// External Solana wallet keys (#243). The connector call itself is asserted from the web project, which
// is the only one that loads the Privy chunk.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@jest/globals';
import type { WalletListEntry } from '@privy-io/react-auth';
import {
  CURATED_SOLANA_WALLETS,
  DETECTED_SOLANA_WALLETS,
  OTHER_SOLANA_WALLETS,
  SOLANA_WALLET_LIST,
  TRUST_SOLANA_WALLET,
  bytesToBase64,
  classifyWalletFailure,
  siwsPreview,
  solanaChainsAreMainnet,
  solanaConnectWalletOptions,
  loginWalletName,
  solanaWalletKeyFromClient,
  solanaWalletName,
  walletBrowseUrl,
  walletInstallUrl,
} from '@/auth/solanaWallets';

const ROOT = path.resolve(__dirname, '..', '..', '..');

test('curated rows include Jupiter at the top level, then More', () => {
  const listed: readonly WalletListEntry[] = [
    ...CURATED_SOLANA_WALLETS,
    ...OTHER_SOLANA_WALLETS,
    DETECTED_SOLANA_WALLETS,
  ];
  expect(listed).toEqual([
    'phantom', 'jupiter', 'backpack', 'solflare',
    'okx_wallet', 'coinbase_wallet',
    'detected_solana_wallets',
  ]);
  expect(SOLANA_WALLET_LIST).toEqual([
    'phantom', 'jupiter', 'backpack', 'solflare',
    'okx_wallet', 'coinbase_wallet',
    'trust_wallet',
    'detected_solana_wallets',
  ]);
  expect(TRUST_SOLANA_WALLET).toBe('trust_wallet');
});

test('one tapped wallet is a solana-only connectWallet list of that key', () => {
  expect(solanaConnectWalletOptions('phantom')).toEqual({
    walletList: ['phantom'],
    walletChainType: 'solana-only',
  });
  expect(solanaConnectWalletOptions('jupiter').walletList).toEqual(['jupiter']);
  expect(solanaConnectWalletOptions('backpack').walletList).toEqual(['backpack']);
  expect(solanaConnectWalletOptions('solflare').walletList).toEqual(['solflare']);
  expect(solanaConnectWalletOptions('okx_wallet').walletList).toEqual(['okx_wallet']);
  expect(solanaConnectWalletOptions('coinbase_wallet').walletList).toEqual(['coinbase_wallet']);
  expect(solanaConnectWalletOptions('trust_wallet').walletList).toEqual(['trust_wallet']);
  expect(solanaConnectWalletOptions('detected_solana_wallets').walletList).toEqual(['detected_solana_wallets']);
});

test('a persisted Privy wallet client resolves to its named row or browser detection', () => {
  expect(solanaWalletKeyFromClient('Phantom')).toBe('phantom');
  expect(solanaWalletKeyFromClient('Jupiter')).toBe('jupiter');
  expect(solanaWalletKeyFromClient('Jupiter Wallet')).toBe('jupiter');
  expect(solanaWalletKeyFromClient('Glow')).toBe('detected_solana_wallets');
  expect(solanaWalletKeyFromClient(null)).toBe('detected_solana_wallets');
});

// @ts-expect-error Trust Wallet's standard id is not a WalletListEntry in @privy-io/react-auth 3.45
const trustIsOutsideTheUnion: WalletListEntry = TRUST_SOLANA_WALLET;
void trustIsOutsideTheUnion;

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name === '.claude') return [];
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

test('names, install pages, and the Phantom and Solflare browse links', () => {
  expect(solanaWalletName('phantom')).toBe('Phantom');
  expect(solanaWalletName('jupiter')).toBe('Jupiter');
  expect(solanaWalletName('backpack')).toBe('Backpack');
  expect(solanaWalletName('solflare')).toBe('Solflare');
  expect(solanaWalletName('detected_solana_wallets')).toBe('Browser wallet');
  expect(walletInstallUrl('phantom')).toBe('https://phantom.app/download');
  expect(walletInstallUrl('jupiter')).toContain('/jupiter-wallet/');
  expect(walletInstallUrl('solflare')).toBe('https://solflare.com/download');
  const page = 'https://gachapon.example/pull';
  expect(walletBrowseUrl('phantom', page)).toBe(`https://phantom.app/ul/browse/${encodeURIComponent(page)}`);
  expect(walletBrowseUrl('jupiter', page)).toBe(`jupjupjup://jup.ag/browse/${encodeURIComponent(page)}`);
  expect(walletBrowseUrl('solflare', page)).toBe(`https://solflare.com/ul/v1/browse/${encodeURIComponent(page)}`);
  expect(walletBrowseUrl('okx_wallet', page)).toBeNull();
});

test('mainnet is allowed, devnet is not, and a wallet that names no chain is not blocked', () => {
  expect(solanaChainsAreMainnet([])).toBe(true);
  expect(solanaChainsAreMainnet(['solana:mainnet'])).toBe(true);
  expect(solanaChainsAreMainnet(['solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'])).toBe(true);
  expect(solanaChainsAreMainnet(['solana:devnet'])).toBe(false);
  expect(solanaChainsAreMainnet(['solana:testnet'])).toBe(false);
});

