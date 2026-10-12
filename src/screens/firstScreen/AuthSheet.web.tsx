// Sign-in sheet on the web (#244). Apple, Google, and email stay primary. Wallets sit behind one
// "Connect a wallet" toggle and run connect → SIWS sign → the same land as Google. The phone keeps
// `AuthSheet.tsx` (social only).
//
// The 17 Sept decision still drops "18+" from this footer. `?ref` is ignored here: the invited-by pill went with the rest of
// referral until W4 (Ben, 11 Oct). Nothing here links a wallet to an email account.
import React, { useEffect, useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Backdrop } from '@/components/Backdrop';
import { useAuth } from '@/auth/AuthProvider';
import { errorCopy } from '@/api/errors';
import type { ApiErrorCode } from '@/api/contract';
import {
  CURATED_SOLANA_WALLETS,
  DETECTED_SOLANA_WALLETS,
  detectedSolanaWalletKeys,
  hasUnnamedSolanaWallet,
  OTHER_SOLANA_WALLETS,
  solanaWalletName,
  TRUST_SOLANA_WALLET,
  walletBrowseUrl,
  walletInstallUrl,
  type SolanaWalletKey,
  type WalletErrorKind,
  type WalletFlow,
} from '@/auth/solanaWallets';
import { LegalLink } from '@/legal/LegalLink';
import { AppleMark, GoogleMark } from '@/screens/firstScreen/BrandMarks';
import { WalletMark, WalletMarkStack } from '@/screens/firstScreen/WalletMarks';
import { color, radius } from '@/theme/tokens';
import { inputFontSize } from '@/theme/inputs';
import { font } from '@/theme/fonts';
import { shortAddress } from '@/format';

function signInCopy(code: ApiErrorCode): { title: string; body: string } {
  if (code === 'NETWORK') return errorCopy.NETWORK;
  if (code === 'GEO_BLOCKED') return errorCopy.GEO_BLOCKED;
  return { title: 'We could not sign you in', body: 'Nothing was created and nothing was charged. Try again, or use another way in.' };
}

const ERROR_COPY: Record<WalletErrorKind, { title: (name: string) => string; body: string; primary: string }> = {
  cancel: {
    title: (name) => `Cancelled in ${name}`,
    body: 'Nothing was signed and nothing was charged.',
    primary: 'Try again',
  },
  missing: {
    title: (name) => `${name} is not installed`,
    body: 'Install it, or open this page in the wallet app.',
    primary: 'Install',
  },
  network: {
    title: (name) => `Switch ${name} to Mainnet`,
    body: 'This app runs on Solana Mainnet. Devnet and testnet cannot sign in.',
    primary: 'Try again',
  },
  rejected: {
    title: (name) => `${name} declined the signature`,
    body: 'The message was free. Nothing moved.',
    primary: 'Try again',
  },
  unknown: {
    title: (name) => `${name} could not sign in`,
    body: 'The wallet connected, but sign-in did not finish. Try again or choose another wallet.',
    primary: 'Try again',
  },
};

function pageUrl(): string {
  if (typeof window === 'undefined') return '';
  return window.location.href;
}

