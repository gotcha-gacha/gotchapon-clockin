// The `/odds` route tells the session while its sleeve is shown (W2.1, #128): the sleeve locks the pager and the keyboard's
// arrows through `session.oddsOpen`, and that state is the route's while the sheets are routed. Its own file: the session
// imports sheetRoutes.ts.
import { useEffect } from 'react';
import { useSession } from '@/state/session';

export function useRoutedSheet(shown: boolean): void {
  const { oddsShown, oddsHidden } = useSession();
  useEffect(() => {
    if (!shown) return;
    oddsShown();
    return oddsHidden;
  }, [shown, oddsShown, oddsHidden]);
}
