// Feature flags the pack expected from remote config (X.2). Ben's 10 Sept decisions fix them for
// v0, so they are constants; EXPO_PUBLIC_FLAGS (JSON) can override one for a build.
export type Flags = {
  /** Card top-up: not a hidden flag any more — a visible "coming soon" row. */
  cardOnramp: 'coming-soon' | 'off';
  /** Marquee ticker content. 'launch' = vault facts + own session; 'high' = other collectors' pulls (v1). */
  socialTicker: 'launch' | 'high';
  /** Targeted pull ($1.50) — in v1 scope per the reconciliation. */
  missingCard: boolean;
};

const defaults: Flags = { cardOnramp: 'coming-soon', socialTicker: 'launch', missingCard: true };

function parseOverrides(): Partial<Flags> {
  const raw = process.env.EXPO_PUBLIC_FLAGS;
  if (!raw) return {};
  try { return JSON.parse(raw) as Partial<Flags>; } catch { return {}; }
}

export const flags: Flags = { ...defaults, ...parseOverrides() };
