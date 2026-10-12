// What server/src/payments.ts `preparePaymentTransaction` builds for SERVED_PAYMENT_INPUT (mainnet-dev's treasury and test
// mint, a fixed blockhash). server/test/clientPaymentGuard.test.ts fails if the builder stops producing these exact bytes, so
// the app's jest tests, which cannot load @solana/kit, still sign what the server really sends.
export const SERVED_PAYMENT_INPUT = {
  pullId: 'pull_0123456789abcdef',
  amount: 1_000_000,
  treasury: '5J5wfNFJREQ43C9LBeb6qHJm3uN1aKWhb9351BhRgEpt',
  mint: '5NPTRsDiMDtGGBgU2xrCMR5nHoKKMkmT5oM19MPUt547',
  wallet: '9d4LUccwNb1JehNAW4rgy4CzBpxNv32KZ2YZcMTywEV6',
};

export const SERVED_PAYMENT = 
  'AgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAIBAwZjrWoDRLEQaYUUDbmcMFX40Ar0crcuN0oT2gC84hn6hYAaLSQmnXeWQTTyjr3BP1CNuMdftc94oJDXiA3etVnhP881u5l3vsmrflToyQ3AouQe8sr97uMQv75SGIENcsVA6VXcy05a+GGUW34k7VF9fzMxRnUBdUrvHl9wMb64rAVKU1qZKSEGTSTocWDaOHx8NbXdvJK7geQfqEBBBUSNBt324ddloZPZy+FGzut5rBy0he1fWzeROoz1hX7/AKnjMtr5L6vs6LY/96RABeX9/Zr6FYdWthxalfkEs7jQgQIFBAIDAgEKDEBCDwAAAAAABgQAFXB1bGxfMDEyMzQ1Njc4OWFiY2RlZgA=';
