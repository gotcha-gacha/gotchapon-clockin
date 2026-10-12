// "Open wallet app" hands the deposit address to a wallet through a `solana:` link. On a desktop browser nothing answers that
// link and the button does nothing at all, so it is only offered where a wallet app can be (W0.3, #121): native, and a touch
// device's browser (any touch pointer: an iPad with a trackpad still has its wallet apps). QR and Copy are always there.
import { Platform } from 'react-native';

export const canOpenWalletApp = (): boolean =>
  Platform.OS !== 'web' || (typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(any-pointer: coarse)').matches);
