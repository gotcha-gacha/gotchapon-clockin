// What the session sends to /pulls/prepare, as the real server reads it (Batch B step 1: the `gachaId` / `clientSeed` review
// of #206's client changes). The in-app mock accepts any seed, so nothing else here would notice a seed the worker refuses:
// `server/src/randomness.ts` `decode32` wants exactly 32 bytes (64 hex characters, or base64url), and production refuses a
// prepare without one — a wrong shape is a 400 on every pull, in every environment, against a real server.
import { expect, jest, test } from '@jest/globals';
import React, { useEffect } from 'react';
import { render } from '@testing-library/react-native';
import { api, type PullPrepareRequest } from '@/api';
import { SessionProvider, useSession } from '@/state/session';
import { drawReceipt } from '@/state/drawReceipts';

let session: ReturnType<typeof useSession> | null = null;
function Probe() {
  const s = useSession();
  useEffect(() => { session = s; });
  return null;
}

async function sent(...reqs: Parameters<ReturnType<typeof useSession>['preparePull']>[0][]): Promise<PullPrepareRequest[]> {
  await render(<SessionProvider><Probe /></SessionProvider>);
  const spy = jest.spyOn(api, 'preparePull');
  try {
    for (const req of reqs) await session!.preparePull(req).catch(() => undefined); // the answer is not under test
    return spy.mock.calls.map((c) => c[0]);
  } finally {
    spy.mockRestore();
  }
}

test('every prepare carries a fresh 32-byte hex seed, the form the worker decodes', async () => {
  const [a, b] = await sent({ count: 1, targeted: false }, { count: 1, targeted: false });
  for (const req of [a, b]) {
    expect(req.clientSeed).toMatch(/^[0-9a-f]{64}$/);
    // Two whole v4 UUIDs (version digit 4, variant 8-b), not one padded out: a padded seed passes the shape and the "fresh"
    // check with half the entropy (PR #260's review).
    for (const half of [req.clientSeed!.slice(0, 32), req.clientSeed!.slice(32)]) {
      expect(half).toMatch(/^[0-9a-f]{12}4[0-9a-f]{3}[89ab][0-9a-f]{15}$/);
    }
    expect(req.clientSeed!.slice(0, 32)).not.toBe(req.clientSeed!.slice(32));
  }
  expect(a.clientSeed).not.toBe(b.clientSeed);
  expect(a.idem).not.toBe(b.idem);
});

test('a plain pull asks the all-cards gacha; a targeted one asks its album gacha and names the album', async () => {
  const [plain, targeted] = await sent({ count: 5, targeted: false }, { count: 1, targeted: true, albumId: 'A' });
  // `all-cards` and `album:<id>` are the worker's gacha ids (server/scripts/build-seed.mjs), and the worker refuses a
  // targeted pull whose gacha is not that album's.
  expect(plain).toMatchObject({ gachaId: 'all-cards', count: 5, targeted: false, asset: 'USDC' });
  expect(plain.albumId).toBeUndefined(); // the session spreads what it is given; that a plain pull carries none is reducer.ts's
  // SET_TARGET, which sets `targeted` and `albumId` together, and the gacha is chosen by `albumId`, not by `targeted`
  expect(targeted).toMatchObject({ gachaId: 'album:A', albumId: 'A', count: 1, targeted: true, asset: 'USDC' });
});

test('a MagicBlock commitment in the prepare answer is kept on the device before anything is signed (#406)', async () => {
  await render(<SessionProvider><Probe /></SessionProvider>);
  const poolHash = 'ab'.repeat(32);
  const spy = jest.spyOn(api, 'preparePull').mockResolvedValue({
    pullId: 'pull_receipt', costUsd: 0, useFreePulls: 1, expiresAt: '2026-10-07T00:00:00.000Z',
    draw: { source: 'magicblock', sequence: 4242, poolHash },
  });
  try {
    await session!.preparePull({ count: 1, targeted: false });
    expect(drawReceipt('pull_receipt')).toMatchObject({ source: 'magicblock', sequence: 4242, poolHash });
  } finally {
    spy.mockRestore();
  }
});
