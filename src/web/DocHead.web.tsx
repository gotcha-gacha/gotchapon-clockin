// The document's head on the web (W2.2, #129), through expo-router/head (react-helmet: the deepest focused one wins, and a
// screen that is not focused, the app beneath a sheet route, draws none). The served HTML is prerendered once per route file
// (`[...path].html` answers every page path), so what a crawler or a link preview reads is `SiteHead`, the same everywhere;
// the per-page title arrives in the tab once the app runs.
import React from 'react';
import Head from 'expo-router/head';
import { useNavigationContainerRef } from 'expo-router';
import { SITE, SITE_DESCRIPTION } from '@/navigation/appPaths';

export function SiteHead() {
  // Rendered in the root layout, outside the fonts gate, so it is in every prerendered page. One title for every
  // path, including `/odds`: that route no longer shows a sleeve (#332), so it does not name itself "Odds".
  const title = SITE;
  return (
    <Head>
      <title>{title}</title>
      <meta name="description" content={SITE_DESCRIPTION} />
      <meta property="og:type" content="website" />
      <meta property="og:site_name" content={SITE} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={SITE_DESCRIPTION} />
      {/* No og:image until W2.4 (#140) has the preview image, so a summary card, not a large-image one. */}
      <meta name="twitter:card" content="summary" />
    </Head>
  );
}

export function DocTitle({ title, noindex }: { title: string; noindex?: boolean }) {
  // A screen rendered with no router at all (a test renders Home bare) has no document head to write to, and expo-router's
  // Head throws there ("Couldn't find a navigation object"). The same test useUrlState makes.
  const nav = useNavigationContainerRef() as ReturnType<typeof useNavigationContainerRef> | undefined;
  if (!nav) return null;
  return (
    <Head>
      <title>{title}</title>
      {noindex ? <meta name="robots" content="noindex" /> : null}
    </Head>
  );
}
