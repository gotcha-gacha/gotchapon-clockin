// Reveal sounds (F6.2) on the Pull page against the in-app mock: the capsule lands with its thud, and the card is revealed with
// its tier's sound and its haptics. (Haptics never read the reduced-motion setting; reducedMotion.test covers what does.)
import { expect, jest, test } from '@jest/globals';
import React, { useEffect } from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { mock } from '@/api';
import { playSfx, tierSfx } from '@/audio/sfx';
import { AuthProvider } from '@/auth/AuthProvider';
import { RitualProvider, useRitual } from '@/ritual/useRitual';
import { PullPage } from '@/screens/PullPage';
import { PAGE, SessionProvider } from '@/state/session';

jest.mock('@/audio/sfx', () => ({ ...jest.requireActual<object>('@/audio/sfx'), playSfx: jest.fn() }));

const ritualRef: { current: ReturnType<typeof useRitual> | null } = { current: null };
function RitualProbe() {
  const r = useRitual();
  useEffect(() => { ritualRef.current = r; });
  return null;
}

test('the capsule lands with a thud, and the card reveals with its tier sound and haptics', async () => {
  mock!.dev.reset();
  mock!.dev.creditFree(1);
  await render(
    <SafeAreaProvider>
      <AuthProvider>
        <SessionProvider initialPage={PAGE.pull}>
          <RitualProvider><RitualProbe /><PullPage /></RitualProvider>
        </SessionProvider>
      </AuthProvider>
    </SafeAreaProvider>,
  );
  await waitFor(() => expect(ritualRef.current).not.toBeNull());
  await act(async () => { ritualRef.current!.dispatch({ type: 'CRANK_START' }); });
  await waitFor(() => expect(ritualRef.current!.ritual.phase).toBe('armed'));
  await act(async () => { ritualRef.current!.dispatch({ type: 'RELEASE' }); });
  await waitFor(() => expect(ritualRef.current!.ritual.phase).toBe('capsule'));
  await waitFor(() => expect(playSfx).toHaveBeenCalledWith('land'));

  const pulled = ritualRef.current!.ritual.outcomes[0]!;
  jest.mocked(playSfx).mockClear();
  jest.mocked(Haptics.impactAsync).mockClear();
  await act(async () => { ritualRef.current!.dispatch({ type: 'CRACKED' }); });
  await waitFor(() => expect(playSfx).toHaveBeenCalledWith(tierSfx(pulled.rarity)));
  await waitFor(() => expect(Haptics.impactAsync).toHaveBeenCalled());
});
