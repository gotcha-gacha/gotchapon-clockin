// The document's head is a web matter (W2.2, #129). On a phone these draw nothing: expo-router's native Head publishes the
// screen as an iOS handoff / Spotlight activity, which is not wanted here. DocHead.web.tsx is the real one.
import type { ReactNode } from 'react';

/** The site's own tags, in every served page: title, description, Open Graph. */
export function SiteHead(): ReactNode { return null; }
/** The tab's title while this screen is the focused one. `noindex` for a page no search engine should keep. */
export function DocTitle(p: { title: string; noindex?: boolean }): ReactNode { void p; return null; }
