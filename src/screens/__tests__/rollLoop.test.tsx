// Soft-launch pull SFX (#386): the ratchet loops for the whole dispense and stops when that window ends.
// The capsule's land one-shot is the one that was already there. No tier fanfare is added on the way.
import { expect, jest, test } from '@jest/globals';
import React, { useLayoutEffect } from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { mock } from '@/api';
import { playSfx, setRollLoop } from '@/audio/sfx';
import { AuthProvider } from '@/auth/AuthProvider';
import type { Phase } from '@/ritual/reducer';
import { RitualProvider, useRitual } from '@/ritual/useRitual';
import { PullPage } from '@/screens/PullPage';
import { PAGE, SessionProvider } from '@/state/session';

jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual<typeof import('react-native-reanimated')>('react-native-reanimated');
  return { __esModule: true, ...actual, useFrameCallback: jest.fn(() => ({ setActive: () => {}, isActive: false, callbackId: 0 })), withRepeat: (animation: unknown) => animation };
});
jest.mock('@/audio/sfx', () => ({ ...jest.requireActual<object>('@/audio/sfx'), playSfx: jest.fn(), setRollLoop: jest.fn() }));

// A ×1 roll's phases each last well under a second, and on real timers a busy machine could finish the whole roll before a
// `waitFor` on `rolling` ever saw it (11 Oct 2026). So the roll runs on jest's clock, and the probe records every phase
// instead of the test polling for one. Each sound call is stamped with the phase on screen when it ran: the probe writes in
// a layout effect, which runs before any passive effect of the same commit, so the host's roll-loop effect and its cleanup
// both see the phase that commit put on screen.
const ritualRef: { current: ReturnType<typeof useRitual> | null } = { current: null };
const phases: Phase[] = [];
type Sound = { loop: boolean; phase: Phase } | { sfx: string; phase: Phase };
const sounds: Sound[] = [];
function RitualProbe() {
  const r = useRitual();
  useLayoutEffect(() => {
    ritualRef.current = r;
    if (phases.at(-1) !== r.ritual.phase) phases.push(r.ritual.phase);
  });
  return null;
}

test('the ratchet starts once when the roll starts, stays up through the lock, and stops before the capsule lands', async () => {
  jest.useFakeTimers();
  try {
    mock!.dev.reset();
    mock!.dev.creditFree(1);
    phases.length = 0;
    sounds.length = 0;
    const onScreen = () => phases.at(-1) ?? 'idle';
    jest.mocked(setRollLoop).mockReset().mockImplementation((loop) => { sounds.push({ loop, phase: onScreen() }); });
    jest.mocked(playSfx).mockReset().mockImplementation((sfx) => { sounds.push({ sfx, phase: onScreen() }); });
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
    // `act` has run the release's commit and its effects, and no timer has moved: what is recorded by now is the roll's start.
    const atRelease = sounds.length;
    // On fake timers `waitFor` moves the clock `interval` ms per act, and React commits between steps, as it does between two
    // timers in the app. 10 ms keeps the end of the drop (520 ms) and the land (760 ms after the capsule mounts) apart.
    await waitFor(() => expect(playSfx).toHaveBeenCalledWith('land'), { interval: 10 });

    expect(phases).toEqual(['idle', 'preparing', 'armed', 'rolling', 'stopping', 'dropping', 'capsule']);
    const loops = sounds.flatMap((s) => ('loop' in s ? [s] : []));
    // Started exactly once, in the release's own commit: not later in the roll, and the reel lock and the drop do not restart it.
    expect(loops.filter((s) => s.loop).map((s) => s.phase)).toEqual(['rolling']);
    const started = sounds.findIndex((s) => 'loop' in s && s.loop);
    expect(started).toBeGreaterThanOrEqual(0);
    expect(started).toBeLessThan(atRelease);
    // Whether the loop was on as each phase ended. Preparing and armed are not the dispense; capsule is past it.
    let on = false;
    const onAsEachEnded = phases.map((p) => {
      for (const s of loops) if (s.phase === p) on = s.loop;
      return [p, on];
    });
    expect(onAsEachEnded).toEqual([
      ['idle', false], ['preparing', false], ['armed', false],
      ['rolling', true], ['stopping', true], ['dropping', true],
      ['capsule', false],
    ]);
    // Off before the capsule lands, not just by the time anyone looks.
    const land = sounds.findIndex((s) => 'sfx' in s && s.sfx === 'land');
    expect(sounds[land]?.phase).toBe('capsule');
    expect(loops.filter((s) => sounds.indexOf(s) < land).at(-1)?.loop).toBe(false);
  } finally {
    jest.useRealTimers();
  }
});
