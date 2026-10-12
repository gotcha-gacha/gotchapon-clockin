// Is a string a Solana address? (#187, audit item 6.) Money leaving the wallet is the one place the client can check the
// destination on its own, and the check has to be what an address *is*, not what one looks like: a base58 pubkey is exactly
// 32 bytes. The withdraw sheet used to take any 32-to-44-character base58 string, which the in-app mock's own fixture passed
// while decoding to 31 bytes — a length no wallet can hold — so "looks right" and "is an address" were already apart in this
// repo (ran it, 20 Sept).
//
// What this does NOT establish, and nobody here has observed: whether the 32 bytes are a point on ed25519's curve. An
// address off the curve is a program address rather than a wallet, and a transfer to one behaves differently. Checking that
// needs curve arithmetic (or @solana/web3.js, which this app does not carry), and the real send lands with F7.4 — the
// question belongs to whoever writes it, against a server that can be asked.
//
// Base58 is decoded here rather than pulled in: the alphabet drops 0, O, I and l, so an EVM `0x…` address, a typo'd O for 0
// and a pasted URL all fail before the length ever matters.

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** The bytes `s` decodes to as base58, or `null` when it is not base58 at all (empty included). Quadratic in the input:
 *  bound what you pass it. */
export function base58Decode(s: string): Uint8Array | null {
  if (s.length === 0) return null;
  const bytes: number[] = [];
  for (const ch of s) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) return null;
    let carry = v;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>>= 8;
    }
  }
  // Base58 writes a leading zero byte as '1', and the loop above cannot produce those: a zero carries nothing.
  for (let i = 0; i < s.length && s[i] === '1'; i++) bytes.push(0);
  return Uint8Array.from(bytes.reverse());
}

/** How many bytes `s` decodes to as base58, or `null` when it is not base58 at all (empty included). */
export const base58Length = (s: string): number | null => base58Decode(s)?.length ?? null;

/** Whether `s` is a Solana address: base58 of exactly 32 bytes. Nothing is trimmed — callers trim what a user typed.
 *  The length bound is not cosmetic: decoding is quadratic in the input, and this runs on every render of the withdraw
 *  sheet, where the field takes a paste. 32 bytes is always 32 to 44 base58 characters (the extremes measured over the
 *  byte range), so anything longer cannot be an address and is refused before a character of it is decoded — without it, a
 *  pasted 100 KB of base58 froze the money screen for seconds (PR #195's review measured 3.6 s at 100k characters). */
export const isSolanaAddress = (s: string): boolean => s.length <= 44 && base58Length(s) === 32;
