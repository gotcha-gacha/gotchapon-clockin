// The dimmed area behind a sheet: press it and the sheet closes. On the web it is Backdrop.web.tsx (W1.6).
import React from 'react';
import { Pressable, type StyleProp, type ViewStyle } from 'react-native';

export type BackdropProps = { onPress: () => void; label: string; style: StyleProp<ViewStyle> };

export function Backdrop({ onPress, label, style }: BackdropProps) {
  return <Pressable style={style} onPress={onPress} accessibilityLabel={label} />;
}
