// Privy's OAuth return writes three query params (`privy_oauth_code`, `privy_oauth_state`, `privy_oauth_provider`).
// The code is a one-time credential. The desktop shell's QR is `window.location.href` (PhoneCard), so these have to be
// gone from that string before a phone can scan them. Pure: no `window`, so the QR filter and the handoff share one list.
export const OAUTH_PARAM_KEYS = ['privy_oauth_code', 'privy_oauth_state', 'privy_oauth_provider'] as const;

export function hrefWithoutOAuthParams(href: string): string {
  try {
    const url = new URL(href);
    for (const key of OAUTH_PARAM_KEYS) url.searchParams.delete(key);
    return url.toString();
  } catch {
    return href;
  }
}
