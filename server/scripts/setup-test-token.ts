import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  fetchMaybeMint,
  fetchMaybeToken,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getInitializeMint2Instruction,
  getMintSize,
  getMintToCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
  getTokenSize,
} from '@solana-program/token';
import { getCreateAccountWithSeedInstruction } from '@solana-program/system';
import {
  address,
  assertIsFullySignedTransaction,
  assertIsTransactionWithBlockhashLifetime,
  createAddressWithSeed,
  createClient,
  isSome,
  sendAndConfirmTransactionFactory,
  type Address,
  type Instruction,
} from '@solana/kit';
import { solanaMainnetRpc } from '@solana/kit-plugin-rpc';
import { signerFromFile } from '@solana/kit-plugin-signer';

type Args = {
  configPath: string;
  execute: boolean;
  approvedDigest?: string;
};

type Config = {
  cluster: 'mainnet-beta';
  rpcUrl: string;
  operatorKeypair: string;
  testToken: { seed: string; decimals: number; initialSupply: string; treasuryOwner: string };
};

const usage = `Usage:
  node scripts/setup-test-token.ts --config <mainnet-dev.json> \\
    [--execute --approve-digest <review digest>]

Without --execute the command is read-only and prints the deterministic mint,
treasury ATA, current chain state, required actions, and approval digest.`;

function valueAfter(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

export function parseArgs(argv: string[]): Args {
  const values = new Map<string, string>();
  let execute = false;
  const allowed = new Set(['--config', '--approve-digest', '--execute']);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!allowed.has(flag)) throw new Error(`unknown argument ${flag}\n\n${usage}`);
    if (flag === '--execute') {
      if (execute) throw new Error('--execute may only be specified once');
      execute = true;
      continue;
    }
    if (values.has(flag)) throw new Error(`${flag} may only be specified once`);
    values.set(flag, valueAfter(argv, index, flag));
    index += 1;
  }
  if (!values.has('--config')) throw new Error(`--config is required\n\n${usage}`);
  const approvedDigest = values.get('--approve-digest');
  if (execute && !approvedDigest) throw new Error('--execute requires --approve-digest');
  if (!execute && approvedDigest) throw new Error('--approve-digest is only valid with --execute');
  return {
    configPath: resolve(values.get('--config')!),
    execute,
    approvedDigest,
  };
}

