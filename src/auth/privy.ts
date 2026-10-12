// Privy's public ids and embedded-wallet configuration (F7.4, #6). Ids come from the environment and are never in the repo
// (CLAUDE.md "Deployment"); the app secret is not one of these and belongs in Dev 2's server environment.
//
// Read when asked rather than at import, because `EXPO_PUBLIC_*` is inlined where it is read and a test sets one before
// calling. With no app id nothing Privy is constructed at all: `AuthProvider` keeps the mock, which is what every build
// without ids has always run.
//
// **Native (iOS and Android).** One app id on every platform; this file's client id is the mobile app client, whose Apple
// override is the bundle id `com.benliew.gachapon`. The browser resolves `privy.web.ts` instead and reads
// `EXPO_PUBLIC_PRIVY_CLIENT_ID_WEB` — the web app client has no Apple override, so Apple gets the Services ID. Passing
// this mobile id on the web is what made Apple reject the OAuth `client_id`.
export const privyAppId = () => process.env.EXPO_PUBLIC_PRIVY_APP_ID ?? '';
export const privyClientId = () => process.env.EXPO_PUBLIC_PRIVY_CLIENT_ID ?? '';
export const privyConfigured = () => privyAppId().length > 0 && privyClientId().length > 0;
