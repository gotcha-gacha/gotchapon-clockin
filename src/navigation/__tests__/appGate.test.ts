// What Home says it draws, for the sheet routes over it (W2.1, #128; PR #165's review).
import { expect, test } from '@jest/globals';
import { appGateOf } from '../appGate';

test('show only with the app on screen; wait while it is coming; never while another tab or a closed country has it', () => {
  const g = (authStage: string, tabRole: 'deciding' | 'active' | 'other', blocked = false) => appGateOf({ authStage, tabRole, blocked });
  expect([g('idle', 'active'), g('busy', 'active'), g('idle', 'other')]).toEqual(['wait', 'wait', 'wait']); // signed out: sign-in first, whatever the tab
  expect([g('done', 'deciding'), g('onboarding', 'active')]).toEqual(['wait', 'wait']);
  expect([g('done', 'other'), g('onboarding', 'other'), g('done', 'active', true), g('onboarding', 'active', true)]).toEqual(['never', 'never', 'never', 'never']);
  expect(g('done', 'active')).toBe('show');
});
