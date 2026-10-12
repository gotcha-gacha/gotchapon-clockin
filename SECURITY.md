# Security notes and response to the CLOCK IN automated scan (commit f634241)

Written 12 October 2026, for the public snapshot at commit `f634241`. Every file and line reference below is to this
repository at that commit unless it names a published package and version, or MagicBlock's `ephemeral-vrf` repository
at commit `52b103c`.

## Summary

The CLOCK IN platform ran an automated scan of this repository at `f634241`. Its report has 49 entries: 15 under
"Your code" (one finding and 14 "worth a look" pattern matches), 30 under "Packages", and 4 notes about licences and
duplicate crates. We checked every entry against the source, the committed program IDL, the three lockfiles, and fresh
builds of this commit (web export, Android and iOS JavaScript bundles, the Worker bundle).

- **Confirmed vulnerabilities: none.** No entry has an exploit path that we could find.
- **The High finding in our own code is a false positive.** The scan says `fulfill_draw` in the on-chain program
  takes a writable account and no signer. It read the accounts struct as written, before the `#[vrf_callback]` macro
  runs. That macro adds a required signer: MagicBlock's VRF identity for this program, an address that only MagicBlock's
  VRF program can sign for, and it signs only after checking a VRF proof. The IDL that Anchor builds from this source
  lists it as a signer ([onchain/draw/idl/draw.json:92-103](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/onchain/draw/idl/draw.json#L92-L103)). The program is
  deployed on **devnet only**, and nothing live calls it: the mainnet-dev Worker's MagicBlock path is off
  (`DRAW_SOURCE` unset), so every live pull is drawn with the Worker's ECVRF.
- **Code changes needed: none.** No entry is exploitable. One low-impact inconsistency is planned for after the
  deadline: `onchain/draw/package.json` says `"license": "ISC"`, but the repository is all rights reserved. Dependency
  clean-ups that reduce what is installed are planned too (see [What we will change](#what-we-will-change)).
- **Why the other entries are not issues:**
  - The 9 HTML and `new Function` matches are in jest test files that are in no build, or in `src/app/+html.tsx`,
    which writes compile-time constants into a static page once, at export.
  - The 11 "secret read from an inlined env var" matches are test lines that delete or set dummy values, or public
    identifiers that have to be in the client: a PostHog project token, and a treasury token account that the app
    pins so it can check payments. No server secret is an `EXPO_PUBLIC_*` variable.
  - Of the 14 JavaScript package advisories, 12 never reach a shipped build: they are dev tooling, or code that the
    browser and React Native builds never include. The other 2 ship, but on every code path we traced the vulnerable
    function is not called: uuid is only called as `v4()`, and expo-router parses URLs with `URLSearchParams` (from
    reading the code, not a runtime trace).
  - The 5 Rust advisories are transitive dependencies of Anchor, the Solana crates and MagicBlock's SDK. Two of the
    crates are compiled only for the host, not into the program. One flags code that is not compiled in. One is
    listed as patched by its own advisory. One is "unmaintained" with no known vulnerability.
  - The 3 `@solana/web3.js` v1 matches are informational: v1 is in maintenance, and no advisory is listed for the
    pinned version.
  - The 2 Low on-chain findings (owner check, reinitialization) are already covered by the upgrade-authority
    constraint and Anchor's plain `init`.

| Verdict | Entries |
|---|---|
| Confirmed | 0 |
| False positive | 25 |
| Not in any shipped build (dev tooling, or Node-only code the bundlers leave out) | 14 |
| Accepted risk (no exploit path; kept on purpose or waiting on an upstream release) | 10 |
| Needs a fix, low impact (not a scan entry: found next to the licence notes) | 1 |

## What is live, what is devnet-only, what is off

| Part | State |
|---|---|
| Android APK (the CLOCK IN build) | **Live**, against mainnet-dev. Built with the EAS `preview` profile ([eas.json:24-34](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/eas.json#L24-L34)): mock off, the mainnet-dev API, the test USDC mint. |
| gotchapon.fun | **Live**, against mainnet-dev. A static web export ([config/web-mainnet-dev.json](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/config/web-mainnet-dev.json)) served as Cloudflare static assets: [wrangler.web.jsonc](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/wrangler.web.jsonc) has an `assets` block and no Worker script, and [scripts/deploy-web.mjs:56-69](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/scripts/deploy-web.mjs#L56-L69) copies the export into it. |
| Worker `server/`, environment `mainnet-dev` | **Live** ([server/wrangler.jsonc:45-74](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/server/wrangler.jsonc#L45-L74)). Solana mainnet, but payments use a self-made test USDC mint with no cash value, `6yCC9D83GvZg8s2rT5ftXPiSCWgf7qmKfD1HZqXM29HT` ([server/wrangler.jsonc:62](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/server/wrangler.jsonc#L62); README.md lines 24-26). Every live draw is the Worker's RFC 9381 ECVRF ([server/src/randomness.ts](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/server/src/randomness.ts)). |
| Worker environment `production` | **Not deployed.** Its web origin, treasury token accounts, Privy app id and fee payer are still `REPLACE_WITH_…` placeholders ([server/wrangler.jsonc:89-96](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/server/wrangler.jsonc#L89-L96)), and server/README.md lines 398-400 say they are still to be supplied. There is no real-money deployment. |
| On-chain program `onchain/draw` (`GJZe44ZXk27WxVqXgEbX9tXNpxrPBAA9Z1a7Gd8Rp5ut`) | **Devnet only** (onchain/draw/PHASE0.md line 3; server/README.md line 371). Nothing live uses it. |
| MagicBlock VRF draws in the Worker | **Off.** The only gate is `env.DRAW_SOURCE === 'magicblock'` ([server/src/draw.ts:13-15](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/server/src/draw.ts#L13-L15)). No environment in `server/wrangler.jsonc` sets `DRAW_SOURCE` or `DRAW_PROGRAM_ID`, and it is not set on the deployed mainnet-dev Worker (README.md line 70: "built, off on mainnet-dev"). |
| Refund sending | **Off.** The sweep sends only when `REFUNDS_ENABLED` is `'true'` ([server/src/refunds.ts:52](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/server/src/refunds.ts#L52)), and no environment in `server/wrangler.jsonc` sets it (README.md line 151 lists refund sending as built and switched off). The sweep still decides and records which refunds are owed (README.md line 73). |
| Jupiter gift on Claim pack | **Off.** `"JUPITER_GIFT_ENABLED": "false"` ([server/wrangler.jsonc:68](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/server/wrangler.jsonc#L68)). |

## Findings at a glance

Entry numbers are the report's. "Worth a look" entries are listed under "Your code" in the report.

| Report entry | Finding | Verdict | Evidence | Action |
|---|---|---|---|---|
| Your code 1 (High) | `fulfill_draw`: writable `draw`, no signer ([lib.rs:180](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/onchain/draw/programs/draw/src/lib.rs#L177-L182)) | False positive | `#[vrf_callback]` inserts `vrf_program_identity: Signer`, pinned to MagicBlock's scoped VRF identity for this program. The IDL lists it as a signer ([draw.json:92-103](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/onchain/draw/idl/draw.json#L92-L103)). [Details](#your-code-1-fulfill_draw-has-a-signer) | None. Devnet-only; no live service calls it |
| Worth a look 1, 2 (High) | `innerHTML` in [browserFloor.web.test.ts:19](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/src/web/__tests__/browserFloor.web.test.ts#L19) | False positive | Jest-only file. The value is the constant [browserFloor.ts:16-22](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/src/web/browserFloor.ts#L16-L22) | None |
| Worth a look 3 (High) | `innerHTML` in [browserFloor.web.test.ts:26](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/src/web/__tests__/browserFloor.web.test.ts#L26) | False positive | Assigns `''` in `afterEach`. Jest-only | None |
| Worth a look 4 (High) | `new Function` in [browserFloor.web.test.ts:60](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/src/web/__tests__/browserFloor.web.test.ts#L58-L61) | False positive | Compiles, never calls, the constant [browserFloor.ts:24-31](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/src/web/browserFloor.ts#L24-L31) to check it parses (line 59 checks it uses no post-ES5 syntax). Jest-only | None |
| Worth a look 5, 6 (High) | `innerHTML` in [spaceKey.web.test.ts:6, 12](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/src/web/__tests__/spaceKey.web.test.ts#L5-L12) | False positive | Every caller of the helper passes a string-literal fixture. `afterEach` assigns `''`. Jest-only | None |
| Worth a look 7, 8, 9 (Medium) | `dangerouslySetInnerHTML` in [+html.tsx:28, 32, 33](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/src/app/+html.tsx#L28-L33) | False positive | Build-time constants only ([tokens.ts:3](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/src/theme/tokens.ts#L3), [pageCss.ts:36](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/src/web/pageCss.ts#L36), [browserFloor.ts:16-31](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/src/web/browserFloor.ts#L16-L31)), written once at export into a static page | None |
| Worth a look 10 (Low) | Missing owner check ([lib.rs:122](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/onchain/draw/programs/draw/src/lib.rs#L122-L133)) | False positive | `program_data` must be loader-owned `ProgramData` for this program, and its upgrade authority must be the signer ([lib.rs:128-131](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/onchain/draw/programs/draw/src/lib.rs#L128-L131), [140-143](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/onchain/draw/programs/draw/src/lib.rs#L140-L143)). Devnet check: [program-checks.mjs:57-59](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/onchain/draw/scripts/program-checks.mjs#L57-L59) | None |
| Worth a look 11 (Low) | Reinitialization ([lib.rs:27](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/onchain/draw/programs/draw/src/lib.rs#L26-L31)) | False positive | A plain `init` ([lib.rs:126](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/onchain/draw/programs/draw/src/lib.rs#L126)), with no `init_if_needed`, cannot re-create an existing account. It also needs the upgrade authority | None |
| Worth a look 12, 13 (Low) | `@solana/web3.js` v1 in two tests | Accepted risk | Test fixtures, jest-only. No advisory against 1.98.4 | Planned with 14 |
| Worth a look 14 (Low) | `@solana/web3.js` v1 in [nativeSolanaSigner.ts:5](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/src/auth/nativeSolanaSigner.ts#L5) | Accepted risk | Privy's Expo wallet provider takes a web3.js `VersionedTransaction`. Used only to decode and re-encode server-built bytes that the payment guard has already checked. No RPC. Pinned exactly ([package.json:19](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/package.json#L19)). Native builds only | Planned: drop it when Privy's Expo provider accepts wire bytes |
| Packages 1 (High) | js-yaml 4.1.0 | Not in any shipped build | Only in [onchain/draw/package-lock.json:1166](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/onchain/draw/package-lock.json#L1166), through the unused `mocha` devDependency | Planned: remove the unused test devDependencies |
| Packages 2 (High) | minimatch 4.2.1 | Not in any shipped build | Only in [onchain/draw/package-lock.json:1279](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/onchain/draw/package-lock.json#L1279), through `mocha` | Same |
| Packages 3 (High) | nanoid 3.3.1 | Not in any shipped build | Only in [onchain/draw/package-lock.json:1365](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/onchain/draw/package-lock.json#L1365), through `mocha`. The app ships nanoid 3.3.18, which is patched | Same |
| Packages 4 (High) | serialize-javascript 6.0.0 | Not in any shipped build | Only in [onchain/draw/package-lock.json:1676](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/onchain/draw/package-lock.json#L1676), through `mocha` | Same |
| Packages 5 (High) | toml 3.0.0 | Not in any shipped build | Only in [onchain/draw/package-lock.json:1814](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/onchain/draw/package-lock.json#L1814), through `@coral-xyz/anchor`, which only a devnet operator script uses. Anchor uses toml only to read the repo's own `Anchor.toml`, on a code path that script never calls | Planned |
| Packages 6 (High) | undici 7.29.0 | Not in any shipped build | `wrangler` → `miniflare` → undici, a server devDependency ([server/package.json:39-44](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/server/package.json#L39-L44)). Not in the Worker bundle | Planned: bump wrangler |
| Packages 7, 8 (High) | ws 8.18.0, ws 8.18.3 | Not in any shipped build | Node-only dependency of `viem` under Privy's web SDK. Browser builds use `globalThis.WebSocket`. No ws 8.18.x file is in any build | Planned: bump Privy |
| Packages 9-17 (High) | Env var in [posthog.test.ts](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/src/analytics/__tests__/posthog.test.ts) and [posthog.web.test.ts](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/src/analytics/__tests__/posthog.web.test.ts) | False positive | The lines delete the variable or set `'phc_test'` / `'phc_web'`. Jest-only | None |
| Packages 18 (High) | `EXPO_PUBLIC_POSTHOG_KEY` ([config.ts:5](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/src/analytics/config.ts#L5)) | False positive | A PostHog project token, which is made for client code: it can send events, not read them. No key is committed | None |
| Packages 19 (High) | `EXPO_PUBLIC_TREASURY_USDC_TOKEN_ACCOUNT` ([treasury.ts:11](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/src/config/treasury.ts#L11)) | False positive | A public on-chain address, already committed ([eas.json:30](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/eas.json#L30), [server/wrangler.jsonc:61](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/server/wrangler.jsonc#L61)). The app pins it so the payment guard can check where money goes | None |
| Packages 20 (Medium) | rand 0.7.3 | Not in any shipped build | Compiled only for the host, through `solana-secp256k1-recover` (`cfg(not(target_os = "solana"))`). Not in the program | None upstream yet |
| Packages 21 (Medium) | rkyv 0.7.46 | False positive | The flagged code is behind rkyv's `validation` feature, which is not enabled. The program never reads an rkyv archive | None upstream yet |
| Packages 22 (Medium) | libsecp256k1 0.6.0 | Not in any shipped build | "Unmaintained" notice. Host-only, same path as rand | None upstream yet |
| Packages 23 (Medium) | bincode 1.3.3 | Accepted risk | "Unmaintained" notice, no vulnerability. Used by anchor-lang to read loader-written `ProgramData` | None upstream yet |
| Packages 24 (Medium) | borsh 0.10.4 | False positive | The advisory lists `^0.10.4` as patched. The program parses no zero-sized types | None |
| Packages 25 (Medium) | stream-json 1.9.1 | Not in any shipped build | Required only by jayson's server-side code, which is in no build | Planned |
| Packages 26 (Medium) | decode-uri-component 0.2.2 | Accepted risk | Ships through expo-router → query-string, but expo-router parses URLs with `URLSearchParams`. Worst case is the visitor's own tab busy-looping | Planned: wait for expo-router |
| Packages 27 (Medium) | uuid 9.0.1 | Not in any shipped build | In no build. The report's locations point at uuid 14.0.2 entries, which are not vulnerable | Planned: bump Privy |
| Packages 28 (Medium) | uuid 8.3.2 | Accepted risk | Ships in the Android and iOS bundles through web3.js → jayson. Only `v4()` is called; the advisory needs v3, v5 or v6 with a buffer | Planned with 14 |
| Packages 29 (Medium) | uuid 7.0.3 | Not in any shipped build | `expo` → `@expo/config-plugins` → `xcode` → uuid. Runs at `expo prebuild` only | None |
| Packages 30 (Low) | diff 5.0.0 | Not in any shipped build | Only in [onchain/draw/package-lock.json:750](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/onchain/draw/package-lock.json#L750), through `mocha` | Planned with 1 |
| Notes (3 licence rows) | `draw` crate has no licence | Accepted risk | All rights reserved on purpose ([LICENSE](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/LICENSE); README.md line 168). The crate is not published | Optional: `publish = false` |
| Notes (1 row) | 70 crates resolve to more than one version | Accepted risk | `ephemeral-rollups-sdk` 0.17.3 depends on both `solana-program` 2.3.0 and 3.0.0. Affects build size only | None |
| Adjacent to the licence notes | [onchain/draw/package.json:2](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/onchain/draw/package.json#L2) says `"license": "ISC"` | Needs a fix (low impact) | The anchor-init template default, repeated in [package-lock.json:7](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/onchain/draw/package-lock.json#L7). It contradicts [LICENSE](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/LICENSE) | Planned: set `UNLICENSED` and `"private": true` |

## Details

### 1. The on-chain program (`onchain/draw`)

#### Your code 1: `fulfill_draw` has a signer

**What the scan read.** [lib.rs:177-182](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/onchain/draw/programs/draw/src/lib.rs#L177-L182) as written:

```rust
#[vrf_callback]
#[derive(Accounts)]
pub struct FulfillDraw<'info> {
    #[account(mut)]
    pub draw: Account<'info, Draw>,
}
```

**What the compiler builds.** `vrf_callback` is imported from `ephemeral_rollups_sdk::anchor`
([lib.rs:7](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/onchain/draw/programs/draw/src/lib.rs#L7)), which re-exports the proc macro from
`ephemeral-vrf-sdk-vrf-macro` 0.17.3. That crate is pinned by checksum in
[onchain/draw/Cargo.lock:890-893](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/onchain/draw/Cargo.lock#L890-L893) (`4db39f8c…160480`; the source is at
`https://static.crates.io/crates/ephemeral-vrf-sdk-vrf-macro/ephemeral-vrf-sdk-vrf-macro-0.17.3.crate`). Its
`src/lib.rs:180-195`:

```rust
        if field_name.eq("vrf_program_identity") {
            has_identity = true;
        }
    }

    if !has_identity {
        new_fields.insert(
            0,
            quote! {
                /// Scoped VRF identity PDA, bound to this program. Its presence as a signer proves
                /// the callback was issued by the VRF program for this program.
                #[account(address = #vrf::consts::scoped_vrf_identity(&crate::ID))]
                pub vrf_program_identity: Signer<'info>,
            },
        );
    }
```

The macro runs before `#[derive(Accounts)]`, so Anchor sees two accounts. The expanded `try_accounts` for
`FulfillDraw` (from `RUSTC_BOOTSTRAP=1 cargo rustc -p draw --lib --locked --profile=check -- -Zunpretty=expanded`
in `onchain/draw`; abridged):

```rust
pub struct FulfillDraw<'info> {
    #[account(address = ::ephemeral_rollups_sdk::vrf::consts::scoped_vrf_identity(&crate::ID))]
    pub vrf_program_identity: Signer<'info>,
    #[account(mut)]
    pub draw: Account<'info, Draw>,
}
// in try_accounts:
let vrf_program_identity: Signer = anchor_lang::Accounts::try_accounts(/* … */)?; // AccountNotSigner (3010) unless it signed
let draw: anchor_lang::accounts::account::Account<Draw> = anchor_lang::Accounts::try_accounts(/* … */)?;
{
    let actual = vrf_program_identity.key();
    let expected = ::ephemeral_rollups_sdk::vrf::consts::scoped_vrf_identity(&crate::ID);
    if actual != expected {
        return Err(/* ErrorCode::ConstraintAddress (2012) */);
    }
}
```

The committed IDL, which `anchor idl build` produces by compiling this source, lists the same accounts for
`fulfill_draw`: `vrf_program_identity` with `"signer": true`, then `draw` with `"writable": true`
([onchain/draw/idl/draw.json:92-103](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/onchain/draw/idl/draw.json#L92-L103)). (We did not compare the deployed devnet
bytecode with this source; see [the limits below](#how-this-was-checked-and-its-limits).)

**Who can sign as that account.** `scoped_vrf_identity(id)` is the program-derived address of seeds
`[b"identity", id]` under MagicBlock's VRF program `Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz`
(`ephemeral-vrf-sdk` 0.17.3, `src/consts.rs:4, 22, 30-38`; pinned at
[Cargo.lock:874-877](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/onchain/draw/Cargo.lock#L874-L877)). For this program it is
`DDQPKFxkdKhEBumSTV6NFd8uXykzoGDwCbFR1yyDWRSE`, which is off the ed25519 curve, so no private key for it exists. No
transaction can carry its signature directly. Only the VRF program can sign for it, through `invoke_signed`.

**When the VRF program signs.** We read MagicBlock's `ephemeral-vrf` program source at its GitHub HEAD `52b103c`
(18 September 2026), `program/src/provide_randomness.rs`:
- the oracle must sign (line 78) and the request must be in the queue (line 116);
- fulfilment must land in a later slot than the request (lines 130-131);
- the VRF proof must verify (line 141);
- only then does it call the callback program and accounts stored with the request (lines 151-162), passing a hash
  of the VRF output (line 172) and signing as the scoped identity (lines 186-200).

So the oracle can withhold a value but cannot choose it. A request that names this program as its callback must be
signed by this program's own identity PDA (`request_randomness.rs:67-69`). Only `request_draw`'s `invoke_signed_vrf`
produces that signature ([lib.rs:93-94](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/onchain/draw/programs/draw/src/lib.rs#L93-L94)), and `request_draw` is
limited to the configured authority ([lib.rs:163](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/onchain/draw/programs/draw/src/lib.rs#L163)).

**The handler writes once.** `fulfill_draw` stores the randomness only while `fulfilled_slot == 0`
([lib.rs:100-107](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/onchain/draw/programs/draw/src/lib.rs#L100-L107)), so a second fulfilment changes nothing.

**Executed check.** We called the program's real entry point on the host, built from this `lib.rs` and the locked
dependencies (plus one test-only dependency, `solana-sysvar`, to stub the clock), with hand-built accounts:

| Identity account | Signed? | Result | Stored randomness |
|---|---|---|---|
| An attacker's own key | yes | `ConstraintAddress` (2012) | unchanged |
| MagicBlock's older global identity `9irBy75…` | yes | `ConstraintAddress` (2012) | unchanged |
| The scoped PDA | no | `AccountNotSigner` (3010) | unchanged |
| The scoped PDA (control: what only the VRF program can produce) | yes | `Ok` | written |
| The scoped PDA, a second time | yes | `Ok` | unchanged from the first write |

This host test is not in this snapshot: adding it changes `Cargo.toml` and `Cargo.lock`. Adding it is planned for
after the deadline (item 8 below). The devnet checks that are in the repo
([onchain/draw/scripts/program-checks.mjs](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/onchain/draw/scripts/program-checks.mjs))
cover the requester and upgrade-authority refusals and single-request-per-pull. They do not send a fulfilment from a
signer other than the VRF program, which is why we ran the host test.

**Live impact: none.** The program is on devnet only, and the Worker never calls it while `DRAW_SOURCE` is unset
([server/src/draw.ts:13-15](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/server/src/draw.ts#L13-L15)); see the table above.

#### Worth a look 10: owner check on `Initialize` and `SetAuthority`

Both structs ([lib.rs:122-144](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/onchain/draw/programs/draw/src/lib.rs#L122-L144)) take:
- `upgrade_authority: Signer`;
- `program: Program<Draw>`, which Anchor requires to be this program's id and executable;
- `program_data: Account<ProgramData>`, which Anchor requires to be owned by the BPF upgradeable loader before it is
  read;
- `program.programdata_address()? == Some(program_data.key())`, which ties that `ProgramData` to this program;
- `program_data.upgrade_authority_address == Some(upgrade_authority.key()) @ NotUpgradeAuthority`.

That is the owner check the scan asks for: only the program's upgrade authority can set or rotate the requester key.
On devnet, `set_authority` signed by another key is refused with `NotUpgradeAuthority`
([program-checks.mjs:57-59](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/onchain/draw/scripts/program-checks.mjs#L57-L59)). The host run of `set_authority` gave:
upgrade authority `Ok`; attacker 6004 (`NotUpgradeAuthority`); the authority's key without its signature 3010; a
forged `ProgramData` not owned by the loader 3007; the attacker's own real `ProgramData` 2003; a fake program
account 3008.

#### Worth a look 11: reinitialization of `config`

`config` is created with a plain `init` ([lib.rs:126](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/onchain/draw/programs/draw/src/lib.rs#L126)). The file has no
`init_if_needed`, and [programs/draw/Cargo.toml](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/onchain/draw/programs/draw/Cargo.toml) enables no extra anchor-lang
features. A plain `init` always takes the create path. For an account that already exists, the System Program refuses
to allocate it ("already in use"). A second `init` of an existing `draw` account was refused on devnet (PHASE0.md
line 27, on the Phase 0 spike of this program; [program-checks.mjs:85-86](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/onchain/draw/scripts/program-checks.mjs#L85-L86)
checks that the current program refuses it). No instruction closes `config`. `initialize` also needs the upgrade
authority, which can already rotate the requester through `set_authority`, so a second `initialize` would grant
nothing new.

### 2. HTML and `new Function` matches (Worth a look 1-9)

**Test files (1-6).** [browserFloor.web.test.ts](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/src/web/__tests__/browserFloor.web.test.ts) and
[spaceKey.web.test.ts](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/src/web/__tests__/spaceKey.web.test.ts) are collected only by the jest `web` project (the
native project ignores `*.web.test.*`; [package.json](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/package.json) → `jest.projects`). No app file imports a test file.

- Line 19 writes `BROWSER_FLOOR_HTML`, a constant built from `'browser-floor'`, `color.room` (`'#0B0E1A'`,
  [tokens.ts:3](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/src/theme/tokens.ts#L3)) and `PRODUCT_NAME` (`'Gotchapon'`, [name.ts:2](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/src/brand/name.ts#L2)). It has
  no request, URL, user or API input.
- Line 26 and spaceKey line 12 assign `''`.
- Line 60 compiles the constant with `new Function` inside `expect(...).not.toThrow()` and never calls it; line 59
  checks it uses no post-ES5 syntax.
- spaceKey line 6 is a fixture helper, and every caller passes a string literal.

A fresh export of this commit for web, Android and iOS contains none of the 907 test titles of 25 characters or
more from the 180 test files (and one test helper) under `src/`, and none of the dummy values (`phc_test`,
`phc_web`). Outside tests, `src/` has no `innerHTML`, `insertAdjacentHTML`, `document.write`, `eval(` or `new Function`.

**`src/app/+html.tsx` (7-9).** The three `__html` values ([+html.tsx:28-33](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/src/app/+html.tsx#L28-L33)) are:
- `html, body { background-color: #0B0E1A; }` followed by `PAGE_CSS`, five string constants
  ([pageCss.ts:8-36](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/src/web/pageCss.ts#L8-L36));
- `BROWSER_FLOOR_HTML` ([browserFloor.ts:16-22](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/src/web/browserFloor.ts#L16-L22));
- `BROWSER_FLOOR_SCRIPT` ([browserFloor.ts:24-31](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/src/web/browserFloor.ts#L24-L31)), whose only interpolation is
  `'browser-floor'`.

The only environment read in the file is `EXPO_PUBLIC_WEB_INDEXABLE` ([+html.tsx:16](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/src/app/+html.tsx#L16)), and it
only decides whether a `robots` meta tag is written. The file renders in Node at export, and gotchapon.fun serves
the result as static files ([wrangler.web.jsonc](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/wrangler.web.jsonc), [scripts/deploy-web.mjs:65-66](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/scripts/deploy-web.mjs#L65-L66)).
The browser-floor card and script are raw HTML on purpose: they have to work in a browser too old to parse the app's
JavaScript ([browserFloor.ts:1-3](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/src/web/browserFloor.ts#L1-L3)).

### 3. `@solana/web3.js` v1 (Worth a look 12-14)

The app uses `@solana/kit` ([package.json:18](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/package.json#L18)). It keeps web3.js v1 in one file,
[src/auth/nativeSolanaSigner.ts](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/src/auth/nativeSolanaSigner.ts), because Privy's Expo embedded-wallet provider takes a
web3.js `VersionedTransaction` ([nativeSolanaSigner.ts:1-4, 8-16](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/src/auth/nativeSolanaSigner.ts#L1-L16)). The file
decodes the server's bytes, has Privy add the user's signature, and returns the bytes
([lines 18-37](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/src/auth/nativeSolanaSigner.ts#L18-L37)). It makes no RPC call and broadcasts nothing. It runs only
after the payment guard has accepted the transaction ([src/state/paymentFlow.ts:26-33](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/src/state/paymentFlow.ts#L26-L33)).
The version is pinned exactly to `1.98.4` ([package.json:19](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/package.json#L19)). That is not one of the December 2024
compromised releases (1.95.6, 1.95.7), and the scan lists no advisory for it. It is in the Android and iOS bundles,
not in the web export: the web sign-in path never imports this file. The two test imports
([nativeSolanaSigner.test.ts:2](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/src/auth/__tests__/nativeSolanaSigner.test.ts#L2),
[privyAuth.test.tsx:10](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/src/auth/__tests__/privyAuth.test.tsx#L10)) build fixtures and are in no build.

### 4. `EXPO_PUBLIC_*` variables (Packages 9-19)

Expo inlines every `EXPO_PUBLIC_*` value the app reads into the client at build time, and [.env.example](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/.env.example)
(line 2) says so. That is why only public values go in them. These are all twelve the app reads, outside tests:

| Variable | Read at | What it is |
|---|---|---|
| `EXPO_PUBLIC_API_URL` | [src/api/index.ts:15](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/src/api/index.ts#L15) | The Worker's public URL ([eas.json:29](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/eas.json#L29)) |
| `EXPO_PUBLIC_USE_MOCK` | [src/api/index.ts:16](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/src/api/index.ts#L16) | Build switch for the in-app demo mock |
| `EXPO_PUBLIC_WEB_INDEXABLE` | [src/app/+html.tsx:16](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/src/app/+html.tsx#L16) | Build switch for the `robots` meta tag |
| `EXPO_PUBLIC_FLAGS` | [src/config/flags.ts:15](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/src/config/flags.ts#L15) | Feature-flag overrides |
| `EXPO_PUBLIC_DEV_PAYMENTS` | [src/state/session.tsx:37](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/src/state/session.tsx#L37) | A development-only switch, read behind `__DEV__`, so a release build compiles it to `false`. Tests fail if any EAS profile sets it or any other file reads it ([bundle-budget.test.mjs:479, 506](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/scripts/__tests__/bundle-budget.test.mjs#L479)) |
| `EXPO_PUBLIC_PRIVY_APP_ID` | [src/auth/privy.ts:12](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/src/auth/privy.ts#L12), [privy.web.ts:4](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/src/auth/privy.web.ts#L4) | Privy's public app id. Also a plain `var` on the Worker ([server/wrangler.jsonc:67](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/server/wrangler.jsonc#L67)) |
| `EXPO_PUBLIC_PRIVY_CLIENT_ID` | [src/auth/privy.ts:13](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/src/auth/privy.ts#L13) | Privy's public client id for the mobile app |
| `EXPO_PUBLIC_PRIVY_CLIENT_ID_WEB` | [src/auth/privy.web.ts:5](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/src/auth/privy.web.ts#L5) | Privy's public client id for the browser |
| `EXPO_PUBLIC_POSTHOG_KEY` | [src/analytics/config.ts:5](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/src/analytics/config.ts#L5) | PostHog's project token, used only to send events ([posthog.ts:28](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/src/analytics/posthog.ts#L28), [posthogChunk.web.ts:26](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/src/analytics/posthogChunk.web.ts#L26)). PostHog's API docs describe it as made for client code: the ingestion endpoints accept it, and reading data needs a personal API key, which the app never has. None is committed |
| `EXPO_PUBLIC_POSTHOG_HOST` | [src/analytics/config.ts:7](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/src/analytics/config.ts#L7) | PostHog's ingestion host |
| `EXPO_PUBLIC_TREASURY_USDC_TOKEN_ACCOUNT` | [src/config/treasury.ts:11](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/src/config/treasury.ts#L11) | The treasury's public token account. The payment guard needs it in the build, not from the API, so that a compromised API cannot redirect a payment ([treasury.ts:1-7](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/src/config/treasury.ts#L1-L7)) |
| `EXPO_PUBLIC_USDC_MINT` | [src/config/treasury.ts:12](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/src/config/treasury.ts#L12) | The public mint address, pinned for the same reason |

The real secrets live only in the Worker:
- They are `PRIVY_APP_SECRET`, `ADMIN_API_KEY`, `ECVRF_SECRET_SEED`, `FEE_PAYER_KEYPAIR`, `HOUSE_SENDER_SECRET`,
  `DRAW_AUTHORITY_KEYPAIR` and `REFUND_KEYPAIR`
  ([server/src/types.ts:11-64](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/server/src/types.ts#L11-L64)).
- Each is documented as a Wrangler secret, never a config `var`: server/README.md lines 384-395 for the first five,
  lines 288-289 for `REFUND_KEYPAIR`, and lines 353-354 for `DRAW_AUTHORITY_KEYPAIR`. Neither deployed environment
  (`mainnet-dev`, `production`) in [server/wrangler.jsonc](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/server/wrangler.jsonc) carries any of the seven as a var.
  The only one in the file is the `local` profile's published test seed for `ECVRF_SECRET_SEED` (see below).
  [wrangler-config.test.ts:52-60](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/server/scripts/__tests__/wrangler-config.test.ts#L52-L60) fails if a deployed
  environment carries `ADMIN_API_KEY`, `PRIVY_APP_SECRET`, `ECVRF_SECRET_SEED`, `SOLANA_RPC_URL`, `FEE_PAYER_KEYPAIR`
  or `HOUSE_SENDER_SECRET` as a var. `DRAW_AUTHORITY_KEYPAIR` and `REFUND_KEYPAIR` are not in its list yet.
- `.env.example` line 52 says the same for Privy's app secret. The secret is used only in
  [server/src/auth.ts:31-38](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/server/src/auth.ts#L31-L38).
- The app imports nothing from `server/`. No `EXPO_PUBLIC_*` name contains SECRET, SEED, KEYPAIR, PRIVATE, ADMIN,
  AUTHORITY or MNEMONIC.

We also exported web, Android and iOS with every one of those secret names set to a sentinel value in the build
environment. No sentinel appeared in any output. An `EXPO_PUBLIC_*` sentinel set at the same time did appear, which
shows that the search could find inlined values.

One committed value looks like a secret and is not: `ECVRF_SECRET_SEED` is a published test seed (`000102…1f`) in the
`local` profile only ([server/wrangler.jsonc:31](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/server/wrangler.jsonc#L31)), for local development and tests. The
Worker refuses that seed outside `local` ([server/src/randomness.ts:57-62](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/server/src/randomness.ts#L57-L62)), and
[wrangler-config.test.ts:21-34](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/server/scripts/__tests__/wrangler-config.test.ts#L21-L34) fails if a deployed
environment has the seed as a `var`.

### 5. JavaScript packages (Packages 1-8, 25-30)

"Shipped builds" here means the web export served at gotchapon.fun, the Android and iOS JavaScript bundles, and the
Worker bundle. For each one we listed the `sources` of its source map.

| Package | In the lockfile | How it gets in | In a shipped build? | Why the advisory does not apply | Lowest version at or above the installed one that clears every listed advisory |
|---|---|---|---|---|---|
| js-yaml 4.1.0 | [onchain/draw/package-lock.json:1166](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/onchain/draw/package-lock.json#L1166) | `mocha` 9.2.2, a devDependency ([onchain/draw/package.json:10-19](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/onchain/draw/package.json#L10-L19)) | No | `onchain/draw` has no tests, so mocha never runs. The root lockfile has js-yaml 3.15.2 and 4.3.2 ([pnpm-lock.yaml:6579-6583](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/pnpm-lock.yaml#L6579-L6583)), both patched | 4.3.2 |
| minimatch 4.2.1 | [onchain/draw/package-lock.json:1279](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/onchain/draw/package-lock.json#L1279) | `mocha` | No | As above. glob's copy, 3.1.5 ([:942](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/onchain/draw/package-lock.json#L942)), is patched | 4.2.5 |
| nanoid 3.3.1 | [onchain/draw/package-lock.json:1365](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/onchain/draw/package-lock.json#L1365) | `mocha` | No | The copy that ships in the app is 3.3.18 ([pnpm-lock.yaml:7034](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/pnpm-lock.yaml#L7034)), which is patched | 3.3.18 |
| serialize-javascript 6.0.0 | [onchain/draw/package-lock.json:1676](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/onchain/draw/package-lock.json#L1676) | `mocha` | No | Used only by mocha's parallel mode | 7.0.5 (clears all three advisories) |
| toml 3.0.0 | [onchain/draw/package-lock.json:1814](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/onchain/draw/package-lock.json#L1814) | `@coral-xyz/anchor` 0.32.1 ([onchain/draw/package.json:7-9](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/onchain/draw/package.json#L7-L9)) | No | The only JS that uses anchor is [onchain/draw/scripts/program-checks.mjs](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/onchain/draw/scripts/program-checks.mjs), an operator script run by hand against devnet. Anchor parses TOML only in `anchor.workspace`, to read `Anchor.toml`. The script builds `new Program(idl, provider)` instead ([line 17](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/onchain/draw/scripts/program-checks.mjs#L17)). The root lockfile has neither toml nor anchor | 4.2.0. Anchor 0.32.1 declares `toml ^3.0.0` |
| undici 7.29.0 | [pnpm-lock.yaml:8549](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/pnpm-lock.yaml#L8549) | `wrangler` and `@cloudflare/vitest-plugin` → `miniflare` → undici: server devDependencies ([server/package.json:39-44](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/server/package.json#L39-L44)). Not a direct dependency | No | Runs on a developer's machine during `wrangler dev`, the tests and deploys. The deployed Worker bundle has no undici: Workers use the runtime's `fetch` | 7.29.1, through wrangler 4.149.0 or later |
| ws 8.18.0 | [pnpm-lock.yaml:9027](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/pnpm-lock.yaml#L9027) (the report's line 9015 is ws 7.5.13) | `@privy-io/react-auth` → `x402` → `wagmi` → `@wagmi/connectors` → … → `viem` 2.23.2 → ws | No | A Node WebSocket library. In browsers, viem reaches sockets through `isows`, whose browser entry uses `globalThis.WebSocket`. The only ws files in any build are `browser.js` stubs (ws 7.5.13 in the web Privy chunk, ws 8.21.3 in the Worker), which throw "ws does not work in the browser" | 8.21.0 |
| ws 8.18.3 | [pnpm-lock.yaml:9039](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/pnpm-lock.yaml#L9039) | `@privy-io/react-auth` → `@walletconnect/ethereum-provider` → … → `viem` 2.36.0 → ws | No | viem 2.36.0 is in the web Privy chunk, but its socket layer is `isows`'s native entry. No ws 8.18.x file is in any build (the Worker carries ws 8.21.3's `browser.js` stub, a patched version) | 8.21.0 |
| stream-json 1.9.1 | [pnpm-lock.yaml:8233](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/pnpm-lock.yaml#L8233), [onchain/draw/package-lock.json:1713](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/onchain/draw/package-lock.json#L1713) | `@solana/web3.js` → `jayson` 4.3.0 → stream-json | No | The native bundles take web3.js's React Native entry, which loads only `jayson/lib/client/browser`. stream-json is required only by jayson's server-side `lib/utils.js`, which is not bundled | 3.6.0 (the registry lists three advisories; 3.5.0 clears one) |
| decode-uri-component 0.2.2 | [pnpm-lock.yaml:5098](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/pnpm-lock.yaml#L5098) | `expo-router` 57.0.23 → `query-string` 7.1.3 → decode-uri-component | **Yes**: web entry chunk, Android and iOS bundles | Only `query-string`'s `parse` decodes. All four bundled importers of query-string are in expo-router. Three call only `stringify`. The fourth, a copy of React Navigation's `getStateFromPath`, calls `parse` only when the linking options bring no `getStateFromPath` of their own, and expo-router always brings one (`build/getLinkingConfig.js:90-91`). That one parses queries with `URLSearchParams` (`build/fork/getStateFromPath-forks.js:370-371`); its old `queryString.parse` call is commented out (`build/fork/getStateFromPath.js:536-538`). This is from reading the code, not a runtime trace. Worst case: a crafted link keeps the visitor's own tab or app busy. No data or funds are exposed | 0.5.0. It is ESM-only, and query-string 7 `require`s it and calls it as a function, so wherever `parse` runs a forced override would throw. It is untested, so we will not force it before the deadline |
| uuid 9.0.1 | [pnpm-lock.yaml:8732](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/pnpm-lock.yaml#L8732) | Privy's `wagmi` / MetaMask tree → `@metamask/utils` → uuid | No | Not in any build. The report's locations ([pnpm-lock.yaml:8718](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/pnpm-lock.yaml#L8718), [onchain/draw/package-lock.json:1622](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/onchain/draw/package-lock.json#L1622)) are uuid 14.0.2, which is not vulnerable | 11.1.1 |
| uuid 8.3.2 | [pnpm-lock.yaml:8727](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/pnpm-lock.yaml#L8727), [onchain/draw/package-lock.json:1945](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/onchain/draw/package-lock.json#L1945) | `@solana/web3.js` → `jayson` → uuid | **Yes**: Android and iOS bundles | jayson's two bundled files call only `uuid.v4()` with no arguments. The advisory needs `v3`, `v5` or `v6` called with a buffer, and those are never called. Not in the web export or the Worker | 11.1.1 |
| uuid 7.0.3 | [pnpm-lock.yaml:8722](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/pnpm-lock.yaml#L8722) | `expo` → `@expo/config-plugins` → `xcode` → uuid | No | `xcode` edits the iOS project during `expo prebuild` on a build machine. The report's anchor / rpc-websockets path is not this version's | 11.1.1 |
| diff 5.0.0 | [onchain/draw/package-lock.json:750](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/onchain/draw/package-lock.json#L750) | `mocha` | No | The report already marks it as not shipping | 5.2.2 |

Where our reading differs from the report's package table:
- "Fixed in" gives the fix for the oldest affected branch, not the installed one: js-yaml (3.15.0 → 4.3.2 for 4.x),
  minimatch (3.1.4 → 4.2.5), undici (6.28.1 → 7.29.1), ws (5.2.5 → 8.21.0) and diff (3.5.1 → 5.2.2).
- Some of the named fixes clear only some of the advisories: serialize-javascript needs 7.0.5, toml 4.2.0, and
  stream-json 3.6.0.
- undici, ws and decode-uri-component are transitive, not direct.
- toml, undici, ws 8.18.x, stream-json, uuid 9.0.1 and uuid 7.0.3 do not ship.
- The report gives `ts-mocha` as a path for js-yaml, nanoid and serialize-javascript; it is only `mocha`.
- uuid's second id, CVE-2026-41988, is not in the npm registry's record for that advisory, so we could not check it.

### 6. Rust crates (Packages 20-24)

The only Rust in the repository is [onchain/draw/programs/draw/src/lib.rs](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/onchain/draw/programs/draw/src/lib.rs).
Every flagged crate reaches it through `anchor-lang` 0.32.1 or `ephemeral-rollups-sdk` 0.17.3
([programs/draw/Cargo.toml](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/onchain/draw/programs/draw/Cargo.toml)). `ephemeral-rollups-sdk` 0.17.3 (24 September
2026) is MagicBlock's latest release, so there is nothing newer to move to yet.

- **rand 0.7.3** ([Cargo.lock:1555](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/onchain/draw/Cargo.lock#L1555)) and **libsecp256k1 0.6.0**
  ([Cargo.lock:1184](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/onchain/draw/Cargo.lock#L1184)) come in through `solana-program` 2.3.0 →
  `solana-secp256k1-recover` 2.2.1. That crate lists `libsecp256k1` only under
  `[target.'cfg(not(target_os = "solana"))'.dependencies]` (its `Cargo.toml:75`); on Solana it uses a syscall.
  - With a target whose `target_os` is `solana`, `cargo tree --locked -i rand@0.7.3` prints nothing, and the same
    command finds rkyv, bincode and borsh.
  - So rand and libsecp256k1 are built only for host tools (`anchor idl build`, `cargo test`), never into the program.
  - The rand advisory also needs rand's `log` feature and a custom logger that calls the thread RNG. The features
    enabled here are `alloc`, `getrandom`, `getrandom_package`, `libc` and `std`.
  - The libsecp256k1 notice is "unmaintained", with no vulnerability.
- **rkyv 0.7.46** ([Cargo.lock:1683](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/onchain/draw/Cargo.lock#L1683)) is in the program, through
  `magicblock-delegation-program-api` 3.1.0. The advisory is about shared-pointer validation, which rkyv compiles only
  with its `validation` feature (`src/lib.rs:169-170`). The enabled features are `alloc`, `default`, `hashbrown`,
  `size_32` and `std`. The delegation API uses only `rkyv::util::AlignedVec`, and the draw program never reads an
  rkyv archive. The fix (0.8.17) is a major version, which MagicBlock's crate would have to adopt.
- **bincode 1.3.3** ([Cargo.lock:290](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/onchain/draw/Cargo.lock#L290)) has an "unmaintained" notice and no
  vulnerability. In the program, anchor-lang uses it to read `ProgramData` in `initialize` and `set_authority`
  (`anchor-lang` 0.32.1 `src/bpf_upgradeable_state.rs:72`). That read happens after the owner check, so the input is
  data the BPF loader wrote.
- **borsh 0.10.4** ([Cargo.lock:358](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/onchain/draw/Cargo.lock#L358)): RUSTSEC-2023-0033 lists
  `patched = [">= 1.0.0-alpha.1", "^0.10.4"]`, so this version is patched; borsh 0.10.4's `src/de/mod.rs:380-385`
  refuses a `Vec` of zero-sized types. The program's instruction arguments are `u64`, `[u8; 32]`, `u8`, `u32` and
  `Pubkey`, and its accounts hold no collections.

### 7. Notes: licence and duplicate crates

- The `draw` crate has no `license` field. That is intended: the repository is all rights reserved ([LICENSE](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/LICENSE);
  README.md line 168), and the crate is not published.
- [onchain/draw/package.json:2](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/onchain/draw/package.json#L2) and
  [package-lock.json:7](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/onchain/draw/package-lock.json#L7) do say `"license": "ISC"`. That is the anchor-init template
  default, it contradicts [LICENSE](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/LICENSE), and fixing it is planned for after the deadline (item 1 below). It has no
  security effect.
- [onchain/draw/Cargo.lock](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/onchain/draw/Cargo.lock) has about 70 crates in more than one version. Most are Solana 2.x
  and 3.x pairs, because `ephemeral-rollups-sdk` 0.17.3 depends on both `solana-program` 2.3.0 and 3.0.0
  ([Cargo.lock:813-814](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/onchain/draw/Cargo.lock#L813-L814), in the `ephemeral-rollups-sdk` entry that starts at line 791). This affects build size and time only.

### 8. Advisories the scan did not list

`pnpm audit` on the root lockfile also lists shell-quote 1.10.0 (rated critical), node-forge, compression, sharp,
source-map-js, braces, brace-expansion, sprintf-js and dompurify. None of these packages is in the source map of any
shipped build. We have not yet traced each one's development path; that is item 11 under [What we will change](#what-we-will-change).

## How the money path is protected

The checks below are what stands between a user's wallet and a pull. Everything here runs on mainnet-dev, with the
test mint.

1. **The server builds the payment.** `preparePaymentWithLifetime`
   ([server/src/payments.ts:76-115](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/server/src/payments.ts#L76-L115)) builds a v0 transaction with:
   - the server's fee payer;
   - one SPL `TransferChecked` of the exact amount to the treasury token account;
   - a Memo of the pull id.
2. **The app checks the bytes before it signs.** `paysAsExpected`
   ([src/api/paymentGuard.ts:113-159](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/src/api/paymentGuard.ts#L113-L159)) decodes the transaction the wallet would sign.
   It refuses unless the transaction is exactly:
   - a v0 message with no lookup tables or trailing bytes, and shortest-form lengths;
   - not paid for by the user's wallet;
   - exactly two instructions: one `TransferChecked` of the quoted amount, in the pinned mint, to the pinned treasury,
     with the signed-in wallet as authority; then a Memo of the pull id.

   The pinned values come from the build ([src/config/treasury.ts:11-14](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/src/config/treasury.ts#L11-L14)), not from
   the API. The signer is reached only through this check
   ([src/state/paymentFlow.ts:18-33](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/src/state/paymentFlow.ts#L18-L33)).

   The guard's tests run in the server's suite against the real server builder, so a change to the server's
   transaction shape fails them ([server/test/clientPaymentGuard.test.ts:13-15, 72-239](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/server/test/clientPaymentGuard.test.ts#L72-L239)).
   They include refusals for:
   - another destination, mint, amount, decimals or memo;
   - an approval shaped like the transfer, or the same transfer under another token program;
   - a lookup table, a legacy message, or a non-canonical length.

   Wallet-app deposits have the same kind of guard, `depositAsExpected`
   ([paymentGuard.ts:165-223](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/src/api/paymentGuard.ts#L165-L223)).
3. **The phone signs and nothing more.** It adds only the user's signature and never broadcasts
   ([src/auth/nativeSolanaSigner.ts:18-37](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/src/auth/nativeSolanaSigner.ts#L18-L37)).
4. **The server co-signs only the unchanged message.** `sponsorPaymentTransaction`
   ([server/src/payments.ts:194-228](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/server/src/payments.ts#L194-L228)) adds the fee payer's signature only if:
   - the submitted message bytes equal the stored prepared message;
   - the signers are exactly the fee payer and the user;
   - the user's signature verifies.

   Tests: [server/test/payments.test.ts:179, 199](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/server/test/payments.test.ts#L179-L219). The Worker then broadcasts
   ([server/src/pulls.ts:515-529](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/server/src/pulls.ts#L515-L529)).
5. **The payment is verified on chain.** `verifyPayment`
   ([server/src/payments.ts:472-510](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/server/src/payments.ts#L472-L510)) reads the transaction at `confirmed`. It
   requires success, a memo equal to the pull id, and a transfer of the exact amount to the treasury. Mock payments are
   refused outside `local` (line 475).
6. **One signature, one pull.**
   - `pulls.tx_signature` is `UNIQUE` ([server/schema.sql:227](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/server/schema.sql#L227)).
   - `payment_receipts` is keyed by signature, with `pull_id UNIQUE` ([schema.sql:255-266](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/server/schema.sql#L255-L266)).
   - Commit refuses a signature that another pull has used ([server/src/pulls.ts:536-537](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/server/src/pulls.ts#L536-L537)).
   - The receipt and the payment obligation are written in one batch before any card is allocated
     ([pulls.ts:195-238](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/server/src/pulls.ts#L195-L238)).
   - A pull settles once: the `pull_settlements` row is the first statement of the settlement batch, and its primary
     key makes a racing second settlement roll back ([schema.sql:246-253](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/server/schema.sql#L246-L253),
     [pulls.ts:594-596](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/server/src/pulls.ts#L594-L596)).
7. **The draw happens at commit, after the payment.**
   - The card is drawn only after the payment is verified and recorded
     ([pulls.ts:538-548](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/server/src/pulls.ts#L538-L548)).
   - The draw is an RFC 9381 ECVRF proof over inputs fixed at prepare: pull, user, sequence, gacha, pinned odds and
     client seed ([server/src/randomness.ts:71-96](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/server/src/randomness.ts#L71-L96)).
   - The proof is verified before it is used (lines 85-88) and stored with the pull
     ([schema.sql:202-205](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/server/schema.sql#L202-L205)).
   - The proving key is a Worker secret, and the published local seed is refused outside `local`
     ([randomness.ts:57-62](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/server/src/randomness.ts#L57-L62)).
8. **A confirmed payment becomes cards or a recorded refund.** The refund sweep
   ([server/src/refunds.ts:1-13](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/server/src/refunds.ts#L1-L13)) marks any recorded payment still unsettled after
   15 minutes as `refund_pending`. In the same batch it settles the pull as expired, so a late commit cannot also hand
   out cards. Sending is a separate switch, and it is off (see the table at the top). When it is on:
   - the refund is exactly the receipt amount, sent to the wallet that paid;
   - it comes from a dedicated refund wallet;
   - the signed transfer is stored before it is broadcast, so a retry cannot pay twice;
   - there are per-sweep and per-day caps.
9. **Deploys fail closed.** A bare `wrangler deploy` publishes a Worker with no environment and no database, which
   refuses every request ([server/wrangler.jsonc:1-5](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/server/wrangler.jsonc#L1-L5)). Tests keep it that way
   ([wrangler-config.test.ts:16-19](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/server/scripts/__tests__/wrangler-config.test.ts#L16-L19)).

## What we will change

None of these is needed for safety. They reduce the dependency surface and make the code easier to review. All are
planned for after the deadline; none is done yet.

1. `onchain/draw/package.json`: set `"license": "UNLICENSED"` and `"private": true`, and refresh its lockfile.
2. Remove the unused anchor-template test devDependencies (`mocha`, `ts-mocha`, `chai`, `@types/mocha`,
   `@types/chai`, `@types/bn.js`) from `onchain/draw/package.json`. This clears Packages 1-4 and 30.
3. Bump `wrangler` (and `@cloudflare/vitest-plugin`) in `server/` so miniflare uses undici 7.29.1 (Packages 6).
4. Remove `@solana/web3.js` from the app once Privy's Expo provider accepts wire bytes, or test an override of `jayson`
   to 5.0.0. The first removes jayson, and web3.js v1 with it (Worth a look 12-14). The second moves to jayson 5.0.0,
   which no longer depends on uuid or stream-json. Either way the shipped copy of uuid 8.3.2 (jayson's, the only uuid
   in the Android and iOS bundles) and the root lockfile's stream-json go (Packages 25, 28). uuid 8.3.2 stays in the
   root lockfile through MetaMask's SDK in Privy's web tree, which is in no build, and the `onchain/draw` lockfile
   keeps its copies through `@coral-xyz/anchor` (see item 6).
5. Bump `@privy-io/react-auth` and recheck its ws 8.18.x and uuid 9.0.1 copies (Packages 7, 8, 27).
6. Port `onchain/draw/scripts/program-checks.mjs` to `@solana/kit`, or override `toml` to 4.2.0 or later (Packages 5).
7. Follow expo-router releases for a move off `query-string` 7, then revisit decode-uri-component (Packages 26).
8. Add a "fulfilment from a signer that is not the VRF program is refused" case, either to `program-checks.mjs` or as
   the host test above.
9. Optional: write the `vrf_program_identity` field out in `FulfillDraw` so a reader sees it in source. The macro then
   skips inserting it, and the expanded accounts code is the same. We have not done it now because the source would no
   longer match the deployed devnet build.
10. Optional: a repo test that fails if any `EXPO_PUBLIC_*` name contains SECRET, SEED, KEYPAIR, PRIVATE or ADMIN. Today
    that holds by convention and by `wrangler-config.test.ts`, not by a client-side name check.
11. Look into the `pnpm audit` entries in section 8 that the scan did not list.
12. Add `DRAW_AUTHORITY_KEYPAIR` and `REFUND_KEYPAIR` to the secret list in `wrangler-config.test.ts`.

## How this was checked, and its limits

- **Builds.** We made fresh builds of `f634241` from a clean clone, with
  `pnpm install --frozen-lockfile`, `EXPO_NO_DOTENV=1`, `--clear`, the mock off, and the mainnet-dev public values
  from [config/web-mainnet-dev.json](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/config/web-mainnet-dev.json) and the `preview` profile:
  - a web export with source maps;
  - `expo export --platform android --platform ios --no-bytecode`;
  - `wrangler deploy --dry-run --env mainnet-dev --outdir …`.

  We read each source map's `sources` to decide which packages ship, and searched the bundles for test titles and
  sentinel values. The repo's own gate, `node scripts/bundle-budget.mjs <export> --no-mock`, passed on the web export.
- **On-chain.** We expanded the macros with the locked dependencies, ran host tests against the program's real entry
  point, and ran `cargo tree` for host and Solana targets.
- **Advisory data.** Ids, ranges and fixed versions come from the npm registry's audit data and the RustSec advisory
  database.
- **What we could not check:**
  - Our audit environment could not reach `api.devnet.solana.com`. So we did not compare the deployed devnet
    program's bytecode with this source in this pass, or re-run `program-checks.mjs`.
  - MagicBlock's VRF program was read at its GitHub HEAD. We did not check that source against the deployed build.
  - We did not fetch gotchapon.fun's live files. We compared against a fresh export of the same commit.
  - We did not unpack the APK. We exported the same JavaScript with the `preview` profile's values. Values held in the
    EAS `production` environment ([eas.json:26](https://github.com/gotcha-gacha/gotchapon-clockin/blob/f634241a48acabdfee32a95c8199c2a646d3dac5/eas.json#L26)), such as the mobile Privy client id, are not in the
    repo, and we used placeholders for them.

## Reporting

To report a security issue, open an issue on this repository:
https://github.com/gotcha-gacha/gotchapon-clockin/issues. If the details would put a wallet at risk, say only that in
the issue, and we will reply there with a private way to send them.
