// The walker that AC-3 of W1.6 rests on (#139): what it calls a control, and what it accepts as a name.
import { afterEach, expect, test } from '@jest/globals';
import { controlCount, unnamedControls } from '../unnamedControls';

const put = (html: string) => { document.body.innerHTML = html; };
afterEach(() => { document.body.innerHTML = ''; });

test('a glyph is not a name; a label, a placeholder or words are', () => {
  put('<button>✕</button><div role="button" tabindex="0">♪</div><button>G</button>');
  expect(unnamedControls()).toHaveLength(3);
  put('<button aria-label="Close">✕</button><div role="button" tabindex="0" aria-label="Sound on">♪</div><button>G Continue with Google</button><input placeholder="or your email"><div role="tab" tabindex="0">Wallet</div>');
  expect([unnamedControls(), controlCount()]).toEqual([[], 5]);
});

test('aria-labelledby is read through to the text it names, and an empty aria-label hides nothing', () => {
  put('<span id="r1">Restock alerts</span><div role="switch" tabindex="0" aria-labelledby="r1"></div>');
  expect(unnamedControls()).toEqual([]);
  put('<div role="switch" tabindex="0" aria-labelledby="r1"></div>'); // names an element that is not there: the id is not a name
  expect(unnamedControls()).toHaveLength(1);
  put('<input aria-label="" placeholder="Amount">');
  expect(unnamedControls()).toEqual([]);
  put('<input aria-label="">');
  expect(unnamedControls()).toHaveLength(1);
});

test('what nobody can reach is skipped: an inert subtree, and the Modal focus trap\'s empty sentinels', () => {
  put('<div inert><button>✕</button></div><div role="presentation" tabindex="0"></div><button aria-label="Close">✕</button>');
  expect([unnamedControls(), controlCount()]).toEqual([[], 1]);
});
