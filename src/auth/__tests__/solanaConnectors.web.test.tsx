// The web Privy chunk's external Solana connectors (#243). The SDK is the jest mock; this checks the
// config the chunk actually hands to PrivyProvider, including shouldAutoConnect: false.
import { afterEach, expect, test } from '@jest/globals';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PrivyWebRoot } from '@/auth/privyWebChunk';
import { SOLANA_WALLET_LIST } from '@/auth/solanaWallets';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type SeenConfig = {
  loginMethods: string[];
  appearance: { walletChainType: string; walletList: string[] };
  externalWallets: { solana: { connectors: { onMount: () => void; onUnmount: () => void; get: () => unknown[] } } };
  embeddedWallets: {
    ethereum: { createOnLogin: string };
    solana: { createOnLogin: string };
    showWalletUIs: boolean;
  };
};
const calls = () => (globalThis as unknown as {
  __gachaponSolanaConnectors: { calls: { shouldAutoConnect?: boolean }[] };
}).__gachaponSolanaConnectors.calls;
const seen = () => (globalThis as unknown as { __gachaponPrivyConfig: SeenConfig }).__gachaponPrivyConfig;

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(async () => {
  if (root) { await act(async () => { root!.unmount(); }); root = null; }
  host?.remove(); host = null;
});

test('connectors include Jupiter as a top-level wallet and do not auto-connect', async () => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(<PrivyWebRoot><span /></PrivyWebRoot>); });

  expect(calls()).toEqual([{ shouldAutoConnect: false }]);
  const config = seen();
  expect(config.loginMethods).toEqual(['email', 'google', 'apple']);
  expect(config.appearance.walletChainType).toBe('solana-only');
  expect(config.appearance.walletList).toEqual([...SOLANA_WALLET_LIST]);
  expect(typeof config.externalWallets.solana.connectors.onMount).toBe('function');
  expect(typeof config.externalWallets.solana.connectors.onUnmount).toBe('function');
  // The SDK's get() always ends with WalletConnect. That row is not an installed browser wallet.
  expect(config.externalWallets.solana.connectors.get()).toEqual([
    expect.objectContaining({
      connectorType: 'solana_adapter',
      walletClientType: 'walletconnect_solana',
      walletBranding: { id: 'walletconnect_solana', name: 'WalletConnect' },
    }),
  ]);
  expect(config.embeddedWallets.ethereum.createOnLogin).toBe('off');
  expect(config.embeddedWallets.solana.createOnLogin).toBe('users-without-wallets');
  expect(config.embeddedWallets.showWalletUIs).toBe(false);
});
