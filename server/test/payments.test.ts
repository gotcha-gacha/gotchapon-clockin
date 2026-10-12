import { env } from 'cloudflare:workers';
import {
  AccountRole,
  address,
  appendTransactionMessageInstruction,
  assertIsFullySignedTransaction,
  blockhash,
  compileTransaction,
  createTransactionMessage,
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
  getTransactionDecoder,
  partiallySignTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  signatureBytes,
} from '@solana/kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  acceptUserSignedTransaction,
  broadcastPaymentTransaction,
  hasConfirmed,
  buildDepositTransaction,
  sponsorPaymentTransaction,
  verifyPayment,
  walletBalance,
} from '../src/payments';
import type { Env } from '../src/types';

const owner = '7i6jN4W6Xb2yqqU6Ei9fsgMAGW2x37zmZGfzPvJSEGc4';
const mint = '5NPTRsDiMDtGGBgU2xrCMR5nHoKKMkmT5oM19MPUt547';
const ata = 'FfGJNEx585tv26UsD1nh3fZooexRVFxK7Mfz8FofApVG';

function chainEnv(): Env {
  return {
    ...(env as unknown as Env),
    PAYMENTS_MODE: 'solana-rpc',
    ENABLED_ASSETS: 'USDC',
    SOLANA_RPC_URL: 'https://rpc.example',
    USDC_MINT: mint,
  };
}

beforeEach(() => vi.stubGlobal('isSecureContext', true));
afterEach(() => vi.unstubAllGlobals());

describe('wallet balance', () => {
  it('derives the canonical ATA and reads that one token-account balance', async () => {
    let payload: Record<string, unknown> | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({ jsonrpc: '2.0', id: ata, result: {
        context: { slot: 1 }, value: { amount: '1234567', decimals: 6, uiAmount: 1.234567 },
      } });
    }));

    await expect(walletBalance(chainEnv(), owner)).resolves.toEqual({ usdc: 1_234_567, usdt: 0, pulls: 1 });
    expect(payload).toMatchObject({ method: 'getTokenAccountBalance', params: [ata, { commitment: 'confirmed' }] });
  });

  it('treats a wallet without an ATA as a zero balance', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      jsonrpc: '2.0', id: ata, error: { code: -32602, message: 'Invalid param: could not find account' },
    })));

    await expect(walletBalance(chainEnv(), owner)).resolves.toEqual({ usdc: 0, usdt: 0, pulls: 0 });
  });
});

describe('payment confirmation', () => {
  it('accepts confirmed and finalized statuses, but not processed', () => {
    expect(hasConfirmed('processed')).toBe(false);
    expect(hasConfirmed('confirmed')).toBe(true);
    expect(hasConfirmed('finalized')).toBe(true);
    expect(hasConfirmed(undefined)).toBe(false);
  });

  it('verifies payment contents at confirmed commitment', async () => {
    let payload: { params?: unknown[] } | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      payload = JSON.parse(String(init?.body)) as { params?: unknown[] };
      return Response.json({ jsonrpc: '2.0', id: 'payment-signature', result: {
        slot: 55,
        meta: { err: null },
        transaction: { message: { instructions: [
          { program: 'spl-token', parsed: { type: 'transferChecked', info: {
            destination: ata, mint, tokenAmount: { amount: '1000000' },
          } } },
          { program: 'spl-memo', parsed: 'pull-id' },
        ] } },
      } });
    }));

    await expect(verifyPayment({
      ...chainEnv(), TREASURY_USDC_TOKEN_ACCOUNT: ata,
    }, {
      signature: 'payment-signature', memo: 'pull-id', asset: 'USDC', amount: 1_000_000,
    })).resolves.toEqual({ signature: 'payment-signature', destination: ata, slot: 55 });
    expect(payload?.params?.[1]).toMatchObject({ commitment: 'confirmed' });
  });

  it('makes a lapsed signed blockhash a terminal expired authorization when no payment landed', async () => {
    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (message) => setTransactionMessageFeePayer(address(owner), message),
      (message) => setTransactionMessageLifetimeUsingBlockhash({
        blockhash: blockhash('11111111111111111111111111111111'), lastValidBlockHeight: 1n,
      }, message),
    );
    const unsigned = compileTransaction(transactionMessage);
    const transactionBase64 = getBase64EncodedWireTransaction({
      ...unsigned,
      signatures: {
        ...unsigned.signatures, [owner]: signatureBytes(new Uint8Array(64).fill(1)),
      } as unknown as typeof unsigned.signatures,
    });
    // The answers a real RPC gives once the lifetime has passed (Surfpool 1.5.0, 26 Sept): the send fails with
    // BlockhashNotFound, the signature has no status, the confirmed height is past the last valid one, and the node does
    // not accept the blockhash. The decision reads the height (#273), not the send's text.
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)) as { method: string };
      const result = (value: unknown) => Response.json({ jsonrpc: '2.0', id: payload.method, result: value });
      if (payload.method === 'sendTransaction') {
        return Response.json({ jsonrpc: '2.0', id: payload.method, error: {
          code: -32002, message: 'Transaction simulation failed: Blockhash not found', data: { err: 'BlockhashNotFound' },
        } });
      }
      if (payload.method === 'getSignatureStatuses') return result({ context: { slot: 900 }, value: [null] });
      if (payload.method === 'getEpochInfo') return result({ absoluteSlot: 900, blockHeight: 5 });
      if (payload.method === 'isBlockhashValid') return result({ context: { slot: 900 }, value: false });
      throw new Error(`unexpected ${payload.method}`);
    }));

    // A pull (its lifetime stored): proof that it can never land, so its reservation is released.
    await expect(broadcastPaymentTransaction(chainEnv(), transactionBase64, 1))
      .rejects.toMatchObject({ code: 'EXPIRED', release: true });
    // A deposit (no lifetime stored): the node's word is enough to say EXPIRED, and there is nothing to release.
    await expect(broadcastPaymentTransaction(chainEnv(), transactionBase64))
      .rejects.toMatchObject({ code: 'EXPIRED', release: false });
  });
});

