// Withdraw sheet (F7.1, design "Withdraw"): address, amount, $0.01 network fee, net → confirm → Sent.
// The transfer leaves the user's own wallet (Privy session signer, F7.4); the mock debits the balance.
// The destination is checked as an address rather than as a pattern (`isSolanaAddress`, #187): base58 of exactly 32 bytes,
// so a string that merely looks like one — the app's own mock fixture did, at 31 bytes — can never be confirmed.
// Money rules: amounts are whole cents, so the value on the button and the receipt is the value sent, and
// the bound is the USDC balance (only USDC is sent). The idempotency key survives a failed attempt so
// "Try again" repeats the same request; any edit after a failure is a new intent with a new key. One
// attempt in flight at a time; the sheet cannot close while one is. Failure copy is withdraw-specific
// reviewed copy, never a raw error message.
import React, { useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { toApiError } from '@/api/errors';
import { isSolanaAddress } from '@/api/solanaAddress';
import type { ApiErrorCode } from '@/api/contract';
import { newIdempotencyKey } from '@/api/http';
import { color, radius } from '@/theme/tokens';
import { inputFontSize } from '@/theme/inputs';
import { font } from '@/theme/fonts';

const FEE_CENTS = 1;
const AMOUNT = /^\d+([.,]\d{1,2})?$/; // dollars and at most two decimals; no exponent, hex or thousands separators
const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

// Failure copy for money leaving the wallet (the pull flow's errorCopy talks about capsules and deposits).
const WITHDRAW_COPY: Partial<Record<ApiErrorCode, string>> = {
  INSUFFICIENT_FUNDS: "That's more than your USDC balance.",
  NETWORK: 'No connection. Check your balance before trying again.',
  TX_NOT_FOUND: 'The network is slow. Check your balance in a minute before trying again.',
};
const withdrawCopy = (code: ApiErrorCode) => WITHDRAW_COPY[code] ?? 'Something went wrong. Check your balance before trying again.';

export type WithdrawSheetProps = {
  open: boolean;
  /** USDC the wallet can send (USDT is not converted). */
  availableUsd: number;
  onClose: () => void;
  /** Sends `usd` to `address`; `idem` identifies the intent so a retry is safe. */
  onWithdraw: (usd: number, address: string, idem: string) => Promise<void>;
};

export function WithdrawSheet({ open, availableUsd, onClose, onWithdraw }: WithdrawSheetProps) {
  const [address, setAddress] = useState('');
  const [amountText, setAmountText] = useState('');
  const [step, setStep] = useState<'form' | 'busy' | 'sent'>('form');
  const [error, setError] = useState<string | null>(null);
  const [idem, setIdem] = useState(() => newIdempotencyKey());
  const inFlight = useRef(false);
  const attempt = useRef(0);
  const to = address.trim();
  const typed = amountText.trim();
  const amountCents = AMOUNT.test(typed) ? Math.round(Number(typed.replace(',', '.')) * 100) : NaN;
  const availableCents = Math.floor(availableUsd * 100 + 1e-6);
  const netCents = amountCents - FEE_CENTS;
  const valid = isSolanaAddress(to) && Number.isInteger(amountCents) && amountCents > FEE_CENTS && amountCents <= availableCents;

  // Editing after a failed attempt is a new intent: new key, and the "same request" promise no longer applies.
  const edit = (set: (v: string) => void) => (v: string) => { set(v); if (error) { setError(null); setIdem(newIdempotencyKey()); } };
  const close = () => {
    if (step === 'busy') return; // the transfer is in flight: the sheet stays until it settles
    attempt.current += 1; // anything still resolving belongs to an old intent
    setStep('form'); setError(null); setAmountText(''); setAddress('');
    setIdem(newIdempotencyKey()); // the next opening is a new intent
    onClose();
  };
  const confirm = async () => {
    if (inFlight.current || !valid) return; // two taps in one frame are one withdrawal
    inFlight.current = true;
    const mine = ++attempt.current;
    setStep('busy'); setError(null);
    try {
      await onWithdraw(amountCents / 100, to, idem);
      if (attempt.current === mine) setStep('sent');
    } catch (e) {
      if (attempt.current === mine) { setStep('form'); setError(withdrawCopy(toApiError(e).code)); }
    } finally {
      inFlight.current = false;
    }
  };

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={close} testID="withdraw-sheet">
      <View style={s.scrim}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.kav}>
          <View style={s.sheet}>
            <View style={s.head}>
              <Text style={s.title}>{step === 'sent' ? 'Sent' : 'Withdraw'}</Text>
              <Pressable onPress={close} disabled={step === 'busy'} hitSlop={8} style={[s.close, step === 'busy' && { opacity: 0.4 }]} accessibilityRole="button" accessibilityLabel="Close"><Text style={s.closeText}>×</Text></Pressable>
            </View>
            {step === 'sent' ? (
              <>
                <Text style={s.sentBig}>{usd(netCents)} sent</Text>
                <Text style={s.sub}>to {to.slice(0, 4)}…{to.slice(-4)} on Solana. It usually lands within a minute.</Text>
                <Pressable onPress={close} style={s.primary} accessibilityRole="button"><Text style={s.primaryText}>Done</Text></Pressable>
              </>
            ) : (
              <>
                <Text style={s.sub}>{usd(availableCents)} USDC available on Solana</Text>
                <Text style={s.label}>Solana address</Text>
                <TextInput value={address} onChangeText={edit(setAddress)} placeholder="Paste a Solana address" placeholderTextColor={color.text3} autoCapitalize="none" autoCorrect={false} editable={step === 'form'} style={s.input} accessibilityLabel="Solana address" />
                <Text style={s.label}>Amount (USD)</Text>
                <TextInput value={amountText} onChangeText={edit(setAmountText)} placeholder="0.00" placeholderTextColor={color.text3} keyboardType="decimal-pad" editable={step === 'form'} style={s.input} accessibilityLabel="Amount in US dollars" />
                <View style={s.line}><Text style={s.lineLabel}>Network fee</Text><Text style={s.lineValue}>{usd(FEE_CENTS)}</Text></View>
                <View style={s.line}><Text style={s.lineLabel}>You receive</Text><Text style={s.lineValue}>{usd(valid ? netCents : 0)}</Text></View>
                {error ? <Text style={s.error}>{error} Trying again repeats the same request, so it can&apos;t send twice.</Text> : null}
                <Pressable onPress={() => { void confirm(); }} disabled={!valid || step === 'busy'} style={[s.primary, (!valid || step === 'busy') && { opacity: 0.5 }]} accessibilityRole="button" accessibilityLabel={error ? 'Try again' : 'Withdraw'}>
                  {step === 'busy' ? <ActivityIndicator color={color.inkOnMint} /> : <Text style={s.primaryText}>{error ? 'Try again' : valid ? `Withdraw ${usd(amountCents)}` : 'Withdraw'}</Text>}
                </Pressable>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(3,5,12,0.72)', justifyContent: 'flex-end' },
  kav: { width: '100%' },
  sheet: { backgroundColor: color.roomMid, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, borderWidth: 1, borderColor: color.glassBorder, padding: 20, paddingBottom: 36, gap: 8 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
  title: { fontFamily: font.black, fontSize: 18, color: color.text },
  close: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  closeText: { fontFamily: font.bold, fontSize: 18, color: color.text, lineHeight: 20 },
  sub: { fontFamily: font.semibold, fontSize: 12.5, color: color.text2, lineHeight: 17 },
  label: { fontFamily: font.extrabold, fontSize: 11, color: color.text3, letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 6 },
  input: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', borderRadius: radius.button, paddingVertical: 11, paddingHorizontal: 12, fontFamily: font.semibold, fontSize: inputFontSize(14), color: color.text, backgroundColor: 'rgba(255,255,255,0.05)' },
  line: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  lineLabel: { fontFamily: font.semibold, fontSize: 12.5, color: color.text2 },
  lineValue: { fontFamily: font.extrabold, fontSize: 12.5, color: color.text },
  error: { fontFamily: font.semibold, fontSize: 12, color: color.danger, marginTop: 2, lineHeight: 16 },
  primary: { marginTop: 10, backgroundColor: color.mint, borderRadius: 14, paddingVertical: 13, alignItems: 'center', justifyContent: 'center', minHeight: 46 },
  primaryText: { fontFamily: font.black, fontSize: 14, color: color.inkOnMint },
  sentBig: { fontFamily: font.black, fontSize: 26, color: color.text, marginTop: 4 },
});
