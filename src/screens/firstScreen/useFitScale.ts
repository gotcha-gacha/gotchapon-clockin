// Native: the first screen is the phone, and it does not scale. The web file measures the panel.
import type { RefObject } from 'react';
import type { View } from 'react-native';

export type Fit = { scale: number; content: number };

export function useFitScale(_viewport: RefObject<View | null>, _column: RefObject<View | null>): Fit {
  return { scale: 1, content: 0 };
}
