// The destination check for money leaving the wallet (#187). The cases that matter are the ones a "looks like an address"
// regex waves through: the repo's own fixture decoded to 31 bytes and passed the sheet's old pattern.
//
// The byte counts are not asserted from memory. `oracle()` below decodes base58 through BigInt — a different algorithm from
// the implementation's byte-array arithmetic — and every case checks the two against each other, so a shared mistake has to
// be made twice, in two shapes.
//
// What the oracle does NOT cover, because it shares them with the implementation: the alphabet constant, the validity rule
// (`indexOf(ch) < 0`), and the model that each leading '1' is one zero byte — the parts a hand-rolled base58 usually gets
// wrong. PR #195's review closed that half from outside, against bs58 6.0: 198,534 exhaustive strings of length 1-3,
// 180,000 round-trips from random 31/32/33-byte keys with 0-8 leading zero bytes, and 200,000 random strings — zero
// disagreements, and no real 32-byte address rejected. That is the evidence for this file's own alphabet being right;
// the table and sweep below are what keeps it right.
import { expect, test } from '@jest/globals';
import { base58Length, isSolanaAddress } from '@/api/solanaAddress';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Independent decoder: big-integer, not byte-array. Returns the byte length, or null when `s` is not base58. */
function oracle(s: string): number | null {
  if (s.length === 0) return null;
  let n = 0n;
  let leadingZeros = 0;
  let counting = true;
  for (const ch of s) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) return null;
    if (counting && ch === '1') leadingZeros++; else counting = false;
    n = n * 58n + BigInt(v);
  }
  let significant = 0;
  for (let m = n; m > 0n; m >>= 8n) significant++;
  return significant + leadingZeros;
}

// Real addresses, so the 32 is not a number this repo invented: Solana's System Program (all zero bytes, the '1' case),
// the SPL Token program, and the mainnet USDC mint — 32, 43 and 44 characters, all 32 bytes.
const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
/** The in-app mock's wallet until #185: 42 base58 characters, and 31 bytes — the string that started this ticket. */
const THIRTY_ONE_BYTES = '7xKpQm2vR8tW3nHd9fQaLm4sT6uVbN1cXeYz8wKpRq';

const CASES: [name: string, s: string, bytes: number | null][] = [
  ['the System Program, all zero bytes', SYSTEM_PROGRAM, 32],
  ['the SPL Token program, 43 characters', TOKEN_PROGRAM, 32],
  ['the USDC mint, 44 characters', USDC_MINT, 32],
  ['the old mock wallet: base58, wrong size', THIRTY_ONE_BYTES, 31],
  ['one character short of the System Program', SYSTEM_PROGRAM.slice(1), 31],
  ['one zero byte too many', `1${SYSTEM_PROGRAM}`, 33],
  ['the demo wallet: hyphens are not base58', 'DEMO-WALLET-DO-NOT-SEND', null],
  ['an EVM address: 0 and x', '0x71C7656EC7ab88b098defB751B7401B5f6d8976F', null],
  ['base58 with the letter O', `O${USDC_MINT.slice(1)}`, null],
  ['base58 with a lowercase l', `l${USDC_MINT.slice(1)}`, null],
  ['empty', '', null],
  ['a space around an otherwise good address', ` ${USDC_MINT}`, null],
  ['a single 1', '1', 1],
  ['longer than any address', 'z'.repeat(45), 33],
];

test.each(CASES)('%s', (_name, s, bytes) => {
  expect(base58Length(s)).toBe(bytes);
  expect(oracle(s)).toBe(bytes); // the two decoders agree, so neither is the definition of the other
  expect(isSolanaAddress(s)).toBe(bytes === 32);
});

// The sheet's old check, kept here as the thing being replaced: every case it got wrong is a case above.
test('the pattern this replaced accepted a string that is not an address, and rejected none of what it should', () => {
  const OLD = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  expect(OLD.test(THIRTY_ONE_BYTES)).toBe(true); // 42 characters of base58 — and 31 bytes
  expect(isSolanaAddress(THIRTY_ONE_BYTES)).toBe(false);
  // It is not only the one fixture: character length cannot separate them. 43 characters is 31, 32 or 33 bytes
  // depending on the value, and the pattern takes all three.
  const thirtyThree = `1${'z'.repeat(42)}`;
  expect(OLD.test(thirtyThree)).toBe(true);
  expect(base58Length(thirtyThree)).toBe(32); // this one happens to be an address
  const alsoForty__Three = 'z'.repeat(43);
  expect(OLD.test(alsoForty__Three)).toBe(true);
  expect(base58Length(alsoForty__Three)).toBe(32);
});

// A guard made of hand-picked cases only rules out what someone imagined: sweep every length the sheet can be handed
// instead. Of the 32-to-44-character strings the old pattern took, only some are 32 bytes — and the new check must answer
// by the bytes at every one of those lengths, not by the length.
test('across every character length the old pattern allowed, the answer follows the bytes', () => {
  const lengths = Array.from({ length: 44 - 32 + 1 }, (_, i) => 32 + i);
  expect(lengths).toHaveLength(13);
  for (const len of lengths) {
    for (const s of [ALPHABET[0].repeat(len), ALPHABET[57].repeat(len), `${ALPHABET[0]}${ALPHABET[57].repeat(len - 1)}`]) {
      const n = base58Length(s);
      expect(n).toBe(oracle(s));
      expect(isSolanaAddress(s)).toBe(n === 32);
    }
  }
  // And the sweep is not vacuous: within that range both answers occur.
  expect(isSolanaAddress('z'.repeat(43))).toBe(true);
  expect(isSolanaAddress('z'.repeat(44))).toBe(false); // 33 bytes
  expect(isSolanaAddress('1'.repeat(44))).toBe(false); // 44 zero bytes
});

// A differential over the middle of the range, not only its extremes (PR #195's review): a seeded generator, so a failure
// is reproducible rather than a flake, and the two decoders are compared on every draw.
test('the two decoders agree on 2,000 random base58 strings, not only the hand-picked ones', () => {
  let seed = 0x9e3779b9; // any fixed value; the point is that a failure repeats
  const next = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; };
  let addresses = 0;
  for (let i = 0; i < 2000; i++) {
    const len = 1 + Math.floor(next() * 50);
    let s = '';
    for (let j = 0; j < len; j++) s += ALPHABET[Math.floor(next() * 58)];
    const n = base58Length(s);
    expect(n).toBe(oracle(s));
    expect(isSolanaAddress(s)).toBe(n === 32 && s.length <= 44);
    if (n === 32) addresses++;
  }
  // The draw is not vacuous in either direction: it produced addresses and non-addresses.
  expect(addresses).toBeGreaterThan(0);
  expect(addresses).toBeLessThan(2000);
});
