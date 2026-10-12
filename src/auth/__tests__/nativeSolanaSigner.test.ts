import { expect, jest, test } from '@jest/globals';
import { PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { signEmbeddedSolanaTransaction } from '@/auth/nativeSolanaSigner';
import { transactionBytesFromBase64, transactionBytesToBase64 } from '@/auth/solanaTransactionBytes';

function unsignedV0(): VersionedTransaction {
  return new VersionedTransaction(new TransactionMessage({
    payerKey: new PublicKey('11111111111111111111111111111111'),
    recentBlockhash: '11111111111111111111111111111111',
    instructions: [],
  }).compileToV0Message());
}

test('adapts Kit wire bytes to Privy Expo and returns signed wire bytes', async () => {
  const request = jest.fn(async (input: { params: { transaction: VersionedTransaction } }) => {
    input.params.transaction.signatures[0] = new Uint8Array(64).fill(9);
    return { signedTransaction: input.params.transaction };
  });
  const wallet = { address: 'embedded-wallet', getProvider: async () => ({ request }) };

  const result = await signEmbeddedSolanaTransaction(wallet, transactionBytesToBase64(unsignedV0().serialize()));
  const signed = VersionedTransaction.deserialize(transactionBytesFromBase64(result));

  expect(request).toHaveBeenCalledWith(expect.objectContaining({ method: 'signTransaction' }));
  expect(Array.from(signed.signatures[0])).toEqual(new Array(64).fill(9));
});

test('refuses a missing provider and malformed transaction before asking Privy to sign', async () => {
  await expect(signEmbeddedSolanaTransaction({ address: 'embedded-wallet' }, transactionBytesToBase64(unsignedV0().serialize())))
    .rejects.toThrow('wallet is not ready');
  const request = jest.fn(async (_input: { method: 'signTransaction'; params: { transaction: VersionedTransaction } }) => ({
    signedTransaction: unsignedV0(),
  }));
  await expect(signEmbeddedSolanaTransaction({ address: 'embedded-wallet', getProvider: async () => ({ request }) }, 'not-a-transaction'))
    .rejects.toThrow('transaction was invalid');
  expect(request).not.toHaveBeenCalled();
});
