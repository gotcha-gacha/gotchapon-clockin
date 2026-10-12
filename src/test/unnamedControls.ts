// AC-3 of W1.6 (#139): every control has a name. Walks a DOM for anything a user can press or type into and answers the ones
// that have no words: no aria-label, no placeholder, and no text of their own beyond a glyph ("✕", "♪", "⚙"). Inert subtrees
// (a page beside the one on screen, the app under onboarding) are skipped: nobody can reach them.
const CONTROLS = 'button, [role="button"], [role="tab"], [role="link"], [role="switch"], [role="checkbox"], [tabindex="0"], input, textarea, select';

export function unnamedControls(root: ParentNode = document): string[] {
  const out: string[] = [];
  for (const el of root.querySelectorAll<HTMLElement>(CONTROLS)) {
    if (el.closest('[inert]') || el.getAttribute('role') === 'presentation') continue; // presentation: react-native-web's Modal focus-trap sentinels, empty and invisible
    // aria-labelledby names other elements: read THEIR text, never the id itself ("r1" is two characters and a name for nobody).
    const labelledBy = (el.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean).map((id) => el.ownerDocument.getElementById(id)?.textContent ?? '').join(' ');
    const label = [el.getAttribute('aria-label'), labelledBy, el.getAttribute('placeholder')].find((v) => v && v.trim()) ?? ''; // an empty aria-label does not hide a placeholder
    const words = /[\p{L}\p{N}]{2,}/u.test(label) || /[\p{L}\p{N}]{2,}/u.test(el.textContent ?? '');
    if (!words) out.push(el.outerHTML.slice(0, 160));
  }
  return out;
}
/** How many controls the walk looked at: a walk over nothing proves nothing. */
export function controlCount(root: ParentNode = document): number {
  return [...root.querySelectorAll<HTMLElement>(CONTROLS)].filter((el) => !el.closest('[inert]') && el.getAttribute('role') !== 'presentation').length;
}
