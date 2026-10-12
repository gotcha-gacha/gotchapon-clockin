// The connect list used to draw simplified ghosts and suns. These files are the press-kit marks
// (#346). A placeholder swapped back in fails the signature, not just the filename.
import { readFileSync } from 'node:fs';
import { expect, test } from '@jest/globals';

const svg = (name: string) => readFileSync(`public/wallets/${name}`, 'utf8');

test('named wallet files are the official marks, not the drawn placeholders', () => {
  const phantom = svg('phantom.svg');
  expect(phantom).toContain('fill="#AB9FF2"');
  expect(phantom).toContain('fill="#FFFDF8"');
  expect(phantom).toContain('M55.6416 82.1477');
  expect(phantom).not.toContain('M18 8c-5.2');

  const jupiter = svg('jupiter.svg');
  expect(jupiter).toContain('#C7F284');
  expect(jupiter).toContain('#00BEF0');
  expect(jupiter).toContain('M26.1464 199.614');
  expect(jupiter).not.toContain('#12182D');

  const backpack = svg('backpack.svg');
  expect(backpack).toContain('fill="#E33E3F"');
  expect(backpack).toContain('M59.4834 70.4082');

  const solflare = svg('solflare.svg');
  expect(solflare).toContain('#ffef46');
  expect(solflare).toContain('M24.23,26.42');

  const okx = svg('okx.svg');
  expect(okx).toContain('fill="black"');
  expect(okx).toContain('M385.67 428H171.631');

  const coinbase = svg('coinbase.svg');
  expect(coinbase).toContain('fill="#0052FF"');
  expect(coinbase).toContain('M152 512C152 710.823');

  const trust = svg('trust.svg');
  expect(trust).toContain('#0500FF');
  expect(trust).toContain('M0.882812 6.36743');
});