test('a login wallet name is the sheet name, never an address', () => {
  expect(loginWalletName('phantom')).toBe('Phantom');
  expect(loginWalletName('jupiter')).toBe('Jupiter');
  expect(loginWalletName('Jupiter Wallet')).toBe('Jupiter');
  expect(loginWalletName('backpack')).toBe('Backpack');
  expect(loginWalletName('solflare')).toBe('Solflare');
  expect(loginWalletName('not-a-wallet')).toBe('connected wallet');
  expect(loginWalletName(null)).toBe('connected wallet');
});

test('a SIWS preview reads domain, address, and nonce', () => {
  const message = 'gachapon.example wants you to sign in with your Solana account:\nSo1anaAddr\n\nNonce: abc-9';
  expect(siwsPreview(message, 'fallback')).toEqual({ domain: 'gachapon.example', address: 'So1anaAddr', nonce: 'abc-9' });
});

test('wallet failures land on the specific sheet states instead of calling unknown failures a rejection', () => {
  expect(classifyWalletFailure(Object.assign(new Error('closed'), { privyErrorCode: 'exited_auth_flow' }))).toBe('cancel');
  // Privy's adapter replaces a dismissed direct connect (the wallet's 4001) with this code when no account was chosen.
  expect(classifyWalletFailure(Object.assign(new Error('No Solana accounts found in wallet'), { privyErrorCode: 'no_solana_accounts', type: 'connector_error' }))).toBe('cancel');
  expect(classifyWalletFailure(new Error('Provider not found'))).toBe('missing');
  expect(classifyWalletFailure(new Error('wrong network: devnet'))).toBe('network');
  expect(classifyWalletFailure(new Error('User rejected the request'))).toBe('rejected');
  expect(classifyWalletFailure({ code: 4001, message: 'The request was closed' })).toBe('rejected');
  expect(classifyWalletFailure(new TypeError('wallet.signMessage is not a function'))).toBe('unknown');
});

test('a signature is base64, which is what loginWithSiws takes', () => {
  expect(bytesToBase64(Uint8Array.from([9, 8, 7, 6]))).toBe('CQgHBg==');
});

test('the client does not call Privy REST wallet export or assemble a key itself', () => {
  const files = walk(path.join(ROOT, 'src')).filter((file) => /\.(ts|tsx|js|mjs)$/.test(file) && !/\.(test|spec)\./.test(file));
  const hits = files.flatMap((file) => {
    const text = fs.readFileSync(file, 'utf8');
    const banned = ['/v1/wallets/', 'exportPrivateKey', 'recipient_public_key', 'useImportWallet'];
    return banned.some((needle) => text.includes(needle)) ? [path.relative(ROOT, file)] : [];
  });
  expect(hits).toEqual([]);
});

test('the Solana connector import stays in the Privy web chunk', () => {
  const allowed = new Set(['src/auth/privyWebChunk.tsx', 'jest.setup.web.ts']);
  const files = [...walk(path.join(ROOT, 'src')), path.join(ROOT, 'jest.setup.web.ts')];
  const hits = files.flatMap((file) => {
    const rel = path.relative(ROOT, file);
    if (allowed.has(rel) || /\.(test|spec)\./.test(rel)) return [];
    const text = fs.readFileSync(file, 'utf8');
    const mentions = text.includes('toSolanaWalletConnectors') || text.includes('@privy-io/react-auth/solana');
    return mentions ? [rel] : [];
  });
  expect(hits).toEqual([]);
});

// One exception (Ben, 11 Oct, CLOCK IN): the Wallet page's "Connect wallet app" on Android links a Mobile Wallet Adapter
// account through the native provider's `linkWalletApp`, an explicit action, because the server builds deposits only from a
// linked wallet. The sign-in sheets still never link, and nothing else may.
test('no screen links an external wallet onto an email or social account; only the native wallet-app link may', () => {
  const allowed = 'src/auth/privyAuth.tsx';
  const files = [...walk(path.join(ROOT, 'src')), path.join(ROOT, 'jest.setup.web.ts')];
  const hits = files.flatMap((file) => {
    const rel = path.relative(ROOT, file);
    if (rel === allowed || /\.(test|spec)\./.test(rel)) return [];
    return fs.readFileSync(file, 'utf8').includes('useLinkWithSiws') ? [rel] : [];
  });
  expect(hits).toEqual([]);
  const native = fs.readFileSync(path.join(ROOT, allowed), 'utf8');
  expect(native.match(/useLinkWithSiws\(\)/g)).toHaveLength(1);
  expect(native.match(/siwsLink\b(?!:)/g)?.length).toBeGreaterThan(0);
  // Its only caller is `linkWalletApp`: the generated message and the link both sit inside it.
  const body = native.slice(native.indexOf('const linkWalletApp = useCallback'), native.indexOf('}, []);', native.indexOf('const linkWalletApp = useCallback')));
  expect(body).toContain('generateMessage');
  expect(body).toContain('await link(');
  expect(native.split('sdk.current.siwsLink').length - 1).toBe(1);
});

test('nothing brings back an external sign-to-pay path', () => {
  const banned = ['EXTERNAL_PAY_UNAVAILABLE', 'externalPayRegistry'];
  const files = [...walk(path.join(ROOT, 'src')), path.join(ROOT, 'jest.setup.web.ts')];
  const hits = files.flatMap((file) => {
    const rel = path.relative(ROOT, file);
    if (/\.(test|spec)\./.test(rel)) return [];
    const text = fs.readFileSync(file, 'utf8');
    return banned.filter((word) => text.includes(word)).map((word) => `${rel}:${word}`);
  });
  expect(hits).toEqual([]);
});
