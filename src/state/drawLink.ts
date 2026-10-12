// "Check the draw" (#406 spec step 6, #418): after a MagicBlock pull, one link opens the oracle's fulfilment transaction, the
// one that delivered the pull's random bytes. The app builds the URL itself and opens nothing the server names: only a
// well-formed transaction signature on a cluster it knows becomes a link, so a bad or hostile view shows no link at all.
import { useEffect, useState } from 'react';
import { api, type PullDrawView, type PullPrepareResponse } from '@/api';

const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;

/** The Solana Explorer page of this draw's fulfilment, or null when the view does not name one the app can link. */
export function drawTxUrl(view: PullDrawView): string | null {
  const signature = view.fulfilSignature;
  const query = view.cluster === 'devnet' ? '?cluster=devnet' : view.cluster === 'mainnet-beta' ? '' : undefined;
  if (view.source !== 'magicblock' || query === undefined || typeof signature !== 'string' || !SIGNATURE.test(signature)) return null;
  return `https://explorer.solana.com/tx/${signature}${query}`;
}

/** Tries before the link is given up on: the fulfilment can lag the settled pull by an index read (server/src/draw.ts). */
export const DRAW_LINK_TRIES = 3;
export const DRAW_LINK_RETRY_MS = 2_000;

/** The link for the pull on show, fetched while it is shown so the press itself opens it at once (a browser blocks a window
 *  opened after an await). Null for a pull not drawn by MagicBlock, until the view answers, and when it names no link. */
export function useDrawLink(prepared: PullPrepareResponse | undefined, shown: boolean): string | null {
  const pullId = shown && prepared?.draw?.source === 'magicblock' ? prepared.pullId : null;
  const [link, setLink] = useState<{ pullId: string; url: string } | null>(null);
  useEffect(() => {
    if (!pullId) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = (n: number) => {
      api.pullDraw(pullId).then((view) => drawTxUrl(view), () => null).then((url) => {
        if (!live) return;
        if (url) setLink({ pullId, url });
        else if (n + 1 < DRAW_LINK_TRIES) timer = setTimeout(() => attempt(n + 1), DRAW_LINK_RETRY_MS);
      });
    };
    attempt(0);
    return () => { live = false; clearTimeout(timer); };
  }, [pullId]);
  return link && link.pullId === pullId ? link.url : null;
}
