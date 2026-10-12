import React, { useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { newIdempotencyKey } from '@/api/http';
import { toApiError } from '@/api/errors';
import { USDC_BASE } from '@/api/contract';
import { shortAddress } from '@/format';
import { font } from '@/theme/fonts';
import { inputFontSize } from '@/theme/inputs';
import { PRODUCT_NAME } from '@/brand/name';
import { color, radius } from '@/theme/tokens';

const AMOUNT = /^\d+([.,]\d{1,2})?$/;

// The idempotency key stays for the life of this amount. A dead signature is rebuilt by the server under that
// same key (#266); a lost response or a short balance keeps the signed bytes, so a new key would be a second deposit.
function depositError(code: string): string {
  if (code === 'INSUFFICIENT_FUNDS') {
    return 'That is more test USDC than the connected wallet can send. Try again uses the same deposit request.';
  }
  if (code === 'EXPIRED') {
    return 'The signing request expired. Try again builds a fresh transfer for this amount.';
  }
  if (code === 'TX_MISMATCH') {
    return 'That transfer did not go through. Nothing was sent. Try again builds a fresh transfer for this amount.';
  }
  return 'The deposit did not finish. Check both wallet balances before trying again. Try again uses the same deposit request.';
}

export type DepositSheetProps = {
  open: boolean;
  source: string;
  destination: string;
  onClose: () => void;
  onDeposit: (amountBase: number, idem: string) => Promise<void>;
};

export function DepositSheet({ open, source, destination, onClose, onDeposit }: DepositSheetProps) {
  const [amountText, setAmountText] = useState('');
  const [step, setStep] = useState<'form' | 'busy' | 'sent'>('form');
  const [error, setError] = useState<string | null>(null);
  const [idem, setIdem] = useState(() => newIdempotencyKey());
  const inFlight = useRef(false);
  const typed = amountText.trim();
  const cents = AMOUNT.test(typed) ? Math.round(Number(typed.replace(',', '.')) * 100) : NaN;
  const amountBase = cents * 10_000;
  const valid = Number.isSafeInteger(amountBase) && amountBase > 0 && Boolean(source && destination);
  const amount = valid ? `$${(amountBase / USDC_BASE).toFixed(2)}` : '$0.00';

  const edit = (value: string) => {
    setAmountText(value);
    if (error) { setError(null); setIdem(newIdempotencyKey()); }
  };
  const close = () => {
    if (step === 'busy') return;
    setStep('form'); setError(null); setAmountText(''); setIdem(newIdempotencyKey());
    onClose();
  };
  const confirm = async () => {
    if (inFlight.current || !valid) return;
    inFlight.current = true;
    setStep('busy'); setError(null);
    try {
      await onDeposit(amountBase, idem);
      setStep('sent');
    } catch (cause) {
      setStep('form');
      setError(depositError(toApiError(cause).code));
    } finally {
      inFlight.current = false;
    }
  };

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={close} testID="deposit-sheet">
      <View style={s.scrim}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.kav}>
          <View style={s.sheet}>
            <View style={s.head}>
              <Text style={s.title}>{step === 'sent' ? 'Deposit sent' : 'Deposit test USDC'}</Text>
              <Pressable onPress={close} disabled={step === 'busy'} hitSlop={8} style={[s.close, step === 'busy' && { opacity: 0.4 }]} accessibilityRole="button" accessibilityLabel="Close"><Text style={s.closeText}>×</Text></Pressable>
            </View>
            {step === 'sent' ? (
              <>
                <Text style={s.sentBig}>{amount} sent</Text>
                <Text style={s.sub}>Your {PRODUCT_NAME} balance will update after Solana confirms the transfer.</Text>
                <Pressable onPress={close} style={s.primary} accessibilityRole="button"><Text style={s.primaryText}>Done</Text></Pressable>
              </>
            ) : (
              <>
                <Text style={s.sub}>The API builds and broadcasts this transfer. Your connected wallet is the only signer and pays the Solana network fee.</Text>
                <Text style={s.label}>Amount (USDC)</Text>
                <TextInput value={amountText} onChangeText={edit} placeholder="0.00" placeholderTextColor={color.text3} keyboardType="decimal-pad" editable={step === 'form'} style={s.input} accessibilityLabel="Deposit amount in USDC" />
                <View style={s.line}><Text style={s.lineLabel}>From connected wallet</Text><Text style={s.lineValue}>{shortAddress(source)}</Text></View>
                <View style={s.line}><Text style={s.lineLabel}>To {PRODUCT_NAME} wallet</Text><Text style={s.lineValue}>{shortAddress(destination)}</Text></View>
                <View style={s.line}><Text style={s.lineLabel}>Token</Text><Text style={s.lineValue}>Development USDC</Text></View>
                {error ? <Text style={s.error}>{error}</Text> : null}
                <Pressable onPress={() => { void confirm(); }} disabled={!valid || step === 'busy'} style={[s.primary, (!valid || step === 'busy') && { opacity: 0.5 }]} accessibilityRole="button" accessibilityLabel={error ? 'Try deposit again' : 'Sign deposit'}>
                  {step === 'busy' ? <ActivityIndicator color={color.inkOnMint} /> : <Text style={s.primaryText}>{error ? 'Try again' : valid ? `Sign and deposit ${amount}` : 'Enter an amount'}</Text>}
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
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, marginTop: 4 },
  lineLabel: { fontFamily: font.semibold, fontSize: 12.5, color: color.text2 },
  lineValue: { fontFamily: font.extrabold, fontSize: 12.5, color: color.text, textAlign: 'right' },
  error: { fontFamily: font.semibold, fontSize: 12, color: color.danger, marginTop: 2, lineHeight: 16 },
  primary: { marginTop: 10, backgroundColor: color.mint, borderRadius: 14, paddingVertical: 13, alignItems: 'center', justifyContent: 'center', minHeight: 46 },
  primaryText: { fontFamily: font.black, fontSize: 14, color: color.inkOnMint },
  sentBig: { fontFamily: font.black, fontSize: 26, color: color.text, marginTop: 4 },
});
