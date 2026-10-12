// Geo-block (F5.3): the launch list, case and spacing forgiven; the screen names the country and promises no charge.
import { expect, test } from '@jest/globals';
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { countryName, geoBlocked, isBlockedCountry } from '@/config/geo';
import { GeoBlockScreen } from '@/screens/GeoBlockScreen';

test('the launch list: US, UK (GB or UK), China, Belgium, the Netherlands and Japan are closed; Malaysia is not', () => {
  for (const c of ['US', 'GB', 'UK', 'CN', 'BE', 'NL', 'JP', 'jp', ' nl ']) expect(isBlockedCountry(c)).toBe(true);
  for (const c of ['MY', 'SG', '', null, undefined]) expect(isBlockedCountry(c)).toBe(false);
  expect(countryName('NL')).toBe('the Netherlands');
  expect(countryName('ZZ')).toBe('your country');
});

test('the block screen names the country and says nothing was charged', async () => {
  await render(<GeoBlockScreen country="JP" />);
  expect(screen.getByText('Not available in Japan')).toBeTruthy();
  expect(screen.getByText(/Nothing has been charged\./)).toBeTruthy();
});

test("the app closes on the server's GEO_BLOCKED or a closed /me country, and only then", () => {
  expect(geoBlocked('MY', 'GEO_BLOCKED')).toBe(true); // the edge blocks by IP even when the profile country is open
  expect(geoBlocked('JP', null)).toBe(true);
  expect(geoBlocked('MY', 'NETWORK')).toBe(false);
  expect(geoBlocked(undefined, undefined)).toBe(false);
});