export function AuthSheet({ onClose }: { onClose: () => void }) {
  const auth = useAuth();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [hint, setHint] = useState('');
  const [walletOpen, setWalletOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [detected, setDetected] = useState<ReadonlySet<SolanaWalletKey>>(() => new Set());
  const [unnamed, setUnnamed] = useState(false);
  const flow = auth.walletFlow ?? null;
  const busy = auth.stage === 'busy';
  const locked = busy || flow?.status === 'connect' || flow?.status === 'sign' || flow?.status === 'ok';

  const toggleWallets = () => {
    if (walletOpen) {
      setWalletOpen(false);
      setMoreOpen(false);
      return;
    }
    const registered = auth.installedSolanaWallets?.() ?? new Set<SolanaWalletKey>();
    setDetected(new Set([...detectedSolanaWalletKeys(), ...registered]));
    setUnnamed(hasUnnamedSolanaWallet() || registered.has(DETECTED_SOLANA_WALLETS));
    setWalletOpen(true);
  };

  const askForCode = async () => {
    if (!email.trim().includes('@')) { setHint('Enter your email address.'); return; }
    setHint('');
    setCodeSent(await auth.sendEmailCode(email));
    setCode('');
  };
  const close = () => { if (!locked) onClose(); };
  const pickWallet = (key: SolanaWalletKey) => {
    setHint('');
    if (!auth.signInWallet) {
      setHint('Wallet sign-in is not on in this build. Use Apple, Google, or email.');
      return;
    }
    void auth.signInWallet(key);
  };
  const openExternal = (url: string | null) => { if (url) Linking.openURL(url).catch(() => {}); };

  const rise = useSharedValue(40);
  useEffect(() => { rise.set(withTiming(0, { duration: 400, easing: Easing.bezier(0.2, 0.9, 0.2, 1) })); }, [rise]);
  const sheetIn = useAnimatedStyle(() => ({ transform: [{ translateY: rise.get() }] }));

  return (
    <Modal visible transparent animationType="fade" onRequestClose={close} testID="auth-sheet">
      <Backdrop style={s.backdrop} onPress={close} label="Close sign in" />
      <Animated.View style={[s.sheet, { paddingBottom: insets.bottom + 18 }, sheetIn]}>
        <ScrollView style={s.scroll} keyboardShouldPersistTaps="handled" bounces={false}>
          <View testID="auth-sheet-body" style={s.scrollBody}>
          <View style={s.handle} />
          <View style={s.head}>
            <View style={{ flex: 1 }}>
              <Text style={s.title}>Sign in to pull</Text>
              {flow || busy ? null : (
                <Text style={s.sub}>One tap. Your free pulls and every card you win stay on your account.</Text>
              )}
            </View>
            {locked ? null : (
              <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8} style={s.close}>
                <Text style={s.closeText}>✕</Text>
              </Pressable>
            )}
          </View>
          {auth.error && !flow ? (
            <View style={s.errorBox} accessibilityRole="alert">
              <Text style={s.errorTitle}>{signInCopy(auth.error.code).title}</Text>
              <Text style={s.errorBody}>{signInCopy(auth.error.code).body}</Text>
            </View>
          ) : null}
          {flow ? (
            <WalletStep
              flow={flow}
              onCancel={() => auth.dismissWalletFlow?.()}
              onRetry={(key) => pickWallet(key)}
              onOpen={openExternal}
            />
          ) : busy ? (
            <View style={s.busy}>
              <View style={s.busyRow}><View style={s.busyDot} /><Text style={s.busyText}>{auth.step}</Text></View>
              <Text style={s.busySub}>Privy is creating a Solana wallet for you — no seed phrase, nothing to write down.</Text>
            </View>
          ) : (
            <>
              <View style={s.socialRow}>
                <Pressable
                  onPress={() => auth.signIn('Apple')}
                  disabled={!auth.appleReady}
                  accessibilityState={{ disabled: !auth.appleReady }}
                  style={({ pressed }) => [s.btn, s.apple, s.socialBtn, pressed && s.pressed, !auth.appleReady && s.off]}
                  accessibilityRole="button"
                >
                  <AppleMark />
                  <Text style={[s.socialText, { color: color.room }]}>Continue with Apple</Text>
                </Pressable>
                <Pressable onPress={() => { setCodeSent(false); void auth.signIn('Google'); }} style={({ pressed }) => [s.btn, s.google, s.socialBtn, pressed && s.pressed]} accessibilityRole="button">
                  <GoogleMark />
                  <Text style={s.socialText}>Continue with Google</Text>
                </Pressable>
              </View>
              {auth.appleReady ? null : <Text style={s.appleNote}>Apple sign-in is not set up yet — use Google or email.</Text>}
              {codeSent ? (
                <View style={s.emailRow}>
                  <TextInput
                    value={code}
                    onChangeText={setCode}
                    placeholder="code from your email"
                    placeholderTextColor={color.text3}
                    keyboardType="number-pad"
                    autoComplete="one-time-code"
                    textContentType="oneTimeCode"
                    style={s.input}
                    accessibilityLabel="Email code"
                  />
                  <Pressable
                    onPress={() => { void auth.signIn('email', { email: email.trim(), code: code.trim() }); }}
                    disabled={code.trim().length < 4}
                    style={({ pressed }) => [s.sendBtn, pressed && s.pressed, code.trim().length < 4 && s.off]}
                    accessibilityRole="button"
                  ><Text style={s.sendText}>Sign in</Text></Pressable>
                </View>
              ) : (
                <View style={s.emailRow}>
                  <TextInput value={email} onChangeText={setEmail} placeholder="or your email" placeholderTextColor={color.text3} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} style={s.input} accessibilityLabel="Email" />
                  <Pressable onPress={() => { void askForCode(); }} style={({ pressed }) => [s.sendBtn, pressed && s.pressed]} accessibilityRole="button"><Text style={s.sendText}>Send code</Text></Pressable>
                </View>
              )}
              {hint ? <Text style={s.hint} accessibilityRole="alert">{hint}</Text> : null}
              <View style={s.orRow}><View style={s.orLine} /><Text style={s.orText}>or</Text><View style={s.orLine} /></View>
              <Pressable
                testID="wallet-toggle"
                onPress={toggleWallets}
                accessibilityRole="button"
                accessibilityLabel="Connect a wallet"
                accessibilityState={{ expanded: walletOpen }}
                aria-expanded={walletOpen}
                style={[s.walletToggle, walletOpen && s.walletToggleOpen]}
              >
                <WalletMarkStack />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.walletToggleTitle}>Connect a wallet</Text>
                  <Text style={s.walletToggleSub}>Phantom · Jupiter · Backpack · more</Text>
                </View>
                <Text style={s.chevron}>{walletOpen ? '⌃' : '›'}</Text>
              </Pressable>
              {walletOpen ? (
                <View style={s.walletList}>
                  {CURATED_SOLANA_WALLETS.map((key) => (
                    <WalletRow key={key} id={key} detected={detected.has(key)} onPress={() => pickWallet(key)} />
                  ))}
                  <Text style={s.free}>{"Free to sign · can't move funds"}</Text>
                  <Pressable
                    testID="wallet-more"
                    onPress={() => setMoreOpen((v) => !v)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: moreOpen }}
                    aria-expanded={moreOpen}
                    accessibilityLabel="More wallets"
                    style={s.moreRow}
                  >
                    <Text style={s.rowName}>More wallets</Text>
                    <Text style={s.chevron}>{moreOpen ? '⌃' : '›'}</Text>
                  </Pressable>
                  {moreOpen ? (
                    <View style={s.morePanel}>
                      <Text style={s.moreLabel}>Browser wallets</Text>
                      <WalletRow
                        id={DETECTED_SOLANA_WALLETS}
                        detected={unnamed}
                        name="Choose browser wallet"
                        undetectedLabel="Choose"
                        onPress={() => pickWallet(DETECTED_SOLANA_WALLETS)}
                      />
                      <Text style={s.moreLabel}>Other Solana</Text>
                      {[...OTHER_SOLANA_WALLETS, TRUST_SOLANA_WALLET].map((key) => (
                        <WalletRow key={key} id={key} detected={detected.has(key)} onPress={() => pickWallet(key)} />
                      ))}
                      <View style={s.scanRow} accessibilityState={{ disabled: true }}>
                        <View style={{ flex: 1 }}>
                          <Text style={s.rowName}>Scan with phone</Text>
                          <Text style={s.rowSub}>WalletConnect · coming soon</Text>
                        </View>
                      </View>
                    </View>
                  ) : null}
                </View>
              ) : null}
            </>
          )}
          <Text style={s.footer}>Apple, Google, email, or your wallet · <Text style={s.footerStrong}>Privy</Text> · <LegalLink doc="terms" style={s.link} /> · <LegalLink doc="privacy" style={s.link} /></Text>
          </View>
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

