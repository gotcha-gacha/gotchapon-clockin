// Which copy of the app runs the machine (W0.2b, #136). A phone runs one copy, so native is always the active one. The web has
// its own file (activeTab.web.ts): every tab of a browser shares one store, and the session is written for a single writer.
import type { TabRole } from './activeTab.types';

export type { TabRole } from './activeTab.types';

export function useActiveTab(): { role: TabRole; takeOver: () => void } {
  return NATIVE;
}
const NATIVE = { role: 'active' as TabRole, takeOver: () => {} };
