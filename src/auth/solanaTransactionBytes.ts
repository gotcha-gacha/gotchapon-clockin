import { getBase64Decoder, getBase64Encoder } from '@solana/codecs-strings';

const fromBase64 = getBase64Encoder();
const toBase64 = getBase64Decoder();

/** Privy signs wire-format Solana transactions as bytes; the API transports those bytes as base64. */
export const transactionBytesFromBase64 = (value: string): Uint8Array => new Uint8Array(fromBase64.encode(value));

export const transactionBytesToBase64 = (value: Uint8Array): string => toBase64.decode(value);
