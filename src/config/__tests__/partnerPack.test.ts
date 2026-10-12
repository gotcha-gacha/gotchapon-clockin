import { expect, test } from '@jest/globals';
import { PACK_COPY, partnerPackFace, placeholderPartner } from '@/config/partnerPack';

test('the soft-launch partner is jupiter-degen and the copy credits a pull on Jupiter gacha', () => {
  expect(placeholderPartner).toBe('jupiter-degen');
  expect(partnerPackFace().sub).toBe('Jupiter Degen pack');
  expect(PACK_COPY.claim).toBe('Claim pack');
  expect(PACK_COPY.open).toBe('Open on Jupiter');
  expect(PACK_COPY.creditedBody).toBe('You have a free Degen pack pull with Jupiter. Open it on Jupiter gacha.');
  const blob = `${JSON.stringify(PACK_COPY)} ${partnerPackFace().mark} ${partnerPackFace().tier} ${partnerPackFace().sub}`;
  expect(blob).not.toMatch(/example partner|Save for later|Claim it later|Open pack|Credit reserved|redeem on Jupiter|official Jupiter|partnership confirmed|Trainer/i);
});
