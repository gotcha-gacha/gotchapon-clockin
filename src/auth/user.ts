// A Privy user, read for the two things this app needs of it: which Solana wallet holds funds, and who they signed in with.
// Kept apart from the provider so both can be tested without a React tree.
//
// Funds are always the embedded Solana wallet (#245). An external wallet on a SIWS user is the login id only.
// The Expo SDK writes `linked_accounts` / `chain_type`. `@privy-io/react-auth` writes `linkedAccounts` / `chainType`.
// One reader covers both so the web chunk does not import the web SDK's types into this file.
import { loginWalletName } from '@/auth/solanaWallets';

type LinkedAccount = {
  type?: string;
  address?: string;
  chain_type?: string;
  chainType?: string;
  wallet_client_type?: string;
  walletClientType?: string;
  connector_type?: string;
  connectorType?: string;
};

export type PrivyUserLike = {
  id?: string;
  linked_accounts?: readonly LinkedAccount[] | null;
  linkedAccounts?: readonly LinkedAccount[] | null;
} | null | undefined;

function accountsOf(user: PrivyUserLike): readonly LinkedAccount[] {
  const raw = user?.linked_accounts ?? user?.linkedAccounts;
  return Array.isArray(raw) ? raw : [];
}

function chainOf(account: LinkedAccount): string | undefined {
  return account.chain_type ?? account.chainType;
}

function clientOf(account: LinkedAccount): string | undefined {
  const client = account.wallet_client_type ?? account.walletClientType;
  return typeof client === 'string' && client.length > 0 ? client : undefined;
}

function connectorOf(account: LinkedAccount): string | undefined {
  const connector = account.connector_type ?? account.connectorType;
  return typeof connector === 'string' && connector.length > 0 ? connector : undefined;
}

function isSolanaWallet(account: LinkedAccount): account is LinkedAccount & { address: string } {
  return account.type === 'wallet' && chainOf(account) === 'solana' && typeof account.address === 'string' && account.address.length > 0;
}

/** The Privy embedded wallet. That is the deposit and spend address for social and for SIWS. */
function isEmbeddedSolana(account: LinkedAccount): boolean {
  if (!isSolanaWallet(account)) return false;
  return clientOf(account) === 'privy' || connectorOf(account) === 'embedded';
}

/**
 * A connected wallet (Phantom, Backpack, Solflare, …). Unmarked Solana accounts are not this:
 * social documents and the test double omit a client type on the embedded wallet.
 */
function isExternalSolana(account: LinkedAccount): boolean {
  if (!isSolanaWallet(account) || isEmbeddedSolana(account)) return false;
  const client = clientOf(account);
  const connector = connectorOf(account);
  if (client && client !== 'privy') return true;
  if (connector && connector !== 'embedded') return true;
  return false;
}

/**
 * The address Privy's Solana export modal may open (#352). Stricter than the funds reader:
 * `walletClientType === 'privy'` and `chainType === 'solana'` on this exact address.
 * An unmarked embedded wallet still counts as funds (`solanaAddressFromUser`) but is not exported.
 * Phantom, Jupiter, and every other external login wallet are not.
 */
export function isPrivyEmbeddedSolana(user: PrivyUserLike, address: string): boolean {
  if (!address) return false;
  return accountsOf(user).some((account) =>
    account.type === 'wallet'
    && chainOf(account) === 'solana'
    && clientOf(account) === 'privy'
    && account.address === address);
}

/** Deposit address: the embedded Solana wallet, never the wallet the person connected to sign in. */
export function solanaAddressFromUser(user: PrivyUserLike): string | null {
  const solana = accountsOf(user).filter(isSolanaWallet);
  const embedded = solana.find(isEmbeddedSolana);
  if (embedded?.address) return embedded.address;
  const unmarked = solana.find((a) => !isExternalSolana(a));
  return unmarked?.address ?? null;
}

/** Privy's connector key for the external SIWS wallet, used to reconnect its browser signer after restore. */
export function externalSolanaWalletClientFromUser(user: PrivyUserLike): string | null {
  const external = accountsOf(user).find(isExternalSolana);
  return external ? (clientOf(external) ?? null) : null;
}

export function providerFromUser(user: PrivyUserLike): 'Apple' | 'Google' | 'email' | 'wallet' | null {
  // Social and email win when both are present. An embedded Solana wallet sits on every Apple / Google / email
  // account, and that must stay "Signed in with Google", not "your wallet". A SIWS user has the external wallet
  // and, after #245, an embedded deposit wallet, and no social account: that is `wallet`, a different binder.
  // Nothing here merges the two.
  for (const a of accountsOf(user)) {
    if (a.type === 'google_oauth') return 'Google';
    if (a.type === 'apple_oauth') return 'Apple';
    if (a.type === 'email') return 'email';
  }
  for (const a of accountsOf(user)) {
    if (isSolanaWallet(a)) return 'wallet';
  }
  return null;
}

/** The external wallet that signed a SIWS binder in. Null for Apple, Google, and email, and null once that account is gone. */
export function loginWalletOf(user: PrivyUserLike): { name: string; address: string } | null {
  if (providerFromUser(user) !== 'wallet') return null;
  const external = accountsOf(user).find(isExternalSolana);
  if (!external?.address) return null;
  return { name: loginWalletName(clientOf(external)), address: external.address };
}
