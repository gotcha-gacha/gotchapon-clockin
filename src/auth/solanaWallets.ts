// External Solana wallet keys for the web (#243). This file is the list #244 passes to
// `connectWallet`. It does not import `@privy-io/react-auth`: the connectors stay in `privyWebChunk.tsx`,
// which is the lazy chunk, so a screen can read the keys without putting the SDK on the first paint.
//
// Curated rows: Phantom, Jupiter, Backpack, Solflare. More: `detected_solana_wallets` (other Solana extensions
// already in this browser) plus OKX, Coinbase, and Trust as named install rows.
//
// `trust_wallet` is outside `@privy-io/react-auth` 3.45's `WalletListEntry` union. The Solana connector
// sets `walletClientType` from the wallet-standard name (`"Trust Wallet"` becomes `trust_wallet`), and
// the allow-list compare strips a trailing `_wallet`, so that string still selects Trust.

export const CURATED_SOLANA_WALLETS = ['phantom', 'jupiter', 'backpack', 'solflare'] as const;

/** OKX and Coinbase, which are `WalletListEntry` members. Trust is `TRUST_SOLANA_WALLET`. */
export const OTHER_SOLANA_WALLETS = ['okx_wallet', 'coinbase_wallet'] as const;

/** Wallet-standard id for Trust Wallet. See the note above. */
export const TRUST_SOLANA_WALLET = 'trust_wallet' as const;

/** Other Solana extensions this browser already injected, excluding the named rows above. */
export const DETECTED_SOLANA_WALLETS = 'detected_solana_wallets' as const;

/** Named wallets first, then detection, so a detected Phantom stays on the Phantom row. */
export const SOLANA_WALLET_LIST = [
  ...CURATED_SOLANA_WALLETS,
  ...OTHER_SOLANA_WALLETS,
  TRUST_SOLANA_WALLET,
  DETECTED_SOLANA_WALLETS,
] as const;

export type SolanaWalletKey = (typeof SOLANA_WALLET_LIST)[number];

/** One tapped row: `connectWallet(solanaConnectWalletOptions(k))` from inside the Privy tree. */
export function solanaConnectWalletOptions(wallet: SolanaWalletKey): {
  walletList: [SolanaWalletKey];
  walletChainType: 'solana-only';
} {
  return { walletList: [wallet], walletChainType: 'solana-only' };
}

/** What the sheet and analytics say. Analytics gets this name, never an address. */
const WALLET_NAMES: Record<Exclude<SolanaWalletKey, typeof DETECTED_SOLANA_WALLETS>, string> = {
  phantom: 'Phantom',
  jupiter: 'Jupiter',
  backpack: 'Backpack',
  solflare: 'Solflare',
  okx_wallet: 'OKX',
  coinbase_wallet: 'Coinbase',
  trust_wallet: 'Trust',
};

export function solanaWalletName(key: SolanaWalletKey): string {
  if (key === DETECTED_SOLANA_WALLETS) return 'Browser wallet';
  return WALLET_NAMES[key];
}

/** What the Wallet tab calls the connected login wallet. Unknown client types stay generic, and the address is never part of the name. */
export function loginWalletName(client: string | null | undefined): string {
  if (client && (SOLANA_WALLET_LIST as readonly string[]).includes(client)) return solanaWalletName(client as SolanaWalletKey);
  const standardKey = solanaWalletKeyFromClient(client);
  if (standardKey !== DETECTED_SOLANA_WALLETS) return solanaWalletName(standardKey);
  return 'connected wallet';
}

/** Resolve Privy's persisted wallet client back to a connect row; unknown wallet-standard clients use detection. */
export function solanaWalletKeyFromClient(client: string | null | undefined): SolanaWalletKey {
  const normalized = client?.trim().toLowerCase().replaceAll(' ', '_');
  const comparable = normalized?.replace(/_wallet$/, '');
  return SOLANA_WALLET_LIST.find((key) => key !== DETECTED_SOLANA_WALLETS
    && key.replace(/_wallet$/, '') === comparable)
    ?? DETECTED_SOLANA_WALLETS;
}

export type WalletErrorKind = 'cancel' | 'missing' | 'network' | 'rejected' | 'unknown';

/** The sheet's wallet states (#244). `ok` holds for ~950 ms, then the same land as Google. */
export type WalletFlow =
  | { status: 'connect'; key: SolanaWalletKey; name: string }
  | { status: 'sign'; key: SolanaWalletKey; name: string; domain: string; address: string; nonce: string }
  | { status: 'ok'; key: SolanaWalletKey; name: string; address: string }
  | { status: 'error'; key: SolanaWalletKey; name: string; kind: WalletErrorKind };

const INSTALL_URL: Record<Exclude<SolanaWalletKey, typeof DETECTED_SOLANA_WALLETS>, string> = {
  phantom: 'https://phantom.app/download',
  jupiter: 'https://chromewebstore.google.com/detail/jupiter-wallet/iledlaeogohbilgbfhmbgkgmpplbfboh',
  backpack: 'https://backpack.app/download',
  solflare: 'https://solflare.com/download',
  okx_wallet: 'https://www.okx.com/web3',
  coinbase_wallet: 'https://www.coinbase.com/wallet/downloads',
  trust_wallet: 'https://trustwallet.com/download',
};

/** Store / download page. Null for the "already in this browser" row, which has nothing to install by name. */
export function walletInstallUrl(key: SolanaWalletKey): string | null {
  if (key === DETECTED_SOLANA_WALLETS) return null;
  return INSTALL_URL[key];
}

