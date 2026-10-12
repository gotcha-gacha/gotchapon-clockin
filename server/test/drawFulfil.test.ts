// What counts as MagicBlock's delivery of a draw (#406): the Worker archives by it and the verifier checks by it.
import { getBase58Decoder } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { deliveredRandomness, FULFILL_DRAW, VRF_PROGRAM, type FulfilTx } from '../src/drawFulfil';

const PROGRAM = 'GJZe44ZXk27WxVqXgEbX9tXNpxrPBAA9Z1a7Gd8Rp5ut';
const DRAW = 'Draw1111111111111111111111111111111111111111';
const OTHER = 'Other111111111111111111111111111111111111111';
const ORACLE = 'vrfkfM4uoisXZQPrFiS2brY4oMkU9EWjyvmvqaFd5AS';
const bytes = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const b58 = (data: Uint8Array) => getBase58Decoder().decode(data);
const fulfil = b58(Uint8Array.from([...FULFILL_DRAW, ...bytes]));

// keys: 0 oracle, 1 VRF program, 2 draw program, 3 draw account, 4 another account
function tx(options: { outerProgram?: number; innerAccount?: number; data?: string; err?: unknown; inner?: boolean } = {}): FulfilTx {
  const inner = { programIdIndex: 2, accounts: [options.innerAccount ?? 3], data: options.data ?? fulfil };
  return {
    transaction: { message: { accountKeys: [ORACLE, VRF_PROGRAM, PROGRAM, DRAW, OTHER],
      instructions: options.inner === false ? [inner] : [{ programIdIndex: options.outerProgram ?? 1, accounts: [3], data: '1' }] } },
    meta: { err: options.err ?? null, innerInstructions: options.inner === false ? [] : [{ index: 0, instructions: [inner] }] },
  };
}

describe('deliveredRandomness (#406)', () => {
  it('reads the bytes MagicBlock handed to fulfill_draw for this draw account', () => {
    expect(deliveredRandomness(tx(), PROGRAM, DRAW)).toEqual(bytes);
  });
  it('refuses a fulfill_draw that is not under the VRF program\'s own instruction', () => {
    expect(deliveredRandomness(tx({ outerProgram: 2 }), PROGRAM, DRAW)).toBeNull();
    expect(deliveredRandomness(tx({ inner: false }), PROGRAM, DRAW)).toBeNull();
  });
  it('refuses one on another account, another program, a failed transaction, or other data', () => {
    expect(deliveredRandomness(tx({ innerAccount: 4 }), PROGRAM, DRAW)).toBeNull();
    expect(deliveredRandomness(tx(), OTHER, DRAW)).toBeNull();
    expect(deliveredRandomness(tx({ err: { InstructionError: [0, 'Custom'] } }), PROGRAM, DRAW)).toBeNull();
    expect(deliveredRandomness(tx({ data: b58(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, ...bytes])) }), PROGRAM, DRAW)).toBeNull();
  });
});
