// Mobile Wallet Adapter (MWA) is how an Android app asks a wallet app on the same phone (the Seeker's own wallet, Phantom,
// Solflare, …) to sign. This is the slice of its session the app uses, typed here so nothing outside
// `mobileWallet.android.ts` imports the MWA package: it is a native module that exists only in the Android build.
export type MobileWalletIdentity = Readonly<{ name?: string; uri?: string; icon?: string }>;

export interface MobileWalletSession {
  authorize(params: { identity: MobileWalletIdentity; chain: `${string}:${string}`; auth_token?: string }): Promise<Readonly<{
    // MWA sends each account's public key as base64, not base58.
    accounts: readonly Readonly<{ address: string; label?: string }>[];
    auth_token: string;
  }>>;
  signTransactions(params: { payloads: string[] }): Promise<Readonly<{ signed_payloads: string[] }>>;
  /** `addresses` are the base64 public keys `authorize` returned; payloads are base64. */
  signMessages(params: { addresses: string[]; payloads: string[] }): Promise<Readonly<{ signed_payloads: string[] }>>;
}

/** Opens one session with a wallet app on this phone and runs `session` inside it. */
export type MobileWalletTransact = <T>(session: (wallet: MobileWalletSession) => Promise<T>) => Promise<T>;
