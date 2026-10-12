# Gotchapon

![Gotchapon](assets/brand/mark-3a.svg)

**A $1 capsule machine for Pokémon trading cards, built for your phone.** Turn the crank, a capsule drops, scratch it open,
and the card goes into a 25-card album. Three albums are live (75 cards). The goal is to **finish an album**, not to hit a
jackpot: every album is made of commons, so finishing one is something a player can actually do, and every pull moves
them closer. Duplicates count too: five extras burn into a free pull. A finished album's **Claim pack** sends a free
**Jupiter Degen pack** to the player's wallet. Every paid pull also earns raffle tickets for the season draw, and a
**5-day streak** of paid days adds two more.

You sign in with Google or your email and get a Solana wallet with no seed phrase. Pulls cost $1 in USDC. The interface
never talks about the chain; underneath, every pull is a real Solana payment.

Entered in **CLOCK IN**, the Solana Mobile hackathon (with RadiantsDAO).

**APK:** [Releases](https://github.com/gotcha-gacha/gotchapon-clockin/releases/latest) · **In a browser:** [gotchapon.fun](https://gotchapon.fun) · The demo
video and pitch deck are linked in the CLOCK IN submission.

---

## Try it (about 5 minutes, on any Android phone)

The APK talks to **mainnet-dev**, our staging stack: Solana mainnet, real Privy sign-in, real transactions and real draws,
but **payments use a test USDC mint with no cash value** (`6yCC9D83GvZg8s2rT5ftXPiSCWgf7qmKfD1HZqXM29HT`), not Circle's
USDC. For judging, this stack is open in every country. [gotchapon.fun](https://gotchapon.fun) runs the same app on the same
stack in a browser (sign in with Apple, Google or email); the steps below are for the phone.

1. **Install** the APK from [Releases](https://github.com/gotcha-gacha/gotchapon-clockin/releases/latest) on a Seeker or any
   Android phone (allow installs from your browser or file manager).
2. **Pull your first card** → the sign-in sheet rises. **Continue with Google**, or enter your email for a code. Privy
   creates your Solana wallet with no seed phrase.
3. Skip or step through the three intro sheets. You land on **Albums** with $0.
4. Swipe to **Wallet** → **Claim test USDC**: **$100 of test USDC**, once per account, straight into your wallet.
5. Swipe to **Pull** and turn the crank one full circle (or shake the phone hard). Your wallet signs a $1 transfer, and the
   server draws the card at the moment the turn completes. Scratch the capsule (or tap it three times), then
   **Into binder**. You never need SOL for a pull: our fee payer co-signs it.
6. Try **×5** or **×10**: the capsules land as one pile, and **Tap the pile to open all N** deals them out.
7. Back on **Albums**, open a binder. **Pull $1.50** chases a card from *that* album (any card, duplicates included).
   With five extras, **Burn 5 → free pull**. The header shows your streak and raffle tickets.

**Seeker / wallet-app path (Solana Mobile Stack).** On Android, the Wallet page also offers **Deposit from a wallet app**
through Mobile Wallet Adapter:

- **Connect wallet app** opens the wallet on your phone (the Seeker's own wallet, Phantom, Solflare…). It asks you to
  approve the connection and sign a sign-in message, which links that wallet to your Gotchapon account. No transaction is
  signed.
- **Claim test USDC to wallet app** sends your account's one faucet grant to that wallet instead (use it *instead of*
  step 4).
- **Deposit from wallet app** has the server build the transfer into your Gotchapon wallet. The app checks the exact bytes,
  and your wallet app signs them. The wallet app pays its own network fee; the first deposit also pays about 0.002 SOL of
  rent for your Gotchapon wallet's USDC account, so it needs a little SOL.

**What $100 won't show.** An album is 25 cards drawn at random with repeats, so finishing one takes about 95 chase pulls on
average. Completion and **Claim pack** are in the demo video. On mainnet-dev, Claim answers *"temporarily unavailable"*
because the house gift wallet is switched off there.

---

## How Solana is used

| What | How | Where |
|---|---|---|
| **Embedded wallet** | Privy creates a Solana wallet at first sign-in. Your balance is the USDC in *your* wallet, read from chain. Money leaves it only when you pull. | `src/auth/privyAuth.tsx`, `server/src/catalog.ts` |
| **$1 USDC payment** | At crank start the server builds a v0 transaction: one SPL `TransferChecked` of exactly the quoted amount to the treasury token account, plus a Memo of the pull id, with the server as fee payer. | `server/src/payments.ts` |
| **Client-side payment guard** | Before signing, the phone decodes the transaction bytes and refuses unless they hold exactly that transfer: the amount, a mint and treasury pinned in the build, your wallet as authority, the pull id as memo, nothing else. | `src/api/paymentGuard.ts` |
| **Sign on the phone, broadcast on the server** | The phone adds only your signature and never broadcasts. The Worker checks your signature covers the unchanged bytes, adds the fee-payer signature, broadcasts, and counts the payment at `confirmed`. | `src/auth/nativeSolanaSigner.ts`, `server/src/payments.ts` |
| **One signature, one pull** | `pulls.tx_signature` is `UNIQUE`; a payment receipt is keyed by its signature; commit is idempotent on both. The receipt and the obligation are written before any card is allocated. | `server/schema.sql` |
| **Draws** | RFC 9381 ECVRF: the input hashes your client seed with the pull; output bytes go through domain-separated, rejection-sampled choices. The proof is kept server-side with the pull. | `server/src/randomness.ts`, `server/src/pulls.ts` |
| **MagicBlock VRF draws** (built, off on mainnet-dev) | An Anchor program requests one MagicBlock VRF draw per pull sequence; a used-sequence bitmap means a pull can never be re-rolled. Before you pay, prepare hands you the sequence and a hash of the frozen card pool; the card is `deriveSlots(pool, 32 bytes)`, recomputable by anyone. **Check the draw** opens the fulfilment transaction. Program (devnet): `GJZe44ZXk27WxVqXgEbX9tXNpxrPBAA9Z1a7Gd8Rp5ut`. | `onchain/draw/`, `server/src/draw.ts`, `server/scripts/verify-draw.ts` |
| **Mobile Wallet Adapter** (Android) | `@solana-mobile/mobile-wallet-adapter-protocol`: authorize, a Sign in with Solana link through Privy, then the wallet app signs the server-built deposit after the same byte check. Loaded lazily, Android only. | `src/wallet/`, `src/components/wallet/WalletAppDepositPanel.tsx` |
| **Jupiter Degen gift** (built, off on mainnet-dev) | Claim pack asks Jupiter's API for one `degen_100` gift to your wallet, signs it with a house wallet and submits it; the album counts as claimed only once the gift id and signature are stored, idempotent per (player, album). | `server/src/jupiterGift.ts` |
| **Refunds** (built, sending off) | A Cron Trigger finds confirmed payments that can no longer become cards and, when enabled, sends exactly the paid amount back to the wallet that paid, from a dedicated refund wallet, with the signed transaction stored before broadcast and per-sweep and per-day caps. | `server/src/refunds.ts` |
| **Test token and faucet** | mainnet-dev runs its own SPL mint; the faucet stores the exact signed transfer before broadcasting, so a retry resends the same signature. | `server/src/faucet.ts` |

**What is not on chain:** cards. There are no NFTs. Owning a card is a row in `user_inventory` (D1); Solana handles
payment, randomness and the partner gift.

---

## Architecture

```
  Android APK · iOS · Web          one Expo codebase (SDK 57, React Native 0.86, expo-router)
  ┌───────────────────────────────────────────────┐
  │ crank / capsule / binder UI  (Reanimated,     │
  │ Gesture Handler, Skia scratch, haptics, shake)│
  │ Privy ── embedded Solana wallet (signs)       │
  │ Mobile Wallet Adapter ── wallet apps (Android)│
  │ paymentGuard ── checks tx bytes before signing│
  │ in-app mock ── same API shape, for demos/tests│
  └──────────────────────┬────────────────────────┘
                         │ HTTPS + Privy access token
  ┌──────────────────────▼────────────────────────┐
  │ Cloudflare Worker  (server/)                  │──► Solana RPC: build, verify, co-sign,
  │  prepare → commit → settle, burns, claims     │    broadcast USDC transfers
  │  D1: catalog, gachas, pinned odds, pulls,     │──► ECVRF, or the MagicBlock VRF draw
  │      receipts, inventory, streak, tickets     │    program (flag)
  │  Cron: refund sweeper                         │──► Jupiter API: Degen gift (flag)
  └───────────────────────────────────────────────┘
```

- **App:** `src/` (the ritual state machine in `src/ritual/`, the machine in `src/components/machine/`), routes in `src/app/`.
- **API:** `server/src/index.ts` (routes), `server/src/pulls.ts` (settlement), `server/schema.sql` (the whole ledger in one file).
- **In-app mock:** `src/api/mock/`. A development build with no API URL runs entirely on device with demo money, and the
  header shows a **DEMO** pill. Release builds cannot carry it: the web export's artifact is read back to prove it.

---

## Product rules the code keeps

- **The outcome is decided when the crank completes 360°, after payment is verified,** never before, and the animation
  never chooses it. The capsule, scratch and reveal only show what the server already decided.
- **No near-miss, no pity timer, no bundle discount, no animation timing that depends on the outcome.** ×5 costs $5, ×10 $10.
- **Odds:** each paid $1 pull is one of the 75 album cards, each equally likely (1 in 75). A $1.50 chase is one of that
  album's 25 cards (1 in 25) and can repeat a card you already have. Odds are pinned per pull at prepare time.
- **A confirmed payment always resolves to cards or a refund**, and one transaction signature can never fund two pulls.
- **Free pulls are only earned:** five extras burn into one. New accounts start at 0.
- **Streak:** one paid pull of at least $1 per Malaysia calendar day. Day 5 grants +2 raffle tickets once; missing a day resets it.

---

## Build and test

Node ≥ 20 and pnpm 10 (`node-linker=hoisted`, already set in `.npmrc`).

```sh
pnpm install
cp .env.example .env.local      # leave EXPO_PUBLIC_API_URL empty to run the in-app mock

pnpm verify                     # tsc + eslint + jest (native and web projects) + a pinned web export with bundle checks
pnpm server:verify              # Worker: typecheck, script tests, vitest on workerd

pnpm web                        # browser, against the mock
pnpm server:db:reset && pnpm server:db:seed && pnpm server:dev   # local Worker on :8787 with mock payments
```

The judge APK is built with EAS: `eas build --profile preview --platform android`. The `preview` profile turns the mock
off and points at the mainnet-dev Worker with its treasury token account, test USDC mint and Privy app id, all public by
design. No secrets are in the repository: the fee-payer key, VRF seed, Privy app secret and house wallet keys are Worker
secrets.

---

## What is real, and what is coming

| Live on mainnet-dev today | Built, switched off | Not built yet |
|---|---|---|
| Privy sign-in, embedded wallet | MagicBlock VRF draws, **Check the draw** | **Physical cards:** the 75-card stock is not yet bought and counted, so today a pulled card is a record in your binder |
| $100 test-USDC faucet, deposits, Mobile Wallet Adapter (Android) | Jupiter Degen gift on Claim pack | **Shipping** |
| $1 / ×5 / ×10 pulls, $1.50 chase, sponsored fees | Refund sending | Card top-up / onramp |
| Payment guard, ECVRF draws, binder, burns, completion | | The raffle draw (end of 30 Nov 2026, Malaysia time) and its prizes, bought before the draw |
| Streak, raffle tickets | | Real-money launch: web first, then the stores after a legal review |

---

## Team and notices

Built by [@benlvb](https://github.com/benlvb). Gotchapon is a working name.

This snapshot is one commit of a private repository built in September and October 2026; the full development history is
available to the judges on request.

Pokémon, the card names and the card images belong to their respective owners. Gotchapon is not affiliated with, or
endorsed by, Nintendo, The Pokémon Company, Creatures or GAME FREAK. Jupiter, MagicBlock, Privy and Solana Mobile are
third-party services; no partnership is implied.

**License:** all rights reserved (see `LICENSE`). The source is published to be read.