describe('payment sponsorship', () => {
  async function fixture() {
    const feePayer = await generateKeyPairSigner(true);
    const user = await generateKeyPairSigner(true);
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (current) => setTransactionMessageFeePayer(feePayer.address, current),
      (current) => setTransactionMessageLifetimeUsingBlockhash({
        blockhash: blockhash('11111111111111111111111111111111'), lastValidBlockHeight: 1n,
      }, current),
      (current) => appendTransactionMessageInstruction({
        programAddress: address('11111111111111111111111111111111'),
        accounts: [{ address: user.address, role: AccountRole.READONLY_SIGNER }],
      }, current),
    );
    const prepared = compileTransaction(message);
    const userSigned = await partiallySignTransaction([user.keyPair], prepared);
    const privatePkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', feePayer.keyPair.privateKey));
    const publicBytes = new Uint8Array(await crypto.subtle.exportKey('raw', feePayer.keyPair.publicKey));
    const secret = new Uint8Array(64);
    secret.set(privatePkcs8.slice(-32));
    secret.set(publicBytes, 32);
    return {
      feePayer,
      user,
      prepared,
      userSigned,
      env: {
        ...chainEnv(),
        FEE_PAYER_ADDRESS: feePayer.address,
        FEE_PAYER_KEYPAIR: JSON.stringify([...secret]),
      },
    };
  }

  it('adds the fee-payer signature only after a valid user signed the stored message', async () => {
    const value = await fixture();
    expect(Object.values(value.prepared.signatures)).toEqual([null, null]);
    expect(value.userSigned.signatures[value.feePayer.address]).toBeNull();
    expect(value.userSigned.signatures[value.user.address]).not.toBeNull();

    const sponsored = await sponsorPaymentTransaction(
      value.env,
      getBase64EncodedWireTransaction(value.prepared),
      getBase64EncodedWireTransaction(value.userSigned),
      value.user.address,
    );
    const decoded = getTransactionDecoder().decode(Uint8Array.from(
      atob(sponsored.transactionBase64), (character) => character.charCodeAt(0),
    ));
    assertIsFullySignedTransaction(decoded);
    expect(decoded.signatures[value.feePayer.address]).not.toBeNull();
    expect(decoded.signatures[value.user.address]).toEqual(value.userSigned.signatures[value.user.address]);
  });

  it('refuses a changed message before adding the fee-payer signature', async () => {
    const value = await fixture();
    const changedMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (current) => setTransactionMessageFeePayer(value.feePayer.address, current),
      (current) => setTransactionMessageLifetimeUsingBlockhash({
        blockhash: blockhash('SysvarC1ock11111111111111111111111111111111'), lastValidBlockHeight: 1n,
      }, current),
      (current) => appendTransactionMessageInstruction({
        programAddress: address('11111111111111111111111111111111'),
        accounts: [{ address: value.user.address, role: AccountRole.READONLY_SIGNER }],
      }, current),
    );
    const changed = await partiallySignTransaction([value.user.keyPair], compileTransaction(changedMessage));
    await expect(sponsorPaymentTransaction(
      value.env,
      getBase64EncodedWireTransaction(value.prepared),
      getBase64EncodedWireTransaction(changed),
      value.user.address,
    )).rejects.toMatchObject({ code: 'TX_MISMATCH' });
  });
});

describe('connected-wallet deposits', () => {
  it('uses the connected wallet as the only signer and fee payer', async () => {
    const source = await generateKeyPairSigner(true);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      jsonrpc: '2.0', id: 'getLatestBlockhash', result: {
        value: { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 123 },
      },
    })));
    const preparedBase64 = await buildDepositTransaction(chainEnv(), {
      sourceWallet: source.address,
      destinationWallet: owner,
      memo: 'deposit:test',
      amount: 2_000_000,
    });
    const prepared = getTransactionDecoder().decode(Uint8Array.from(
      atob(preparedBase64), (character) => character.charCodeAt(0),
    ));
    expect(Object.keys(prepared.signatures)).toEqual([source.address]);
    expect(prepared.signatures[source.address]).toBeNull();

    const userSigned = await partiallySignTransaction([source.keyPair], prepared);
    const accepted = await acceptUserSignedTransaction(
      preparedBase64,
      getBase64EncodedWireTransaction(userSigned),
      source.address,
    );
    const decoded = getTransactionDecoder().decode(Uint8Array.from(
      atob(accepted.transactionBase64), (character) => character.charCodeAt(0),
    ));
    assertIsFullySignedTransaction(decoded);
    expect(Object.keys(decoded.signatures)).toEqual([source.address]);
  });
});
