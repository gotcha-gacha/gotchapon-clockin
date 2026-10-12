import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  TOKEN_PROGRAM_ADDRESS,
  tokenProgram,
} from '@solana-program/token';
import {
  assertIsFullySignedTransaction,
  assertIsTransactionWithBlockhashLifetime,
  createClient,
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
  getTransactionDecoder,
  lamports,
  partiallySignTransaction,
  sendAndConfirmTransactionFactory,
  type Address,
} from '@solana/kit';
import { solanaLocalRpc } from '@solana/kit-plugin-rpc';
import { airdropSigner, generatedSigner } from '@solana/kit-plugin-signer';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  broadcastPaymentTransaction,
  preparePaymentTransaction,
  sponsorPaymentTransaction,
  verifyPayment,
} from '../src/payments';
import type { Env } from '../src/types';

const rpcUrl = process.env.SURFPOOL_RPC_URL ?? 'http://127.0.0.1:18899';
const rpcSubscriptionsUrl = process.env.SURFPOOL_WS_URL ?? 'ws://127.0.0.1:18900';

let signature = '';
let pullId = '';
let mint: Address;
let treasuryTokenAccount: Address;
let simulatedUnits = 0n;

beforeAll(async () => {
  const client = await createClient()
    .use(generatedSigner())
    .use(solanaLocalRpc({ rpcUrl, rpcSubscriptionsUrl, skipPreflight: false }))
    .use(airdropSigner(lamports(10_000_000_000n)))
    .use(tokenProgram());

  const mintSigner = await generateKeyPairSigner();
  const treasury = await generateKeyPairSigner();
  const user = await generateKeyPairSigner();
  mint = mintSigner.address;

  await client.token.instructions
    .createMint({
      newMint: mintSigner,
      decimals: 6,
      mintAuthority: client.identity.address,
    })
    .sendTransaction();

  await client.token.instructions
    .mintToATA({
      mint: mintSigner.address,
      owner: user.address,
      mintAuthority: client.identity,
      amount: 10_000_000n,
      decimals: 6,
    })
    .sendTransaction();

  [treasuryTokenAccount] = await findAssociatedTokenPda({
    owner: treasury.address,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    mint: mintSigner.address,
  });
  pullId = `pull-e2e-${crypto.randomUUID()}`;

  const ataTransaction = await client.signTransaction([
    getCreateAssociatedTokenIdempotentInstruction({
      payer: client.payer,
      ata: treasuryTokenAccount,
      owner: treasury.address,
      mint: mintSigner.address,
    }),
  ]);
  assertIsFullySignedTransaction(ataTransaction.context.transaction);
  assertIsTransactionWithBlockhashLifetime(ataTransaction.context.transaction);
  const sendAndConfirm = sendAndConfirmTransactionFactory({
    rpc: client.rpc,
    rpcSubscriptions: client.rpcSubscriptions,
  });
  await sendAndConfirm(ataTransaction.context.transaction, { commitment: 'confirmed', skipPreflight: false });

  const feePayer = await generateKeyPairSigner(true);
  await client.airdrop(feePayer.address, lamports(100_000_000n));
  const privatePkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', feePayer.keyPair.privateKey));
  const publicBytes = new Uint8Array(await crypto.subtle.exportKey('raw', feePayer.keyPair.publicKey));
  const secret = new Uint8Array(64);
  secret.set(privatePkcs8.slice(-32));
  secret.set(publicBytes, 32);
  const env = {
    DB: null as unknown as D1Database,
    ENVIRONMENT: 'local',
    AUTH_MODE: 'dev',
    PAYMENTS_MODE: 'solana-rpc',
    SOLANA_RPC_URL: rpcUrl,
    TREASURY_USDC_TOKEN_ACCOUNT: treasuryTokenAccount,
    TREASURY_USDT_TOKEN_ACCOUNT: treasuryTokenAccount,
    USDC_MINT: mint,
    USDT_MINT: mint,
    FEE_PAYER_ADDRESS: feePayer.address,
    FEE_PAYER_KEYPAIR: JSON.stringify([...secret]),
  } as Env;

  const preparedBase64 = await preparePaymentTransaction(env, {
    wallet: user.address,
    memo: pullId,
    asset: 'USDC',
    amount: 1_000_000,
  });
  const prepared = getTransactionDecoder().decode(Uint8Array.from(
    atob(preparedBase64), (character) => character.charCodeAt(0),
  ));
  expect(Object.values(prepared.signatures)).toEqual([null, null]);
  const userSigned = await partiallySignTransaction([user.keyPair], prepared);
  expect(userSigned.signatures[feePayer.address]).toBeNull();

  const sponsored = await sponsorPaymentTransaction(
    env,
    preparedBase64,
    getBase64EncodedWireTransaction(userSigned),
    user.address,
  );
  const signedPayment = getTransactionDecoder().decode(Uint8Array.from(
    atob(sponsored.transactionBase64), (character) => character.charCodeAt(0),
  ));
  assertIsFullySignedTransaction(signedPayment);
  const simulation = await client.rpc
    .simulateTransaction(sponsored.transactionBase64, {
      commitment: 'confirmed',
      encoding: 'base64',
      sigVerify: true,
    })
    .send();
  if (simulation.value.err !== null) {
    throw new Error(`Payment simulation failed: ${JSON.stringify(simulation.value.err)}`);
  }
  simulatedUnits = simulation.value.unitsConsumed ?? 0n;
  signature = await broadcastPaymentTransaction(env, sponsored.transactionBase64);
});

describe('Surfpool payment verification', () => {
  it('accepts the exact confirmed transfer and rejects altered claims', async () => {
    expect(simulatedUnits).toBeGreaterThan(0n);

    const env = {
      DB: null as unknown as D1Database,
      ENVIRONMENT: 'local',
      AUTH_MODE: 'dev',
      PAYMENTS_MODE: 'solana-rpc',
      SOLANA_RPC_URL: rpcUrl,
      TREASURY_USDC_TOKEN_ACCOUNT: treasuryTokenAccount,
      TREASURY_USDT_TOKEN_ACCOUNT: treasuryTokenAccount,
      USDC_MINT: mint,
      USDT_MINT: mint,
    } as Env;

    await expect(
      verifyPayment(env, {
        signature,
        memo: pullId,
        asset: 'USDC',
        amount: 1_000_000,
      }),
    ).resolves.toMatchObject({ signature, destination: treasuryTokenAccount });

    await expect(
      verifyPayment(env, {
        signature,
        memo: `${pullId}-wrong`,
        asset: 'USDC',
        amount: 1_000_000,
      }),
    ).rejects.toMatchObject({ code: 'TX_MISMATCH' });

    await expect(
      verifyPayment(env, {
        signature,
        memo: pullId,
        asset: 'USDC',
        amount: 2_000_000,
      }),
    ).rejects.toMatchObject({ code: 'TX_MISMATCH' });
  });
});
