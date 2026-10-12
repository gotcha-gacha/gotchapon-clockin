// The app's entry (F7.4): Privy's polyfills must be in place before the router loads, and `src/polyfills` is a platform
// seam, so a browser gets an empty module instead of ethers' shims. The OAuth handoff is the same kind of seam (W5.1):
// on the web it stashes `privy_oauth_*` and takes them off the bar before the router, and before the QR reads the URL.
import './src/polyfills';
import './src/auth/oauthHandoff';
import 'expo-router/entry';
