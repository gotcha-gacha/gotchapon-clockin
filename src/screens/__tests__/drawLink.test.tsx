// "Check the draw" on the Pull page (#406 step 6, #418), against the in-app mock. The mock never draws by MagicBlock, so a
// pull of its own shows no link and never asks for a draw; with its prepare answering a MagicBlock commitment and its draw view
// naming the fulfilment, the revealed card carries the link and the press opens that transaction's page.
import { afterEach, expect, jest, test } from '@jest/globals';
import React, { useEffect } from 'react';
import { Linking } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { mock } from '@/api';
import { AuthProvider } from '@/auth/AuthProvider';
import { RitualProvider, useRitual } from '@/ritual/useRitual';
import { PullPage } from '@/screens/PullPage';
import { PAGE, SessionProvider } from '@/state/session';

const SIG = 'A'.repeat(40) + 'b'.repeat(40);
const probe: { ritual: ReturnType<typeof useRitual> | null } = { ritual: null };
function Probe() {
  const ritual = useRitual();
  useEffect(() => { probe.ritual = ritual; });
  return null;
}

async function revealOne(atCapsule: () => void = () => {}) {
  mock!.dev.reset();
  mock!.dev.creditFree(3);
  await render(
    <SafeAreaProvider>
      <AuthProvider>
        <SessionProvider initialPage={PAGE.pull}>
          <RitualProvider><Probe /><PullPage /></RitualProvider>
        </SessionProvider>
      </AuthProvider>
    </SafeAreaProvider>,
  );
  await waitFor(() => expect(probe.ritual).toBeTruthy());
  await act(async () => { probe.ritual!.dispatch({ type: 'CRANK_START' }); });
  await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('armed'));
  await act(async () => { probe.ritual!.dispatch({ type: 'RELEASE' }); });
  await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('capsule'));
  atCapsule();
  await act(async () => { probe.ritual!.dispatch({ type: 'CRACKED' }); });
  await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('card'));
  await screen.findByLabelText('Into binder');
}

const spies: { mockRestore: () => void }[] = [];
afterEach(() => { while (spies.length) spies.pop()!.mockRestore(); });

test('a pull the server proved itself shows no link and asks for no draw', async () => {
  const pullDraw = jest.spyOn(mock!, 'pullDraw');
  spies.push(pullDraw);
  await revealOne();
  await act(async () => { await new Promise((done) => setTimeout(done, 50)); });
  expect(screen.queryByLabelText('Check the draw')).toBeNull();
  expect(pullDraw).not.toHaveBeenCalled();
});

test('a MagicBlock pull\'s revealed card links its draw, and the press opens that page', async () => {
  const realPrepare = mock!.preparePull.bind(mock);
  const prepare = jest.spyOn(mock!, 'preparePull').mockImplementation(async (req) =>
    ({ ...(await realPrepare(req)), draw: { source: 'magicblock', sequence: 41, poolHash: 'a'.repeat(64) } }));
  const pullDraw = jest.spyOn(mock!, 'pullDraw').mockImplementation(async (pullId) =>
    ({ pullId, source: 'magicblock', cluster: 'devnet', fulfilSignature: SIG }));
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  spies.push(prepare, pullDraw, open);
  // "After the pull": nothing is asked while the capsule is still sealed (a draw view asked before commit has no fulfilment).
  await revealOne(() => expect(pullDraw).not.toHaveBeenCalled());
  const link = await screen.findByLabelText('Check the draw');
  expect(pullDraw).toHaveBeenCalledWith(probe.ritual!.ritual.prepared!.pullId);
  await fireEvent.press(link);
  expect(open).toHaveBeenCalledWith(`https://explorer.solana.com/tx/${SIG}?cluster=devnet`);
  // Into binder takes the card, and its link, away.
  await fireEvent.press(screen.getByLabelText('Into binder'));
  await waitFor(() => expect(screen.queryByLabelText('Check the draw')).toBeNull());
});

test('a ×5 MagicBlock pull links its draw once on the spread, and asks for nothing before the pile opens', async () => {
  const realPrepare = mock!.preparePull.bind(mock);
  const prepare = jest.spyOn(mock!, 'preparePull').mockImplementation(async (req) =>
    ({ ...(await realPrepare(req)), draw: { source: 'magicblock', sequence: 42, poolHash: 'b'.repeat(64) } }));
  const pullDraw = jest.spyOn(mock!, 'pullDraw').mockImplementation(async (pullId) =>
    ({ pullId, source: 'magicblock', cluster: 'mainnet-beta', fulfilSignature: SIG }));
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  spies.push(prepare, pullDraw, open);
  mock!.dev.reset();
  await render(
    <SafeAreaProvider>
      <AuthProvider>
        <SessionProvider initialPage={PAGE.pull}>
          <RitualProvider><Probe /><PullPage /></RitualProvider>
        </SessionProvider>
      </AuthProvider>
    </SafeAreaProvider>,
  );
  await waitFor(() => expect(probe.ritual).toBeTruthy());
  mock!.dev.deposit(20);
  await act(async () => { probe.ritual!.dispatch({ type: 'SET_MULTI', multi: 5 }); });
  await act(async () => { probe.ritual!.dispatch({ type: 'CRANK_START' }); });
  await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('armed'));
  expect(probe.ritual!.ritual.prepared?.draw?.source).toBe('magicblock');
  await act(async () => { probe.ritual!.dispatch({ type: 'RELEASE' }); });
  await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('batchcaps'));
  expect(pullDraw).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('Check the draw')).toBeNull();
  await act(async () => { probe.ritual!.dispatch({ type: 'OPEN_PILE' }); });
  await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('spread'));
  const link = await screen.findByLabelText('Check the draw');
  expect(screen.getAllByLabelText('Check the draw')).toHaveLength(1);
  expect(pullDraw).toHaveBeenCalledTimes(1);
  await fireEvent.press(link);
  expect(open).toHaveBeenCalledWith(`https://explorer.solana.com/tx/${SIG}`);
});
