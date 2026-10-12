// Soft launch (#349): the Wallet tab does not show Ship my cards, even when a rare is held.
// Deposit and Pay by card stay. Shipping itself is still later.
import { expect, jest, test } from '@jest/globals';
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { api } from '@/api';
import { AuthProvider } from '@/auth/AuthProvider';
import { RitualProvider } from '@/ritual/useRitual';
import { WalletPage } from '@/screens/WalletPage';
import { SessionProvider } from '@/state/session';

test('Wallet hides Ship my cards for soft launch, including with a rare held (#349)', async () => {
  const holdings = jest.spyOn(api, 'holdings').mockResolvedValue([{ cardId: 'rare-1', qty: 1, rarity: 'holo' }, { cardId: 'common-1', qty: 2, rarity: 'common' }]);
  try {
    await render(
      <SafeAreaProvider>
        <AuthProvider>
          <SessionProvider>
            <RitualProvider><WalletPage /></RitualProvider>
          </SessionProvider>
        </AuthProvider>
      </SafeAreaProvider>,
    );
    expect(await screen.findByText('Pay by card instead')).toBeTruthy();
    expect(screen.getByText('Card top-ups are on the way. For now, deposit USDC above.')).toBeTruthy();
    expect(screen.getAllByText('Coming soon')).toHaveLength(1); // card top-up only
    expect(screen.queryByText('Ship my cards')).toBeNull();
    expect(screen.queryByText(/in the vault under your name/)).toBeNull();
    expect(screen.queryByText(/Kuala Lumpur/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ship my cards' })).toBeNull();
    expect(screen.queryByText(/Ready — pick|Unlocks at/)).toBeNull();
  } finally {
    holdings.mockRestore();
  }
});
