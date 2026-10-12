import type { PullCommitRequest, PullPrepareResponse } from '@/api';
import { paysAsExpected, type ExpectedPayment } from '@/api/paymentGuard';

type Signer = (transactionBase64: string) => Promise<string>;

type SignInput = {
  prepared: PullPrepareResponse;
  useMockPayment: boolean;
  /** The treasury and mint this build pinned (`src/config/treasury.ts`); null refuses every real payment. */
  expected: ExpectedPayment | null;
  /** The wallet whose signature is asked for: the transfer's authority has to be this address. */
  authority: string | null | undefined;
};

/** Whether this quote may be signed: always on a mock payment (nothing is signed), and on a real one only when the
 *  server-built transaction pays what the build expects (#186). The ritual asks this at prepare, so a refusal leaves the
 *  machine idle with nothing signed; `signPreparedTransfer` asks it again, so no caller can sign around it. */
export function paymentSignable(input: SignInput): boolean {
  if (input.useMockPayment) return true;
  const transfer = input.prepared.transfer;
  return !!transfer && paysAsExpected(input.prepared.pullId, transfer, input.expected, input.authority);
}

/** The client does not rebuild the API transaction. Privy only adds the user's signature; /commit verifies the stored
 *  message before the API sponsors and broadcasts it. What the client does do is read it first (`paymentSignable`). */
export async function signPreparedTransfer(input: SignInput & { signer: Signer | null | undefined }): Promise<string> {
  if (input.useMockPayment) return `mock:${input.prepared.pullId}`;
  const transaction = input.prepared.transfer?.transactionBase64;
  if (!transaction || !input.signer) {
    throw new Error('The Solana payment signer is not ready. Sign in again and retry.');
  }
  if (!paymentSignable(input)) throw new Error('That payment does not match this pull. Nothing was signed.');
  return input.signer(transaction);
}

export function pullCommitWireRequest(req: PullCommitRequest, realApi: boolean): PullCommitRequest {
  return realApi && req.txSignature && !req.txSignature.startsWith('mock:')
    ? { pullId: req.pullId, signedTransactionBase64: req.txSignature }
    : req;
}
