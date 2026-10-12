// iOS and the web have no Mobile Wallet Adapter, so there is no wallet-app deposit: this stub renders nothing and imports
// nothing but a type, which keeps the panel, its codecs and the deposit guard out of those bundles. Android loads
// `WalletAppDeposit.android.tsx`.
import type { WalletAppDepositProps } from './WalletAppDepositPanel';

export function WalletAppDeposit(_props: WalletAppDepositProps) {
  return null;
}
