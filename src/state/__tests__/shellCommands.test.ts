// The shell's commands (W1.5, #127): on offer only while whoever can honour one says so.
import { expect, test } from '@jest/globals';
import { provideShellCommand, runShellCommand } from '../shellCommands';

test('nothing on offer: nothing runs, and the caller is told', () => {
  expect(runShellCommand('odds')).toBe(false);
});

test('an offered command runs until it is withdrawn', () => {
  let ran = 0;
  const withdraw = provideShellCommand('odds', () => { ran++; });
  expect(runShellCommand('odds')).toBe(true);
  expect(ran).toBe(1);
  withdraw();
  expect(runShellCommand('odds')).toBe(false);
  expect(ran).toBe(1);
});

// React runs a new effect's cleanup-then-setup in that order, but two providers (a remount under a new key) can overlap:
// the old one leaving must not take the new one's offer with it.
test('withdrawing an old offer leaves a newer one standing', () => {
  let a = 0; let b = 0;
  const withdrawA = provideShellCommand('odds', () => { a++; });
  const withdrawB = provideShellCommand('odds', () => { b++; });
  withdrawA();
  expect(runShellCommand('odds')).toBe(true);
  expect([a, b]).toEqual([0, 1]);
  withdrawB();
  expect(runShellCommand('odds')).toBe(false);
});
