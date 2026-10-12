// #418: on the web only the async Clipboard API's own success is a copy. expo-clipboard's web fallback answers true for a copy
// `execCommand` refused, so it is not used here.
import { afterEach, expect, jest, test } from '@jest/globals';
import { copyText } from '@/components/copyText';

const original = Object.getOwnPropertyDescriptor(globalThis.navigator, 'clipboard');
const withClipboard = (clipboard: unknown) =>
  Object.defineProperty(globalThis.navigator, 'clipboard', { value: clipboard, configurable: true });
afterEach(() => {
  if (original) Object.defineProperty(globalThis.navigator, 'clipboard', original);
  else delete (globalThis.navigator as { clipboard?: unknown }).clipboard;
});

test('a copy the browser accepts is a copy, of exactly that text', async () => {
  const writeText = jest.fn(async (_text: string) => undefined);
  withClipboard({ writeText });
  expect(await copyText('[{"pullId":"p"}]')).toBe(true);
  expect(writeText).toHaveBeenCalledWith('[{"pullId":"p"}]');
});

test('no Clipboard API, or one that refuses, is a failed copy, and execCommand is never asked', async () => {
  const execCommand = jest.fn(() => true);
  (document as { execCommand?: unknown }).execCommand = execCommand;
  withClipboard(undefined);
  expect(await copyText('x')).toBe(false);
  withClipboard({});
  expect(await copyText('x')).toBe(false);
  withClipboard({ writeText: async () => { throw new DOMException('denied', 'NotAllowedError'); } });
  expect(await copyText('x')).toBe(false);
  expect(execCommand).not.toHaveBeenCalled();
});
