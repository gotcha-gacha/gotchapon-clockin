// House-funded Jupiter TCG gift (#402). The Worker generates a gift into the user's Privy
// deposit wallet, signs it with the house sender, and submits it to tcgapi. The house secret
// is a Wrangler secret in the same 64-byte JSON shape as FEE_PAYER_KEYPAIR. It is unset until
// ops creates the wallet; JUPITER_GIFT_ENABLED stays false, and Claim then fails closed.
import {
  address,
  assertIsFullySignedTransaction,
  createKeyPairSignerFromBytes,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  getTransactionDecoder,
  partiallySignTransaction,
} from '@solana/kit';
import { ApiError } from './http';
import type { Env } from './types';

export const GIFT_UNAVAILABLE = 'Your Degen pack is temporarily unavailable. Try again.';
export const ALREADY_CLAIMED = 'That album was already claimed';
const OPEN_DEFAULT = 'https://jup.ag/gacha';
const BASE_DEFAULT = 'https://tcgapi.jup.ag';
const PACK_DEFAULT = 'degen_100';

export type GiftConfig = {
  enabled: true;
  sender: string;
  secret: string;
  baseUrl: string;
  packType: string;
  count: 1;
  openUrl: string;
} | { enabled: false; reason: string };

export type GeneratedGift = {
  memo: string;
  transaction: string;
  giftId?: string;
  totalCost?: string;
  count?: number;
  packType?: string;
};

export type SentGift = {
  giftId?: string;
  memo?: string;
  packType: string;
  count?: number;
  counterparty: string;
  cost?: string;
  status?: string;
  txSignature?: string;
};

export interface TcgGiftClient {
  generateGift(input: { sender: string; receiver: string; packType: string; count: number }): Promise<GeneratedGift>;
  submitGift(input: { signedTransaction: string; memo: string }): Promise<{ signature: string; confirmationStatus?: string }>;
  listSentGifts(houseWallet: string): Promise<SentGift[]>;
  /** Lifetime gifted count for this pack, or null when the purchased read failed. */
  giftedCount(receiver: string, packType: string): Promise<number | null>;
}

/** https://jup.ag/… only. Anything else becomes the locked soft-launch open URL. */
export function safeOpenUrl(raw: string | undefined | null): string {
  if (!raw) return OPEN_DEFAULT;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return OPEN_DEFAULT;
    if (url.hostname !== 'jup.ag' && url.hostname !== 'www.jup.ag') return OPEN_DEFAULT;
    return url.toString();
  } catch {
    return OPEN_DEFAULT;
  }
}

function validSecret(secret: string | undefined): boolean {
  if (!secret) return false;
  try {
    const parsed: unknown = JSON.parse(secret);
    return Array.isArray(parsed) && parsed.length === 64
      && parsed.every((value) => Number.isInteger(value) && value >= 0 && value <= 255);
  } catch {
    return false;
  }
}

function secretBytes(secret: string): Uint8Array {
  return Uint8Array.from(JSON.parse(secret) as number[]);
}

/** Flag, pack, and key shape. Address match is `houseSigner` (it needs the public half of the secret). */
export function giftConfig(env: Env): GiftConfig {
  if (env.JUPITER_GIFT_ENABLED !== 'true') return { enabled: false, reason: 'disabled' };
  if (!env.HOUSE_SENDER_SECRET || !env.HOUSE_SENDER_ADDRESS) return { enabled: false, reason: 'house sender is not configured' };
  if (!validSecret(env.HOUSE_SENDER_SECRET)) return { enabled: false, reason: 'house sender secret is invalid' };
  if ((env.JUPITER_GIFT_COUNT ?? '1') !== '1') return { enabled: false, reason: 'gift count must be 1' };
  const packType = env.JUPITER_GIFT_PACK_TYPE?.trim() || PACK_DEFAULT;
  let baseUrl: string;
  try {
    const url = new URL(env.TCGAPI_BASE_URL?.trim() || BASE_DEFAULT);
    if (url.protocol !== 'https:') return { enabled: false, reason: 'tcg api url is not https' };
    baseUrl = `${url.origin}${url.pathname}`.replace(/\/$/, '');
  } catch {
    return { enabled: false, reason: 'tcg api url is invalid' };
  }
  return {
    enabled: true,
    sender: env.HOUSE_SENDER_ADDRESS,
    secret: env.HOUSE_SENDER_SECRET,
    baseUrl,
    packType,
    count: 1,
    openUrl: safeOpenUrl(env.JUPITER_GACHA_OPEN_URL),
  };
}

export function unavailable(reason: string): ApiError {
  if (reason !== 'disabled') console.error('jupiter gift unavailable', reason);
  return new ApiError('UNKNOWN', GIFT_UNAVAILABLE, 503);
}

export function alreadyClaimed(): ApiError {
  return new ApiError('UNKNOWN', ALREADY_CLAIMED, 409, 'already-claimed');
}

/** The house keypair, or a throw when the secret's public half is not HOUSE_SENDER_ADDRESS. */
export async function houseSigner(secret: string, expectedAddress: string) {
  const signer = await createKeyPairSignerFromBytes(secretBytes(secret));
  let expected: string;
  try { expected = address(expectedAddress); }
  catch { throw new Error('house address'); }
  if (signer.address !== expected) throw new Error('house mismatch');
  return signer;
}

