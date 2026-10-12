// Wallet (F7.1, design "4. Wallet"): balance, the Deposit stablecoin card (Solana wallet row, QR +
// address + Copy / Open wallet app, "Listening for deposits", warning, Withdraw balance link), and "Pay by
// card instead" as a visible coming-soon row (Ben, 10 Sept: no onramp in v0/v1, deposit only).
// Ship my cards stays in this file but is off the tab for soft launch (#349, Ben 30 Sept 2026). Shipping
// is still later; an early request is handled by hand. Flip SHOW_WALLET_SHIPPING to bring the card back.
import React, { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { Page, PageTitle } from './Page';
import { WithdrawSheet } from '@/components/wallet/WithdrawSheet';
import { DepositSheet } from '@/components/wallet/DepositSheet';
import { WalletAppDeposit } from '@/components/wallet/WalletAppDeposit';
import { TIER_VALUE_USD, type Holding } from '@/api/contract';
import { ApiError } from '@/api/errors';
import { PAGE, balanceText, useSession } from '@/state/session';
import { color, radius } from '@/theme/tokens';
import { useAuth } from '@/auth/AuthProvider';
import { canOpenWalletApp } from '@/components/wallet/walletApp';
import { font } from '@/theme/fonts';
import { playSfx } from '@/audio/sfx';
import { shortAddress } from '@/format';

function Listening({ active }: { active: boolean }) {
  const p = useSharedValue(0.35);
  // All four pages stay mounted in the pager: the dot only pulses while the wallet is on screen.
  useEffect(() => {
    if (!active) { cancelAnimation(p); p.set(0.35); return; }
    p.set(withRepeat(withSequence(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }), withTiming(0.35, { duration: 900, easing: Easing.inOut(Easing.ease) })), -1));
  }, [active, p]);
  const dot = useAnimatedStyle(() => ({ opacity: p.get() }));
  return (
    <View style={s.listenRow}>
      <Animated.View style={[s.listenDot, dot]} />
      <Text style={s.listenText}>Listening for deposits</Text>
    </View>
  );
}

/** Soft launch (#349): the Wallet tab does not show Ship my cards. Set true to restore that coming-soon card. */
const SHOW_WALLET_SHIPPING = false;

/** A card heading with the Coming soon tag. */
function SoonHead({ title }: { title: string }) {
  return (
    <View style={s.cardHead}>
      <Text style={s.cardTitle}>{title}</Text>
      <View style={[s.tag, s.tagSoon]}><Text style={[s.tagText, s.tagSoonText]}>Coming soon</Text></View>
    </View>
  );
}

/**
 * Deposit row. `loginName` is set only for a wallet-SIWS binder: the QR is the embedded wallet, and the
 * line says so. Apple, Google, and email pass null and keep the sign-in line.
 */
export function depositWalletCopy(loginName: string | null): { title: string; sub: string } {
  if (!loginName) return { title: 'Solana wallet', sub: 'Made for you at sign-in · nothing to write down' };
  if (loginName === 'connected wallet') return { title: 'Solana wallet', sub: 'Deposit address · not the wallet you signed in with' };
  return { title: 'Solana wallet', sub: `Deposit address · not your ${loginName} address` };
}

/** Coming-soon shipping card: held count, vault value, KL copy. Mounted only when SHOW_WALLET_SHIPPING is on. */
function ShipMyCards({ holdings }: { holdings: Record<string, Holding> }) {
  const vault = useMemo(() => {
    let held = 0; let value = 0; let valueKnown = true;
    for (const h of Object.values(holdings)) {
      held += h.qty;
      const v = h.rarity ? TIER_VALUE_USD[h.rarity] : undefined;
      if (typeof v === 'number') value += h.qty * v; else valueKnown = false; // absent or unknown tier
    }
    return { held, value, valueKnown };
  }, [holdings]);
  return (
    <View style={[s.card, s.cardMuted]}>
      <SoonHead title="Ship my cards" />
      <Text style={s.cardSub}>{vault.held} card{vault.held === 1 ? '' : 's'}{vault.valueKnown ? ` · about $${vault.value.toFixed(2)}` : ''} in the vault under your name</Text>
      <Text style={s.cardSub}>Shipping to your door is on the way. Until then every card stays sleeved in the Kuala Lumpur vault.</Text>
    </View>
  );
}

