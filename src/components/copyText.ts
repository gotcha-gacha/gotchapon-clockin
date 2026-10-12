// Put text on the clipboard and say whether it is there (#418). The phone's clipboard answers with a boolean that a caller must
// read, not a rejection: a resolved `false` is a failed copy. The web has its own file (copyText.web.ts).
import * as Clipboard from 'expo-clipboard';

export async function copyText(text: string): Promise<boolean> {
  try {
    return (await Clipboard.setStringAsync(text)) === true;
  } catch {
    return false;
  }
}
