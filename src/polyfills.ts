// What Privy's Expo SDK needs in place before anything else loads (F7.4, #6; `docs/PRIVY_SETUP.md` §7): a TextEncoder, a
// crypto source for random values, a global Buffer, and ethers' shims.
//
// **Native only.** Metro resolves `polyfills.web.ts` in a browser, which is empty on purpose: a browser has all four
// already, and shipping them anyway would put `@ethersproject/shims` and `buffer` in the first thing every web visitor
// downloads — the entry chunk that `scripts/bundle-budget.mjs` holds under a ceiling with about 13 KB to spare.
import 'fast-text-encoding';
import 'react-native-get-random-values';
import { Buffer } from 'buffer';
import '@ethersproject/shims';

const g = globalThis as unknown as { Buffer?: typeof Buffer };
g.Buffer = g.Buffer ?? Buffer;
