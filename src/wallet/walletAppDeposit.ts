// Deposit from a wallet app on this phone, through Mobile Wallet Adapter (CLOCK IN, Ben, 11 Oct): the same connected-wallet
// deposit the web runs for a Sign in with Solana user (privyWebChunk `depositFromConnectedWallet`, #278), with the wallet
// app as the signer instead of a browser extension. The server builds the transfer from the wallet app's account into the
// player's embedded wallet (`POST /deposit/build`, any source address), the app checks the exact bytes, the wallet app signs
// them, and the server broadcasts (`POST /deposit/submit`). Nothing here signs a pull: pulls still pay from the embedded
// wallet.
//
// The build happens before the wallet app is opened, so no network call runs while the player is looking at their wallet.
import { getBase58Decoder, getBase64Decoder, getBase64Encoder } from '@solana/codecs-strings';
import type { GachaApi } from '@/api/contract';
import { depositAsExpected } from '@/api/paymentGuard';
import { PRODUCT_NAME } from '@/brand/name';
import type { MobileWalletIdentity, MobileWalletTransact } from './mobileWalletTypes';

/** What the wallet app shows the player when it asks to connect. */
export const WALLET_APP_IDENTITY: MobileWalletIdentity = { name: PRODUCT_NAME, uri: 'https://gotchapon.fun' };
/** mainnet-dev and prod both settle on mainnet; mainnet-dev uses its own test USDC mint (config/web-mainnet-dev.json). */
export const WALLET_APP_CHAIN = 'solana:mainnet' as const;

export type WalletAppConnection = { address: string; label?: string; authToken: string };

const base64 = getBase64Encoder();
const base64Decoder = getBase64Decoder();
const base58 = getBase58Decoder();

/** MWA sends a public key as base64; the API and the deposit guard read base58. `null` unless it is exactly 32 bytes. */
export function walletAppAddress(base64Address: string): string | null {
  try {
    const bytes = base64.encode(base64Address);
    return bytes.length === 32 ? base58.decode(bytes) : null;
  } catch {
    return null;
  }
}

/** The 64-byte signature in what MWA's `signMessages` returns for `message`: the bare signature, or the message with the
 *  signature on either side of it (wallets differ). `null` when it is none of those, so nothing unverified is passed on. */
export function walletAppSignature(signed: Uint8Array, message: Uint8Array): Uint8Array | null {
  if (signed.length === 64) return signed;
  if (signed.length !== message.length + 64) return null;
  const same = (offset: number) => message.every((byte, i) => signed[offset + i] === byte);
  if (same(0)) return signed.slice(message.length);
  if (same(64)) return signed.slice(0, 64);
  return null;
}

/** Links a wallet app account to the signed-in account (Privy SIWS): given the account's address and a way to have the
 *  wallet app sign a message, it does the rest. `undefined` where linking does not exist (the provider is not native Privy). */
export type LinkWalletApp = (address: string, signMessage: (message: Uint8Array) => Promise<Uint8Array>) => Promise<void>;

/** Asks the wallet app for an account and, when `link` is given, links that account in the same session (one more
 *  approval in the wallet app: a sign-in message, never a transaction). */
export async function connectWalletApp(transact: MobileWalletTransact, link?: LinkWalletApp): Promise<WalletAppConnection> {
  return transact(async (wallet) => {
    const auth = await wallet.authorize({ identity: WALLET_APP_IDENTITY, chain: WALLET_APP_CHAIN });
    const account = auth.accounts[0];
    const address = account ? walletAppAddress(account.address) : null;
    if (!account || !address) throw new Error('The wallet app shared no account.');
    if (link) {
      await link(address, async (message) => {
        const { signed_payloads } = await wallet.signMessages({
          addresses: [account.address],
          payloads: [base64Decoder.decode(message)],
        });
        const signature = signed_payloads[0] ? walletAppSignature(new Uint8Array(base64.encode(signed_payloads[0])), message) : null;
        if (!signature) throw new Error('The wallet app returned no signature.');
        return signature;
      });
    }
    return { address, label: account.label, authToken: auth.auth_token };
  });
}

export type WalletAppDepositDeps = {
  api: Pick<GachaApi, 'buildDeposit' | 'submitDeposit'>;
  connection: WalletAppConnection;
  /** The player's embedded (deposit) wallet, from the session. */
  owner: string;
  /** The build's pinned USDC mint; `null` refuses every deposit, as on the web. */
  mint: string | null;
};

export async function depositFromWalletApp(
  transact: MobileWalletTransact,
  { api, connection, owner, mint }: WalletAppDepositDeps,
  amountBase: number,
  idem: string,
): Promise<void> {
  const built = await api.buildDeposit({ sourceWallet: connection.address, amount: amountBase, idem });
  if (built.amount !== amountBase || built.destination !== owner) {
    throw new Error('The built deposit did not match your request.');
  }
  // Matched exhaustively, as on the web (PR #290's review): only 'prepared' reaches a signature.
  if (built.status === 'committed') return;
  if (built.status === 'signed') {
    // Nothing is signed here: the server broadcasts the bytes the wallet app signed on an earlier attempt.
    await api.submitDeposit({ depositId: built.depositId, idem });
    return;
  }
  // The bytes the wallet app signs, not only the JSON beside them (#278): exactly this transfer, from the connected account,
  // into the embedded wallet, of the pinned mint. Every expected value comes from the connection, the session or the build.
  if (built.status !== 'prepared' || !depositAsExpected(built, mint ? { source: connection.address, owner, mint } : null)) {
    throw new Error('The built deposit did not match your request.');
  }
  const signed = await transact(async (wallet) => {
    // The stored auth token lets the wallet app skip asking again; the account must still be the one the deposit was built for.
    const auth = await wallet.authorize({ identity: WALLET_APP_IDENTITY, chain: WALLET_APP_CHAIN, auth_token: connection.authToken });
    if (!auth.accounts.some((a) => walletAppAddress(a.address) === connection.address)) {
      throw new Error('Reconnect the same wallet app account.');
    }
    const { signed_payloads } = await wallet.signTransactions({ payloads: [built.transactionBase64] });
    return signed_payloads[0];
  });
  if (!signed) throw new Error('The wallet app returned no signature.');
  await api.submitDeposit({ depositId: built.depositId, signedTransactionBase64: signed, idem });
}
