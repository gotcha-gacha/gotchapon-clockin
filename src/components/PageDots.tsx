// Persistent swipe rail for the three-page track (Albums · Pull · Wallet). The solid ground keeps
// navigation legible over card art; labels and custom line icons make every destination explicit
// while the pager remains the primary interaction. Odds is a Pull-page sleeve, not a rail tab.
// The Albums icon carries the existing mint badge for newly filed cards. The Pull icon carries one
// when a capsule is still waiting to open: that banner is drawn on the Pull page only, and a relaunch
// lands on the Binder (#210), so the dot is what keeps the waiting capsule visible from there.
import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import Svg, { Circle, G, Line, Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PAGE, PAGES, useSession, type PageIndex } from '@/state/session';
import { color } from '@/theme/tokens';
import { font } from '@/theme/fonts';

// The labeled rail replaced the design's page dots. `bottom: 70` on the result sheet was that
// short footer; this rail is the tab row plus the home-indicator inset, so an overlay still
// aimed at 70 is painted over by the rail. On a phone, count the hint even after it hides — a
// card that clears this number also clears the hint on the landing page. The web rail never
// draws the line (#327), so it does not reserve those 14pt.
const RAIL_PAD_TOP = 5;
const RAIL_HINT = 14;
/** Handheld swipe affordance. Web tabs are taps, so the line above them is omitted (#327). */
const SWIPE_HINT = Platform.OS !== 'web';
const RAIL_ICON = 24;
const RAIL_GAP = 2;
/** Nunito draws outside a box the size of the font size, and the row used to clip that. */
const RAIL_LABEL = 16;
const RAIL_TAB_PAD_TOP = 6;
const RAIL_TAB_PAD_BOT = 8;
const RAIL_TAB_BORDER = 1;
/** Under the tabs, in addition to the safe area, so the labels are not on the indicator. */
const RAIL_UNDER = 8;
const RAIL_HAIRLINE = 1;
const RAIL_TAB = RAIL_TAB_PAD_TOP + RAIL_ICON + RAIL_GAP + RAIL_LABEL + RAIL_TAB_PAD_BOT + RAIL_TAB_BORDER * 2;

/** How far the rail reaches up from the bottom of the screen. */
export function railHeight(bottomInset: number) {
  return RAIL_PAD_TOP + (SWIPE_HINT ? RAIL_HINT : 0) + RAIL_TAB + RAIL_UNDER + RAIL_HAIRLINE + bottomInset;
}

/** The result sheet's gap above the rail — what `bottom: 70` used to leave over the dots. */
export const RESULT_GAP = 10;

type IconProps = { page: PageIndex; active: boolean };

