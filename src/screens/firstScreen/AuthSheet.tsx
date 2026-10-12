// Sign-in, as a sheet over the first screen (#211; design/README.md: "Privy sign-in is now a sheet (`authSheet`) that rises
// over it"). Everything inside is what the old full-screen sign-in wall carried: the error box, the two-step busy state that
// #6 specifies, Apple / Google / email, and the Privy footer with Terms · Privacy (no "18+": there is no age gate, #116;
// no Odds: the sleeve is hidden for v0, #332). Both words open the interim drafts (#354).
//
// A Modal, like the account sheet, so `esc`, the focus trap and the desktop cabinet's portal CSS all come for free. It cannot
// be closed while Privy is answering: the busy copy has to end somewhere the user is looking.
//
// Android (11 Oct 2026, for the judging build) differs twice. No Apple button: Privy runs Apple there as a browser flow with the
// mobile client, whose Apple client id is the iOS bundle id, and Apple rejects it. And the keyboard: SDK 57 is edge to edge, so
// the Modal's window is not resized for it and the email field and its button sat under the keys; the sheet stands in a
// KeyboardAvoidingView there. iOS is as it was; the web is AuthSheet.web.tsx.
import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Backdrop } from '@/components/Backdrop';
import { useAuth } from '@/auth/AuthProvider';
import { errorCopy } from '@/api/errors';
import type { ApiErrorCode } from '@/api/contract';
import { LegalLink } from '@/legal/LegalLink';
import { AppleMark, GoogleMark } from '@/screens/firstScreen/BrandMarks';
import { color, radius } from '@/theme/tokens';
import { inputFontSize } from '@/theme/inputs';
import { font } from '@/theme/fonts';

/** What a failed sign-in says. `errorCopy` is written for the pull flow — its UNKNOWN body promises that "a paid pull is
 *  never lost — it resolves to a card or a refund", which on this sheet is told to someone who has not signed in and has
 *  certainly not paid (review). The codes that mean the same thing here keep their own copy; the rest get sign-in words.
 *  Same shape, and the same reason, as `prepareErrorCopy` and the wallet sheet's own copy. */
function signInCopy(code: ApiErrorCode): { title: string; body: string } {
  if (code === 'NETWORK') return errorCopy.NETWORK;
  if (code === 'GEO_BLOCKED') return errorCopy.GEO_BLOCKED;
  return { title: 'We could not sign you in', body: 'Nothing was created and nothing was charged. Try again, or use another way in.' };
}

