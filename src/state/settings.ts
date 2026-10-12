// Device settings that outlive a launch: sound muted (F6.2), the account sheet's notification toggles (F7.3), and whether the
// onboarding sheets have been seen on this device (#116: the server's ageConfirmed used to double as that flag). A small JSON
// file next to the kept pulls. Reads never throw: a missing or unreadable file, or a missing field, gives the defaults.
// The sheet no longer shows a daily reminder (#376). Shipment, restock, and the retired daily key stay in this file so a
// saved value is not dropped the next time sound is written.
import { readStored, writeStored } from './storage';

export type NotifyKey = 'daily' | 'shipments' | 'restock';
export type Settings = { muted: boolean; notify: Record<NotifyKey, boolean>; onboarded: boolean };
/** The design's defaults: the daily capsule reminder and shipment updates on, restock alerts off. */
export const DEFAULT_SETTINGS: Settings = { muted: false, notify: { daily: true, shipments: true, restock: false }, onboarded: false };

const NAME = 'settings.json';
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);

export function readSettings(): Settings {
  try {
    const text = readStored(NAME);
    if (text === null) return DEFAULT_SETTINGS;
    const saved = JSON.parse(text) as { muted?: unknown; notify?: Partial<Record<NotifyKey, unknown>>; onboarded?: unknown } | null;
    const n = DEFAULT_SETTINGS.notify;
    return {
      muted: bool(saved?.muted, DEFAULT_SETTINGS.muted),
      notify: { daily: bool(saved?.notify?.daily, n.daily), shipments: bool(saved?.notify?.shipments, n.shipments), restock: bool(saved?.notify?.restock, n.restock) },
      onboarded: bool(saved?.onboarded, DEFAULT_SETTINGS.onboarded),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** A failed write (a full or blocked store) keeps this launch's setting; only a relaunch would forget it. */
export function writeSettings(settings: Settings): void {
  writeStored(NAME, JSON.stringify(settings));
}

/** Save a change to some settings and keep the rest as they are on disk: the one place a write merges, so a sound change never
 *  clobbers the notification toggles or the other way round. Returns what was saved. */
export function updateSettings(patch: Partial<Settings>): Settings {
  const next = { ...readSettings(), ...patch };
  writeSettings(next);
  return next;
}
