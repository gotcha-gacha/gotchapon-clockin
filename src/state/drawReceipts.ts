// MagicBlock draw receipts (#406): what the server committed a pull to before the user paid (its sequence and frozen pool's
// hash). Kept on the device after the pull settles, so the draw can be checked against it later (server/scripts/verify-draw.ts
// --receipt, which reads this file as stored). A server that published a different sequence's draw for this pull would not
// match. Nothing secret.
import type { DrawCommitment } from '@/api/contract';
import { parseReceipts, serializeReceipts, withReceipt, type DrawReceipt } from './drawReceiptList';
import { readStored, writeStored } from './storage';

export { RECEIPT_LIMIT, type DrawReceipt } from './drawReceiptList';

const NAME = 'draw-receipts.json';

export function readDrawReceipts(): DrawReceipt[] {
  try {
    return parseReceipts(readStored(NAME));
  } catch {
    return [];
  }
}

/** Keeps the receipt for a prepared pull that carries a MagicBlock commitment; any other answer keeps nothing. True when
 *  stored. The first receipt for a pull id wins: a later answer for the same pull never replaces what was promised first. */
export function keepDrawReceipt(prepared: { pullId: string; draw?: DrawCommitment }, at = new Date()): boolean {
  const list = readDrawReceipts();
  const next = withReceipt(list, prepared, at);
  if (next === null) return false;
  if (next === list) return true;
  return writeStored(NAME, serializeReceipts(next));
}

export function drawReceipt(pullId: string): DrawReceipt | undefined {
  return readDrawReceipts().find((r) => r.pullId === pullId);
}

/** The receipts as one text for the user to take off the device (#418): the stored receipts, serialised as the app stores them
 *  (the same bytes for any file the app wrote; a malformed entry is dropped), which is what the verifier reads
 *  (`verify-draw.ts --receipt <file> --pull <id>`). Null when the device holds none, so there is nothing to offer. */
export function drawReceiptsExport(): { text: string; count: number } | null {
  const list = readDrawReceipts();
  return list.length ? { text: serializeReceipts(list), count: list.length } : null;
}
