// Gold raffle stub. The header pill's is 20×14 with notches in the header ground; the sheet's is larger.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { color } from '@/theme/tokens';

export function TicketMark({ width, height, notch, notchColor = color.roomDeep, perf = 7 }: { width: number; height: number; notch: number; notchColor?: string; perf?: number }) {
  const cut = notch / 2;
  return (
    <View style={{ width, height }}>
      <LinearGradient colors={['#FFE680', '#FFD23F', '#E0A91A']} locations={[0, 0.55, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.stub, { borderRadius: 3 }]} />
      <View style={[s.notch, { width: notch, height: notch, borderRadius: cut, backgroundColor: notchColor, left: -cut, top: (height - notch) / 2 }]} />
      <View style={[s.notch, { width: notch, height: notch, borderRadius: cut, backgroundColor: notchColor, right: -cut, top: (height - notch) / 2 }]} />
      <View style={[s.perf, { left: perf }]} />
    </View>
  );
}

const s = StyleSheet.create({
  stub: { flex: 1 },
  notch: { position: 'absolute' },
  perf: { position: 'absolute', top: 1, bottom: 1, borderLeftWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(31,45,77,0.45)' },
});
