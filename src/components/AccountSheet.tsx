// Account sheet (F7.3, the design's "Account" behind ⚙): who you signed in with and the wallet, exporting the deposit
// wallet key through Privy's modal when this session can (#352), sound, legal, sign out, and delete, whose confirm
// warns about held cards and balance (the server keeps the account for 30 days). The daily capsule reminder is gone
// with the daily free pull (#376). Shipment updates and restock alerts stay off the sheet (#350); their prefs stay on
// disk. Terms and Privacy open the interim drafts (#354). Shipping is not a policy row. The export row is present only
// when `exportDepositWallet` is set — the web Privy path, and only for a Privy embedded Solana deposit wallet. The mock
// and the phone leave it unset. This sheet never reveals a key itself. "Copy draw receipts" (#418) is present only when the
// device holds MagicBlock draw receipts: it copies them as the app stores them, the text the draw verifier reads.
import React, { useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ApiErrorCode } from '@/api/contract';
import { toApiError, type ApiError } from '@/api/errors';
import { useAuth } from '@/auth/AuthProvider';
import { useSheetIn } from '@/components/useSheetIn';
import { dayMonthYear, PENDING_COUNT, shortAddress } from '@/format';
import { drawReceiptsExport } from '@/state/drawReceipts';
import { balanceText, useSession } from '@/state/session';
import { color, radius, space } from '@/theme/tokens';
import { Backdrop } from '@/components/Backdrop';
import { copyText } from '@/components/copyText';
import { openLegal, PRIVACY_URL, TERMS_URL } from '@/legal/urls';
import { font } from '@/theme/fonts';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
/** What a failed delete says: what to do about the delete (`errorCopy` is written for pulls and reassures about capsules).
 *  UNREADABLE is not "that did not go through" — the request left and only the body could not be read, so it may have landed. */
function deleteErrorCopy(code: ApiErrorCode): string {
  if (code === 'NETWORK') return 'No connection. Check your connection and try again.';
  if (code === 'UNAUTHENTICATED') return 'You were signed out. Sign in again, then try again.';
  if (code === 'UNREADABLE') return 'We could not read the reply. Try again — if it already went through, the closing date will show.';
  return 'That did not go through. Try again in a moment.';
}

type Deletion = { step: 'idle' } | { step: 'asking' } | { step: 'sending' } | { step: 'failed'; error: ApiError };

/** A settings row: a switch when it has `checked`, otherwise a button, disabled when it has nowhere to go (coming soon) or while
 *  the sheet is busy. */
function Row({ label, onPress, right, soon, last, checked, disabled }: { label: string; onPress?: () => void; right?: React.ReactNode; soon?: boolean; last?: boolean; checked?: boolean; disabled?: boolean }) {
  const off = !onPress || !!disabled;
  const isSwitch = checked !== undefined;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole={isSwitch ? 'switch' : 'button'}
      accessibilityLabel={label}
      accessibilityValue={soon ? { text: 'coming soon' } : undefined}
      accessibilityState={isSwitch ? { checked } : { disabled: off }}
      style={[s.row, !last && s.rowRule]}
    >
      <Text style={s.rowText}>{label}</Text>
      {soon ? <Text style={s.soon}>coming soon</Text> : right}
    </Pressable>
  );
}

// Withdraw is deferred past launch (Ben, 10 Oct): no real build has one, so the delete warning points at the deposit-key
// export where this sheet offers it, and where it does not, it says the balance cannot leave yet and is not forfeited.
const DELETE_KEEP = {
  asking: {
    exit: 'To keep your balance, export your deposit wallet key above first — shipping cards home is coming soon. Anything left after 30 days is forfeited.',
    none: 'Moving your balance out is coming soon, and nothing is forfeited until it is. Shipping cards home is coming soon too.',
  },
  closing: {
    exit: 'To keep your balance, export your deposit wallet key above before then — shipping cards home is coming soon. Anything left is forfeited.',
    none: 'Moving your balance out is coming soon, and nothing is forfeited until it is. Shipping cards home is coming soon too.',
  },
} as const;

