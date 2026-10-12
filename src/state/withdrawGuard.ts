// Every withdrawal goes out through this (#187). It exists so the destination check belongs to the *seam* rather than to
// whichever implementation is behind it today: the in-app mock now, Privy's session signer at F7.4. The first version of
// this fix put the check inside the mock's own function, one line below `if (!m) return null` — which reads as guarded and
// is not, because F7.4's real send is written in that `null` branch and would have inherited a comment, not a check
// (PR #195's review). Taking the sender as an argument moves the check out of the stub F7.4 replaces, and the wiring below
// is pinned by `withdraw.test.tsx` — returning the sender unwrapped fails it. What it does NOT do is bind the next branch:
// an unguarded send written in the session's `if (!m) return null` branch passes tsc, lint and every test (PR #195's round
// 2 wrote one and ran them). So F7.4 has to call this deliberately. The binding shape is not on offer — see below.
//
// It takes the sender per call rather than returning a wrapped one: React Compiler's lint refuses a closure over render
// state passed to a function *during* render (`react-hooks/refs` on `withDestinationCheck(send)` inside the `useMemo` —
// ran it), and the session's sender closes over `applyBalance`. Handing it over at call time is the same guarantee with
// no render-time pass.
import { isSolanaAddress } from '@/api/solanaAddress';

export type Send = (usd: number, address: string, idem: string) => Promise<void>;

/** Sends `usd` to `address` through `send`, refusing a destination that is not a Solana address before `send` is reached.
 *  The address is trimmed the way a paste arrives, and `send` is handed the trimmed string so nothing re-derives it. */
export async function sendChecked(send: Send, usd: number, address: string, idem: string): Promise<void> {
  const to = address.trim();
  if (!isSolanaAddress(to)) throw new Error('withdraw: the destination is not a Solana address');
  await send(usd, to, idem);
}
