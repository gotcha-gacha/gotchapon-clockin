// Small synchronous text storage under the device's state (W0.2b, #136): settings and the kept pulls. Native: a file per name in
// the app's documents (expo-file-system), exactly what settings.ts and pendingPulls.ts did themselves before. The web has its own
// file (storage.web.ts, localStorage): expo-file-system has no web implementation.
import { File, Paths } from 'expo-file-system';

/** The stored text, or null when there is none. Throws when the store cannot be read; callers decide what that means. */
export function readStored(name: string): string | null {
  const f = new File(Paths.document, name);
  return f.exists ? f.textSync() : null;
}

/** True when the text was stored. Never throws: a caller must be able to tell "kept" from "not kept" without a try. */
export function writeStored(name: string, text: string): boolean {
  try {
    const f = new File(Paths.document, name);
    if (!f.exists) f.create();
    f.write(text);
    return true;
  } catch {
    return false;
  }
}
