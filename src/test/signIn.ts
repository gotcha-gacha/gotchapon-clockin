// Getting a test signed in, now that sign-in is a sheet over the first screen (#211).
//
// The CTA's 780 ms arming beat is the screen's own subject and has its own test; every other suite only needs to BE signed in,
// so it takes the quiet way the design puts there for a returning collector — "Already collecting? Sign in" opens the same
// sheet at once. Native only: `@testing-library/react-native` is the native project's.
import { fireEvent, screen } from '@testing-library/react-native';

export async function signInFromFirstScreen(provider: 'Apple' | 'Google' = 'Apple') {
  await fireEvent.press(await screen.findByText('Already collecting? Sign in'));
  await fireEvent.press(await screen.findByText(`Continue with ${provider}`));
}
