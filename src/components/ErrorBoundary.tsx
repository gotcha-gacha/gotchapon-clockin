// The root error boundary (W0.2d, #138). Without one a render error is a white page on the web with no way back (native keeps
// the last tree). It shows the same card as a connection error, with one action: on the web a reload, on native a fresh render
// of the tree. The card says only what is true where it is shown. Native keeps a paid, unopened pull on disk, so it says so.
// The web has nowhere to keep one until the storage seam lands (W0.2b, #136: until then `readPendingPulls` on the web reads
// nothing back, PR #152's review ran it), and Reload is the one action that would drop it: there the card promises nothing.
// When #136 is in, the web line can say it too, but only by reading whether the pull really was saved.
import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { color, radius } from '@/theme/tokens';
import { font } from '@/theme/fonts';
import { captureError, track } from '@/analytics';

type Props = { children: React.ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error) { track('render_error', { message: String(error?.message ?? error).slice(0, 200) }); captureError(error); } // the event for the funnel, the exception for the stack (#143)
  private again = () => {
    const w = globalThis as { location?: { reload?: () => void } };
    if (Platform.OS === 'web' && typeof w.location?.reload === 'function') w.location.reload();
    else this.setState({ error: null });
  };
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View style={s.wrap} accessibilityRole="alert" testID="error-boundary">
        <Text style={s.title}>Something went wrong</Text>
        <Text style={s.body}>{Platform.OS === 'web' ? 'The screen could not be drawn. Reload the page to try again.' : 'The screen could not be drawn. Nothing you paid for is lost: a capsule that has not opened is waiting for you.'}</Text>
        <Pressable onPress={this.again} style={({ pressed }) => [s.btn, pressed && { transform: [{ scale: 0.97 }] }]} accessibilityRole="button">
          <Text style={s.btnText}>{Platform.OS === 'web' ? 'Reload' : 'Try again'}</Text>
        </Pressable>
      </View>
    );
  }
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: color.room, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 10 },
  title: { fontFamily: font.black, fontSize: 18, color: color.text, textAlign: 'center' },
  body: { fontFamily: font.semibold, fontSize: 13, lineHeight: 19, color: color.text2, textAlign: 'center', maxWidth: 300 },
  btn: { marginTop: 10, borderRadius: radius.button, paddingVertical: 13, paddingHorizontal: 26, backgroundColor: color.yellow, borderBottomWidth: 3, borderBottomColor: color.yellowShadow },
  btnText: { fontFamily: font.extrabold, fontSize: 15, color: color.inkOnYellow },
});
