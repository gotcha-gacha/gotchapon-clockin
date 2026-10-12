// What the catch-all route draws on the web (W2.2, #129): the app at one of its own addresses, the not-found page anywhere
// else. Decided ONCE, when this route instance mounts, from the route's OWN `path` param. Never from the global pathname:
// with the odds sleeve or a card sheet on top, the address is `/odds` or `/card/:id`, and a decision that read it would
// unmount the app beneath the sheet, a pull in progress with it. And never again later: after mount the address only
// follows the app's state (W2.1), and nothing about it may take the app away. Leaving the not-found page is a page load of `/`
// (NotFound.tsx: `router.replace('/')` re-rendered in place), which decides afresh.
import React, { useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import Home from '@/screens/Home';
import { NotFound } from '@/screens/NotFound';
import { isAppPath, ownSegments } from '@/navigation/appPaths';

export default function AppRoute() {
  const { path } = useLocalSearchParams<{ path?: string | string[] }>();
  const [known] = useState(() => isAppPath(ownSegments(path, typeof window === 'undefined' ? '/' : window.location.pathname)));
  return known ? <Home /> : <NotFound />;
}
