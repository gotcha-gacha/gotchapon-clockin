// Reading a Privy user (F7.4): which wallet is theirs, and who they signed in with.
import { expect, test } from '@jest/globals';
import {
  externalSolanaWalletClientFromUser,
  isPrivyEmbeddedSolana,
  loginWalletOf,
  providerFromUser,
  solanaAddressFromUser,
} from '@/auth/user';

type Account = {
  type?: string; address?: string; chain_type?: string; chainType?: string;
  wallet_client_type?: string; walletClientType?: string; connector_type?: string; connectorType?: string;
};
const user = (accounts: Account[]) => ({ id: 'u', linked_accounts: accounts });
const webUser = (accounts: Account[]) => ({ id: 'u', linkedAccounts: accounts });

test('the Solana wallet is the embedded Solana one, not an EVM wallet and not a missing one', () => {
  expect(solanaAddressFromUser(null)).toBeNull();
  expect(solanaAddressFromUser(user([]))).toBeNull();
  expect(solanaAddressFromUser(user([{ type: 'wallet', chain_type: 'ethereum', address: '0xabc' }]))).toBeNull();
  expect(solanaAddressFromUser(user([{ type: 'wallet', chain_type: 'solana', address: '' }]))).toBeNull(); // present but empty is no wallet
  expect(solanaAddressFromUser(user([
    { type: 'wallet', chain_type: 'ethereum', address: '0xabc' },
    { type: 'wallet', chain_type: 'solana', address: 'So1ana' },
  ]))).toBe('So1ana');
});

test('the provider is the one they signed in with, and nothing when there is none to read', () => {
  expect(providerFromUser(null)).toBeNull();
  expect(providerFromUser(user([{ type: 'wallet', chain_type: 'solana', address: 'x' }]))).toBe('wallet');
  // The embedded wallet on a Google account does not turn that person into a wallet sign-in.
  expect(providerFromUser(user([{ type: 'google_oauth' }, { type: 'wallet', chain_type: 'solana', address: 'x' }]))).toBe('Google');
  expect(providerFromUser(user([{ type: 'google_oauth' }]))).toBe('Google');
  expect(providerFromUser(user([{ type: 'apple_oauth' }]))).toBe('Apple');
  expect(providerFromUser(user([{ type: 'email' }]))).toBe('email');
});

test('a SIWS user\'s funds address is the embedded wallet, not the connected one', () => {
  const both = user([
    { type: 'wallet', chain_type: 'solana', address: 'PhantomAddr', wallet_client_type: 'phantom' },
    { type: 'wallet', chain_type: 'solana', address: 'EmbeddedAddr', connector_type: 'embedded', wallet_client_type: 'privy' },
  ]);
  expect(solanaAddressFromUser(both)).toBe('EmbeddedAddr');
  expect(providerFromUser(both)).toBe('wallet');
  expect(loginWalletOf(both)).toEqual({ name: 'Phantom', address: 'PhantomAddr' });
  // The connected wallet alone is not a deposit address, so sign-in still has to provision one.
  expect(solanaAddressFromUser(user([
    { type: 'wallet', chain_type: 'solana', address: 'PhantomAddr', wallet_client_type: 'phantom' },
  ]))).toBeNull();
  // Google plus an embedded wallet stays Google. The login wallet is not read off that binder.
  const social = user([
    { type: 'google_oauth' },
    { type: 'wallet', chain_type: 'solana', address: 'EmbeddedAddr', connector_type: 'embedded' },
  ]);
  expect(providerFromUser(social)).toBe('Google');
  expect(solanaAddressFromUser(social)).toBe('EmbeddedAddr');
  expect(loginWalletOf(social)).toBeNull();
});

test('the web SDK\'s camelCase document reads the same way', () => {
  expect(solanaAddressFromUser(webUser([
    { type: 'wallet', chainType: 'ethereum', address: '0xabc' },
    { type: 'wallet', chainType: 'solana', address: 'So1anaWeb' },
  ]))).toBe('So1anaWeb');
  expect(providerFromUser(webUser([{ type: 'apple_oauth' }]))).toBe('Apple');
  expect(providerFromUser(webUser([{ type: 'google_oauth' }]))).toBe('Google');
  expect(providerFromUser(webUser([{ type: 'email' }]))).toBe('email');
  expect(solanaAddressFromUser(webUser([
    { type: 'wallet', chainType: 'solana', address: 'BackpackAddr', walletClientType: 'backpack' },
    { type: 'wallet', chainType: 'solana', address: 'EmbeddedWeb', walletClientType: 'privy', connectorType: 'embedded' },
  ]))).toBe('EmbeddedWeb');
  expect(loginWalletOf(webUser([
    { type: 'wallet', chainType: 'solana', address: 'BackpackAddr', walletClientType: 'backpack' },
    { type: 'wallet', chainType: 'solana', address: 'EmbeddedWeb', walletClientType: 'privy' },
  ]))).toEqual({ name: 'Backpack', address: 'BackpackAddr' });
});

test('export is the Privy embedded Solana address, not an external login wallet and not an unmarked one', () => {
  const deposit = 'EmbeddedAddr';
  const both = webUser([
    { type: 'wallet', chainType: 'solana', address: 'PhantomAddr', walletClientType: 'phantom' },
    { type: 'wallet', chainType: 'solana', address: 'JupiterAddr', walletClientType: 'jupiter' },
    { type: 'wallet', chainType: 'solana', address: deposit, walletClientType: 'privy', connectorType: 'embedded' },
    { type: 'wallet', chainType: 'ethereum', address: '0xabc', walletClientType: 'privy' },
  ]);
  expect(isPrivyEmbeddedSolana(both, deposit)).toBe(true);
  expect(isPrivyEmbeddedSolana(both, 'PhantomAddr')).toBe(false);
  expect(isPrivyEmbeddedSolana(both, 'JupiterAddr')).toBe(false);
  expect(isPrivyEmbeddedSolana(both, '0xabc')).toBe(false);
  expect(isPrivyEmbeddedSolana(both, '')).toBe(false);
  // Snake case, the Expo document. Same predicate, so a phone user document is not a different rule.
  expect(isPrivyEmbeddedSolana(user([
    { type: 'wallet', chain_type: 'solana', address: deposit, wallet_client_type: 'privy' },
  ]), deposit)).toBe(true);
  // Funds can be an unmarked embedded wallet. Export cannot: the client type has to say privy.
  const unmarked = webUser([
    { type: 'google_oauth' },
    { type: 'wallet', chainType: 'solana', address: deposit, connectorType: 'embedded' },
  ]);
  expect(solanaAddressFromUser(unmarked)).toBe(deposit);
  expect(isPrivyEmbeddedSolana(unmarked, deposit)).toBe(false);
  expect(isPrivyEmbeddedSolana(null, deposit)).toBe(false);
});

test('embedded funds and external SIWS wallets stay distinct', () => {
  const mixed = webUser([
    { type: 'wallet', chainType: 'solana', address: 'External', walletClientType: 'phantom' },
    { type: 'wallet', chainType: 'solana', address: 'Embedded', connectorType: 'embedded', walletClientType: 'privy' },
  ]);
  expect(externalSolanaWalletClientFromUser(mixed)).toBe('phantom');
  expect(solanaAddressFromUser(mixed)).toBe('Embedded');
  expect(solanaAddressFromUser(webUser([
    { type: 'wallet', chainType: 'solana', address: 'External', walletClientType: 'phantom' },
  ]))).toBeNull();
});
