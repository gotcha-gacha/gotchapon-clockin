// The wrapper every withdrawal goes out through (#187). Its whole point is that the sender behind it cannot be reached
// with a destination that is not an address — so these tests watch a sender they own, rather than the in-app mock, and the
// claim they hold is the one PR #195's review found the first fix did not support: that F7.4's real send inherits the
// check by being wrapped, not by someone remembering to re-add a line.
import { expect, jest, test } from '@jest/globals';
import { sendChecked, type Send } from '@/state/withdrawGuard';

const ADDR = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // 32 bytes of base58
/** 42 characters of base58 and 31 bytes: the app's own old mock wallet, and what the sheet used to accept. */
const THIRTY_ONE_BYTES = '7xKpQm2vR8tW3nHd9fQaLm4sT6uVbN1cXeYz8wKpRq';

const spy = () => jest.fn<Send>(async () => {});

test('a destination that is not an address never reaches the sender', async () => {
  const send = spy();
  const withdraw = (usd: number, address: string, idem: string) => sendChecked(send, usd, address, idem);
  for (const bad of [THIRTY_ONE_BYTES, 'DEMO-WALLET-DO-NOT-SEND', '0x71C7656EC7ab88b098defB751B7401B5f6d8976F', '', '   ', 'z'.repeat(44), `${ADDR}${ADDR}`]) {
    await expect(withdraw(5, bad, 'idem-1')).rejects.toThrow(/not a Solana address/);
  }
  expect(send).not.toHaveBeenCalled();
});

test('a real address reaches the sender, trimmed, with the amount and key unchanged', async () => {
  const send = spy();
  await sendChecked(send, 2.5, ` ${ADDR}\n`, 'idem-2'); // as a paste arrives
  expect(send).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledWith(2.5, ADDR, 'idem-2');
});

test("the sender's own failure is passed through, not swallowed or relabelled", async () => {
  const send = jest.fn<Send>(async () => { throw new Error('the network went away'); });
  await expect(sendChecked(send, 1, ADDR, 'idem-3')).rejects.toThrow('the network went away');
});

// The guard is not the sender's to skip: whatever F7.4 hands it gets the same treatment as the mock does today. Written
// as a second, independent sender so the test would still fail if someone re-added the check inside the in-app mock's
// function and took it out of here.
test('any sender handed to it is guarded, not just the one the app ships', async () => {
  const other = spy();
  await expect(sendChecked(other, 1, THIRTY_ONE_BYTES, 'idem-4')).rejects.toThrow(/not a Solana address/);
  expect(other).not.toHaveBeenCalled();
});