/**
 * Open the current page inside the wallet's in-app browser. Phantom and Solflare are the links the
 * ticket names; Backpack uses the same browse shape. The page is encoded so its slashes stay one segment.
 */
export function walletBrowseUrl(key: SolanaWalletKey, page: string): string | null {
  const enc = encodeURIComponent(page);
  if (key === 'phantom') return `https://phantom.app/ul/browse/${enc}`;
  if (key === 'jupiter') return `jupjupjup://jup.ag/browse/${enc}`;
  if (key === 'solflare') return `https://solflare.com/ul/v1/browse/${enc}`;
  if (key === 'backpack') return `https://backpack.app/ul/v1/browse/${enc}`;
  return null;
}

type Injected = {
  phantom?: { solana?: { isPhantom?: boolean } };
  jupiter?: { isJupiter?: boolean };
  solana?: { isPhantom?: boolean; isBackpack?: boolean; isSolflare?: boolean };
  backpack?: unknown;
  solflare?: { isSolflare?: boolean };
  okxwallet?: { solana?: unknown };
  coinbaseSolana?: unknown;
  trustwallet?: { solana?: unknown };
};

function injected(): Injected | null {
  if (typeof window === 'undefined') return null;
  return window as unknown as Injected;
}

/** Which named rows are already in this browser. The sheet's Detected / Install tags read this. */
export function detectedSolanaWalletKeys(): Set<SolanaWalletKey> {
  const w = injected();
  const found = new Set<SolanaWalletKey>();
  if (!w) return found;
  if (w.phantom?.solana?.isPhantom || w.solana?.isPhantom) found.add('phantom');
  if (w.jupiter?.isJupiter) found.add('jupiter');
  if (w.backpack || w.solana?.isBackpack) found.add('backpack');
  if (w.solflare?.isSolflare || w.solana?.isSolflare) found.add('solflare');
  if (w.okxwallet?.solana) found.add('okx_wallet');
  if (w.coinbaseSolana) found.add('coinbase_wallet');
  if (w.trustwallet?.solana) found.add('trust_wallet');
  return found;
}

/** A Solana provider that is not one of the named rows, so More can offer `detected_solana_wallets`. */
export function hasUnnamedSolanaWallet(): boolean {
  const solana = injected()?.solana;
  if (!solana) return false;
  if (solana.isPhantom || solana.isBackpack || solana.isSolflare) return false;
  return true;
}

/** Mainnet, including the CAIP genesis-hash form. An empty list is "the wallet did not say", which does not block. */
const MAINNET = /(?:^|:)mainnet(?:-beta)?$|5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/i;

export function solanaChainsAreMainnet(chains: readonly string[]): boolean {
  if (chains.length === 0) return true;
  return chains.some((c) => MAINNET.test(c.trim()));
}

export function chainsOf(wallet: {
  chains?: readonly string[];
  accounts?: readonly { chains?: readonly string[] }[];
}): string[] {
  return [
    ...(wallet.chains ?? []),
    ...(wallet.accounts?.flatMap((a) => [...(a.chains ?? [])]) ?? []),
  ];
}

/** Domain, address, and nonce out of a SIWS message, for the sign step's preview. */
export function siwsPreview(message: string, address: string): { domain: string; address: string; nonce: string } {
  const domain = message.split(' wants you to sign in')[0]?.trim() || '';
  const nonce = /Nonce:\s*(\S+)/.exec(message)?.[1] ?? '';
  const found = /Solana account:\s*(\S+)/.exec(message)?.[1] ?? address;
  return { domain, address: found, nonce };
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return globalThis.btoa(binary);
}

/**
 * The four wallet-sheet failures. Cancel is a code first (`exited_auth_flow`), because "rejected" also
 * appears in cancel prose. Anything else that is a signature refusal is `rejected`, so the sheet still
 * has a primary action rather than the pull-flow error card.
 *
 * Privy 3.45's Solana adapter drops a dismissed connect. `promptConnection` wraps the wallet's 4001,
 * then `connect` throws `no_solana_accounts` whenever the wallet still has no accounts — for every
 * named row that connects directly, not only Jupiter. That is a cancel of the wallet the user tapped.
 * The unknown card ("the wallet connected, but sign-in did not finish") is false here.
 */
export function classifyWalletFailure(e: unknown): WalletErrorKind {
  const o = e as { code?: unknown; privyErrorCode?: unknown; message?: unknown } | null;
  const codes = [o?.code, o?.privyErrorCode].filter((c): c is string => typeof c === 'string').map((c) => c.toLowerCase());
  const message = typeof o?.message === 'string' ? o.message.toLowerCase() : '';
  const blob = `${codes.join(' ')} ${message}`;
  if (codes.some((c) => c === 'exited_auth_flow' || c === 'user_exited' || c === 'no_solana_accounts' || c.includes('cancelled_by_user'))) return 'cancel';
  if (/not installed|not found|no provider|provider not|wallet_missing|could not find/.test(blob)) return 'missing';
  if (/mainnet|wrong network|unsupported chain|devnet|testnet|switch network/.test(blob)) return 'network';
  // Wallet-standard user rejection is numeric 4001. The string check misses a code the message does not repeat.
  if (o?.code === 4001 || /reject|declin|denied|4001/.test(blob)) return 'rejected';
  if (/cancel|exited|closed the/.test(blob)) return 'cancel';
  return 'unknown';
}
