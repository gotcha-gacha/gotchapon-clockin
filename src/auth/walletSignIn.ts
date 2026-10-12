// External Solana sign-in (#244): connect one wallet, preview the SIWS message, sign it, then
// `loginWithSiws`. The embedded deposit wallet is provisioned by the caller after this returns (#245).
// Nothing here links the wallet to an email or social account — that door is a separate binder.
import {
  chainsOf,
  classifyWalletFailure,
  DETECTED_SOLANA_WALLETS,
  siwsPreview,
  solanaChainsAreMainnet,
  solanaWalletName,
  type SolanaWalletKey,
  type WalletErrorKind,
  type WalletFlow,
  bytesToBase64,
} from '@/auth/solanaWallets';

/** How long the "Wallet connected" chip stays before the same land as Google. */
export const WALLET_OK_MS = 950;

export type SiwsConnected = {
  address: string;
  chains?: readonly string[];
  accounts?: readonly { chains?: readonly string[] }[];
  walletClientType?: string;
  connectorType?: string;
  signMessage: (input: { message: Uint8Array }) => Promise<{ signature: Uint8Array | string }>;
};

export type WalletSignInResult =
  | { ok: true; address: string; user: unknown }
  | { ok: false; kind: WalletErrorKind; authenticated: boolean };

function signatureString(raw: Uint8Array | string): string {
  return typeof raw === 'string' ? raw : bytesToBase64(raw);
}

/**
 * One wallet row, from the tap through the ok chip. `onPhase` is how the sheet renders connect / sign / ok.
 * A cancel that bumps the caller's generation makes `cancelled()` true; later phases are not written, so
 * the caller's own cancel card stays. `onConnect` fires once Privy returns a usable mainnet wallet and is where
 * signup analytics belongs. Wallet availability is deliberately decided by Privy's Wallet Standard connectors,
 * not by legacy `window.solana` globals; the address is not an argument of that callback.
 */
export async function runWalletSignIn(args: {
  key: SolanaWalletKey;
  connect: (key: SolanaWalletKey) => Promise<SiwsConnected>;
  generateMessage: (address: string) => Promise<string>;
  login: (input: { message: string; signature: string; walletClientType?: string; connectorType?: string }) => Promise<unknown>;
  onPhase: (phase: WalletFlow) => void;
  onConnect: () => void;
  cancelled: () => boolean;
  wait: (ms: number) => Promise<void>;
}): Promise<WalletSignInResult> {
  const name = solanaWalletName(args.key);
  const phase = (next: WalletFlow) => { if (!args.cancelled()) args.onPhase(next); };
  const stop = (kind: WalletErrorKind, authenticated = false): WalletSignInResult => {
    if (!args.cancelled()) phase({ status: 'error', key: args.key, name, kind });
    return { ok: false, kind, authenticated };
  };

  phase({ status: 'connect', key: args.key, name });

  let wallet: SiwsConnected;
  try {
    wallet = await args.connect(args.key);
  } catch (e) {
    if (args.cancelled()) return { ok: false, kind: 'cancel', authenticated: false };
    return stop(classifyWalletFailure(e));
  }
  if (args.cancelled()) return { ok: false, kind: 'cancel', authenticated: false };
  if (!wallet.address) return stop('missing');
  if (!solanaChainsAreMainnet(chainsOf(wallet))) return stop('network');
  args.onConnect();

  let message: string;
  try {
    message = await args.generateMessage(wallet.address);
  } catch (e) {
    if (args.cancelled()) return { ok: false, kind: 'cancel', authenticated: false };
    return stop(classifyWalletFailure(e));
  }
  if (args.cancelled()) return { ok: false, kind: 'cancel', authenticated: false };

  const preview = siwsPreview(message, wallet.address);
  phase({ status: 'sign', key: args.key, name, domain: preview.domain, address: preview.address, nonce: preview.nonce });

  let signature: string;
  try {
    const signed = await wallet.signMessage({ message: new TextEncoder().encode(message) });
    signature = signatureString(signed.signature);
  } catch (e) {
    if (args.cancelled()) return { ok: false, kind: 'cancel', authenticated: false };
    return stop(classifyWalletFailure(e));
  }
  if (args.cancelled()) return { ok: false, kind: 'cancel', authenticated: false };

  let user: unknown;
  try {
    user = await args.login({
      message,
      signature,
      walletClientType: wallet.walletClientType ?? (args.key === DETECTED_SOLANA_WALLETS ? undefined : args.key),
      connectorType: wallet.connectorType,
    });
  } catch (e) {
    if (args.cancelled()) return { ok: false, kind: 'cancel', authenticated: false };
    return stop(classifyWalletFailure(e), true);
  }
  if (args.cancelled()) return { ok: false, kind: 'cancel', authenticated: true };

  phase({ status: 'ok', key: args.key, name, address: preview.address });
  await args.wait(WALLET_OK_MS);
  if (args.cancelled()) return { ok: false, kind: 'cancel', authenticated: true };
  return { ok: true, address: preview.address, user };
}
