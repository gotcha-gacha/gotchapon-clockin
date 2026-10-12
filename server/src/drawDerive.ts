// The $1 pull's card choice as a public function (#406): the pool frozen at prepare, the 32 bytes MagicBlock delivered, and
// the pull's count and free slots decide every card. No database, no clock, no key: the Worker settles a MagicBlock pull with
// `deriveSlots`, and `scripts/verify-draw.ts` recomputes it with the same function from what is public.
import type { Tier } from './types';

const encoder = new TextEncoder();

export function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function hexToBytes(value: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})+$/i.test(value)) throw new Error('expected hex bytes');
  return Uint8Array.from(value.match(/../g)!, (pair) => Number.parseInt(pair, 16));
}

export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer));
}

export function framed(values: string[]): Uint8Array {
  const chunks = values.map((value) => encoder.encode(value));
  const length = chunks.reduce((total, chunk) => total + 4 + chunk.length, 0);
  const output = new Uint8Array(length);
  const view = new DataView(output.buffer);
  let offset = 0;
  for (const chunk of chunks) {
    view.setUint32(offset, chunk.length);
    offset += 4;
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

/** The server proof's derivation tag. A MagicBlock pull derives under its own tag, so the two roots can never be confused. */
export const ECVRF_DERIVE_TAG = 'gachapon:derive:v1';
export const MAGICBLOCK_DERIVE_TAG = 'gachapon:derive:magicblock:v1';

/** Domain-separated, rejection-sampled indexes derived from one 32-byte random root. */
export class RandomOracle {
  // Plain fields, not parameter properties: scripts/verify-draw.ts runs this file under Node's type stripping, which has none.
  private readonly root: Uint8Array;
  private readonly tag: string;
  constructor(root: Uint8Array, tag: string = ECVRF_DERIVE_TAG) {
    this.root = root;
    this.tag = tag;
  }

  async index(maxExclusive: number, ...domain: (string | number)[]): Promise<number> {
    if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0 || maxExclusive > 0x1_0000_0000) {
      throw new Error('random index bound is invalid');
    }
    const limit = Math.floor(0x1_0000_0000 / maxExclusive) * maxExclusive;
    for (let counter = 0; ; counter++) {
      const digest = await sha256(framed([
        this.tag,
        bytesToHex(this.root),
        ...domain.map(String),
        String(counter),
      ]));
      const value = new DataView(digest.buffer, digest.byteOffset, digest.byteLength).getUint32(0);
      if (value < limit) return value % maxExclusive;
    }
  }
}

export type WeightedTier = { tier: Tier; weight: number };
export type FrozenCard = { key: string; weight: number };
/** Which slots of the pull are burned free-common slots: those in [reservedPaid, reservedPaid + reservedCommon). Part of the
 *  frozen pool, so the hash the program stores binds it: a server cannot pick the split after seeing the bytes. */
export type FrozenSlots = { count: number; reservedPaid: number; reservedCommon: number };
/** Everything a MagicBlock pull can draw, fixed before any random byte exists. `slots` is the pull's count and free split;
 *  `paid` and `free` are the tier weights for paid slots and burned free-common slots, already narrowed to the tiers the
 *  gacha offers; `cards` lists each tier's candidates (all unlimited stock) in `inventory_key` order with their weights. */
export type FrozenPool = {
  v: 1; slots: FrozenSlots; paid: WeightedTier[]; free: WeightedTier[]; cards: Partial<Record<Tier, FrozenCard[]>>;
};

export const POOL_TAG = 'gachapon:pool:v1';

/** The one string that is stored, hashed and published: fixed key order, no whitespace. */
export function canonicalPool(pool: FrozenPool): string {
  const tiers = (rows: WeightedTier[]) => rows.map((row) => ({ tier: row.tier, weight: row.weight }));
  const cards: Record<string, FrozenCard[]> = {};
  for (const tier of Object.keys(pool.cards).sort() as Tier[]) {
    cards[tier] = (pool.cards[tier] ?? []).map((card) => ({ key: card.key, weight: card.weight }));
  }
  const { count, reservedPaid, reservedCommon } = pool.slots;
  return JSON.stringify({ v: 1, slots: { count, reservedPaid, reservedCommon }, paid: tiers(pool.paid), free: tiers(pool.free), cards });
}

/** sha256(POOL_TAG framed with the canonical pool string), hex. The program stores these 32 bytes with the request. */
export async function poolHash(canonical: string): Promise<string> {
  return bytesToHex(await sha256(framed([POOL_TAG, canonical])));
}

/** The 32 bytes the program is given as `pull_id`. */
export async function pullIdHash(pullId: string): Promise<Uint8Array> {
  return sha256(framed(['gachapon:pull-id:v1', pullId]));
}

async function pick<T extends { weight: number }>(oracle: RandomOracle, rows: T[], ...domain: (string | number)[]): Promise<T> {
  const total = rows.reduce((sum, row) => sum + row.weight, 0);
  if (!rows.length || total <= 0) throw new Error('nothing to draw from');
  const value = await oracle.index(total, ...domain);
  let cursor = 0;
  for (const row of rows) {
    cursor += row.weight;
    if (value < cursor) return row;
  }
  throw new Error('weights did not resolve');
}

export type DerivedSlot = { index: number; tier: Tier; key: string };

/** Every slot of the pull, from the frozen pool alone (its `slots` included) and the 32 bytes. */
export async function deriveSlots(pool: FrozenPool, randomness: Uint8Array): Promise<DerivedSlot[]> {
  if (randomness.length !== 32) throw new Error('randomness must be 32 bytes');
  const slots = pool.slots;
  const whole = (n: unknown) => Number.isSafeInteger(n) && (n as number) >= 0;
  if (!slots || ![1, 5, 10].includes(slots.count) || !whole(slots.reservedPaid) || !whole(slots.reservedCommon)
    || slots.reservedPaid + slots.reservedCommon > slots.count) throw new Error('pool slots are invalid');
  const oracle = new RandomOracle(randomness, MAGICBLOCK_DERIVE_TAG);
  const out: DerivedSlot[] = [];
  for (let index = 0; index < slots.count; index++) {
    const freeCommon = index >= slots.reservedPaid && index < slots.reservedPaid + slots.reservedCommon;
    const { tier } = await pick(oracle, freeCommon ? pool.free : pool.paid, index, 'tier');
    const { key } = await pick(oracle, pool.cards[tier] ?? [], index, 'inventory');
    out.push({ index, tier, key });
  }
  return out;
}
