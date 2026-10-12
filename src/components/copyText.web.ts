// The web half of copyText (#418). Not expo-clipboard: its web build falls back to `document.execCommand('copy')` whenever
// `navigator.clipboard.writeText` is missing or refuses, and answers true even when that fallback copied nothing, so a failed
// copy would read as a success. Only the async Clipboard API's own success counts here.
export async function copyText(text: string): Promise<boolean> {
  try {
    const clipboard = (globalThis as { navigator?: Navigator }).navigator?.clipboard;
    if (typeof clipboard?.writeText !== 'function') return false;
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
