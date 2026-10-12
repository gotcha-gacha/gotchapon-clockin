import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fetchMaybeMint,
  fetchMaybeToken,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
  getTokenSize,
} from '@solana-program/token';
import {
  address,
  assertIsFullySignedTransaction,
  assertIsTransactionWithBlockhashLifetime,
  createAddressWithSeed,
  createClient,
  sendAndConfirmTransactionFactory,
} from '@solana/kit';
import { solanaMainnetRpc } from '@solana/kit-plugin-rpc';
import { signerFromFile } from '@solana/kit-plugin-signer';
import { parseTokenAmount } from './setup-test-token.ts';

type Config = {
  cluster: 'mainnet-beta';
  rpcUrl: string;
  operatorKeypair: string;
  feePayerAddress: string;
  testToken: { seed: string; decimals: number; faucetTargetBalance: string };
};

function parseArgs(argv: string[]) {
  const configIndex = argv.indexOf('--config');
  const digestIndex = argv.indexOf('--approve-digest');
  const execute = argv.includes('--execute');
  if (configIndex < 0 || !argv[configIndex + 1]) throw new Error('--config <path> is required');
  if (execute && (digestIndex < 0 || !argv[digestIndex + 1])) throw new Error('--execute requires --approve-digest');
  return { configPath: resolve(argv[configIndex + 1]), execute,
    approvedDigest: digestIndex >= 0 ? argv[digestIndex + 1] : undefined };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = JSON.parse(await readFile(args.configPath, 'utf8')) as Config;
  if (config.cluster !== 'mainnet-beta') throw new Error('config cluster must be mainnet-beta');
  const rpcUrl = new URL(config.rpcUrl);
  if (rpcUrl.protocol !== 'https:') throw new Error('config rpcUrl must use HTTPS');
  const operatorKeypair = resolve(dirname(args.configPath), config.operatorKeypair);
  const client = await createClient()
    .use(signerFromFile(operatorKeypair))
    .use(solanaMainnetRpc({ rpcUrl: rpcUrl.toString() }));
  const operator = client.identity.address;
  const faucetOwner = address(config.feePayerAddress);
  const mint = await createAddressWithSeed({ baseAddress: operator, seed: config.testToken.seed,
    programAddress: TOKEN_PROGRAM_ADDRESS });
  const [source] = await findAssociatedTokenPda({ owner: operator, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  const [destination] = await findAssociatedTokenPda({ owner: faucetOwner, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  const target = parseTokenAmount(config.testToken.faucetTargetBalance, config.testToken.decimals);
  const [mintAccount, sourceAccount, destinationAccount, destinationRent] = await Promise.all([
    fetchMaybeMint(client.rpc, mint, { commitment: 'confirmed' }),
    fetchMaybeToken(client.rpc, source, { commitment: 'confirmed' }),
    fetchMaybeToken(client.rpc, destination, { commitment: 'confirmed' }),
    client.getMinimumBalance(getTokenSize()),
  ]);
  if (!mintAccount.exists || mintAccount.data.decimals !== config.testToken.decimals) throw new Error('configured test mint is missing or invalid');
  if (!sourceAccount.exists || sourceAccount.data.owner !== operator || sourceAccount.data.mint !== mint) throw new Error('operator treasury token account is missing or invalid');
  if (destinationAccount.exists && (destinationAccount.data.owner !== faucetOwner || destinationAccount.data.mint !== mint)) {
    throw new Error('faucet token account has unexpected owner or mint');
  }
  const current = destinationAccount.exists ? destinationAccount.data.amount : 0n;
  if (current > target) throw new Error('faucet balance already exceeds configured target');
  const amount = target - current;
  if (sourceAccount.data.amount < amount) throw new Error('operator treasury cannot cover the configured faucet target');

  const review = {
    cluster: config.cluster,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    mint,
    decimals: config.testToken.decimals,
    authority: operator,
    source,
    sourceBalance: sourceAccount.data.amount.toString(),
    faucetOwner,
    destination,
    destinationBalance: current.toString(),
    targetBalance: target.toString(),
    transferAmount: amount.toString(),
    estimatedNewAccountRentLamports: destinationAccount.exists ? '0' : destinationRent.toString(),
    actions: ['ensure-faucet-ata', ...(amount > 0n ? ['transfer-test-usdc-to-faucet'] : [])],
  };
  const digest = createHash('sha256').update(JSON.stringify(review)).digest('hex');
  console.log(JSON.stringify({ ...review, approvalDigest: digest, mode: args.execute ? 'execute' : 'review' }, null, 2));
  if (!args.execute || amount === 0n) return;
  if (args.approvedDigest !== digest) throw new Error(`--approve-digest must equal reviewed digest ${digest}`);

  const signed = await client.signTransaction([
    getCreateAssociatedTokenIdempotentInstruction({ payer: client.payer, ata: destination, owner: faucetOwner, mint }),
    getTransferCheckedInstruction({ source, mint, destination, authority: client.identity,
      amount, decimals: config.testToken.decimals }),
  ]);
  const simulation = await client.rpc.simulateTransaction(signed.context.transactionBase64, {
    commitment: 'confirmed', encoding: 'base64', sigVerify: true,
  }).send();
  if (simulation.value.err !== null) throw new Error(`faucet funding simulation failed: ${JSON.stringify(simulation.value.err)}`);
  console.log(`Simulation succeeded (${simulation.value.unitsConsumed ?? 'unknown'} compute units)`);
  assertIsFullySignedTransaction(signed.context.transaction);
  assertIsTransactionWithBlockhashLifetime(signed.context.transaction);
  const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc: client.rpc, rpcSubscriptions: client.rpcSubscriptions });
  await sendAndConfirm(signed.context.transaction, { commitment: 'confirmed', skipPreflight: false });
  console.log(JSON.stringify({ signature: signed.context.signature, mint, faucetTokenAccount: destination,
    amount: amount.toString() }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
