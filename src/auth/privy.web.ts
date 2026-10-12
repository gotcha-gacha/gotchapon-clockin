// Privy's public browser configuration (W5.1). React requires the app id; an app client is optional and is useful only
// when the deployment needs client-specific restrictions or OAuth overrides. Never pass the mobile app client here.
// Read when asked, same as `privy.ts` — tests set the vars first.
export const privyAppId = () => process.env.EXPO_PUBLIC_PRIVY_APP_ID ?? '';
export const privyClientId = () => process.env.EXPO_PUBLIC_PRIVY_CLIENT_ID_WEB ?? '';
export const privyConfigured = () => privyAppId().length > 0;
