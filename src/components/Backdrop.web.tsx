// The dimmed area behind a sheet, on the web (W1.6, #139): a click target and nothing more. As a Pressable it carried a
// tabindex, and react-native-web's Modal puts focus on the first thing that will take it: every sheet opened with its
// whole-screen backdrop focused, a ring round the entire screen, and Tab came back to it every lap (tabindex -1 does not
// help: the focus trap focuses by script). A keyboard closes a sheet with esc or its ✕; this is for the mouse.
import React from 'react';
import { View } from 'react-native';
import type { BackdropProps } from './Backdrop';

export function Backdrop({ onPress, style }: BackdropProps) {
  return <View style={style} aria-hidden {...({ onClick: onPress } as object)} />;
}
