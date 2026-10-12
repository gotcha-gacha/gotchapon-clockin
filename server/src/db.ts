import { ApiError } from './http';

export async function getIdempotent<T>(db: D1Database, userId: string, operation: string, idem: string): Promise<T | null> {
  const row = await db.prepare('SELECT response_json FROM idempotency WHERE user_id = ? AND operation = ? AND idem = ?')
    .bind(userId, operation, idem).first<{ response_json: string }>();
  return row ? JSON.parse(row.response_json) as T : null;
}

export function putIdempotent(db: D1Database, userId: string, operation: string, idem: string, response: unknown, now: string): D1PreparedStatement {
  return db.prepare('INSERT INTO idempotency (user_id, operation, idem, response_json, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(userId, operation, idem, JSON.stringify(response), now);
}

export function asInt(value: unknown, name: string, allowed?: number[]): number {
  if (!Number.isSafeInteger(value) || (allowed && !allowed.includes(value as number))) throw new ApiError('UNKNOWN', `Invalid ${name}`);
  return value as number;
}

export function bool(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new ApiError('UNKNOWN', `Invalid ${name}`);
  return value;
}

export function dayKey(date = new Date()): string {
  return new Date(date.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
}

export function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
}
