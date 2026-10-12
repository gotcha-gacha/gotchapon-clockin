// An inline Terms or Privacy word. The account sheet and the web footer open the same drafts through their own controls.
import React from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';
import { openLegal, PRIVACY_URL, TERMS_URL } from '@/legal/urls';

const DOCS = {
  terms: { label: 'Terms', url: TERMS_URL },
  privacy: { label: 'Privacy', url: PRIVACY_URL },
} as const;

export function LegalLink({ doc, style }: { doc: keyof typeof DOCS; style?: StyleProp<TextStyle> }) {
  const { label, url } = DOCS[doc];
  return (
    <Text style={style} onPress={() => openLegal(url)} accessibilityRole="link" accessibilityLabel={label} suppressHighlighting>
      {label}
    </Text>
  );
}