export function AuthSheet({ onClose }: { onClose: () => void }) {
  const auth = useAuth();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [hint, setHint] = useState('');
  const busy = auth.stage === 'busy';
  const android = Platform.OS === 'android';

  // Privy sends a code to the inbox and then wants it back; the mock has no inbox and signs in on the spot, and says so by
  // answering false. Either way the screen only ever asks for what it was told to ask for.
  const askForCode = async () => {
    // Answered here, under the field it is about, rather than as an error card: the provider's guard behind this says the
    // same thing, but it arrives as a generic code and the card would talk about a sign-in that never began.
    if (!email.trim().includes('@')) { setHint('Enter your email address.'); return; }
    setHint('');
    setCodeSent(await auth.sendEmailCode(email));
    setCode('');
  };
  const close = () => { if (!busy) onClose(); };

  // The design's `pbUp`, written out rather than taken from `useSheetIn`, which plays its own click: this sheet is already
  // announced — by the capsule dropping into the mouth (`pop`), or by the press on "Already collecting?" (`click`).
  const rise = useSharedValue(40);
  useEffect(() => { rise.set(withTiming(0, { duration: 400, easing: Easing.bezier(0.2, 0.9, 0.2, 1) })); }, [rise]);
  const sheetIn = useAnimatedStyle(() => ({ transform: [{ translateY: rise.get() }] }));

  const body = (
    <Animated.View testID="auth-sheet-body" style={[s.sheet, android && s.sheetInFlow, { paddingBottom: insets.bottom + 26 }, sheetIn]}>
      <View style={s.head}>
        <Text style={s.title}>{busy ? 'Setting you up' : 'Start pulling'}</Text>
        {busy ? null : (
          <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8} style={s.close}>
            <Text style={s.closeText}>✕</Text>
          </Pressable>
        )}
      </View>
      {auth.error ? (
        <View style={s.errorBox} accessibilityRole="alert">
          <Text style={s.errorTitle}>{signInCopy(auth.error.code).title}</Text>
          <Text style={s.errorBody}>{signInCopy(auth.error.code).body}</Text>
        </View>
      ) : null}
      {busy ? (
        <View style={s.busy}>
          <View style={s.busyRow}><View style={s.busyDot} /><Text style={s.busyText}>{auth.step}</Text></View>
          <Text style={s.busySub}>Privy is creating a Solana wallet for you — no seed phrase, nothing to write down.</Text>
        </View>
      ) : (
        <>
          {/* Not on Android at all (see the top of the file): a disabled button there would promise what is not coming. */}
          {android ? null : (
            <>
              <Pressable
                onPress={() => auth.signIn('Apple')}
                disabled={!auth.appleReady}
                accessibilityState={{ disabled: !auth.appleReady }}
                style={({ pressed }) => [s.btn, s.apple, pressed && s.pressed, !auth.appleReady && s.off]}
                accessibilityRole="button"
              >
                <View style={s.btnRow}>
                  <AppleMark />
                  <Text style={[s.btnText, { color: color.room }]}>Continue with Apple</Text>
                </View>
              </Pressable>
              {/* Ben, 16 Sept: the Privy dashboard has no Apple Sign In. The button stays visible and says why rather than
                  vanishing, so someone looking for it learns it is coming rather than that it is gone. */}
              {auth.appleReady ? null : <Text style={s.appleNote}>Apple sign-in is not set up yet — use Google or email.</Text>}
            </>
          )}
          <Pressable onPress={() => { setCodeSent(false); void auth.signIn('Google'); }} style={({ pressed }) => [s.btn, s.google, pressed && s.pressed]} accessibilityRole="button">
            <View style={s.btnRow}>
              <GoogleMark />
              <Text style={s.btnText}>Continue with Google</Text>
            </View>
          </Pressable>
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
        </>
      )}
      <Text style={s.footer}>Sign-in and wallet by <Text style={s.footerStrong}>Privy</Text>. You get a Solana wallet automatically — deposit USDC to it to play. <LegalLink doc="terms" style={s.link} /> · <LegalLink doc="privacy" style={s.link} /></Text>
    </Animated.View>
  );

  return (
    <Modal visible transparent animationType="fade" onRequestClose={close} testID="auth-sheet">
      <Backdrop style={s.backdrop} onPress={close} label="Close sign in" />
      {/* Android: the sheet sits at the foot of this view, in its flow, and the view's bottom padding grows by the keyboard. Taps
          above the sheet pass through it to the backdrop. */}
      {android ? <KeyboardAvoidingView testID="auth-sheet-keyboard" behavior="padding" style={s.keyboard} pointerEvents="box-none">{body}</KeyboardAvoidingView> : body}
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(3,5,12,0.55)' },
  // Same inset as the web sheet (#346): title, close, and the Apple / Google / email row
  // sit clear of the rim. 26px sides, 22px top.
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(18,24,45,0.97)', borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.16)', paddingHorizontal: 26, paddingTop: 22, gap: 8 },
  // Android: an absolute sheet is placed against its parent's padding box, so the keyboard's padding would not move it.
  keyboard: { flex: 1, justifyContent: 'flex-end' },
  sheetInFlow: { position: 'relative' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
  title: { fontFamily: font.black, fontSize: 19, color: color.text, letterSpacing: -0.2 },
  close: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.07)' },
  closeText: { fontFamily: font.bold, fontSize: 15, color: color.text2 },
  btn: { borderRadius: 14, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  apple: { backgroundColor: '#F7F8FC' },
  google: { backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.22)', paddingVertical: 13 },
  pressed: { transform: [{ scale: 0.97 }] },
  off: { opacity: 0.5 },
  hint: { fontFamily: font.semibold, fontSize: 12, color: color.text2, marginTop: -2 },
  appleNote: { fontFamily: font.semibold, fontSize: 11, color: color.text3, textAlign: 'center', marginTop: -4 },
  btnText: { fontFamily: font.extrabold, fontSize: 15, color: color.text },
  btnRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  emailRow: { flexDirection: 'row', gap: 8 },
  input: { flex: 1, minWidth: 0, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.18)', borderRadius: radius.button, paddingVertical: 11, paddingHorizontal: 12, fontFamily: font.bold, fontSize: inputFontSize(13), backgroundColor: 'rgba(255,255,255,0.05)', color: color.text },
  sendBtn: { borderRadius: radius.button, paddingVertical: 11, paddingHorizontal: 14, backgroundColor: color.yellow, justifyContent: 'center' },
  sendText: { fontFamily: font.extrabold, fontSize: 13, color: color.inkOnYellow },
  busy: { backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: color.glassBorder, borderRadius: 14, padding: 16, alignItems: 'center' },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  busyDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: color.mint, shadowColor: color.mint, shadowOpacity: 1, shadowRadius: 10 },
  busyText: { fontFamily: font.extrabold, fontSize: 13, color: color.text },
  busySub: { fontFamily: font.semibold, fontSize: 11.5, color: color.text2, marginTop: 4, textAlign: 'center' },
  errorBox: { backgroundColor: 'rgba(255,107,91,0.12)', borderWidth: 1, borderColor: 'rgba(255,107,91,0.45)', borderRadius: 14, padding: 12, alignItems: 'center', gap: 2 },
  errorTitle: { fontFamily: font.extrabold, fontSize: 13, color: color.text },
  errorBody: { fontFamily: font.semibold, fontSize: 11.5, color: color.text2, textAlign: 'center' },
  footer: { textAlign: 'center', fontFamily: font.semibold, fontSize: 10.5, color: color.text3, marginTop: 2, lineHeight: 15 },
  footerStrong: { color: color.text2, fontFamily: font.extrabold },
  link: { color: color.text2, textDecorationLine: 'underline' },
});
