/** Records an album's completion INSIDE the settling batch, from the rows the batch can see when it runs (#305). A burn and a
 *  pull that each add one of an album's last cards at the same time each counted before their batch, so neither saw the
 *  album full, and nothing recorded it until the user's next pull. D1 runs one batch at a time, so the second of the two
 *  to commit sees both cards here. `OR IGNORE`: whichever records it first wins, and the other is not failed for it. */
export function recordCompletionIfFull(db: D1Database, userId: string, albumId: string, completedAt: string): D1PreparedStatement {
  return db.prepare(`INSERT OR IGNORE INTO album_completions (user_id, album_id, completed_at)
    SELECT ?, a.id, ? FROM albums a WHERE a.id = ?
      AND (SELECT COUNT(DISTINCT ui.card_id) FROM user_inventory ui JOIN stock_items i ON i.inventory_key = ui.inventory_key
        WHERE ui.user_id = ? AND ui.tier = 'common' AND ui.status = 'owned' AND i.tier = 'common' AND i.album_id = a.id) >= a.size`)
    .bind(userId, completedAt, albumId, userId);
}

// The album this settlement's own statement recorded: same user, this settlement's stamp, not yet claimed.
const RECORDED_HERE = `(SELECT album_id FROM album_completions WHERE user_id = ? AND completed_at = ? AND claimed_at IS NULL
  ORDER BY album_id LIMIT 1)`;

/** Announces what the batch recorded, in the stored answer, in the same batch (PR #308's review). The count taken before the
 *  batch decides `albumCompleted` for the ordinary case; in the race, the album is recorded here while that count said
 *  "short", and a later settlement sees it as already recorded, so nothing would ever announce it and its holo could never be
 *  claimed. Written into the stored response rather than patched afterwards, so the answer and its replay agree. */
export function announceRecordedCompletion(db: D1Database, target: { pullId: string } | { idem: string; operation: string },
  userId: string, completedAt: string): D1PreparedStatement {
  if ('pullId' in target) {
    return db.prepare(`UPDATE pulls SET response_json = json_set(response_json, '$.albumCompleted', ${RECORDED_HERE})
      WHERE id = ? AND ${RECORDED_HERE} IS NOT NULL`)
      .bind(userId, completedAt, target.pullId, userId, completedAt);
  }
  return db.prepare(`UPDATE idempotency SET response_json = json_set(response_json, '$.albumCompleted', ${RECORDED_HERE})
    WHERE user_id = ? AND operation = ? AND idem = ? AND ${RECORDED_HERE} IS NOT NULL`)
    .bind(userId, completedAt, userId, target.operation, target.idem, userId, completedAt);
}
