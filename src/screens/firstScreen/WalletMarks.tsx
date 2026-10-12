// Wallet marks on the sign-in sheet (#244, official marks #346). Each named row uses that wallet's
// unmodified press-kit / brand symbol, served from `public/wallets/`. Decorative: the row's words are
// the accessible name. Sources, used only to identify the connect target:
//   phantom.svg   Phantom integration icon (docs.phantom.com/resources/assets — the SVG they recommend for dapps)
//   jupiter.svg   Jupiter brand kit JupiterLogo/logo-dark.svg (dev.jup.ag brand kit; primary gradient)
//   backpack.svg  Backpack media kit Backpack-Icon.svg (backpack.app/media-kit)
//   solflare.svg  Solflare's current app icon (solflare.com; the stronghold mark)
//   okx.svg       OKX symbol (the four-square mark OKX publishes, source okx.com)
//   coinbase.svg  Coinbase symbol (the blue circle on coinbase.com, used for Coinbase Wallet)
//   trust.svg     Trust Wallet symbol (trustwallet.com/icon.svg, linked from their press page)
// An unnamed browser wallet is not a brand, so it keeps a neutral dot.
import React from 'react';
import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import type { SolanaWalletKey } from '@/auth/solanaWallets';

const quiet = { pointerEvents: 'none' as const };

const INK = '#12182D';

/** File under `public/wallets/`, one per named connector. `detected_solana_wallets` is not a brand. */
const MARK_FILE: Partial<Record<SolanaWalletKey, string>> = {
  phantom: 'phantom.svg',
  jupiter: 'jupiter.svg',
  backpack: 'backpack.svg',
  solflare: 'solflare.svg',
  okx_wallet: 'okx.svg',
  coinbase_wallet: 'coinbase.svg',
  trust_wallet: 'trust.svg',
};

/** 36 px by default, the expanded row. The toggle stacks three of these smaller. */
export function WalletMark({ id, size = 36 }: { id: SolanaWalletKey; size?: number }) {
  const file = MARK_FILE[id];
  if (file) {
    return (
      <View aria-hidden style={[quiet, { width: size, height: size }]}>
        <img
          data-testid={`wallet-mark-${id}`}
          src={`/wallets/${file}`}
          width={size}
          height={size}
          alt=""
          style={{ width: size, height: size, objectFit: 'contain', display: 'block' }}
        />
      </View>
    );
  }
  return (
    <View aria-hidden style={quiet}>
      <Svg testID="wallet-mark-detected" width={size} height={size} viewBox="0 0 36 36">
        <Circle cx={18} cy={18} r={18} fill="#3D4D73" />
        <Circle cx={18} cy={18} r={6} fill="#EAF0FF" />
      </Svg>
    </View>
  );
}

/** Phantom, Backpack, Solflare overlapped, the closed toggle's leading marks. */
export function WalletMarkStack() {
  const ids = ['phantom', 'backpack', 'solflare'] as const;
  return (
    <View style={{ flexDirection: 'row', width: 22 + 14 + 14 }}>
      {ids.map((id, i) => (
        <View
          key={id}
          style={{
            marginLeft: i === 0 ? 0 : -8,
            zIndex: 3 - i,
            borderRadius: 99,
            borderWidth: 2,
            borderColor: INK,
            overflow: 'hidden',
          }}
        >
          <WalletMark id={id} size={22} />
        </View>
      ))}
    </View>
  );
}
