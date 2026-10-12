// Mobile Wallet Adapter exists only on Android (`mobileWallet.android.ts`). iOS, the web and jest load this stub, so the
// deposit-from-a-wallet-app row is simply not offered there.
import type { MobileWalletTransact } from './mobileWalletTypes';

export const mobileWalletTransact: MobileWalletTransact | null = null;
