// Nunito 600–900 (design/README.md "Type"). Fallback stack is applied by RN when the family is missing.
import { Platform } from 'react-native';
import {
  Nunito_600SemiBold,
  Nunito_700Bold,
  Nunito_800ExtraBold,
  Nunito_900Black,
  useFonts,
} from '@expo-google-fonts/nunito';

export const font = {
  /** Serial numbers and wallet addresses. */
  mono: Platform.select({ ios: 'Menlo', default: 'monospace' }) as string,
  semibold: 'Nunito_600SemiBold',
  bold: 'Nunito_700Bold',
  extrabold: 'Nunito_800ExtraBold',
  black: 'Nunito_900Black',
} as const;

export function useAppFonts() {
  return useFonts({ Nunito_600SemiBold, Nunito_700Bold, Nunito_800ExtraBold, Nunito_900Black });
}
