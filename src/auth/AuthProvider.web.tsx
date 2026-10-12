// Which sign-in a browser runs (W5.1). An app id enables Privy; without one the browser uses the week-1 mock. A web app
// client id is optional and the phone's client is never reused. The SDK is a dynamic import (`loadPrivyWeb.ts`) so a
// build with no app id, which is every demo deploy and
// `pnpm verify:web`, never puts `@privy-io/react-auth` in the entry chunk.
import React, { useEffect, useState } from 'react';
import { toApiError, type ApiError } from '@/api/errors';
import { AuthCtx, type Auth } from '@/auth/context';
import { loadPrivyWebChunk } from '@/auth/loadPrivyWeb';
import { MockAuthProvider } from '@/auth/mockAuth';
import { privyConfigured } from '@/auth/privy';

export { useAuth } from '@/auth/context';
export type { Auth, AuthStage, Provider } from '@/auth/context';

const CHUNK_CAP_MS = 8000;
const CHUNK_ERROR = 'Sign-in could not load. Reload the page.';

function waitingAuth(error: ApiError | null): Auth {
  return {
    ready: error !== null,
    stage: 'idle',
    provider: null,
    step: '',
    wallet: null,
    onboardingIndex: 0,
    error,
    appleReady: true,
    signIn: async () => {},
    sendEmailCode: async () => false,
    signSolanaTransaction: null,
    depositFromConnectedWallet: null,
    signOut: () => {},
    nextSheet: () => {},
    skipOnboarding: () => {},
  };
}

function PrivyHost({ children }: { children: React.ReactNode }) {
  const [Root, setRoot] = useState<React.ComponentType<{ children: React.ReactNode }> | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  useEffect(() => {
    let live = true;
    const cap = setTimeout(() => {
      if (live) setError(toApiError(new Error(CHUNK_ERROR)));
    }, CHUNK_CAP_MS);
    void loadPrivyWebChunk()
      .then((m) => { if (live) setRoot(() => m.PrivyWebRoot); })
      .catch(() => { if (live) setError(toApiError(new Error(CHUNK_ERROR))); })
      .finally(() => clearTimeout(cap));
    return () => { live = false; clearTimeout(cap); };
  }, []);
  // A chunk that arrives after the cap still takes over: the blank frame is bounded, not permanent.
  if (!Root) return <AuthCtx.Provider value={waitingAuth(error)}>{children}</AuthCtx.Provider>;
  return <Root>{children}</Root>;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  if (!privyConfigured()) return <MockAuthProvider>{children}</MockAuthProvider>;
  return <PrivyHost>{children}</PrivyHost>;
}
