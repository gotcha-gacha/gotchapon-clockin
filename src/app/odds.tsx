// `/odds` used to be the odds sleeve over Pull (W2.1, #128). v0 hides that sleeve (#332): paid draws are
// album cards only, so a visit steps back once and is not left to reopen after sign-in. The card sheet
// route is unchanged. Do not draw "Odds per $1 pull" here.
import { useEffect, useRef } from 'react';
import { useRouter } from 'expo-router';

export default function OddsRoute() {
  const router = useRouter();
  const left = useRef(false);
  useEffect(() => {
    if (left.current) return;
    left.current = true;
    router.back();
  }, [router]);
  return null;
}
