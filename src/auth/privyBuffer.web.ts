// `@privy-io/react-auth`'s Solana helpers call `Buffer.from` (and the SDK has its own `buffer_not_defined` error).
// The native polyfills stay on `src/polyfills.ts`; this runs only inside the Privy web chunk, so `buffer` is not in
// the first thing a visitor downloads.
import { Buffer } from 'buffer';

const g = globalThis as { Buffer?: typeof Buffer };
if (typeof g.Buffer === 'undefined') g.Buffer = Buffer;
