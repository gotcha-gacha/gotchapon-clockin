// Error → user copy (F0.2). Plain, warm, says what happened and what to do. Never "oops".
import { PRODUCT_NAME } from '@/brand/name';
import type { ApiErrorBody, ApiErrorCode } from './contract';

export class ApiError extends Error {
  code: ApiErrorCode;
  hint?: string;
  status?: number;
  constructor(body: ApiErrorBody, status?: number) {
    super(body.message);
    this.name = 'ApiError';
    this.code = body.code;
    this.hint = body.hint;
    this.status = status;
  }
}

export const errorCopy: Record<ApiErrorCode, { title: string; body: string; action?: string }> = {
  INSUFFICIENT_FUNDS: { title: 'Out of pulls', body: 'Deposit USDC to keep going — $1 is one pull, no minimum.', action: 'Add funds' },
  RESTOCKING: { title: 'That one is restocking', body: 'That pull is sold out until the next restock. Nothing was charged.', action: 'See stock' },
  TX_NOT_FOUND: { title: 'We could not see your payment yet', body: 'The network is slow. Your capsule stays sealed until it lands — nothing is lost.', action: 'Try again' },
  TX_MISMATCH: { title: 'That payment did not match this pull', body: 'Nothing was taken. If you sent funds, they are still in your wallet.', action: 'Try again' },
  EXPIRED: { title: 'That pull timed out', body: 'Turn the crank again — the price has not changed.', action: 'Pull again' },
  GEO_BLOCKED: { title: 'Not available where you are', body: `${PRODUCT_NAME} is not offered in your country yet.` },
  UNAUTHENTICATED: { title: 'Signed out', body: 'Sign in again to keep pulling.', action: 'Sign in' },
  NETWORK: { title: 'No connection', body: 'Check your connection and try again. If you already paid, your capsule is safe — retrying picks it up.', action: 'Retry' },
  UNREADABLE: { title: 'We could not read the reply', body: 'The request went out but the answer came back unreadable. Try again — anything that landed is waiting for you.', action: 'Retry' },
  UNKNOWN: { title: 'Something went wrong', body: 'Try again in a moment. A paid pull is never lost — it resolves to a card or a refund.', action: 'Retry' },
};

/** A commit refusal that retrying the same paid pull can never turn into cards: the payment did not match this pull
 *  (the server says nothing was taken) or the pull expired before the payment landed (anything that went out is
 *  refunded). The session stops keeping such a pull, and its sealed capsule offers Start over instead of Try again.
 *  Both readings are assumed from BUILD_PLAN §2, not observed from a server. */
export function commitCannotOpen(code: ApiErrorCode | undefined): boolean {
  return code === 'TX_MISMATCH' || code === 'EXPIRED';
}

/** No answer we can read came back, so the request may have landed: the client's NETWORK (offline or timed out) and UNREADABLE
 *  (the body was not JSON, so only the status is known). A free pull or a burn that fails either way is kept to open again —
 *  commit is idempotent on its pull id and a burn on its key, so sending it again costs nothing. Any answer the client can read,
 *  including an UNKNOWN code from the server, means the request was answered and the pull is not kept. */
export function answerLost(code: ApiErrorCode | undefined): boolean {
  return code === 'NETWORK' || code === 'UNREADABLE';
}

/** How a sealed capsule that can still open ends: it waits and nothing is lost. */
const WAITS = 'Reconnect and try again, or leave it — the capsule waits and nothing is lost.';
/** The same, for an answer that arrived but could not be read: there is nothing to reconnect. */
const UNREAD_WAITS = 'Try again, or leave it — the capsule waits and nothing is lost.';

/** Copy for a sealed capsule. After a signed transfer, whether the payment landed is unknown, so it never says it went
 *  through or suggests pulling again: a capsule that can still open waits and loses nothing, and one that cannot says
 *  what happened to the money (F2.10). A free pull or a burn seals only when its answer was lost (`answerLost`), and
 *  nothing was paid for it. */
