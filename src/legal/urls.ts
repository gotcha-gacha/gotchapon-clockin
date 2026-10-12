// Interim Terms and Privacy (30 Sept 2026, #354): the soft-launch drafts. Anonymous export of both Docs is refused (they redirect to a Google sign-in),
// so this change opens them instead of mirroring pages at /terms and /privacy. Swap these two constants when
// the drafts are published on the app origin.
import { Linking, Platform } from 'react-native';

export const TERMS_URL = 'https://docs.google.com/document/d/15U6EM2jGAzVGKcLwyagfBRBRR-zD1pUfaUGvX0tgnns/edit';
export const PRIVACY_URL = 'https://docs.google.com/document/d/123FwFSj0oTM0W-48lxovTVJA_u4hKZjT63f7ZhzzqzE/edit';

/** Opens a legal draft. On the web that is a new tab, so a tap on the sign-in row does not leave the sheet.
 *  A blocked popup falls through to the same navigation the phone uses. */
export function openLegal(url: string): void {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (opened) return;
  }
  Linking.openURL(url).catch(() => {});
}
