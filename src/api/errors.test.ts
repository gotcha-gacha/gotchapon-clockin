// Sealed-capsule copy (F2.10, review of PR #66): after a signed transfer the client never claims the payment landed and never
// tells a paying user to pull again. A capsule that can still open says it waits and nothing is lost; one that cannot
// (commitCannotOpen) says what happened to the money.
import { expect, test } from '@jest/globals';
import type { ApiErrorCode } from '@/api/contract';
import { answerLost, burnSealedCopy, commitCannotOpen, errorCopy, prepareErrorCopy, sealedCopy } from './errors';

test('every code has sealed copy: it waits and nothing is lost, or it cannot open and says where the money is', () => {
  for (const code of Object.keys(errorCopy) as ApiErrorCode[]) {
    const c = sealedCopy(code, true);
    expect(c.title.length).toBeGreaterThan(0);
    if (code === 'TX_MISMATCH') expect(c.body).toMatch(/Nothing was taken/);
    // A commit refused for insufficient funds sent nothing (#273): it must not say the payment was sent.
    else if (code === 'INSUFFICIENT_FUNDS') expect(c.body).toMatch(/Nothing was taken/);
    else if (code === 'EXPIRED') expect(c.body).toMatch(/cannot open.*comes back to your balance/);
    else expect(c.body).toMatch(/nothing is lost|resolves to a card or a refund/);
    expect(`${c.title} ${c.body}`).not.toMatch(/went through|Turn the crank again|Start over|Pull again/);
    if (code === 'INSUFFICIENT_FUNDS') expect(c.body).not.toMatch(/payment was sent/);
  }
  expect(sealedCopy(undefined, true).title).toBe('Your capsule is sealed');
});

test('only a payment that did not match or a pull that expired ends a paid pull; anything else is retried', () => {
  expect((Object.keys(errorCopy) as ApiErrorCode[]).filter(commitCannotOpen).sort()).toEqual(['EXPIRED', 'TX_MISMATCH']);
  expect(commitCannotOpen(undefined)).toBe(false);
});

test('a free pull or a burn seals only when its answer was lost, and its copy never mentions a payment', () => {
  // UNREADABLE joins NETWORK: the request went out and only the status came back, so it may have landed. An UNKNOWN code the
  // client could read is an answer, and is not kept.
  expect((Object.keys(errorCopy) as ApiErrorCode[]).filter(answerLost).sort()).toEqual(['NETWORK', 'UNREADABLE']);
  expect(answerLost('UNKNOWN')).toBe(false);
  expect(answerLost(undefined)).toBe(false);
  for (const code of ['NETWORK', 'UNREADABLE'] as const) {
    const c = sealedCopy(code, false);
    expect(c.body).toMatch(/nothing is lost/);
    expect(`${c.title} ${c.body}`).not.toMatch(/pay|went through|Pull again/i);
  }
  // Nothing to reconnect when the answer arrived and could not be read — and it never says the connection is the problem.
  const free = sealedCopy('UNREADABLE', false);
  expect(free.body).not.toMatch(/Reconnect/);
  expect(free.title).toBe(errorCopy.UNREADABLE.title);
  expect(free.title).not.toBe(errorCopy.NETWORK.title);
  const paid = sealedCopy('UNREADABLE', true);
  expect(paid.body).toMatch(/Your payment was sent/);
  expect(paid.body).not.toMatch(/Reconnect/); // the default branch and NETWORK's both differ from this one
  expect(paid.title).toBe(errorCopy.UNREADABLE.title);
});

test('a refused prepare never says something is waiting or that a paid pull is safe', () => {
  // UNREADABLE.body and UNKNOWN.body both render on a failed prepare if the hint uses errorCopy as-is: nothing can be
  // waiting (the quote was refused), and the machine may still say "Free pull".
  expect(prepareErrorCopy('UNREADABLE')).toBe('Try again in a moment. Nothing was charged.');
  expect(prepareErrorCopy('UNKNOWN')).toBe('Try again in a moment. Nothing was charged.');
  expect(prepareErrorCopy('UNREADABLE')).not.toMatch(/waiting for you|paid pull is never lost/i);
  expect(prepareErrorCopy('UNKNOWN')).not.toMatch(/waiting for you|paid pull is never lost/i);
  expect(prepareErrorCopy('UNREADABLE')).not.toBe(errorCopy.UNREADABLE.body);
  expect(prepareErrorCopy('UNKNOWN')).not.toBe(errorCopy.UNKNOWN.body);
  // Other codes keep their own body — this is copy routing, not a new keep/lost-answer rule.
  expect(prepareErrorCopy('INSUFFICIENT_FUNDS')).toBe(errorCopy.INSUFFICIENT_FUNDS.body);
  expect(prepareErrorCopy('NETWORK')).toBe(errorCopy.NETWORK.body);
  expect(prepareErrorCopy('RESTOCKING')).toBe(errorCopy.RESTOCKING.body);
});

// W0.2b (#136): the device could not store the pull (the web's private mode, a full quota). It lives in this page's memory
// only, so no sealed copy may say the capsule waits or can be left; what the server owes a payment is said as before.
test('a sealed capsule that could not be saved never says it will wait', () => {
  const codes: (ApiErrorCode | undefined)[] = ['NETWORK', 'UNREADABLE', 'TX_NOT_FOUND', 'UNKNOWN', undefined];
  for (const paid of [true, false]) {
    for (const code of codes) {
      const kept = sealedCopy(code, paid);
      const unsaved = sealedCopy(code, paid, false);
      expect(unsaved.body).not.toMatch(/waits|leave it|for later/);
      expect(unsaved.body).toMatch(/This device could not save the capsule, so try again now/);
      expect(unsaved.body).not.toMatch(/browser/i); // the apps show this sentence too (a full disk): PR #154's review read "This browser" on an iPhone
      if (paid) expect(unsaved.body).toMatch(/Your payment was sent\.[\s\S]*a card or a refund/);
      else expect(unsaved.body).toMatch(/Nothing was paid/);
      expect(unsaved.title).toBe(kept.title); // what happened has not changed, only what can be promised
    }
  }
  // A pull that can never open has nothing to wait for either way: its copy is about the money, and stays.
  expect(sealedCopy('TX_MISMATCH', true, false)).toEqual(sealedCopy('TX_MISMATCH', true));
  expect(sealedCopy('EXPIRED', true, false)).toEqual(sealedCopy('EXPIRED', true));
});

test('a lost burn says the free pull waits and never a card or a capsule', () => {
  for (const code of ['NETWORK', 'UNREADABLE'] as const) {
    const c = burnSealedCopy(code);
    expect(c.body).toMatch(/free pull waits/);
    expect(`${c.title} ${c.body}`).not.toMatch(/capsule|card|payment/i);
  }
  expect(burnSealedCopy('NETWORK', false).body).toMatch(/try again now/i);
  expect(burnSealedCopy('NETWORK', false).body).not.toMatch(/capsule|card/i);
});