function WalletRow({ id, detected, name, undetectedLabel = 'Install', onPress }: {
  id: SolanaWalletKey;
  detected: boolean;
  name?: string;
  undetectedLabel?: 'Choose' | 'Install';
  onPress: () => void;
}) {
  const label = name ?? solanaWalletName(id);
  return (
    <Pressable testID={`wallet-row-${id}`} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={s.walletRow}>
      <WalletMark id={id} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.rowName}>{label}</Text>
      </View>
      <View style={[s.tag, detected ? s.tagOn : s.tagOff]}>
        <Text style={[s.tagText, detected ? s.tagTextOn : s.tagTextOff]}>{detected ? 'Detected' : undetectedLabel}</Text>
      </View>
      <Text style={s.chevron}>›</Text>
    </Pressable>
  );
}

function WalletStep({ flow, onCancel, onRetry, onOpen }: {
  flow: WalletFlow;
  onCancel: () => void;
  onRetry: (key: SolanaWalletKey) => void;
  onOpen: (url: string | null) => void;
}) {
  if (flow.status === 'connect') {
    return (
      <View style={s.step} testID="wallet-flow">
        <Text style={s.stepTitle}>Approve in {flow.name}</Text>
        <Text style={s.stepBody}>Check the {flow.name} extension and approve the connection.</Text>
        <Pressable onPress={onCancel} accessibilityRole="button" style={s.ghostBtn}><Text style={s.ghostText}>Cancel</Text></Pressable>
      </View>
    );
  }
  if (flow.status === 'sign') {
    return (
      <View style={s.step} testID="wallet-flow">
        <Text style={s.stepTitle}>Sign the message</Text>
        <Text style={s.stepBody}>{"Free to sign · this is not a transaction and can't move funds."}</Text>
        <View style={s.preview}>
          <PreviewRow label="Domain" value={flow.domain || '—'} />
          <PreviewRow label="Address" value={shortAddress(flow.address)} />
          <PreviewRow label="Nonce" value={flow.nonce || '—'} />
        </View>
        <Pressable onPress={onCancel} accessibilityRole="button" style={s.ghostBtn}><Text style={s.ghostText}>Cancel</Text></Pressable>
      </View>
    );
  }
  if (flow.status === 'ok') {
    return (
      <View style={s.step} testID="wallet-flow">
        <Text style={s.stepTitle}>Wallet connected</Text>
        <View style={s.chip}><Text style={s.chipText}>{shortAddress(flow.address)}</Text></View>
        <Text style={s.stepBody}>Taking you in…</Text>
      </View>
    );
  }
  const copy = ERROR_COPY[flow.kind];
  const install = walletInstallUrl(flow.key);
  const browse = walletBrowseUrl(flow.key, pageUrl());
  return (
    <View style={s.step} testID="wallet-flow" accessibilityRole="alert">
      <Text style={s.stepTitle}>{copy.title(flow.name)}</Text>
      <Text style={s.stepBody}>{copy.body}</Text>
      <Pressable
        onPress={() => { if (flow.kind === 'missing') onOpen(install); else onRetry(flow.key); }}
        accessibilityRole="button"
        style={s.primaryBtn}
      >
        <Text style={s.primaryText}>{flow.kind === 'missing' && install ? `${copy.primary} ↗` : copy.primary}</Text>
      </Pressable>
      {flow.kind === 'missing' && browse ? (
        <Pressable onPress={() => onOpen(browse)} accessibilityRole="button" accessibilityLabel="Open in app" style={s.ghostBtn}>
          <Text style={s.ghostText}>Open in app</Text>
        </Pressable>
      ) : null}
      <Pressable onPress={onCancel} accessibilityRole="button" accessibilityLabel="Use another way to sign in" style={s.textBtn}>
        <Text style={s.textBtnLabel}>Use another way to sign in</Text>
      </Pressable>
    </View>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.previewRow}>
      <Text style={s.previewLabel}>{label}</Text>
      <Text style={s.previewValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  backdrop: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(3,5,12,0.55)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '92%', backgroundColor: 'rgba(18,24,45,0.97)', borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  scroll: { flexGrow: 0 },
  // 26px sides is inside the 24–28 target (#346). 18px left the title, close, and the
  // Apple / Google / email row flush with the sheet edge. Top matches that inset so the
  // grabber and title are not sitting on the rim. The ScrollView above still scrolls when
  // the wallet list makes the sheet tall.
  scrollBody: { paddingHorizontal: 26, paddingTop: 22, gap: 8 },
  handle: { alignSelf: 'center', width: 40, height: 5, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.18)', marginBottom: 8 },
  head: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  title: { fontFamily: font.black, fontSize: 21, color: color.text, letterSpacing: -0.3 },
  sub: { fontFamily: font.semibold, fontSize: 13, color: color.text2, marginTop: 5, lineHeight: 18 },
  close: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.07)' },
  closeText: { fontFamily: font.bold, fontSize: 15, color: color.text2 },
  socialRow: { flexDirection: 'row', gap: 8 },
  socialBtn: { flex: 1, minWidth: 0, flexDirection: 'row', paddingVertical: 12, paddingHorizontal: 8 },
  socialText: { fontFamily: font.extrabold, fontSize: 13, color: color.text, textAlign: 'center' },
  btn: { borderRadius: 14, alignItems: 'center', justifyContent: 'center', gap: 6 },
  apple: { backgroundColor: '#F7F8FC' },
  google: { backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.22)' },
  pressed: { transform: [{ scale: 0.97 }] },
  off: { opacity: 0.5 },
  hint: { fontFamily: font.semibold, fontSize: 12, color: color.text2 },
  appleNote: { fontFamily: font.semibold, fontSize: 11, color: color.text3, textAlign: 'center' },
  emailRow: { flexDirection: 'row', gap: 8 },
  input: { flex: 1, minWidth: 0, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.18)', borderRadius: radius.button, paddingVertical: 11, paddingHorizontal: 12, fontFamily: font.bold, fontSize: inputFontSize(13), backgroundColor: 'rgba(255,255,255,0.05)', color: color.text },
  sendBtn: { borderRadius: radius.button, paddingVertical: 11, paddingHorizontal: 14, backgroundColor: color.yellow, justifyContent: 'center' },
  sendText: { fontFamily: font.extrabold, fontSize: 13, color: color.inkOnYellow },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 2 },
  orLine: { flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.12)' },
  orText: { fontFamily: font.bold, fontSize: 12, color: color.text3 },
  walletToggle: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.16)', borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: 'rgba(255,255,255,0.04)' },
  walletToggleOpen: { borderColor: color.yellow },
  walletToggleTitle: { fontFamily: font.extrabold, fontSize: 14, color: color.text },
  walletToggleSub: { fontFamily: font.semibold, fontSize: 11.5, color: color.text3, marginTop: 1 },
  walletList: { gap: 6 },
  walletRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, paddingHorizontal: 4 },
  rowName: { fontFamily: font.extrabold, fontSize: 14, color: color.text },
  rowSub: { fontFamily: font.semibold, fontSize: 11.5, color: color.text3, marginTop: 1 },
  tag: { borderRadius: radius.pill, paddingVertical: 3, paddingHorizontal: 8 },
  tagOn: { backgroundColor: 'rgba(143,227,197,0.16)' },
  tagOff: { backgroundColor: 'rgba(255,255,255,0.06)' },
  tagText: { fontFamily: font.extrabold, fontSize: 10 },
  tagTextOn: { color: color.mint },
  tagTextOff: { color: color.text3 },
  chevron: { fontFamily: font.bold, fontSize: 16, color: color.text2, width: 16, textAlign: 'center' },
  free: { fontFamily: font.semibold, fontSize: 11.5, color: color.text3, textAlign: 'center', marginTop: 2 },
  moreRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, paddingHorizontal: 4, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)' },
  morePanel: { gap: 6, paddingBottom: 4 },
  moreLabel: { fontFamily: font.bold, fontSize: 11, color: color.text3, letterSpacing: 0.3, marginTop: 4 },
  scanRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 4, opacity: 0.7 },
  busy: { backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: color.glassBorder, borderRadius: 14, padding: 16, alignItems: 'center' },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  busyDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: color.mint },
  busyText: { fontFamily: font.extrabold, fontSize: 13, color: color.text },
  busySub: { fontFamily: font.semibold, fontSize: 11.5, color: color.text2, marginTop: 4, textAlign: 'center' },
  step: { backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: color.glassBorder, borderRadius: 14, padding: 16, gap: 8 },
  stepTitle: { fontFamily: font.black, fontSize: 16, color: color.text, textAlign: 'center' },
  stepBody: { fontFamily: font.semibold, fontSize: 12.5, color: color.text2, textAlign: 'center', lineHeight: 18 },
  preview: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 4 },
  previewRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 6 },
  previewLabel: { fontFamily: font.semibold, fontSize: 12, color: color.text3 },
  previewValue: { flex: 1, fontFamily: font.bold, fontSize: 12, color: color.text, textAlign: 'right' },
  chip: { alignSelf: 'center', borderRadius: radius.pill, paddingVertical: 6, paddingHorizontal: 12, backgroundColor: 'rgba(143,227,197,0.16)', borderWidth: 1, borderColor: 'rgba(143,227,197,0.5)' },
  chipText: { fontFamily: font.mono, fontSize: 13, color: color.mint },
  primaryBtn: { borderRadius: radius.button, paddingVertical: 12, backgroundColor: color.yellow, alignItems: 'center' },
  primaryText: { fontFamily: font.extrabold, fontSize: 14, color: color.inkOnYellow },
  ghostBtn: { borderRadius: radius.button, paddingVertical: 11, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', alignItems: 'center' },
  ghostText: { fontFamily: font.extrabold, fontSize: 13, color: color.text },
  textBtn: { alignItems: 'center', paddingVertical: 6 },
  textBtnLabel: { fontFamily: font.semibold, fontSize: 12.5, color: color.text2, textDecorationLine: 'underline' },
  errorBox: { backgroundColor: 'rgba(255,107,91,0.12)', borderWidth: 1, borderColor: 'rgba(255,107,91,0.45)', borderRadius: 14, padding: 12, alignItems: 'center', gap: 2 },
  errorTitle: { fontFamily: font.extrabold, fontSize: 13, color: color.text },
  errorBody: { fontFamily: font.semibold, fontSize: 11.5, color: color.text2, textAlign: 'center' },
  footer: { textAlign: 'center', fontFamily: font.semibold, fontSize: 10.5, color: color.text3, marginTop: 6, lineHeight: 15 },
  footerStrong: { color: color.text2, fontFamily: font.extrabold },
  link: { color: color.text2, textDecorationLine: 'underline' },
});
