// Withdraw at the session seam (#187). The sheet will not offer Withdraw for a destination that is not an address, but the
// sheet is a screen: this is where money leaves, and it is the line F7.4 replaces with a real send. The check itself lives
// in `withdrawGuard.ts`; what this file pins is that the seam goes through it — returning the sender unwrapped fails the
// first test below.
import { expect, test } from '@jest/globals';
import React, { useEffect } from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '@/auth/AuthProvider';
import { RitualProvider } from '@/ritual/useRitual';
import { SessionProvider, useSession } from '@/state/session';
import { USDC_BASE, mock } from '@/api';
import { newIdempotencyKey } from '@/api/http';

const ADDR = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // 32 bytes of base58
const THIRTY_ONE_BYTES = '7xKpQm2vR8tW3nHd9fQaLm4sT6uVbN1cXeYz8wKpRq'; // base58, wrong size — the app's own old fixture

const probe: { session: ReturnType<typeof useSession> | null } = { session: null };
function Probe() {
  const session = useSession();
  useEffect(() => { probe.session = session; });
  return null;
}

async function session() {
  mock!.dev.reset();
  await render(
    <SafeAreaProvider>
      <AuthProvider>
        <SessionProvider>
          <RitualProvider><Probe /></RitualProvider>
        </SessionProvider>
      </AuthProvider>
    </SafeAreaProvider>,
  );
  await waitFor(() => expect(probe.session?.ready).toBe(true));
  await act(async () => { await probe.session!.devDeposit!(20); });
  await waitFor(() => expect(probe.session!.usdcUsd).toBeGreaterThanOrEqual(20));
  return probe.session!;
}

test('a destination that is not an address is refused, and nothing is debited', async () => {
  const s = await session();
  const before = s.usdcUsd;
  for (const bad of [THIRTY_ONE_BYTES, 'DEMO-WALLET-DO-NOT-SEND', '0x71C7656EC7ab88b098defB751B7401B5f6d8976F', '', 'z'.repeat(44)]) {
    await expect(probe.session!.withdraw!(1, bad, newIdempotencyKey())).rejects.toThrow(/not a Solana address/);
  }
  // Read back from the mock, not off the screen: a refusal that still debited would show here.
  expect((await mock!.balance()).usdc / USDC_BASE).toBe(before);
});

test('a real address goes through, and the amount leaves', async () => {
  const s = await session();
  const before = s.usdcUsd;
  await act(async () => { await probe.session!.withdraw!(3, ` ${ADDR} `, newIdempotencyKey()); }); // trimmed, as a paste arrives
  expect((await mock!.balance()).usdc / USDC_BASE).toBe(before - 3);
});

test('the idempotency key still decides a repeat: the same key twice sends once', async () => {
  const s = await session();
  const before = s.usdcUsd;
  const idem = newIdempotencyKey();
  await act(async () => { await probe.session!.withdraw!(2, ADDR, idem); });
  await act(async () => { await probe.session!.withdraw!(2, ADDR, idem); });
  expect((await mock!.balance()).usdc / USDC_BASE).toBe(before - 2);
});
