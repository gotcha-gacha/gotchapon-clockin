// Space never scrolls (W1.6, #139, AC-2). A browser's answer to space is "scroll whatever can scroll", unless focus is on
// something it presses with space itself (a real <button>) or types into. react-native-web only renders a <button> for
// role="button": the rail's tabs and the "see odds" link are divs and spans with a tabindex, which it presses on enter and
// leaves to the browser on space. So: on those, space is a press, as it is for a button; anywhere else it is nothing.
//
// One key, one act. The keyboard bridge (W1.2) also listens for space on the window, and decides what it means with focus on
// nothing. When this guard presses a control the press can move focus off it (the rail tab that was pressed becomes the
// current one, which is disabled), and the bridge, running second on the same event, then saw "space, focus on nothing, not on
// Pull" and paged straight back (seen in Chromium: space on the Wallet tab did nothing). So the guard listens in the capture
// phase, ahead of everything, and a space it turns into a press goes no further. A space it only cancels travels on as before.
const typesInto = (el: HTMLElement) => el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable === true;

export function installSpaceGuard(target: Window = window): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== ' ' || e.metaKey || e.ctrlKey || e.altKey) return;
    const el = e.target as HTMLElement | null;
    if (!el || !el.tagName || typesInto(el) || el.tagName === 'BUTTON' || el.tagName === 'SUMMARY') return;
    e.preventDefault();
    const pressable = el !== el.ownerDocument.body && el.tabIndex >= 0 && el.getAttribute('aria-disabled') !== 'true';
    if (!pressable) return;
    e.stopImmediatePropagation();
    if (!e.repeat) el.click();
  };
  target.addEventListener('keydown', onKey, true);
  return () => target.removeEventListener('keydown', onKey, true);
}