const EXPORT_COPY = 'This deposit key is yours. Exporting it is self-custody and cannot be undone. Do not share it. Import it in Phantom or Backpack. Gotchapon cannot show it again after the window closes.';

/** The deposit pubkey sits above the button, so it is on screen before Privy's modal opens. */
function DepositKeyExport({ address, onPress, disabled, note }: { address: string; onPress: () => void; disabled?: boolean; note: string | null }) {
  return (
    <View style={s.exportBlock}>
      <Text testID="export-deposit-address" style={s.exportAddress} selectable accessibilityLabel="Deposit wallet address">{address}</Text>
      <Text style={s.exportCopy}>{EXPORT_COPY}</Text>
      <Row label="Export deposit wallet key" onPress={onPress} disabled={disabled} last />
      {note ? <Text style={s.exportNote} accessibilityRole="alert">{note}</Text> : null}
    </View>
  );
}

export function AccountSheet({ onClose }: { onClose: () => void }) {
  const auth = useAuth();
  const { me, holdings, balanceUsd, balanceKnown, muted, toggleMuted, accountClosing, scheduleDeletion } = useSession();
  const insets = useSafeAreaInsets();
  const sheetIn = useSheetIn();
  const [deletion, setDeletion] = useState<Deletion>({ step: 'idle' });
  const [exportNote, setExportNote] = useState<string | null>(null);
  // Read once per open: receipts are added by a prepare, and the sheet is not open during one.
  const [hasReceipts] = useState(() => drawReceiptsExport() !== null);
  const [receiptsNote, setReceiptsNote] = useState<{ ok: boolean; text: string } | null>(null);
  const copies = useRef(0); // only the latest press's answer is shown

  const wallet = auth.wallet ?? me?.wallet ?? null;
  // The provider sets this only for a Privy embedded Solana deposit wallet, and the address it exports
  // is `auth.wallet` — not `me.wallet`, and not the external login wallet.
  const showExport = typeof auth.exportDepositWallet === 'function' && !!auth.wallet;
  const held = Object.values(holdings).reduce((n, h) => n + h.qty, 0);
  // While a delete request is out nothing closes the sheet or backs out, so its answer lands where the user is looking.
  const busy = deletion.step === 'sending';
  const gate = (style: StyleProp<ViewStyle>) => ({ disabled: busy, style: [style, busy && s.dim], accessibilityRole: 'button' as const, accessibilityState: { disabled: busy } });
  const close = () => { if (!busy) onClose(); };
  const signOut = () => { onClose(); auth.signOut(); };
  const startExport = () => {
    const run = auth.exportDepositWallet;
    if (!run || busy) return;
    setExportNote(null);
    void run().catch(() => {
      setExportNote('The export window did not finish. You can try again.');
    });
  };
  const copyReceipts = () => {
    const out = drawReceiptsExport();
    if (!out) return;
    const press = ++copies.current;
    void copyText(out.text).then((ok) => {
      if (press !== copies.current) return;
      setReceiptsNote(ok ? { ok, text: `Copied ${plural(out.count, 'draw receipt')}.` } : { ok, text: 'Could not copy. Try again.' });
    });
  };
  const confirmDelete = () => {
    setDeletion({ step: 'sending' });
    scheduleDeletion().then(
      () => setDeletion({ step: 'idle' }), // the session now holds the closing date
      (e) => setDeletion({ step: 'failed', error: toApiError(e) }),
    );
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={close} testID="account-sheet">
      <Backdrop style={s.backdrop} onPress={close} label="Close account" />
      <Animated.View style={[s.sheet, sheetIn]}>
        <View style={s.head}>
          <Text style={s.title}>Account</Text>
          <Pressable onPress={close} {...gate(s.close)} accessibilityLabel="Close" hitSlop={8}><Text style={s.closeText}>✕</Text></Pressable>
        </View>
        <ScrollView contentContainerStyle={[s.body, { paddingBottom: 26 + insets.bottom }]} showsVerticalScrollIndicator={false}>
          <View style={s.idCard} testID="account-identity">
            <LinearGradient colors={['#9945FF', '#14F195']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.avatar} />
            <View style={s.idCopy}>
              <Text style={s.idTitle}>{auth.provider === 'wallet'
                ? (auth.loginWallet && auth.loginWallet.name !== 'connected wallet' ? `Signed in with ${auth.loginWallet.name}` : 'Signed in with your wallet')
                : auth.provider ? `Signed in with ${auth.provider}` : 'Signed in'}</Text>
              {/* "Solana" only as the wallet's network label (CLAUDE.md vocabulary rule). The address is the embedded deposit wallet for every door.
                  The two lines (Privy deposit, then the sign-in wallet) sit in their own block so they are not flush to the card (#350). */}
              <View style={s.idAddresses} testID="account-addresses">
                <Text style={s.idSub} numberOfLines={1}>{wallet ? `${shortAddress(wallet)} · Solana · Privy` : 'Solana · Privy'}</Text>
                {auth.provider === 'wallet' && auth.loginWallet ? (
                  <Text style={s.idSub} numberOfLines={1}>{`${shortAddress(auth.loginWallet.address)} · ${auth.loginWallet.name} · sign-in only, not a deposit address`}</Text>
                ) : null}
              </View>
            </View>
          </View>

          <View style={s.group}>
            {showExport && auth.wallet ? (
              <DepositKeyExport address={auth.wallet} onPress={startExport} disabled={busy} note={exportNote} />
            ) : null}
            {auth.provider === 'wallet' ? (
              <Row label="Disconnect" onPress={signOut} />
            ) : null}
            <Row label="Sound" checked={!muted} onPress={toggleMuted} last right={<Text style={[s.sound, muted && s.soundOff]}>{muted ? 'Sound off' : 'Sound on'}</Text>} />
          </View>

          <View style={s.group}>
            {hasReceipts ? (
              <View style={s.rowRule}>
                <Row label="Copy draw receipts" onPress={copyReceipts} last />
                {receiptsNote ? (
                  <Text style={[s.receiptsNote, !receiptsNote.ok && s.receiptsFailed]} accessibilityRole="alert">{receiptsNote.text}</Text>
                ) : null}
              </View>
            ) : null}
            <Row label="Terms" onPress={() => openLegal(TERMS_URL)} />
            <Row label="Privacy" onPress={() => openLegal(PRIVACY_URL)} last />
          </View>

          <Pressable onPress={signOut} {...gate(s.signOut)} accessibilityLabel="Sign out">
            <Text style={s.signOutText}>Sign out</Text>
          </Pressable>

          {accountClosing ? (
            <View style={s.delBox} accessibilityRole="alert">
              <Text style={s.delTitle}>Account closing</Text>
              <Text style={s.delBody}>Your account closes on <Text style={s.delStrong}>{dayMonthYear(accountClosing)}</Text>. {DELETE_KEEP.closing[showExport ? 'exit' : 'none']}</Text>
            </View>
          ) : deletion.step === 'idle' ? (
            <Pressable onPress={() => setDeletion({ step: 'asking' })} accessibilityRole="button" accessibilityLabel="Delete account" hitSlop={8}>
              <Text style={s.delLink}>Delete account</Text>
            </Pressable>
          ) : (
            <View style={s.delBox}>
              <Text style={s.delTitle}>Delete account?</Text>
              <Text style={s.delBody}>You hold <Text style={s.delStrong}>{plural(held, 'card')}</Text> and <Text style={s.delStrong}>{balanceKnown ? balanceText(balanceUsd) : PENDING_COUNT}</Text>. {DELETE_KEEP.asking[showExport ? 'exit' : 'none']}</Text>
              {deletion.step === 'failed' ? <Text style={s.delError} accessibilityRole="alert">{deleteErrorCopy(deletion.error.code)}</Text> : null}
              <View style={s.delActions}>
                <Pressable onPress={() => setDeletion({ step: 'idle' })} {...gate(s.keepBtn)} accessibilityLabel="Keep account"><Text style={s.keepText}>Keep account</Text></Pressable>
                <Pressable onPress={confirmDelete} {...gate(s.delBtn)} accessibilityLabel="Delete in 30 days">
                  <Text style={s.delBtnText}>Delete in 30 days</Text>
                </Pressable>
              </View>
            </View>
          )}
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(3,5,12,0.72)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '92%', backgroundColor: 'rgba(18,24,45,0.96)', borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 16, paddingHorizontal: 18, paddingBottom: 8 },
  title: { fontFamily: font.black, fontSize: 18, color: color.text },
  close: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', backgroundColor: 'rgba(255,255,255,0.07)', alignItems: 'center', justifyContent: 'center' },
  closeText: { fontSize: 14, color: color.text2 },
  body: { paddingTop: 4, paddingHorizontal: 18, gap: 10 },
  idCard: { flexDirection: 'row', gap: space.md, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: color.hairline, borderRadius: radius.card, paddingVertical: space.gutter, paddingHorizontal: 18 },
  avatar: { width: 42, height: 42, borderRadius: 21 },
  idCopy: { flex: 1, minWidth: 0 },
  idTitle: { fontFamily: font.extrabold, fontSize: 14, color: color.text },
  idAddresses: { marginTop: space.sm, gap: space.sm, paddingVertical: space.xs, paddingHorizontal: space.xs },
  idSub: { fontFamily: font.mono, fontSize: 11.5, lineHeight: 17, color: color.text2 },
  exportBlock: { paddingTop: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)' },
  exportAddress: { fontFamily: font.mono, fontSize: 11.5, color: color.text, lineHeight: 16 },
  exportCopy: { fontFamily: font.semibold, fontSize: 12, color: color.text2, lineHeight: 17, marginTop: 6 },
  exportNote: { fontFamily: font.semibold, fontSize: 12, color: '#FF9A8C', paddingBottom: 8 },
  receiptsNote: { fontFamily: font.semibold, fontSize: 12, color: color.text2, paddingBottom: 8 },
  receiptsFailed: { color: '#FF9A8C' },
  group: { backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: color.hairline, borderRadius: radius.card, paddingVertical: 4, paddingHorizontal: 14 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, minHeight: 42 },
  rowRule: { borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)' },
  rowText: { fontFamily: font.semibold, fontSize: 13, color: color.text },
  soon: { fontFamily: font.semibold, fontSize: 11, color: color.text3 },
  sound: { fontFamily: font.semibold, fontSize: 12, color: color.text2 },
  soundOff: { color: 'rgba(159,176,216,0.4)', textDecorationLine: 'line-through' },
  signOut: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: radius.button, padding: 12, alignItems: 'center' },
  signOutText: { fontFamily: font.extrabold, fontSize: 14, color: color.text },
  delLink: { textAlign: 'center', fontFamily: font.semibold, fontSize: 12, color: color.text3, textDecorationLine: 'underline' },
  delBox: { backgroundColor: 'rgba(255,107,91,0.12)', borderWidth: 1, borderColor: 'rgba(255,107,91,0.45)', borderRadius: radius.card, padding: 12 },
  delTitle: { fontFamily: font.extrabold, fontSize: 13, color: '#FF9A8C' },
  delBody: { fontFamily: font.semibold, fontSize: 12, color: color.text2, marginTop: 4, marginBottom: 10, lineHeight: 17 },
  delStrong: { fontFamily: font.extrabold, color: color.text },
  delError: { fontFamily: font.semibold, fontSize: 12, color: '#FF9A8C', marginBottom: 10 },
  delActions: { flexDirection: 'row', gap: 6 },
  keepBtn: { flex: 1, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 10, padding: 9, alignItems: 'center' },
  keepText: { fontFamily: font.extrabold, fontSize: 12, color: color.text },
  delBtn: { backgroundColor: color.danger, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 12, alignItems: 'center' },
  delBtnText: { fontFamily: font.extrabold, fontSize: 12, color: '#FFFFFF' },
  dim: { opacity: 0.6 },
});
