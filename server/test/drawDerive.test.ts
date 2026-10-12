// Known-answer vectors for the public draw derivation (#406). These are the spec a third party implements to check a pull:
// an independent Python implementation written from the description below (5 Oct 2026) produced the same three answers.
//   pool hash   = sha256(frame("gachapon:pool:v1") ‖ frame(canonical pool JSON))
//   pull id     = sha256(frame("gachapon:pull-id:v1") ‖ frame(pullId))
//   index(max, …domain) = first sha256(frame(tag) ‖ frame(hex(root)) ‖ frame(each domain part) ‖ frame(counter)) whose
//                 big-endian u32 is below floor(2^32 / max) · max, taken mod max; tag "gachapon:derive:magicblock:v1"
//   pool JSON   = {v, slots: {count, reservedPaid, reservedCommon}, paid, free, cards}; burned slots are
//                 [reservedPaid, reservedPaid + reservedCommon)
//   slot i      = tier by index(Σtier weights, i, "tier") over free odds for burned slots, else paid odds; then card by
//                 index(Σcard weights, i, "inventory") over that tier's cards. frame(s) = u32 big-endian byte length ‖ UTF-8.
import { describe, expect, it } from 'vitest';
import { canonicalPool, deriveSlots, ECVRF_DERIVE_TAG, MAGICBLOCK_DERIVE_TAG, poolHash, pullIdHash, bytesToHex, RandomOracle,
  type FrozenPool } from '../src/drawDerive';

const pool: FrozenPool = {
  v: 1,
  slots: { count: 10, reservedPaid: 0, reservedCommon: 2 },
  paid: [{ tier: 'common', weight: 700 }, { tier: 'holo', weight: 300 }],
  free: [{ tier: 'common', weight: 1 }],
  cards: {
    common: [{ key: 'common:A:a', weight: 1 }, { key: 'common:A:b', weight: 2 }, { key: 'common:A:c', weight: 3 }],
    holo: [{ key: 'holo:x', weight: 1 }, { key: 'holo:y', weight: 1 }],
  },
};
const randomness = Uint8Array.from({ length: 32 }, (_, i) => i);

describe('draw derivation known answers (#406)', () => {
  it('canonical pool and its hash', async () => {
    const canonical = canonicalPool(pool);
    expect(canonical).toBe('{"v":1,"slots":{"count":10,"reservedPaid":0,"reservedCommon":2},"paid":[{"tier":"common","weight":700},{"tier":"holo","weight":300}],"free":[{"tier":"common","weight":1}],'
      + '"cards":{"common":[{"key":"common:A:a","weight":1},{"key":"common:A:b","weight":2},{"key":"common:A:c","weight":3}],'
      + '"holo":[{"key":"holo:x","weight":1},{"key":"holo:y","weight":1}]}}');
    expect(await poolHash(canonical)).toBe('99b8ea2de9e7050a8ecf384af9c3c358bc3939d2e6f5f8520b35ff1f93db30ff');
  });

  it('pull id hash', async () => {
    expect(bytesToHex(await pullIdHash('pull_0001'))).toBe('42c37f6e2c8f9e6f6fa75ee0d484da25964d37e399d666f160c3b39efad13188');
  });

  it('a ×10 with two burned free slots', async () => {
    const slots = await deriveSlots(pool, randomness);
    expect(slots.map((s) => s.key)).toEqual(['common:A:c', 'common:A:c', 'common:A:c', 'common:A:b', 'common:A:c',
      'common:A:c', 'common:A:a', 'common:A:b', 'holo:x', 'common:A:c']);
  });

  it('a burned free slot draws from the free odds, a paid slot from the paid odds', async () => {
    // Free odds that hold only holo, against paid odds that hold only common: every slot's tier says which odds it used.
    const split: FrozenPool = { ...pool, slots: { count: 5, reservedPaid: 1, reservedCommon: 2 },
      paid: [{ tier: 'common', weight: 1 }], free: [{ tier: 'holo', weight: 1 }] };
    const slots = await deriveSlots(split, randomness);
    expect(slots.map((s) => s.tier)).toEqual(['common', 'holo', 'holo', 'common', 'common']);
  });

  it('rejection sampling: a bound where a quarter of u32 values are rejected', async () => {
    // floor(2^32 / 3e9) · 3e9 = 3e9, so values in [3e9, 2^32) are drawn again: four of these ten were (Python cross-check).
    const oracle = new RandomOracle(randomness, MAGICBLOCK_DERIVE_TAG);
    const values = await Promise.all(Array.from({ length: 10 }, (_, i) => oracle.index(3_000_000_000, i, 'probe')));
    expect(values).toEqual([203795556, 434180987, 2455322189, 470245134, 1630442160, 350114593, 1778121247, 1190830326,
      676615717, 349227505]);
  });

  it('randomness that is not exactly 32 bytes is refused (a published value is checked, not trusted)', async () => {
    for (const length of [0, 31, 33]) {
      await expect(deriveSlots(pool, new Uint8Array(length))).rejects.toThrow('randomness must be 32 bytes');
    }
  });

  it('a pool whose slots are not a pull the app can make is refused', async () => {
    for (const slots of [{ count: 3, reservedPaid: 0, reservedCommon: 0 }, { count: 5, reservedPaid: 4, reservedCommon: 2 },
      { count: 1, reservedPaid: -1, reservedCommon: 0 }, { count: 1, reservedPaid: 0.5, reservedCommon: 0 }]) {
      await expect(deriveSlots({ ...pool, slots }, randomness)).rejects.toThrow('pool slots are invalid');
    }
  });

  it('the MagicBlock tag and the server proof tag give different draws from the same root', async () => {
    const values = async (tag: string) => {
      const oracle = new RandomOracle(randomness, tag);
      return Promise.all(Array.from({ length: 8 }, (_, i) => oracle.index(1_000_000, i, 'tier')));
    };
    expect(await values(MAGICBLOCK_DERIVE_TAG)).not.toEqual(await values(ECVRF_DERIVE_TAG));
  });
});
