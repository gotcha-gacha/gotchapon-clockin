// The desktop arcade shell is a web thing (Shell.web.tsx). On a phone the app is the whole screen, and this passes it through.
// A component seam, never a `.web` file in src/app/: Metro bundles every file of the route directory on every platform (W1.1, plan §4.1).
import React from 'react';

export function Shell({ children }: { children: React.ReactNode; ready: boolean }) {
  return <>{children}</>;
}