/** `kept` false: the device could not store the pull (the web's private mode, a full quota; on a phone, a full disk), so it lives
 *  in memory only. It says "this device" because the same sentence is shown by the apps (PR #154's review: it said "this browser" on an iPhone). The copy then says to open it now and never that the capsule waits. What the server owes a payment is unchanged. */
const NOT_KEPT_PAID = 'Your payment was sent. This device could not save the capsule, so try again now. If you leave, a paid pull still resolves to a card or a refund.';
const NOT_KEPT_FREE = 'This device could not save the capsule, so try again now. Nothing was paid for it.';

const BURN_WAITS = 'Try again, or leave it — the free pull waits and nothing is lost.';
const BURN_NOT_KEPT = 'This device could not save the burn, so try again now. Nothing was paid for it.';

/** A burn seals only when its answer was lost. It credits a free pull and awards no card, so the copy never says a capsule is waiting. */
export function burnSealedCopy(code: ApiErrorCode | undefined, kept = true): { title: string; body: string } {
  const title = code === 'UNREADABLE' ? errorCopy.UNREADABLE.title : errorCopy.NETWORK.title;
  return { title, body: kept ? BURN_WAITS : BURN_NOT_KEPT };
}

export function sealedCopy(code: ApiErrorCode | undefined, paid: boolean, kept = true): { title: string; body: string } {
  const copy = keptCopy(code, paid);
  // What happened has not changed, only what can be promised. A pull that can never open promises no waiting to begin with.
  if (kept || (paid && commitCannotOpen(code))) return copy;
  return { title: copy.title, body: paid ? NOT_KEPT_PAID : NOT_KEPT_FREE };
}

function keptCopy(code: ApiErrorCode | undefined, paid: boolean): { title: string; body: string } {
  if (!paid) return { title: code === 'UNREADABLE' ? errorCopy.UNREADABLE.title : errorCopy.NETWORK.title, body: code === 'UNREADABLE' ? UNREAD_WAITS : WAITS };
  switch (code) {
    case 'TX_MISMATCH': return { title: errorCopy.TX_MISMATCH.title, body: errorCopy.TX_MISMATCH.body };
    case 'EXPIRED': return { title: errorCopy.EXPIRED.title, body: 'Your payment did not land in time, so this capsule cannot open. Anything that went out comes back to your balance.' };
    case 'TX_NOT_FOUND': return { title: 'Waiting for your payment to land', body: 'The network is slow. Try again in a moment, or leave it — the capsule waits and nothing is lost.' };
    // The commit's own INSUFFICIENT_FUNDS (#273): the wallet did not hold enough when the payment was sent, so nothing was sent.
    case 'INSUFFICIENT_FUNDS': return { title: 'Not enough in your wallet', body: 'Nothing was taken. Add USDC and try again within a minute, or leave it — a capsule that cannot be paid for gives back any free pulls it held.' };
    case 'NETWORK': return { title: errorCopy.NETWORK.title, body: `Your payment was sent. ${WAITS}` };
    case 'UNREADABLE': return { title: errorCopy.UNREADABLE.title, body: `Your payment was sent. ${UNREAD_WAITS}` };
    default: return { title: 'Your capsule is sealed', body: 'Your payment was sent. Try again to open it, or leave it for later — a paid pull always resolves to a card or a refund.' };
  }
}

/** Copy for a prepare (or any unsealed failure) that spent nothing. `errorCopy.UNREADABLE` talks about something waiting,
 *  and `errorCopy.UNKNOWN` about a paid pull — neither is true of a refused quote. Other codes keep their own body. */
export function prepareErrorCopy(code: ApiErrorCode): string {
  if (code === 'UNREADABLE' || code === 'UNKNOWN') return 'Try again in a moment. Nothing was charged.';
  return errorCopy[code].body;
}

export function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  return new ApiError({ code: 'UNKNOWN', message: e instanceof Error ? e.message : String(e) });
}
