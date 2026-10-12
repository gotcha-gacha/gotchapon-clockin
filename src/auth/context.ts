// What every screen reads about sign-in (F7.4, #6). Two implementations fill it: the mock that has carried the app since
// week 1 (`mockAuth.tsx`), and Privy (`privyAuth.tsx`) once an app id is in the environment. `AuthProvider.tsx` picks.
import { createContext, useContext } from 'react';
import type { ApiError } from '@/api/errors';
import type { SolanaWalletKey, WalletFlow } from '@/auth/solanaWallets';

/** Apple, Google, email. A connected wallet is `wallet` on `provider`, and is not a `signIn` argument. */
export type SocialProvider = 'Apple' | 'Google' | 'email';
export type Provider = SocialProvider | 'wallet';
export type AuthStage = 'idle' | 'busy' | 'onboarding' | 'done';

export type Auth = {
  /** The app may be drawn. False only while a cold-start session restore is still in flight, and bounded either way. */
  ready: boolean;
  stage: AuthStage;
  provider: Provider | null;
  step: string;
  /** Embedded Solana deposit address for every door, social and SIWS. Not the connected login wallet. */
  wallet: string | null;
  /**
   * The external wallet that signed a SIWS binder in. Not the deposit address. Null for Apple, Google, and email,
   * and on builds that have no wallet sign-in.
   */
  loginWallet?: { name: string; address: string } | null;
  onboardingIndex: number;
  /** Why the last sign-in did not complete (the API could not be reached, the code was wrong, …). */
  error: ApiError | null;
  /** Whether Continue with Apple can do anything. True on the mock and on Privy (iOS and web, #232 / W5.1); false on Privy
   *  on Android, where Apple refuses the mobile client's browser flow. The sheet disables the button and says so when false;
   *  on Android it draws no Apple button at all. */
  appleReady: boolean;
  /** Sign in with Apple, Google, or email. Email needs the code that `sendEmailCode` asked for. */
  signIn: (provider: SocialProvider, opts?: { email?: string; code?: string }) => Promise<void>;
  /**
   * Web Privy only. Connect one external Solana wallet and sign in with SIWS. Absent on the phone and on the
   * mock: those sheets stay Apple / Google / email. Never links the wallet onto an existing account.
   */
  signInWallet?: (key: SolanaWalletKey) => Promise<void>;
  /** Wallet Standard wallets currently registered in this browser. Web Privy only. */
  installedSolanaWallets?: () => ReadonlySet<SolanaWalletKey>;
  /** Where an external-wallet sign-in is, when one is running or has just failed. Null on the social form. */
  walletFlow?: WalletFlow | null;
  /** Leave a wallet error (or abandon connect / sign) and return to Apple / Google / email. */
  dismissWalletFlow?: () => void;
  /** Ask for an email code. **True** when one is on its way and the screen should collect it; **false** when sign-in is
   *  already done and there is no code to enter — which is what the mock answers, having no inbox to send to. */
  sendEmailCode: (email: string) => Promise<boolean>;
  /** Add the user's Solana signature to the API-built transaction. The API validates it,
   * adds the fee-payer signature, and broadcasts only from /commit. */
  signSolanaTransaction: ((transactionBase64: string) => Promise<string>) | null;
  /** Web SIWS only. The API builds and broadcasts a USDC transfer from the connected
   * wallet to the embedded wallet; the connected wallet signs the exact bytes. */
  depositFromConnectedWallet: ((amountBase: number, idem: string) => Promise<void>) | null;
  /**
   * Native Privy on Android only (Mobile Wallet Adapter, CLOCK IN, Ben, 11 Oct): link a wallet app's account to this
   * account with a Sign in with Solana message the wallet app signs, so the server will build deposits from it and the
   * faucet may send to it (both require a linked external wallet). An explicit action on the Wallet page, unlike the sign-in
   * sheets, which never link. Already linked: resolves without asking for a signature. Absent everywhere else.
   */
  linkWalletApp?: (address: string, signMessage: (message: Uint8Array) => Promise<Uint8Array>) => Promise<void>;
  /**
   * Opens Privy's export modal for the embedded deposit wallet (#352). Set only on the web Privy
   * path, and only when that address is a Privy embedded Solana wallet (`walletClientType === 'privy'`).
   * Absent on the phone and on the mock: the modal is the React SDK, and nothing else may reveal the key.
   * The call takes no address. The provider passes the deposit pubkey, never an external login wallet.
   */
  exportDepositWallet?: () => Promise<void>;
  signOut: () => void;
  nextSheet: () => void;
  skipOnboarding: () => void;
};

export const AuthCtx = createContext<Auth | null>(null);

export function useAuth(): Auth {
  const v = useContext(AuthCtx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