export function WalletPage() {
  const auth = useAuth();
  const { me, balanceUsd, balanceKnown, usdcUsd, holdings, funding, claimFaucet, withdraw, page, usingMock, refresh } = useSession();
  const siws = auth.provider === 'wallet';
  const walletCopy = depositWalletCopy(siws ? (auth.loginWallet?.name ?? 'connected wallet') : null);
  const [copied, setCopied] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [claiming, setClaiming] = useState(false);
  // 'stuck' is the server's 409: retrying may not finish this grant (#304). Hedged, because one of its causes (a transfer
  // from before the stored lifetime) can also be a lagging node, and a later retry then works.
  const [faucetError, setFaucetError] = useState<'retry' | 'stuck' | null>(null);
  const [depositOpen, setDepositOpen] = useState(false);
  // Social: /me.wallet leads, funding.depositAddress is only a fallback (BUILD_PLAN §2).
  // SIWS: the embedded address from sign-in leads. /me.wallet is the same once the server returns it;
  // until then the connected pubkey must not be the QR.
  const serverAddress = me?.wallet ?? funding?.depositAddress ?? '';
  const address = siws && auth.wallet ? auth.wallet : serverAddress;
  // One grant per account (#276): claimed means this account's grant went out, to whichever wallet it first asked for.
  const faucetClaimed = funding?.faucet?.claimed === true;
  // The wallet a claim from here is for: the connected one on a wallet sign-in, the account's own otherwise. "Went elsewhere"
  // is the grant's wallet differing from it, read from /funding so it survives a reload (#304), never `alreadyClaimed` alone,
  // which is also true when a retry finds this same wallet's grant already sent (PR #302's second review).
  const faucetAsked = siws ? auth.loginWallet?.address : me?.wallet;
  const faucetSentTo = funding?.faucet?.wallet;
  const faucetWentElsewhere = faucetClaimed && !!faucetSentTo && !!faucetAsked && faucetSentTo !== faucetAsked;

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);
  const copy = async () => {
    if (!address) return;
    try { await Clipboard.setStringAsync(address); setCopied(true); playSfx('click'); } catch { /* clipboard unavailable: the address text stays selectable */ }
  };
  const openWallet = () => { if (address) Linking.openURL(`solana:${address}`).catch(() => {}); };
  const depositFromConnectedWallet = async (amountBase: number, idem: string) => {
    if (!auth.depositFromConnectedWallet) return;
    await auth.depositFromConnectedWallet(amountBase, idem);
    await refresh();
  };

  return (
    <Page>
      <PageTitle title="Wallet" sub={balanceKnown ? `${balanceText(balanceUsd)} in your balance.` : 'Loading your balance.'} />

      {funding?.faucet ? (
        <View style={s.card}>
          <View style={s.cardHead}>
            <Text style={s.cardTitle}>Development USDC</Text>
            <View style={[s.tag, s.tagDemo]}><Text style={[s.tagText, s.tagDemoText]}>Test token</Text></View>
          </View>
          <Text style={s.cardSub}>{auth.provider === 'wallet'
            ? `Fund your connected wallet with $${(funding.faucet.amount / 1_000_000).toFixed(0)} test USDC, then deposit it below to exercise the full path. It has no cash value.`
            : `Fund this wallet with $${(funding.faucet.amount / 1_000_000).toFixed(0)} test USDC for mainnet-dev pulls. It has no cash value.`}</Text>
          <Pressable
            onPress={() => {
              if (!claimFaucet) return;
              setClaiming(true); setFaucetError(null);
              void claimFaucet(siws ? faucetAsked : undefined)
                .catch((error: unknown) => setFaucetError(error instanceof ApiError && error.status === 409 ? 'stuck' : 'retry'))
                .finally(() => setClaiming(false));
            }}
            disabled={!claimFaucet || claiming || faucetClaimed}
            style={[s.btn, s.btnPrimary, (!claimFaucet || claiming || faucetClaimed) && { opacity: 0.5 }]}
            accessibilityRole="button"
          >
            <Text style={s.btnPrimaryText}>{faucetClaimed
              ? 'Test USDC claimed'
              : claiming
                ? 'Funding wallet…'
                : auth.provider === 'wallet' ? 'Claim to connected wallet' : 'Claim test USDC'}</Text>
          </Pressable>
          {faucetError === 'retry' ? <Text style={s.warn}>The faucet did not finish. Try again—the same grant is safely retried.</Text> : null}
          {faucetError === 'stuck' ? <Text style={s.warn}>This account’s test USDC may need a hand fix. If trying again later doesn’t work, ask the team.</Text> : null}
          {faucetWentElsewhere ? <Text style={s.warn}>This account already had its test USDC, sent to another of its wallets.</Text> : null}
        </View>
      ) : null}

      <View style={s.card}>
        <View style={s.cardHead}>
          <Text style={s.cardTitle}>Deposit stablecoin</Text>
          {usingMock
            ? <View style={[s.tag, s.tagDemo]}><Text style={[s.tagText, s.tagDemoText]}>Demo</Text></View>
            : <View style={s.tag}><Text style={s.tagText}>Recommended</Text></View>}
        </View>
        {usingMock ? (
          // A demo build (#185): the address behind it is a fixture, so the QR, the address text, Copy and Open wallet app
          // are all gone — each of them is a way to hand a string to a real wallet, and a tester who sends real money to a
          // made-up address has lost it. What is left says so in as many words. "Listening for deposits" goes too: nothing
          // is listening.
          <View style={s.demoBox} accessibilityLabel="Demo build: this is not a real wallet">
            <Text style={s.demoTitle}>Demo build — not a real wallet</Text>
            <Text style={s.demoBody}>This build runs on demo data: there is no wallet behind it and no address to deposit to. Never send USDC or anything else from this screen.</Text>
            <Text style={s.demoBody}>The balance above is demo money. The DEMO pill in the header adds $10 of it.</Text>
          </View>
        ) : (
          <>
            {/* USDC only (Ben, 11 Oct): every pull pays USDC, so a USDT deposit is never counted. Where the faucet runs (mainnet-dev),
                the warning below says only its test USDC counts. */}
            <Text style={s.cardSub}>{funding?.faucet ? 'Test USDC on Solana · no fees, no minimum' : 'USDC on Solana · no fees, no minimum'}</Text>
            <View style={s.walletRow}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.rowLabel}>{walletCopy.title}</Text>
                <Text style={s.rowSub}>{walletCopy.sub}</Text>
              </View>
              <Text style={s.mono}>{address ? shortAddress(address) : '—'}</Text>
            </View>
            {siws && auth.loginWallet ? (
              <Text style={s.distinct}>
                {shortAddress(auth.loginWallet.address)} is {auth.loginWallet.name === 'connected wallet' ? 'the wallet you signed in with' : `your ${auth.loginWallet.name} address`}. Deposits do not go there.
              </Text>
            ) : null}
            {auth.depositFromConnectedWallet ? (
              <>
                <Pressable
                  onPress={() => setDepositOpen(true)}
                  disabled={!address || !auth.loginWallet}
                  style={[s.btn, s.btnPrimary, (!address || !auth.loginWallet) && { opacity: 0.5 }]}
                  accessibilityRole="button"
                >
                  <Text style={s.btnPrimaryText}>Deposit from connected wallet</Text>
                </Pressable>
              </>
            ) : null}
            {/* Android only (Mobile Wallet Adapter): renders nothing elsewhere. A wallet sign-in already deposits from its own wallet. */}
            {!siws ? <WalletAppDeposit destination={address} onDeposited={refresh} claimFaucet={claimFaucet} /> : null}
            <View testID="deposit-qr" style={s.qrWrap}>{address ? <QRCode value={address} size={132} backgroundColor="#FFFFFF" color="#0B0E1A" /> : null}</View>
            <Text testID="deposit-address" style={s.address} selectable accessibilityLabel="Deposit address">{address}</Text>
            <View style={s.btnRow}>
              <Pressable onPress={() => { void copy(); }} disabled={!address} style={[s.btn, auth.depositFromConnectedWallet ? s.btnGhost : s.btnPrimary, !address && { opacity: 0.5 }]} accessibilityRole="button"><Text style={auth.depositFromConnectedWallet ? s.btnGhostText : s.btnPrimaryText}>{copied ? 'Copied' : 'Copy address'}</Text></Pressable>
              {canOpenWalletApp() ? <Pressable onPress={openWallet} disabled={!address} style={[s.btn, s.btnGhost, !address && { opacity: 0.5 }]} accessibilityRole="button"><Text style={s.btnGhostText}>Open wallet app</Text></Pressable> : null}
            </View>
            <Listening active={page === PAGE.wallet} />
            <Text style={s.warn}>{funding?.faucet
              ? 'Only the test USDC above counts here. Real USDC sent to this address is not counted on this test site.'
              : 'Only send USDC on Solana to this address. Anything else can\u2019t be recovered.'}</Text>
          </>
        )}
        {withdraw ? <Pressable onPress={() => setWithdrawOpen(true)} hitSlop={6} accessibilityRole="button" style={{ alignSelf: 'flex-start' }}><Text style={s.link}>Withdraw balance</Text></Pressable> : null}
      </View>

      <View style={[s.card, s.cardMuted]}>
        <SoonHead title="Pay by card instead" />
        <Text style={s.cardSub}>Card top-ups are on the way. For now, deposit USDC above.</Text>
      </View>

      {SHOW_WALLET_SHIPPING ? <ShipMyCards holdings={holdings} /> : null}

      {withdraw ? <WithdrawSheet open={withdrawOpen} availableUsd={usdcUsd} onClose={() => setWithdrawOpen(false)} onWithdraw={withdraw} /> : null}
      {auth.depositFromConnectedWallet ? <DepositSheet
        open={depositOpen}
        source={auth.loginWallet?.address ?? ''}
        destination={address}
        onClose={() => setDepositOpen(false)}
        onDeposit={depositFromConnectedWallet}
      /> : null}
    </Page>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: color.glassBg, borderWidth: 1, borderColor: color.glassBorder, borderRadius: radius.cardLg, padding: 16, marginBottom: 12, gap: 8 },
  cardMuted: { opacity: 0.8 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  cardTitle: { fontFamily: font.black, fontSize: 16, color: color.text },
  cardSub: { fontFamily: font.semibold, fontSize: 12.5, color: color.text2, lineHeight: 17 },
  tag: { borderRadius: radius.pill, paddingVertical: 3, paddingHorizontal: 8, backgroundColor: 'rgba(143,227,197,0.16)', borderWidth: 1, borderColor: 'rgba(143,227,197,0.5)' },
  tagText: { fontFamily: font.extrabold, fontSize: 10, color: color.mint, letterSpacing: 0.4 },
  tagSoon: { backgroundColor: 'rgba(255,210,63,0.12)', borderColor: 'rgba(255,210,63,0.45)' },
  tagSoonText: { color: color.yellow },
  // The demo notice wears the header pill's amber, so the two read as one marker (#185).
  tagDemo: { backgroundColor: 'rgba(255,176,63,0.14)', borderColor: 'rgba(255,176,63,0.6)' },
  tagDemoText: { color: color.tickerAmber },
  demoBox: { borderWidth: 1, borderColor: 'rgba(255,176,63,0.6)', backgroundColor: 'rgba(255,176,63,0.1)', borderRadius: radius.card, padding: 12, gap: 6, marginTop: 4 },
  demoTitle: { fontFamily: font.black, fontSize: 14, color: color.tickerAmber },
  demoBody: { fontFamily: font.semibold, fontSize: 12.5, color: color.text2, lineHeight: 17 },
  walletRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: color.hairline, borderRadius: radius.button, paddingVertical: 9, paddingHorizontal: 12, marginTop: 4 },
  rowLabel: { fontFamily: font.extrabold, fontSize: 13, color: color.text },
  rowSub: { fontFamily: font.semibold, fontSize: 11.5, color: color.text3 },
  distinct: { fontFamily: font.semibold, fontSize: 12, color: color.text2, lineHeight: 17 },
  mono: { fontFamily: font.mono, fontSize: 12, color: color.text },
  qrWrap: { alignSelf: 'center', backgroundColor: '#FFFFFF', padding: 10, borderRadius: 12, marginTop: 6 },
  address: { fontFamily: font.mono, fontSize: 11, color: color.text2, textAlign: 'center', lineHeight: 16 },
  btnRow: { flexDirection: 'row', gap: 8 },
  btn: { flex: 1, borderRadius: radius.button, paddingVertical: 11, alignItems: 'center', justifyContent: 'center' },
  btnPrimary: { backgroundColor: color.mint },
  btnPrimaryText: { fontFamily: font.black, fontSize: 13, color: color.inkOnMint },
  btnGhost: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', backgroundColor: 'rgba(255,255,255,0.06)' },
  btnGhostText: { fontFamily: font.extrabold, fontSize: 13, color: color.text },
  listenRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 2 },
  listenDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: color.mint, shadowColor: color.mint, shadowOpacity: 1, shadowRadius: 6 },
  listenText: { fontFamily: font.extrabold, fontSize: 12, color: color.mint },
  warn: { fontFamily: font.semibold, fontSize: 11.5, color: color.text3, lineHeight: 16 },
  link: { fontFamily: font.extrabold, fontSize: 12.5, color: color.mint, textDecorationLine: 'underline' },
});
