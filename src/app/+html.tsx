// The web document (W0.1). Runs in Node only, at export / on the server: no DOM, no browser APIs. Nunito is not in this page:
// the exported HTML carries no @font-face, and the four weights are fetched at runtime by useAppFonts. `_layout.tsx` renders
// nothing until they resolve, so there is no flash of fallback text: first paint WAITS on the fonts (measured by PR #147's
// second review: 204 ms on localhost, 19.7 s under emulated Fast 3G, a blank dark page meanwhile). Preloading them, or painting
// before them, is W2.4's (#140). The dark background is set before any script runs, so that wait is never white.
import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';
import { color } from '@/theme/tokens';
import { BROWSER_FLOOR_HTML, BROWSER_FLOOR_SCRIPT } from '@/web/browserFloor';
import { PAGE_CSS } from '@/web/pageCss';

// Search engines stay out unless an export says otherwise (W3.1, #131). Demo and staging deploys carry the mock or a staging
// API on a public URL: "fake stock never reaches a wider cohort" means an index must never pick one up. So `noindex` is the
// default and the production export opts in, `EXPO_PUBLIC_WEB_INDEXABLE=1` on its command line (plan §4.5): a forgotten flag
// costs a launch day of search traffic, which is seen and fixed; the other way round costs a demo in Google, which is not.
const INDEXABLE = process.env.EXPO_PUBLIC_WEB_INDEXABLE === '1';

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover" />
        <meta name="theme-color" content={color.room} />
        {INDEXABLE ? null : <meta name="robots" content="noindex, nofollow" />}
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: `html, body { background-color: ${color.room}; }\n${PAGE_CSS}` }} />
      </head>
      <body>
        {/* The browser floor (W0.3): plain markup and an ES5 check, ahead of the bundle an old browser may not even parse. */}
        <div dangerouslySetInnerHTML={{ __html: BROWSER_FLOOR_HTML }} />
        <script dangerouslySetInnerHTML={{ __html: BROWSER_FLOOR_SCRIPT }} />
        {children}
      </body>
    </html>
  );
}
