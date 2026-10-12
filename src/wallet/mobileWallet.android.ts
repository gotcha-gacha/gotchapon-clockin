// Android only: the real Mobile Wallet Adapter. Metro picks this file over `mobileWallet.ts` for an Android bundle, so the
// MWA package (a native module) never reaches the iOS or web bundles.
//
// The package is required on first use, not imported: it calls `TurboModuleRegistry.getEnforcing` as it loads, which
// throws when the native module is missing, and a static import would take the whole Wallet page (and Home) down at launch
// with it. Required lazily, a missing module only fails Connect.
import type { MobileWalletSession, MobileWalletTransact } from './mobileWalletTypes';

type Transact = typeof import('@solana-mobile/mobile-wallet-adapter-protocol').transact;
let loaded: Transact | null = null;

function load(): Transact {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberately lazy, see above
  loaded ??= (require('@solana-mobile/mobile-wallet-adapter-protocol') as typeof import('@solana-mobile/mobile-wallet-adapter-protocol')).transact;
  return loaded;
}

// The package types `authorize` with a deprecated `cluster` overload first, so its wallet is narrowed to the calls the app
// makes rather than passed through. `transact` awaits whatever the session returns.
export const mobileWalletTransact: MobileWalletTransact | null = <T,>(session: (wallet: MobileWalletSession) => Promise<T>) => {
  let transact: Transact;
  try {
    transact = load();
  } catch {
    return Promise.reject(new Error('Wallet apps are not available in this build.'));
  }
  return transact((wallet) => session({
    authorize: (params) => wallet.authorize(params),
    signTransactions: (params) => wallet.signTransactions(params),
    signMessages: (params) => wallet.signMessages(params),
  })) as Promise<T>;
};
