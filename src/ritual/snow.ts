// New-card snow (#345). A pull celebrates when it lands a card new to the collector, or any rare.
// An all-duplicate pull does not — every card already held, rare or not.

export type SnowCard = { isDupe: boolean; rarity: string };

/** How many cards in this pull take part in the snow. 0 means no burst. */
export function snowCount(outcomes: readonly SnowCard[]): number {
  if (outcomes.length === 0 || outcomes.every((o) => o.isDupe)) return 0;
  return outcomes.filter((o) => !o.isDupe || o.rarity !== 'common').length;
}

export function pullSnow(outcomes: readonly SnowCard[]): boolean {
  return snowCount(outcomes) > 0;
}
