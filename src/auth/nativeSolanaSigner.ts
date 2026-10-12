// Privy's Expo embedded-wallet provider still accepts the class-based Solana transaction object,
// while the API and the rest of this app use Kit wire bytes. Keep that compatibility boundary here:
// decode the server's v0 wire transaction, let Privy add only the embedded-wallet signature, then
// return wire bytes for /pulls/commit. No RPC call or broadcast happens on the phone.
import { VersionedTransaction } from '@solana/web3.js';
import { transactionBytesFromBase64, transactionBytesToBase64 } from '@/auth/solanaTransactionBytes';

export type NativeEmbeddedSolanaWallet = {
  address: string;
  getProvider?: () => Promise<{
    request: (input: {
      method: 'signTransaction';
      params: { transaction: VersionedTransaction };
    }) => Promise<{ signedTransaction: VersionedTransaction }>;
  }>;
};

export async function signEmbeddedSolanaTransaction(
  wallet: NativeEmbeddedSolanaWallet | null | undefined,
  transactionBase64: string,
): Promise<string> {
  if (!wallet?.getProvider) throw new Error('Your Solana wallet is not ready. Try signing in again.');

  let transaction: VersionedTransaction;
  try {
    transaction = VersionedTransaction.deserialize(transactionBytesFromBase64(transactionBase64));
  } catch {
    throw new Error('The payment transaction was invalid. Try again.');
  }

  const provider = await wallet.getProvider();
  const { signedTransaction } = await provider.request({
    method: 'signTransaction',
    params: { transaction },
  });
  return transactionBytesToBase64(signedTransaction.serialize());
}
