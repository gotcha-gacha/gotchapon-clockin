// Right-edge ODDS tab on idle Pull. Recording is the chrome: flush-right dark tab, white drag
// handle, stacked upright ODDS. Tap or drag left opens the odds sleeve. Hidden during the ritual.
// Painted on the edge from the first frame. The pager clips past the edge, and the tab is 32 wide,
// so a resting translateX of 48 left it fully off-screen until withTiming ran.
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { color } from '@/theme/tokens';
import { font } from '@/theme/fonts';
import { useGestureScale } from '@/state/appFrame';

const TAB_W = 32;
const OPEN_PX = 40;

export function OddsEdgeTab({ onOpen, onActive }: { onOpen: () => void; onActive: (active: boolean) => void }) {
  const pull = useSharedValue(0);
  const stretch = useAnimatedStyle(() => ({ width: TAB_W + pull.get() }));
  const k = useGestureScale(); // glass pixels → the tab's own points (see useGestureScale)
  const pan = Gesture.Pan()
    .withTestId('odds-tab-pan')
    .minDistance(0)
    .onBegin(() => { runOnJS(onActive)(true); })
    .onUpdate((e) => { pull.set(Math.max(0, -e.translationX * k)); })
    .onEnd((e) => {
      if (pull.get() >= OPEN_PX || e.translationX * k < -OPEN_PX || e.velocityX * k < -500) runOnJS(onOpen)();
      else pull.set(withTiming(0, { duration: 200 }));
    })
    .onFinalize(() => { runOnJS(onActive)(false); });
  return (
    <View pointerEvents="box-none" style={s.wrap}>
      <GestureDetector gesture={pan}>
        <Animated.View style={[s.tab, stretch]}>
          <Pressable
            onPress={onOpen}
            testID="odds-tab"
            accessibilityRole="button"
            accessibilityLabel="Open odds"
            style={({ pressed }) => [s.hit, pressed && s.pressed]}
          >
            <View style={s.handle} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden />
            <View style={s.word}>
              {['O', 'D', 'D', 'S'].map((ch, i) => <Text key={i} style={s.letter}>{ch}</Text>)}
            </View>
          </Pressable>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', right: 0, top: '44%', zIndex: 6 },
  tab: {
    minWidth: TAB_W,
    alignItems: 'flex-start',
    borderTopLeftRadius: 14,
    borderBottomLeftRadius: 14,
    backgroundColor: 'rgba(18,24,45,0.86)',
    borderWidth: 1,
    borderRightWidth: 0,
    borderColor: 'rgba(255,255,255,0.18)',
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 24,
    shadowOffset: { width: -8, height: 0 },
    elevation: 8,
  },
  hit: { width: TAB_W, alignItems: 'center', gap: 8, paddingTop: 12, paddingBottom: 12, paddingLeft: 6, paddingRight: 6 },
  pressed: { transform: [{ translateX: 2 }, { scale: 0.97 }] },
  handle: { width: 12, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.7)' },
  word: { alignItems: 'center', gap: 1 },
  letter: { fontFamily: font.black, fontSize: 10.5, lineHeight: 12, color: color.text },
});