/** Small, app-native destination icons: binder, capture ball and wallet. */
function PageIcon({ page, active }: IconProps) {
  const ink = active ? color.yellow : color.text2;
  const common = { stroke: ink, strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

  // Decorative: the tab label is the accessible name. A view carries `aria-hidden`, which native
  // turns into accessibilityElementsHidden and the web writes as the attribute. Those RN props on
  // <Svg> are forwarded to the DOM and React warns.
  return (
    <View aria-hidden>
      <Svg testID="page-icon" width={23} height={23} viewBox="0 0 24 24">
        {page === PAGE.albums ? (
          <G {...common} fill="none">
            <Path d="M4.5 5.5c0-1.1.9-2 2-2H11c.7 0 1.3.3 1.7.8.4-.5 1-.8 1.7-.8h3.1c1.1 0 2 .9 2 2v14c0 .5-.5.9-1 .8l-4-.6c-.7-.1-1.3.1-1.8.6-.5-.5-1.1-.7-1.8-.6l-5.4.7c-.5.1-1-.3-1-.8V5.5Z" />
            <Line x1="12.7" y1="4.6" x2="12.7" y2="19.3" />
            <Line x1="7" y1="8" x2="10.2" y2="7.6" />
            <Line x1="15.1" y1="7.6" x2="17.3" y2="8" />
          </G>
        ) : page === PAGE.pull ? (
          <G {...common} fill="none">
            <Circle cx="12" cy="12" r="8.75" />
            <Path d="M3.35 10.8h5.4M15.25 10.8h5.4" />
            <Path d="M3.4 13.2h5.35M15.25 13.2h5.35" opacity={0.55} />
            <Circle cx="12" cy="12" r="3.25" fill={active ? color.yellow : color.roomMid} />
            <Circle cx="12" cy="12" r="1.15" fill={ink} stroke="none" />
            <Path d="M6.4 7.5A7.1 7.1 0 0 1 10 5.3" opacity={0.7} />
          </G>
        ) : (
          <G {...common} fill="none">
            <Path d="M4 7.2h13.8c1.2 0 2.2 1 2.2 2.2v8.1c0 1.2-1 2.2-2.2 2.2H5.5c-1.1 0-2-.9-2-2V6.4c0-1 .7-1.8 1.7-2l10.3-1.8c.6-.1 1.1.3 1.1.9v3.7" />
            <Path d="M14.5 10.6H20v5h-5.5a2.5 2.5 0 0 1 0-5Z" />
            <Circle cx="15" cy="13.1" r=".8" fill={ink} stroke="none" />
          </G>
        )}
      </Svg>
    </View>
  );
}

function RailItem({ index, active, badge, locked, onPress }: { index: PageIndex; active: boolean; badge: 'new' | 'waiting' | null; locked: boolean; onPress: (i: PageIndex) => void }) {
  const animated = useAnimatedStyle(() => ({
    opacity: withTiming(locked && !active ? 0.45 : 1, { duration: 180 }),
    transform: [{ scale: withTiming(active ? 1 : 0.97, { duration: 220 }) }],
    backgroundColor: withTiming(active ? 'rgba(255,210,63,0.12)' : 'rgba(255,255,255,0)', { duration: 220 }),
    borderColor: withTiming(active ? 'rgba(255,210,63,0.32)' : 'rgba(255,255,255,0)', { duration: 220 }),
  }));

  return (
    <Pressable
      onPress={() => onPress(index)}
      disabled={locked || active}
      accessibilityRole="tab"
      accessibilityLabel={`${PAGES[index]} page${active ? ', current' : ''}${badge === 'waiting' ? ', capsule waiting' : ''}`}
      accessibilityState={{ selected: active, disabled: locked || active }}
      style={s.hit}
    >
      <Animated.View style={[s.item, animated]}>
        <View style={s.iconWrap}>
          <PageIcon page={index} active={active} />
          {badge ? <View testID={badge === 'waiting' ? 'pull-waiting-badge' : 'albums-new-badge'} style={[s.badge, badge === 'waiting' && s.badgeWait]} /> : null}
        </View>
        <Text style={[s.label, active && s.labelActive]}>{PAGES[index]}</Text>
        {active ? <View style={s.activeBar} /> : null}
      </Animated.View>
    </Pressable>
  );
}

export function PageDots() {
  const { page, setPage, newCards, pagerLocked, pendingPulls } = useSession();
  const insets = useSafeAreaInsets();
  const initialPage = useRef(page);
  const [showHint, setShowHint] = useState(SWIPE_HINT);

  useEffect(() => {
    if (!SWIPE_HINT) return;
    if (page !== initialPage.current) setShowHint(false);
  }, [page]);

  return (
    <View style={[s.wrap, { paddingBottom: insets.bottom + RAIL_UNDER }]}>
      {/* U+FE0E asks for the text glyph: without it iOS Safari draws ↔ as a blue emoji box (seen in the simulator, W0.3). */}
      {showHint ? <Text style={s.hint}>SWIPE TO EXPLORE&nbsp; {'\u2194\uFE0E'}</Text> : null}
      <View accessibilityRole="tablist" style={s.rail}>
        {PAGES.map((_, i) => (
          <RailItem
            key={i}
            index={i as PageIndex}
            active={page === i}
            badge={i === PAGE.albums && newCards > 0 ? 'new' : i === PAGE.pull && (pendingPulls?.length ?? 0) > 0 ? 'waiting' : null}
            locked={pagerLocked}
            onPress={setPage}
          />
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 8,
    paddingTop: RAIL_PAD_TOP, paddingHorizontal: 8,
    backgroundColor: 'rgba(6,8,18,0.98)',
    borderTopWidth: RAIL_HAIRLINE, borderTopColor: 'rgba(255,255,255,0.14)',
    shadowColor: '#000', shadowOpacity: 0.55, shadowRadius: 20, shadowOffset: { width: 0, height: -8 },
  },
  hint: { alignSelf: 'center', height: RAIL_HINT, fontFamily: font.extrabold, fontSize: 8.5, letterSpacing: 1.25, color: color.text3 },
  rail: { flexDirection: 'row', alignItems: 'stretch', gap: 4 },
  hit: { flex: 1, minWidth: 0 },
  // No `flex: 1`: inside this column that is a basis of 0, so the tab stayed at minHeight and
  // `overflow: 'hidden'` cut the label and the bottom of the selection border. Height is the
  // icon, the label's line, and the padding that keeps both inside the border.
  item: {
    borderRadius: 14, borderWidth: RAIL_TAB_BORDER, alignItems: 'center', justifyContent: 'center', gap: RAIL_GAP,
    paddingTop: RAIL_TAB_PAD_TOP, paddingBottom: RAIL_TAB_PAD_BOT,
  },
  iconWrap: { width: 27, height: RAIL_ICON, alignItems: 'center', justifyContent: 'center' },
  label: { fontFamily: font.bold, fontSize: 10.5, lineHeight: RAIL_LABEL, letterSpacing: 0.2, color: color.text2 },
  labelActive: { fontFamily: font.black, color: color.yellow },
  activeBar: { position: 'absolute', bottom: 0, width: 24, height: 3, borderTopLeftRadius: 3, borderTopRightRadius: 3, backgroundColor: color.yellow, shadowColor: color.yellow, shadowOpacity: 0.9, shadowRadius: 8 },
  badge: { position: 'absolute', top: 0, right: 0, width: 8, height: 8, borderRadius: 4, backgroundColor: color.mint, borderWidth: 1.5, borderColor: color.roomDeep, shadowColor: color.mint, shadowOpacity: 0.9, shadowRadius: 6 },
  badgeWait: { backgroundColor: color.yellow, shadowColor: color.yellow },
});
