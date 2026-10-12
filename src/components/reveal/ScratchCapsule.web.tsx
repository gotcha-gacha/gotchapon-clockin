// The dispensed capsule on the web (W0.2d, #138). Which capsule is decided ONCE, when it mounts: the Skia scratch capsule if
// CanvasKit is ready by then, otherwise the tap-to-open one for this capsule's whole life (swapping mid-drop would restart the
// drop). Skia is only ever imported here, dynamically, after CanvasKit has loaded (see skiaWeb.web.ts for why), and a Skia
// capsule that throws while rendering falls back to the tap one instead of taking the page down: this is the surface a paid
// pull sits behind.
import React, { Suspense, useRef, useState } from 'react';
import { ScrollHere } from '@/components/ScrollHere';
import type { Tier } from '@/api/contract';
import { TapCapsule } from './TapCapsule';
import { skiaWebState } from './skiaWeb';

type Props = { tier: Tier | null; shellColor?: string; interactive: boolean; onCrack: () => void; onActive?: (active: boolean) => void };

const LazySkiaCapsule = React.lazy(async () => ({ default: (await import('./skiaChunk')).skiaParts().SkiaScratchCapsule }));

class FallBack extends React.Component<{ fallback: React.ReactNode; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export function ScratchCapsule(props: Props) {
  // Where the capsule comes to rest (both capsules: top 516, 88 across): under the rail in a short browser window.
  return <><ScrollHere top={516} height={88} testID="capsule-rest" /><Capsule {...props} /></>;
}

function Capsule(props: Props) {
  const [skia] = useState(() => skiaWebState() === 'ready');
  const opened = useRef(false);
  const tap = <TapCapsule {...props} />;
  if (!skia) return tap;
  // The keyboard's way in (the scratch itself is a pointer drag): focus the capsule, then space or enter opens it.
  // Once, like the tap capsule, and never from a held key (plan §7.18: `event.repeat` is ignored everywhere).
  const onKeyDown = (e: { key?: string; repeat?: boolean; preventDefault?: () => void }) => {
    if (!props.interactive || (e.key !== ' ' && e.key !== 'Enter')) return;
    e.preventDefault?.();
    if (e.repeat || opened.current) return;
    opened.current = true;
    props.onCrack();
  };
  // react-native-web hands onKeyDown to the capsule's div, which its role="button" already makes focusable.
  return (
    <FallBack fallback={tap}>
      <Suspense fallback={null}>
        <LazySkiaCapsule {...props} capProps={{ onKeyDown }} />
      </Suspense>
    </FallBack>
  );
}
