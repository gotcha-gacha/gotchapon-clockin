// A flex child under the session. It used to start the arcade loop on the first tap; that bed is gone, and effects
// play from the gesture that triggers them. The wrapper stays so the tree under the session does not reflow.
import React from 'react';
import { View } from 'react-native';

export function SoundHost({ children }: { children: React.ReactNode }) {
  return <View style={{ flex: 1 }} testID="sound-host">{children}</View>;
}