export function parseTokenAmount(value: string, decimals: number): bigint {
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(value)) {
    throw new Error('--initial-supply must be a non-negative decimal without separators or exponent notation');
  }
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > decimals) throw new Error('--initial-supply has more fractional digits than --decimals');
  const amount = BigInt(whole) * (10n ** BigInt(decimals))
    + BigInt((fraction + '0'.repeat(decimals)).slice(0, decimals) || '0');
  if (amount > 18_446_744_073_709_551_615n) throw new Error('--initial-supply exceeds the SPL Token u64 limit');
  return amount;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = JSON.parse(await readFile(args.configPath, 'utf8')) as Config;
  if (config.cluster !== 'mainnet-beta') throw new Error('config cluster must be mainnet-beta');
  const rpcUrl = new URL(config.rpcUrl);
  if (rpcUrl.protocol !== 'https:') throw new Error('config rpcUrl must be an HTTPS endpoint');
  const { seed, decimals, initialSupply } = config.testToken;
  if (new TextEncoder().encode(seed).length > 32 || seed.length === 0) throw new Error('testToken.seed must contain 1 to 32 UTF-8 bytes');
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 9) throw new Error('testToken.decimals must be an integer from 0 to 9');
  parseTokenAmount(initialSupply, decimals);
  const treasuryOwner = address(config.testToken.treasuryOwner);
  const operatorKeypair = resolve(dirname(args.configPath), config.operatorKeypair);
  const client = await createClient()
    .use(signerFromFile(operatorKeypair))
    .use(solanaMainnetRpc({ rpcUrl: rpcUrl.toString() }));
  const operator = client.identity.address;
  if (client.payer.address !== operator) throw new Error('operator must be both setup identity and transaction payer');

  const mint = await createAddressWithSeed({
    baseAddress: operator,
    seed,
    programAddress: TOKEN_PROGRAM_ADDRESS,
  });
  const [treasuryTokenAccount] = await findAssociatedTokenPda({
    owner: treasuryOwner,
    mint,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const desiredSupply = parseTokenAmount(initialSupply, decimals);
  const [existing, existingTreasury, operatorBalance, mintRent, tokenAccountRent] = await Promise.all([
    fetchMaybeMint(client.rpc, mint, { commitment: 'confirmed' }),
    fetchMaybeToken(client.rpc, treasuryTokenAccount, { commitment: 'confirmed' }),
    client.rpc.getBalance(operator, { commitment: 'confirmed' }).send(),
    client.getMinimumBalance(getMintSize()),
    client.getMinimumBalance(getTokenSize()),
  ]);
  const instructions: Instruction[] = [];
  let currentSupply = 0n;

  if (!existing.exists) {
    const rent = await client.getMinimumBalance(getMintSize());
    instructions.push(
      getCreateAccountWithSeedInstruction({
        payer: client.payer,
        newAccount: mint,
        baseAccount: client.identity,
        base: operator,
        seed,
        amount: rent,
        space: getMintSize(),
        programAddress: TOKEN_PROGRAM_ADDRESS,
      }),
      getInitializeMint2Instruction({
        mint,
        decimals,
        mintAuthority: operator,
        freezeAuthority: null,
      }),
    );
  } else {
    if (!existing.data.isInitialized) throw new Error(`derived mint ${mint} exists but is not initialized`);
    if (existing.data.decimals !== decimals) {
      throw new Error(`derived mint has ${existing.data.decimals} decimals, expected ${decimals}`);
    }
    if (!isSome(existing.data.mintAuthority) || existing.data.mintAuthority.value !== operator) {
      throw new Error('derived mint is not controlled by the operator');
    }
    if (isSome(existing.data.freezeAuthority)) throw new Error('derived mint unexpectedly has a freeze authority');
    currentSupply = existing.data.supply;
  }
  if (currentSupply > desiredSupply) {
    throw new Error(`existing supply ${currentSupply} exceeds requested target ${desiredSupply}`);
  }
  if (existingTreasury.exists
    && (existingTreasury.data.mint !== mint || existingTreasury.data.owner !== treasuryOwner)) {
    throw new Error('derived treasury ATA exists with unexpected mint or owner data');
  }

  instructions.push(getCreateAssociatedTokenIdempotentInstruction({
    payer: client.payer,
    ata: treasuryTokenAccount,
    owner: treasuryOwner,
    mint,
  }));
  const mintDelta = desiredSupply - currentSupply;
  if (mintDelta > 0n) {
    instructions.push(getMintToCheckedInstruction({
      mint,
      token: treasuryTokenAccount,
      mintAuthority: client.identity,
      amount: mintDelta,
      decimals,
    }));
  }

  const review = {
    cluster: 'mainnet-beta',
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    operator,
    mint,
    mintAuthority: operator,
    freezeAuthority: null,
    seed,
    decimals,
    desiredSupply: desiredSupply.toString(),
    currentSupply: currentSupply.toString(),
    mintDelta: mintDelta.toString(),
    treasuryOwner,
    treasuryTokenAccount,
    treasuryTokenAccountExists: existingTreasury.exists,
    operatorBalanceLamports: operatorBalance.value.toString(),
    estimatedNewAccountRentLamports: (
      (existing.exists ? 0n : mintRent)
      + (existingTreasury.exists ? 0n : tokenAccountRent)
    ).toString(),
    actions: [
      ...(!existing.exists ? ['create-mint', 'initialize-mint'] : []),
      'ensure-treasury-ata',
      ...(mintDelta > 0n ? ['mint-to-treasury'] : []),
    ],
  };
  const digest = createHash('sha256').update(JSON.stringify(review)).digest('hex');
  console.log(JSON.stringify({ ...review, approvalDigest: digest, mode: args.execute ? 'execute' : 'review' }, null, 2));
  if (!args.execute || instructions.length === 0) return;
  if (args.approvedDigest !== digest) throw new Error(`--approve-digest must equal reviewed digest ${digest}`);

  const signed = await client.signTransaction(instructions);
  const simulation = await client.rpc.simulateTransaction(signed.context.transactionBase64, {
    commitment: 'confirmed',
    encoding: 'base64',
    sigVerify: true,
  }).send();
  if (simulation.value.err !== null) {
    throw new Error(`test token simulation failed: ${JSON.stringify(simulation.value.err)}`);
  }
  console.log(`Simulation succeeded (${simulation.value.unitsConsumed ?? 'unknown'} compute units)`);
  const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc: client.rpc, rpcSubscriptions: client.rpcSubscriptions });
  assertIsFullySignedTransaction(signed.context.transaction);
  assertIsTransactionWithBlockhashLifetime(signed.context.transaction);
  await sendAndConfirm(signed.context.transaction, { commitment: 'confirmed', skipPreflight: false });
  console.log(JSON.stringify({
    signature: signed.context.signature,
    USDC_MINT: mint,
    TREASURY_USDC_TOKEN_ACCOUNT: treasuryTokenAccount,
  }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
