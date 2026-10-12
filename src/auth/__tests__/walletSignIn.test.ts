// The SIWS sequence without Privy: connect, the sign preview, the ok chip, and the four failures.
// The web chunk calls this, then provisions the embedded deposit wallet. Nothing here links accounts.
import { expect, test } from '@jest/globals';
import { runWalletSignIn, WALLET_OK_MS, type SiwsConnected } from '@/auth/walletSignIn';
import { solanaWalletName, type SolanaWalletKey, type WalletFlow } from '@/auth/solanaWallets';

const ADDRESS = 'So1anaExternalWalletAddressForSiwsTest11';

function wallet(over: Partial<SiwsConnected> = {}): SiwsConnected {
  return {
    address: ADDRESS,
    chains: ['solana:mainnet'],
    walletClientType: 'phantom',
    connectorType: 'injected',
    signMessage: async () => ({ signature: Uint8Array.from([9, 8, 7, 6]) }),
    ...over,
  };
}

function run(over: Partial<Parameters<typeof runWalletSignIn>[0]> = {}) {
  const phases: WalletFlow[] = [];
  const connected: SolanaWalletKey[] = [];
  let connects = 0;
  const result = runWalletSignIn({
    key: 'phantom',
    connect: async (key) => { connects += 1; connected.push(key); return wallet(); },
    generateMessage: async (address) => `gachapon.test wants you to sign in with your Solana account:\n${address}\n\nNonce: n-1`,
    login: async () => ({ id: 'u' }),
    onPhase: (phase) => { phases.push(phase); },
    onConnect: () => {},
    cancelled: () => false,
    wait: async () => {},
    ...over,
  });
  return { result, phases, connected, connects: () => connects };
}

test('each top-level wallet connects, previews the message, and holds the ok chip', async () => {
  for (const key of ['phantom', 'jupiter', 'backpack', 'solflare'] as const) {
    let waited = 0;
    let signed = '';
    const { result, phases, connected } = run({
      key,
      login: async (input) => { signed = input.signature; return { id: 'u' }; },
      wait: async (ms) => { waited = ms; },
    });
    const outcome = await result;
    expect(connected).toEqual([key]);
    expect(phases.map((p) => p.status)).toEqual(['connect', 'sign', 'ok']);
    const sign = phases[1];
    if (sign?.status !== 'sign') throw new Error('sign phase missing');
    expect(sign.domain).toBe('gachapon.test');
    expect(sign.address).toBe(ADDRESS);
    expect(sign.nonce).toBe('n-1');
    expect(signed).toBe('CQgHBg==');
    expect(signed).not.toContain(ADDRESS);
    expect(waited).toBe(WALLET_OK_MS);
    expect(outcome).toEqual({ ok: true, address: ADDRESS, user: { id: 'u' } });
  }
});

test('a generic browser row authenticates with the wallet metadata Privy actually connected', async () => {
  let login: Parameters<Parameters<typeof runWalletSignIn>[0]['login']>[0] | null = null;
  const { result } = run({
    key: 'detected_solana_wallets',
    connect: async () => wallet({ walletClientType: 'glow', connectorType: 'injected' }),
    login: async (input) => { login = input; return { id: 'u' }; },
  });
  expect(await result).toMatchObject({ ok: true });
  expect(login).toMatchObject({ walletClientType: 'glow', connectorType: 'injected' });
});

test('wallet availability is delegated to the Privy connector instead of legacy globals', async () => {
  const { result, phases } = run({
    connect: async () => { throw new Error('Provider not found'); },
  });
  expect(await result).toMatchObject({ ok: false, kind: 'missing', authenticated: false });
  expect(phases).toEqual([
    { status: 'connect', key: 'phantom', name: 'Phantom' },
    { status: 'error', key: 'phantom', name: 'Phantom', kind: 'missing' },
  ]);
});

test('devnet stops before the message is signed', async () => {
  let messages = 0;
  const { result, phases } = run({
    connect: async () => wallet({ chains: ['solana:devnet'] }),
    generateMessage: async () => { messages += 1; return 'x'; },
  });
  expect(await result).toMatchObject({ ok: false, kind: 'network' });
  expect(messages).toBe(0);
  expect(phases.map((p) => p.status)).toEqual(['connect', 'error']);
});

test('a dismissed direct connect is that wallet\'s cancel, not a generic failure', async () => {
  const dismissed = Object.assign(new Error('No Solana accounts found in wallet'), { privyErrorCode: 'no_solana_accounts' });
  for (const key of ['phantom', 'jupiter', 'backpack', 'solflare'] as const) {
    const { result, phases } = run({ key, connect: async () => { throw dismissed; } });
    expect(await result).toMatchObject({ ok: false, kind: 'cancel', authenticated: false });
    expect(phases.at(-1)).toEqual({ status: 'error', key, name: solanaWalletName(key), kind: 'cancel' });
  }
});

test('a declined signature is rejected, and a closed extension is cancel', async () => {
  const declined = run({
    connect: async () => wallet({ signMessage: async () => { throw new Error('User rejected the request'); } }),
  });
  expect(await declined.result).toMatchObject({ ok: false, kind: 'rejected', authenticated: false });
  const closed = run({
    connect: async () => { throw Object.assign(new Error('closed'), { privyErrorCode: 'exited_auth_flow' }); },
  });
  expect(await closed.result).toMatchObject({ ok: false, kind: 'cancel', authenticated: false });
});

test('a cancel after the message is up does not overwrite the caller', async () => {
  let stop = false;
  const { result, phases } = run({
    connect: async () => wallet(),
    generateMessage: async () => { stop = true; return 'gachapon.test wants you to sign in with your Solana account:\nSo1\n\nNonce: n'; },
    cancelled: () => stop,
  });
  expect(await result).toMatchObject({ ok: false, kind: 'cancel' });
  expect(phases.map((p) => p.status)).toEqual(['connect']);
});