export function receiverAddress(wallet: string | null | undefined): string | null {
  if (!wallet) return null;
  try { return address(wallet); }
  catch { return null; }
}

/** Sign Jupiter's unsigned gift transaction. Returns the wire bytes and the signature those bytes carry. */
export async function signGiftTransaction(secret: string, expectedAddress: string, unsignedBase64: string): Promise<{ signedTransaction: string; signature: string }> {
  if (!unsignedBase64 || unsignedBase64.length > 16_384) throw new Error('gift transaction');
  const signer = await houseSigner(secret, expectedAddress);
  const bytes = Uint8Array.from(atob(unsignedBase64), (character) => character.charCodeAt(0));
  const transaction = getTransactionDecoder().decode(bytes);
  const signed = await partiallySignTransaction([signer.keyPair], transaction);
  assertIsFullySignedTransaction(signed);
  return {
    signedTransaction: getBase64EncodedWireTransaction(signed),
    signature: getSignatureFromTransaction(signed),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asSent(value: unknown): SentGift | null {
  const row = asRecord(value);
  if (!row || typeof row.packType !== 'string' || typeof row.counterparty !== 'string') return null;
  const signature = typeof row.txSignature === 'string' && row.txSignature ? row.txSignature : undefined;
  return {
    giftId: row.giftId == null ? undefined : String(row.giftId),
    memo: typeof row.memo === 'string' ? row.memo : undefined,
    packType: row.packType,
    count: typeof row.count === 'number' ? row.count : undefined,
    counterparty: row.counterparty,
    cost: typeof row.cost === 'string' ? row.cost : undefined,
    status: typeof row.status === 'string' ? row.status : undefined,
    txSignature: signature,
  };
}

async function tcg(baseUrl: string, path: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { accept: 'application/json', ...(init?.body ? { 'content-type': 'application/json' } : {}), ...init?.headers },
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw unavailable('tcg api unreachable');
  }
  if (!response.ok) {
    console.error('jupiter gift tcgapi', path, response.status);
    throw unavailable('tcg api rejected the request');
  }
  try { return await response.json(); }
  catch { throw unavailable('tcg api returned an unreadable body'); }
}

export function liveTcgClient(env: Env): TcgGiftClient {
  const baseUrl = () => {
    const config = giftConfig(env);
    if (!config.enabled) throw unavailable(config.reason);
    return config.baseUrl;
  };
  return {
    async generateGift(input) {
      const body = await tcg(baseUrl(), '/v1/gifts/generate', { method: 'POST', body: JSON.stringify(input) });
      const row = asRecord(body);
      const transaction = asRecord(row?.transaction);
      const memo = typeof transaction?.memo === 'string' ? transaction.memo : '';
      const unsigned = typeof transaction?.transaction === 'string' ? transaction.transaction : '';
      if (!memo || !unsigned) throw unavailable('tcg generate returned no transaction');
      return {
        memo,
        transaction: unsigned,
        giftId: row?.giftId == null ? undefined : String(row.giftId),
        totalCost: typeof row?.totalCost === 'string' ? row.totalCost : undefined,
        count: typeof row?.count === 'number' ? row.count : undefined,
        packType: typeof row?.packType === 'string' ? row.packType : undefined,
      };
    },
    async submitGift(input) {
      const body = await tcg(baseUrl(), '/v1/packs/submit', {
        method: 'POST',
        body: JSON.stringify({ signedTransaction: input.signedTransaction, memo: input.memo }),
      });
      const row = asRecord(body);
      const signature = typeof row?.signature === 'string' ? row.signature : '';
      if (!signature) throw unavailable('tcg submit returned no signature');
      return {
        signature,
        confirmationStatus: typeof row?.confirmationStatus === 'string' ? row.confirmationStatus : undefined,
      };
    },
    async listSentGifts(houseWallet) {
      const body = await tcg(baseUrl(), `/v1/gifts?wallet=${encodeURIComponent(houseWallet)}`);
      const sent = asRecord(body)?.sent;
      if (!Array.isArray(sent)) throw unavailable('tcg gifts list was unreadable');
      return sent.map(asSent).filter((row): row is SentGift => row != null);
    },
    async giftedCount(receiver, packType) {
      try {
        const body = await tcg(baseUrl(), `/v1/packs/purchased?wallet=${encodeURIComponent(receiver)}`);
        const breakdown = asRecord(asRecord(body)?.breakdown);
        const pack = asRecord(breakdown?.[packType]);
        return typeof pack?.gifted === 'number' ? pack.gifted : null;
      } catch {
        return null;
      }
    },
  };
}

/** A landed gift for this album: same receiver, pack, and the gift id or memo we stored before submit. */
export function matchSentGift(
  row: { receiver: string; pack_type: string; gift_id: string | null; memo: string | null },
  sent: SentGift[],
): SentGift | null {
  const mine = sent.filter((gift) => gift.counterparty === row.receiver && gift.packType === row.pack_type && gift.txSignature);
  if (row.gift_id) {
    const hit = mine.find((gift) => gift.giftId === row.gift_id);
    if (hit) return hit;
  }
  if (row.memo) {
    const hit = mine.find((gift) => gift.memo === row.memo);
    if (hit) return hit;
  }
  return null;
}
