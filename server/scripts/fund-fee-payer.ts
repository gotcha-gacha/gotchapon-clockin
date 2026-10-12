import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTransferSolInstruction } from '@solana-program/system';
import {
  address,
  assertIsFullySignedTransaction,
  assertIsTransactionWithBlockhashLifetime,
  createClient,
  sendAndConfirmTransactionFactory,
} from '@solana/kit';
import { solanaMainnetRpc } from '@solana/kit-plugin-rpc';
import { signerFromFile } from '@solana/kit-plugin-signer';

type Config = {
  cluster: 'mainnet-beta';
  rpcUrl: string;
  operatorKeypair: string;
  feePayerAddress: string;
  feePayerFundingSol: string;
};

function parseArgs(argv: string[]) {
  const configIndex = argv.indexOf('--config');
  const digestIndex = argv.indexOf('--approve-digest');
  const execute = argv.includes('--execute');
  if (configIndex < 0 || !argv[configIndex + 1]) throw new Error('--config <path> is required');
  if (execute && (digestIndex < 0 || !argv[digestIndex + 1])) {
    throw new Error('--execute requires --approve-digest <review digest>');
  }
  return {
    configPath: resolve(argv[configIndex + 1]),
    execute,
    approvedDigest: digestIndex >= 0 ? argv[digestIndex + 1] : undefined,
  };
}

function solToLamports(value: string): bigint {
  if (!/^(0|[1-9]\d*)(\.\d{1,9})?$/.test(value)) {
    throw new Error('feePayerFundingSol must be a decimal with at most 9 fractional digits');
  }
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 1_000_000_000n + BigInt((fraction + '000000000').slice(0, 9));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = JSON.parse(await readFile(args.configPath, 'utf8')) as Config;
  if (config.cluster !== 'mainnet-beta') throw new Error('funding script only supports mainnet-beta');
  const rpcUrl = new URL(config.rpcUrl);
  if (rpcUrl.protocol !== 'https:') throw new Error('rpcUrl must use HTTPS');

  const operatorKeypair = resolve(dirname(args.configPath), config.operatorKeypair);
  const destination = address(config.feePayerAddress);
  const amountLamports = solToLamports(config.feePayerFundingSol);
  const client = await createClient()
    .use(signerFromFile(operatorKeypair))
    .use(solanaMainnetRpc({ rpcUrl: rpcUrl.toString() }));
  const source = client.payer.address;
  if (client.identity.address !== source) throw new Error('operator must be identity and transaction payer');
  if (source === destination) throw new Error('source and fee payer destination must differ');

  const [sourceBalance, destinationBalance] = await Promise.all([
    client.rpc.getBalance(source, { commitment: 'confirmed' }).send(),
    client.rpc.getBalance(destination, { commitment: 'confirmed' }).send(),
  ]);
  if (sourceBalance.value <= amountLamports) throw new Error('operator balance cannot cover amount plus fee');

  const review = {
    cluster: config.cluster,
    source,
    destination,
    amountLamports: amountLamports.toString(),
    amountSol: config.feePayerFundingSol,
    sourceBalanceLamports: sourceBalance.value.toString(),
    destinationBalanceLamports: destinationBalance.value.toString(),
    action: 'transfer-sol-to-api-fee-payer',
  };
  const digest = createHash('sha256').update(JSON.stringify(review)).digest('hex');
  console.log(JSON.stringify({ ...review, approvalDigest: digest, mode: args.execute ? 'execute' : 'review' }, null, 2));
  if (!args.execute) return;
  if (args.approvedDigest !== digest) throw new Error(`--approve-digest must equal reviewed digest ${digest}`);

  const signed = await client.signTransaction([
    getTransferSolInstruction({ source: client.payer, destination, amount: amountLamports }),
  ]);
  const simulation = await client.rpc.simulateTransaction(signed.context.transactionBase64, {
    commitment: 'confirmed',
    encoding: 'base64',
    sigVerify: true,
  }).send();
  if (simulation.value.err !== null) throw new Error(`fee-payer funding simulation failed: ${JSON.stringify(simulation.value.err)}`);
  console.log(`Simulation succeeded (${simulation.value.unitsConsumed ?? 'unknown'} compute units)`);

  assertIsFullySignedTransaction(signed.context.transaction);
  assertIsTransactionWithBlockhashLifetime(signed.context.transaction);
  const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc: client.rpc, rpcSubscriptions: client.rpcSubscriptions });
  await sendAndConfirm(signed.context.transaction, { commitment: 'confirmed', skipPreflight: false });
  console.log(JSON.stringify({ signature: signed.context.signature, destination, amountLamports: amountLamports.toString() }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
