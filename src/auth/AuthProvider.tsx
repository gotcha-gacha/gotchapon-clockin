// Which sign-in the app runs (F7.4, #6). With Privy's ids in the environment it is Privy; without them it is the mock that
// has carried the app since week 1 — which is every demo deploy, every TestFlight build under the 13 Sept decision, and both
// jest projects. Deciding by the ids rather than by a flag means a build that cannot possibly sign anyone in never loads the
// SDK, and a build that can needs nothing else turned on.
//
// The browser resolves `AuthProvider.web.tsx`, where an app id is sufficient and the web app client is optional.
// This native file still requires the mobile app client (`privy.ts`).
import React from 'react';
import { PrivyProvider } from '@privy-io/expo';
import { MockAuthProvider } from '@/auth/mockAuth';
import { privyAppId, privyClientId, privyConfigured } from '@/auth/privy';
import { PrivyAuthProvider } from '@/auth/privyAuth';

export { useAuth } from '@/auth/context';
export type { Auth, AuthStage, Provider } from '@/auth/context';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  if (!privyConfigured()) return <MockAuthProvider>{children}</MockAuthProvider>;
  return (
    <PrivyProvider
      appId={privyAppId()}
      clientId={privyClientId()}
      // The dashboard's auto-create-on-login applies to Privy's own modal only; a custom sign-in has to ask for itself.
      config={{ embedded: { ethereum: { createOnLogin: 'off' }, solana: { createOnLogin: 'users-without-wallets' } } }}
    >
      <PrivyAuthProvider>{children}</PrivyAuthProvider>
    </PrivyProvider>
  );
}
