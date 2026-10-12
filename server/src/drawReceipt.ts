// The user's receipt for a MagicBlock pull (#406): the sequence and pool hash the server committed the pull to before payment.
// verify-draw.ts takes them from here, never from the server's view. A user may hand over the app's stored receipt file (an
// array of { pullId, source, sequence, poolHash, keptAt }, src/state/drawReceiptList.ts), one entry of it, or the raw prepare
// response ({ pullId, draw: { source, sequence, poolHash } }). Imports nothing local: the verifier runs this file under Node's
// type stripping.

export type Commitment = { pullId: string; sequence: number; poolHash: string };

function commitmentOf(item: unknown): Commitment | null {
  const outer = item as { pullId?: unknown; draw?: unknown } | null;
  const draw = (outer?.draw ?? outer) as { source?: unknown; sequence?: unknown; poolHash?: unknown } | null;
  if (typeof outer?.pullId !== 'string' || draw?.source !== 'magicblock') return null;
  if (!Number.isSafeInteger(draw.sequence) || (draw.sequence as number) <= 0) return null;
  if (typeof draw.poolHash !== 'string' || !/^[0-9a-f]{64}$/.test(draw.poolHash)) return null;
  return { pullId: outer.pullId, sequence: draw.sequence as number, poolHash: draw.poolHash };
}

/** This pull's commitment from a receipt file, or null when the file holds none for it. In a list, the FIRST receipt for the
 *  pull id is the one (the app keeps the first commitment and never replaces it). */
export function commitmentFromReceipt(receipt: unknown, pullId: string): Commitment | null {
  const items = Array.isArray(receipt) ? receipt : [receipt];
  for (const item of items) {
    const commitment = commitmentOf(item);
    if (commitment?.pullId === pullId) return commitment;
  }
  return null;
}
