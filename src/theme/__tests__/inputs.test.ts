// The web's 16 px input floor (W0.3, #121) must not touch the apps: native keeps the design's sizes.
import { expect, test } from '@jest/globals';
import { inputFontSize } from '@/theme/inputs';
import { canOpenWalletApp } from '@/components/wallet/walletApp';

test('native keeps the design size for an input, whatever it is', () => {
  expect(inputFontSize(13)).toBe(13);
  expect(inputFontSize(14)).toBe(14);
  expect(inputFontSize(18)).toBe(18);
});

test('native always offers Open wallet app', () => {
  expect(canOpenWalletApp()).toBe(true);
});
