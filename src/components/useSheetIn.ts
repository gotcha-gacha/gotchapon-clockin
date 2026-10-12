// A bottom sheet's entrance (design pbUp: it rises 40 pt into place over .45 s, cubic-bezier(.2,.9,.2,1)) with the open click.
// Shared by the card detail sheet and the account sheet. An optional `drag` (points, downward positive) is added to the
// same translation so a sheet can follow a finger without a second transform clobbering this one.
import { useEffect } from 'react';
import { Easing, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { playSfx } from '@/audio/sfx';

/** The animated style for a sheet that rises into place each time `open` turns true. */
export function useSheetIn(open = true, drag?: SharedValue<number>) {
  const rise = useSharedValue(40);
  useEffect(() => {
    if (!open) return;
    playSfx('click');
    rise.set(40);
    rise.set(withTiming(0, { duration: 450, easing: Easing.bezier(0.2, 0.9, 0.2, 1) }));
  }, [open, rise]);
  return useAnimatedStyle(() => ({ transform: [{ translateY: rise.get() + (drag ? drag.get() : 0) }] }));
}
