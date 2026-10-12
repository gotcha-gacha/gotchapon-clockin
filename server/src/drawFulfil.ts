// Is this transaction MagicBlock's delivery of a draw (#406)? Shared by the Worker (archiving the fulfilment signature) and
// scripts/verify-draw.ts (checking it), so both read a fulfilment the same way. Imports nothing local: the verifier runs this
// file under Node's type stripping, which resolves no extensionless relative import.
import { getBase58Encoder } from '@solana/kit';

export const VRF_PROGRAM = 'Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz';
export const FULFILL_DRAW = [136, 46, 22, 51, 33, 153, 232, 234];

export type FulfilIx = { programIdIndex: number; accounts: number[]; data: string };
export type FulfilTx = {
  transaction: { message: { accountKeys: string[]; instructions: FulfilIx[] } };
  meta: { err: unknown; innerInstructions?: { index: number; instructions: FulfilIx[] }[];
    loadedAddresses?: { writable: string[]; readonly: string[] } };
};

/** The 32 bytes MagicBlock's VRF program, as a top-level instruction of this successful transaction, handed to `program`'s
 *  fulfill_draw for `draw`; null when the transaction is no such delivery. A fulfill_draw at top level, under another
 *  program's instruction, on another account, or in a failed transaction does not count. */
export function deliveredRandomness(tx: FulfilTx, program: string, draw: string): Uint8Array | null {
  if (tx.meta.err) return null;
  const keys = [...tx.transaction.message.accountKeys, ...(tx.meta.loadedAddresses?.writable ?? []),
    ...(tx.meta.loadedAddresses?.readonly ?? [])];
  const base58 = getBase58Encoder();
  for (const group of tx.meta.innerInstructions ?? []) {
    const outer = tx.transaction.message.instructions[group.index];
    if (!outer || keys[outer.programIdIndex] !== VRF_PROGRAM) continue;
    for (const ix of group.instructions) {
      const data = Uint8Array.from(base58.encode(ix.data));
      if (keys[ix.programIdIndex] === program && FULFILL_DRAW.every((byte, i) => data[i] === byte)
        && ix.accounts.some((index) => keys[index] === draw)) return data.slice(8, 40);
    }
  }
  return null;
}

export function isFulfilment(tx: FulfilTx, program: string, draw: string): boolean {
  return deliveredRandomness(tx, program, draw) !== null;
}
