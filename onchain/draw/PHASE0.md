# #406 Phase 0 — MagicBlock VRF on devnet (5 Oct 2026)

Spike, not the production program. Program `GJZe44ZXk27WxVqXgEbX9tXNpxrPBAA9Z1a7Gd8Rp5ut` on devnet:
`request_draw(pull_id, count, pool_hash, fast)` → MagicBlock base-layer queue `Cuj97ggr…` → `fulfill_draw`
(`#[vrf_callback]`) writes 32 bytes to the per-pull account `["draw", pull_id]`.

Build: Anchor 0.32.1 + `ephemeral-rollups-sdk =0.17.3` (`anchor-compat`, `vrf`). The SDK's deps need rustc 1.89:
`~/.local/share/solana/install/releases/2.3.0/solana-release/bin/cargo-build-sbf --tools-version v1.54`
(Solana CLI 2.1's build tool and platform-tools ≤ v1.51 fail), IDL with `RUSTUP_TOOLCHAIN=1.89.0 anchor idl build`.

## Latency (websocket-timed, public devnet RPC; the measurement script is not included here)

| | n | unfulfilled | send → result stored, p50 / p95 / max | request confirm p50 | result after confirm p50 / p95 | slots p50 / max |
|---|---|---|---|---|---|---|
| 0.0005 SOL tier | 30 | 0 | 1.44 s / 1.86 s / 3.19 s | 0.82 s | 0.60 s / 1.06 s | 3 / 4 |
| 0.0008 SOL tier | 10 | 0 | 1.48 s / 2.02 s / 2.02 s | 0.82 s | 0.57 s / 1.20 s | 3 / 3 |
| burst of 5 at once (0.0005) | 5 | 0 | 1.82 s / 1.83 s | 0.84 s | 0.99 s | 3 / 3 |

The 0.0008 tier was no faster here. Per the source, the oracle only raises its compute limit for it.

## Cost per request

0.0005 SOL VRF fee + 5,000 lamports tx fee; 31–42k CU. Per-pull account (155 bytes): 0.00144 SOL rent, returned on close.

## Checks (now `scripts/program-checks.mjs`)

- A. Second `request_draw` for an open pull: refused (simulation failed; the `init` on an existing account).
- B. The 32 bytes are recoverable from the oracle's callback tx (inner instruction to `fulfill_draw`, oracle
  `vrfkfM4uoisXZQPrFiS2brY4oMkU9EWjyvmvqaFd5AS`) and still are after the account is closed: match = true both times.
- C. **After close, the same pull can be requested again and gets new randomness.** Closing the per-pull account
  re-opens the re-roll the `init` guard was meant to close. The production design needs a tombstone that survives close.

Raw rows: `phase0-results.jsonl`.
