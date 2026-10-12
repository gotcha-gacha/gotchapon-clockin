// The web has no hardware Back: the browser's Back walks the address, which follows the page and the open binder
// (useUrlState.web.ts). The phone's is useHardwareBack.ts.
import type { PageIndex } from '@/state/session';

export function useHardwareBack(_: {
  enabled: boolean;
  page: PageIndex;
  albumOpen: string | null;
  closeAlbum: () => void;
  setPage: (p: PageIndex) => void;
}): void {}
