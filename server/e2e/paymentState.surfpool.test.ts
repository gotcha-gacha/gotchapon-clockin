// #273 against a real Solana RPC (Surfpool): what `broadcastPaymentTransaction` and `paymentState` decide for a paid pull's
// transaction, from chain state. Insufficient funds keeps the pull (it can still land after a top-up); a confirmed block
// height past the blockhash's last valid height, with still no status, releases it. The expiry waits out ~150 blocks (~60 s).
import { findAssociatedTokenPda, getCreateAssociatedTokenIdempotentInstruction, TOKEN_PROGRAM_ADDRESS, tokenProgram } from '@solana-program/token';
import {
  assertIsFullySignedTransaction, assertIsTransactionWithBlockhashLifetime, createClient, generateKeyPairSigner,
  getBase64EncodedWireTransaction, getSignatureFromTransaction, getTransactionDecoder, lamports, partiallySignTransaction,
  sendAndConfirmTransactionFactory,
} from '@solana/kit';
import { solanaLocalRpc } from '@solana/kit-plugin-rpc';
import { airdropSigner, generatedSigner } from '@solana/kit-plugin-signer';
import { beforeAll, describe, expect, it } from 'vitest';
import { broadcastPaymentTransaction, paymentState, preparePaymentWithLifetime, sponsorPaymentTransaction } from '../src/payments';
import type { Env } from '../src/types';

const rpcUrl = process.env.SURFPOOL_RPC_URL ?? 'http://127.0.0.1:18899';
const rpcSubscriptionsUrl = process.env.SURFPOOL_WS_URL ?? 'ws://127.0.0.1:18900';
let env: Env;
let signedFor: (amount: number, memo: string) => Promise<{ tx: string; lastValid: number }>;

beforeAll(async () => {
  const client = await createClient().use(generatedSigner())
    .use(solanaLocalRpc({ rpcUrl, rpcSubscriptionsUrl, skipPreflight: false }))
    .use(airdropSigner(lamports(10_000_000_000n))).use(tokenProgram());
  const mintSigner = await generateKeyPairSigner();
  const treasury = await generateKeyPairSigner();
  const user = await generateKeyPairSigner();
  await client.token.instructions.createMint({ newMint: mintSigner, decimals: 6, mintAuthority: client.identity.address }).sendTransaction();
  await client.token.instructions.mintToATA({ mint: mintSigner.address, owner: user.address, mintAuthority: client.identity, amount: 10_000_000n, decimals: 6 }).sendTransaction();
  const [treasuryTokenAccount] = await findAssociatedTokenPda({ owner: treasury.address, tokenProgram: TOKEN_PROGRAM_ADDRESS, mint: mintSigner.address });
  const ata = await client.signTransaction([getCreateAssociatedTokenIdempotentInstruction({ payer: client.payer, ata: treasuryTokenAccount, owner: treasury.address, mint: mintSigner.address })]);
  assertIsFullySignedTransaction(ata.context.transaction);
  assertIsTransactionWithBlockhashLifetime(ata.context.transaction);
  await sendAndConfirmTransactionFactory({ rpc: client.rpc, rpcSubscriptions: client.rpcSubscriptions })(ata.context.transaction, { commitment: 'confirmed', skipPreflight: false });
  const feePayer = await generateKeyPairSigner(true);
  await client.airdrop(feePayer.address, lamports(100_000_000n));
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', feePayer.keyPair.privateKey));
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', feePayer.keyPair.publicKey));
  const secret = new Uint8Array(64); secret.set(pkcs8.slice(-32)); secret.set(pub, 32);
  env = {
    DB: null as unknown as D1Database, ENVIRONMENT: 'local', AUTH_MODE: 'dev', PAYMENTS_MODE: 'solana-rpc', SOLANA_RPC_URL: rpcUrl,
    TREASURY_USDC_TOKEN_ACCOUNT: treasuryTokenAccount, USDC_MINT: mintSigner.address,
    FEE_PAYER_ADDRESS: feePayer.address, FEE_PAYER_KEYPAIR: JSON.stringify([...secret]),
  } as Env;
  signedFor = async (amount, memo) => {
    const prepared = await preparePaymentWithLifetime(env, { wallet: user.address, memo, asset: 'USDC', amount });
    const decoded = getTransactionDecoder().decode(Uint8Array.from(atob(prepared.transactionBase64), (c) => c.charCodeAt(0)));
    const userSigned = await partiallySignTransaction([user.keyPair], decoded);
    const tx = (await sponsorPaymentTransaction(env, prepared.transactionBase64, getBase64EncodedWireTransaction(userSigned), user.address)).transactionBase64;
    return { tx, lastValid: prepared.lastValidBlockHeight };
  };
}, 120_000);

const signatureOf = (base64: string) =>
  getSignatureFromTransaction(getTransactionDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))) as never);

describe('payment state on a real RPC (#273)', () => {
  it('the RPC shapes paymentState reads: a status carries its context slot, the epoch info a height and a slot', async () => {
    const call = async (method: string, params: unknown[]) => ((await (await fetch(rpcUrl, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json()) as { result: unknown }).result;
    const statuses = await call('getSignatureStatuses', [['1'.repeat(64)], { searchTransactionHistory: true }]) as { context: { slot: unknown }; value: unknown[] };
    expect(typeof statuses.context.slot).toBe('number');
    expect(statuses.value).toEqual([null]);
    const info = await call('getEpochInfo', [{ commitment: 'confirmed' }]) as { absoluteSlot: unknown; blockHeight: unknown };
    expect([typeof info.absoluteSlot, typeof info.blockHeight]).toEqual(['number', 'number']);
  });

  it('more than the wallet holds: INSUFFICIENT_FUNDS, not released, and the node\'s text is not the message', async () => {
    const { tx, lastValid } = await signedFor(20_000_000, `pull-e2e-short-${crypto.randomUUID()}`);
    const error = await broadcastPaymentTransaction(env, tx, lastValid).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'INSUFFICIENT_FUNDS', release: false });
    expect((error as Error).message).not.toMatch(/simulation|program|0x1/i);
    expect(await paymentState(env, signatureOf(tx), lastValid)).toBe('unknown');
  });

  it('a payment that confirms: the broadcast returns its signature and the state reads confirmed', async () => {
    const { tx, lastValid } = await signedFor(1_000_000, `pull-e2e-ok-${crypto.randomUUID()}`);
    expect(await broadcastPaymentTransaction(env, tx, lastValid)).toBe(signatureOf(tx));
    expect(await paymentState(env, signatureOf(tx), lastValid)).toBe('confirmed');
  });

  it('a blockhash that really expires, with the transaction never sent: the state reads expired only once it has', async () => {
    const { tx, lastValid } = await signedFor(1_000_000, `pull-e2e-expire-${crypto.randomUUID()}`);
    expect(await paymentState(env, signatureOf(tx), lastValid)).toBe('unknown'); // the control: still able to land
    const height = async () => ((await (await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getEpochInfo', params: [{ commitment: 'confirmed' }] }) })).json()) as
      { result: { blockHeight: number } }).result.blockHeight;
    const started = Date.now();
    while ((await height()) <= lastValid) {
      if (Date.now() - started > 150_000) throw new Error('the block height did not pass the lifetime');
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    expect(await paymentState(env, signatureOf(tx), lastValid)).toBe('expired');
    const error = await broadcastPaymentTransaction(env, tx, lastValid).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'EXPIRED', release: true });
  }, 180_000);
});
