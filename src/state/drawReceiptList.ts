// The receipt list itself (#406), with no storage and no app imports: the device store (drawReceipts.ts) keeps it, and the
// server's verifier test (server/scripts/__tests__/verify-draw-receipt.test.ts) builds a file with these same functions, so the
// shape the app writes is the shape the verifier is proven to read. Only type imports here: Node runs this file by stripping
// types, and resolves no `@/` alias.
import type { DrawCommitment } from '@/api/contract';

export type DrawReceipt = { pullId: string; keptAt: string } & DrawCommitment;

/** The newest receipts kept; older ones fall off. */
export const RECEIPT_LIMIT = 200;

export function isReceipt(v: unknown): v is DrawReceipt {
  const r = v as Partial<DrawReceipt> | null;
  return typeof r?.pullId === 'string' && r.source === 'magicblock' && Number.isSafeInteger(r.sequence) && (r.sequence as number) > 0
    && typeof r.poolHash === 'string' && /^[0-9a-f]{64}$/.test(r.poolHash) && typeof r.keptAt === 'string';
}

/** The stored text's receipts; anything unreadable or malformed is dropped. */
export function parseReceipts(text: string | null): DrawReceipt[] {
  try {
    const stored: unknown = text === null ? [] : JSON.parse(text);
    return Array.isArray(stored) ? stored.filter(isReceipt) : [];
  } catch {
    return [];
  }
}

/** The list with this prepared pull's commitment added: null when it carries none (or a malformed one), the same list when the
 *  pull already has a receipt (the first commitment for a pull id wins), and only the newest RECEIPT_LIMIT. */
export function withReceipt(list: DrawReceipt[], prepared: { pullId: string; draw?: DrawCommitment }, at: Date): DrawReceipt[] | null {
  const draw = prepared.draw;
  const receipt = draw ? { pullId: prepared.pullId, source: draw.source, sequence: draw.sequence, poolHash: draw.poolHash,
    keptAt: at.toISOString() } : null;
  if (!receipt || !isReceipt(receipt)) return null;
  if (list.some((r) => r.pullId === receipt.pullId)) return list;
  return [...list, receipt].slice(-RECEIPT_LIMIT);
}

/** The text the device stores, and the file a user hands to the verifier (`verify-draw.ts --receipt`). */
export function serializeReceipts(list: DrawReceipt[]): string {
  return JSON.stringify(list);
}
