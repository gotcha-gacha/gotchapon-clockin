// In its own file: Metro applies platform extensions to every import, so on the web `./activeTab` written inside
// activeTab.web.ts would resolve to activeTab.web.ts itself.
/** deciding: asking whether another tab is active · active: this copy runs the machine · other: another tab does. */
export type TabRole = 'deciding' | 'active' | 'other';
