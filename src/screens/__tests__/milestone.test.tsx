// Milestone confetti (F3.4) against the in-app mock, plus the pull-wait rule (#335): any new card bursts 26 pieces.
// The fifth distinct card of an album also bursts the milestone shower (52) and reads "5/25!".
// Its own file: it narrows mock stock and forces the tier.
import { expect, test } from '@jest/globals';
import React, { useEffect } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { mock } from '@/api';
import { ALBUMS } from '@/api/mock/fixtures';
import { AuthProvider } from '@/auth/AuthProvider';
import { RitualProvider, useRitual } from '@/ritual/useRitual';
import { PullPage } from '@/screens/PullPage';
import { PAGE, SessionProvider, useSession } from '@/state/session';

const probe: { session: ReturnType<typeof useSession> | null; ritual: ReturnType<typeof useRitual> | null } = { session: null, ritual: null };

function Probe() {
  const session = useSession();
  const ritual = useRitual();
  useEffect(() => { probe.session = session; probe.ritual = ritual; });
  return null;
}

/** A pull straight through the session, revealed at once, paying with a mock transfer when free pulls run out. */
async function pullOne() {
  const s = probe.session!;
  const p = await s.preparePull({ count: 1, targeted: false });
  const txSignature = p.transfer ? await s.signTransfer(p) : undefined;
  s.revealed((await s.commitPull({ pullId: p.pullId, txSignature })).outcomes);
}

/** A pull through the machine up to the revealed card. */
async function revealThroughMachine() {
  await act(async () => { probe.ritual!.dispatch({ type: 'CRANK_START' }); });
  await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('armed'));
  await act(async () => { probe.ritual!.dispatch({ type: 'RELEASE' }); });
  await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('capsule'));
  await act(async () => { probe.ritual!.dispatch({ type: 'CRACKED' }); });
}

test('the fourth distinct card bursts confetti; the fifth adds the milestone shower and 5/25!', async () => {
  mock!.dev.forceTier('common');
  for (const a of ALBUMS) for (const c of a.cards) mock!.dev.setStock(c.id, 0);
  ALBUMS[0].cards.slice(0, 5).forEach((c) => mock!.dev.setStock(c.id, 1)); // one copy each: every pull is a new card
  await render(
    <SafeAreaProvider>
      <AuthProvider>
        <SessionProvider initialPage={PAGE.pull}>
          <RitualProvider><Probe /><PullPage /></RitualProvider>
        </SessionProvider>
      </AuthProvider>
    </SafeAreaProvider>,
  );
  await waitFor(() => expect(probe.session?.ready).toBe(true));
  await act(async () => { await probe.session!.devDeposit?.(5); for (let i = 0; i < 3; i++) await pullOne(); });
  await revealThroughMachine(); // the fourth distinct card: new, not a milestone
  expect(screen.getAllByTestId('confetti-piece')).toHaveLength(26);
  await act(async () => { probe.ritual!.dispatch({ type: 'INTO_BINDER' }); });
  await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('idle'));
  await revealThroughMachine(); // the fifth: new card and the 5/25 milestone
  expect(await screen.findByText(/· 5\/25!$/)).toBeTruthy();
  expect(screen.getAllByTestId('confetti-piece')).toHaveLength(52);
}, 20_000);
