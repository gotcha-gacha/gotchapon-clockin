import { expect, jest, test } from '@jest/globals';
import { Linking } from 'react-native';
import { openLegal, PRIVACY_URL, TERMS_URL } from '../urls';

test('the interim drafts are the Docs named in #354', () => {
  expect(TERMS_URL).toBe('https://docs.google.com/document/d/15U6EM2jGAzVGKcLwyagfBRBRR-zD1pUfaUGvX0tgnns/edit');
  expect(PRIVACY_URL).toBe('https://docs.google.com/document/d/123FwFSj0oTM0W-48lxovTVJA_u4hKZjT63f7ZhzzqzE/edit');
});

test('a phone opens the draft in the system browser', () => {
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
  openLegal(TERMS_URL);
  expect(open).toHaveBeenCalledWith(TERMS_URL);
});
