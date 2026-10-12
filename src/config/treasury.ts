// Where this build expects a paid pull's USDC to go (#186, #101). Pinned per environment at build time, out of band: a value
// the API sent could be moved by the same server that moves the destination beside it. The values for each environment are
// public and live in server/wrangler.jsonc (`TREASURY_USDC_TOKEN_ACCOUNT`, `USDC_MINT`); the destination is the treasury's
// USDC **token account**, not its owner wallet, because that is what an SPL transfer pays.
//
// Either one missing means no paid pull can be signed on this build (src/api/paymentGuard.ts refuses on `null`). The in-app
// mock and `EXPO_PUBLIC_DEV_PAYMENTS` never sign, so neither needs them.
import type { ExpectedPayment } from '@/api/paymentGuard';

// Written out in full: Expo inlines `process.env.EXPO_PUBLIC_*` only where it is spelled as a static member access.
const to = process.env.EXPO_PUBLIC_TREASURY_USDC_TOKEN_ACCOUNT;
const mint = process.env.EXPO_PUBLIC_USDC_MINT;

export const expectedUsdcPayment: ExpectedPayment | null = to && mint ? { to, mint } : null;

/** The mint alone, for a connected-wallet deposit (#278): it pays the user's own embedded wallet, not the treasury, so it needs
 *  no treasury account, only the mint it must move. Unset refuses every such deposit (src/api/paymentGuard.ts). */
export const pinnedUsdcMint: string | null = mint || null;
