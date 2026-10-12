// "Deposit from a wallet app" on Android (Mobile Wallet Adapter, CLOCK IN, Ben, 11 Oct). Connect asks the wallet app on this
// phone (the Seeker's own wallet, Phantom, Solflare…) for an account and links it to the player's account in the same
// session (a sign-in message, signed in the wallet app): the server builds deposits only from a linked wallet, and the
// faucet sends only to one. Then the player can claim the account's test USDC to that wallet app (while the account's one
// grant is unclaimed) and deposit from it through the deposit sheet the web's connected-wallet deposit uses. Without a
// `transact` nothing renders. Judges are pointed at the plain faucet; this is the showcase.
//
// Only `WalletAppDeposit.android.tsx` renders this. Every other platform gets the null stub `WalletAppDeposit.tsx`, so this
// file and the codecs and guard it imports stay out of the web's first paint (imported everywhere, it cost +16 KB gzipped).
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { api as defaultApi } from '@/api';
import type { GachaApi } from '@/api/contract';
import { useAuth } from '@/auth/AuthProvider';
import { pinnedUsdcMint } from '@/config/treasury';
import { shortAddress } from '@/format';
import { font } from '@/theme/fonts';
import { color, radius } from '@/theme/tokens';
import { mobileWalletTransact } from '@/wallet/mobileWallet';
import type { MobileWalletTransact } from '@/wallet/mobileWalletTypes';
import { connectWalletApp, depositFromWalletApp, type WalletAppConnection } from '@/wallet/walletAppDeposit';
import { DepositSheet } from './DepositSheet';

export type WalletAppDepositProps = {
  /** The player's embedded (deposit) wallet. */
  destination: string;
  onDeposited: () => Promise<void>;
  /** The session's faucet claim, null once the account's one grant is spent (or where there is no faucet). */
  claimFaucet?: ((wallet?: string) => Promise<unknown>) | null;
  transact?: MobileWalletTransact | null;
  api?: Pick<GachaApi, 'buildDeposit' | 'submitDeposit'>;
  mint?: string | null;
};

// MWA's own code when no wallet app on the phone answers the association intent.
const noWalletApp = (cause: unknown) => (cause as { code?: unknown } | null)?.code === 'ERROR_WALLET_NOT_FOUND';

export function WalletAppDepositPanel({
  destination, onDeposited, claimFaucet = null, transact = mobileWalletTransact, api = defaultApi, mint = pinnedUsdcMint,
}: WalletAppDepositProps) {
  const { linkWalletApp } = useAuth();
  const [connection, setConnection] = useState<WalletAppConnection | null>(null);
  const [busy, setBusy] = useState<'connect' | 'claim' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  if (!transact || !linkWalletApp) return null;

  const connect = async () => {
    if (busy) return;
    setBusy('connect'); setProblem(null);
    try {
      setConnection(await connectWalletApp(transact, linkWalletApp));
    } catch (cause) {
      setProblem(noWalletApp(cause)
        ? 'No wallet app on this phone answered. Install one (a Seeker has its own), then try again.'
        : 'The wallet app did not connect. Open it once, then try again.');
    } finally {
      setBusy(null);
    }
  };
  const claim = async () => {
    if (busy || !connection || !claimFaucet) return;
    setBusy('claim'); setProblem(null);
    try {
      await claimFaucet(connection.address);
      await onDeposited();
    } catch {
      setProblem('The test USDC did not arrive. Try again.');
    } finally {
      setBusy(null);
    }
  };
  const deposit = async (amountBase: number, idem: string) => {
    if (!connection) return;
    await depositFromWalletApp(transact, { api, connection, owner: destination, mint }, amountBase, idem);
    await onDeposited();
  };

  return (
    <View style={s.box} testID="wallet-app-deposit">
      <Text style={s.title}>Deposit from a wallet app</Text>
      {connection ? (
        <>
          <Text style={s.sub}>{connection.label ?? 'Wallet app'} · {shortAddress(connection.address)}. It signs the transfer into your deposit wallet above.</Text>
          {claimFaucet ? (
            <Pressable onPress={() => { void claim(); }} disabled={busy !== null} style={[s.btn, s.ghost, busy !== null && { opacity: 0.6 }]} accessibilityRole="button">
              {busy === 'claim' ? <ActivityIndicator color={color.text} /> : <Text style={s.ghostText}>Claim test USDC to wallet app</Text>}
            </Pressable>
          ) : null}
          <Pressable onPress={() => setOpen(true)} disabled={!destination || busy !== null} style={[s.btn, s.primary, (!destination || busy !== null) && { opacity: 0.5 }]} accessibilityRole="button">
            <Text style={s.primaryText}>Deposit from wallet app</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={s.sub}>Use the wallet app on this phone to send USDC into your deposit wallet. Connecting asks it to sign a sign-in message.</Text>
          <Pressable onPress={() => { void connect(); }} disabled={busy !== null} style={[s.btn, s.ghost, busy !== null && { opacity: 0.6 }]} accessibilityRole="button">
            {busy === 'connect' ? <ActivityIndicator color={color.text} /> : <Text style={s.ghostText}>Connect wallet app</Text>}
          </Pressable>
        </>
      )}
      {problem ? <Text style={s.error}>{problem}</Text> : null}
      {connection ? (
        <DepositSheet
          open={open}
          source={connection.address}
          destination={destination}
          onClose={() => setOpen(false)}
          onDeposit={deposit}
        />
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  box: { borderWidth: 1, borderColor: color.hairline, borderRadius: radius.button, padding: 12, gap: 8, marginTop: 4 },
  title: { fontFamily: font.extrabold, fontSize: 13, color: color.text },
  sub: { fontFamily: font.semibold, fontSize: 12, color: color.text2, lineHeight: 17 },
  btn: { borderRadius: radius.button, paddingVertical: 11, alignItems: 'center', justifyContent: 'center', minHeight: 42 },
  primary: { backgroundColor: color.mint },
  primaryText: { fontFamily: font.black, fontSize: 13, color: color.inkOnMint },
  ghost: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', backgroundColor: 'rgba(255,255,255,0.06)' },
  ghostText: { fontFamily: font.extrabold, fontSize: 13, color: color.text },
  error: { fontFamily: font.semibold, fontSize: 12, color: color.danger, lineHeight: 16 },
});
