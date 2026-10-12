import { expect, jest, test } from '@jest/globals';
import { Linking } from 'react-native';
import { openLegal, PRIVACY_URL, TERMS_URL } from '../urls';

test('the web opens the draft in a new tab', () => {
  const tab = jest.spyOn(window, 'open').mockReturnValue({} as Window);
  const linking = jest.spyOn(Linking, 'openURL');
  openLegal(PRIVACY_URL);
  expect(tab).toHaveBeenCalledWith(PRIVACY_URL, '_blank', 'noopener,noreferrer');
  expect(linking).not.toHaveBeenCalled();
});

test('a blocked popup falls through to Linking', () => {
  jest.spyOn(window, 'open').mockReturnValue(null);
  const linking = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
  openLegal(TERMS_URL);
  expect(linking).toHaveBeenCalledWith(TERMS_URL);
});
