// GET /season and GET /me/streak. A bad payload is refused rather than rendered.
import type { MeStreak, Season, SeasonPrize } from '@/api/contract';

function prize(value: unknown): SeasonPrize {
  if (!value || typeof value !== 'object') throw new Error('season prize');
  const row = value as Record<string, unknown>;
  if (row.slot !== 'grand' && row.slot !== 'mid') throw new Error('season prize slot');
  if (typeof row.cardId !== 'string' || !row.cardId) throw new Error('season prize card');
  if (typeof row.name !== 'string' || !row.name) throw new Error('season prize name');
  if (typeof row.set !== 'string' || !row.set) throw new Error('season prize set');
  if (typeof row.number !== 'string' || !row.number) throw new Error('season prize number');
  if (row.grade !== 'PSA 10') throw new Error('season prize grade');
  if (typeof row.cert !== 'string' || !row.cert) throw new Error('season prize cert');
  if (typeof row.photo !== 'string') throw new Error('season prize photo');
  // Underwrite dollars are not a client field. A payload that still carries valueUsd is accepted and the number is dropped.
  return {
    slot: row.slot, cardId: row.cardId, name: row.name, set: row.set, number: row.number,
    grade: 'PSA 10', cert: row.cert, photo: row.photo,
  };
}

export function parseSeason(body: unknown): Season {
  if (!body || typeof body !== 'object') throw new Error('season body');
  const row = body as Record<string, unknown>;
  if (typeof row.id !== 'string' || !row.id) throw new Error('season id');
  if (typeof row.title !== 'string' || !row.title) throw new Error('season title');
  if (typeof row.drawAt !== 'string' || Number.isNaN(Date.parse(row.drawAt))) throw new Error('season drawAt');
  if (typeof row.myTickets !== 'number' || !Number.isInteger(row.myTickets) || row.myTickets < 0) throw new Error('season myTickets');
  if (!row.streak || typeof row.streak !== 'object') throw new Error('season streak');
  const streak = row.streak as Record<string, unknown>;
  if (typeof streak.count !== 'number' || !Number.isInteger(streak.count) || streak.count < 0 || streak.count > 4) throw new Error('season streak count');
  if (typeof streak.countedToday !== 'boolean') throw new Error('season streak countedToday');
  if (!Array.isArray(row.prizes)) throw new Error('season prizes');
  const prizes = row.prizes.map(prize);
  if (prizes.length !== 5 || prizes.filter((item) => item.slot === 'grand').length !== 1) throw new Error('season prizes');
  return {
    id: row.id, title: row.title, drawAt: row.drawAt, prizes, myTickets: row.myTickets,
    streak: { count: streak.count, countedToday: streak.countedToday },
  };
}

export function parseStreak(body: unknown): MeStreak {
  if (!body || typeof body !== 'object') throw new Error('streak body');
  const row = body as Record<string, unknown>;
  if (typeof row.count !== 'number' || !Number.isInteger(row.count) || row.count < 0 || row.count > 4) throw new Error('streak count');
  if (typeof row.countedToday !== 'boolean') throw new Error('streak countedToday');
  if (typeof row.bonusJustEarned !== 'boolean') throw new Error('streak bonusJustEarned');
  if (typeof row.resetsAt !== 'string' || Number.isNaN(Date.parse(row.resetsAt))) throw new Error('streak resetsAt');
  return { count: row.count, countedToday: row.countedToday, bonusJustEarned: row.bonusJustEarned, resetsAt: row.resetsAt };
}
