/**
 * When a scheduled task runs next. Pure (no database, no clock of its own), so every case can be tested.
 * Times are the user's local time in their time zone (default Africa/Kigali), so "every Friday at 16:00" means 16:00 where they are.
 */
export type Schedule =
  | { kind: 'once'; at: string }                                   // an exact moment (ISO, UTC)
  | { kind: 'daily'; time: string }                                // every day at HH:MM
  | { kind: 'weekly'; time: string; days: number[] };              // on these days (0 = Sunday ... 6 = Saturday) at HH:MM

export const DEFAULT_TZ = 'Africa/Kigali';
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const validTimeZone = (tz: string): boolean => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } };
export function parseTime(t: unknown): { h: number; m: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  return h >= 0 && h <= 23 && mi >= 0 && mi <= 59 ? { h, m: mi } : null;
}
const pad = (n: number) => String(n).padStart(2, '0');

/** The wall-clock parts of an instant in a time zone. */
function partsIn(ts: number, tz: string) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short' });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(new Date(ts))) p[x.type] = x.value;
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { y: Number(p.year), mo: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24, mi: Number(p.minute), s: Number(p.second), dow };
}
/** Milliseconds the time zone is ahead of UTC at that instant. */
function offsetAt(ts: number, tz: string): number {
  const p = partsIn(ts, tz);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ts / 1000) * 1000;
}
/** The instant when the wall clock in `tz` shows this date and time. */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let utc = guess - offsetAt(guess, tz);
  utc = guess - offsetAt(utc, tz);       // once more: the offset may differ at the corrected instant (daylight saving)
  return utc;
}

/** The first run strictly after `after`, or null when there is none (a one-time task whose moment has passed). */
export function nextRun(s: Schedule, after: Date, tz: string = DEFAULT_TZ): Date | null {
  const t = after.getTime();
  if (s.kind === 'once') { const at = Date.parse(s.at); return Number.isFinite(at) && at > t ? new Date(at) : null; }
  const time = parseTime(s.time); if (!time) return null;
  const days = s.kind === 'weekly' ? new Set(s.days) : null;
  if (days && days.size === 0) return null;
  const today = partsIn(t, tz);
  for (let add = 0; add <= 8; add++) {
    // the calendar date `add` days after today in this zone (computed on noon UTC so the date arithmetic cannot jump a day)
    const base = new Date(Date.UTC(today.y, today.mo - 1, today.d + add, 12));
    const y = base.getUTCFullYear(), mo = base.getUTCMonth() + 1, d = base.getUTCDate(), dow = base.getUTCDay();
    if (days && !days.has(dow)) continue;
    const at = zonedToUtc(y, mo, d, time.h, time.m, tz);
    if (at > t) return new Date(at);
  }
  return null;
}

/** Plain words for a schedule ("every Friday at 16:00"). */
export function describeSchedule(s: Schedule, tz: string = DEFAULT_TZ): string {
  if (s.kind === 'once') {
    const p = partsIn(Date.parse(s.at), tz);
    return `once, on ${DAYS[p.dow]} ${p.d}/${p.mo}/${p.y} at ${pad(p.h)}:${pad(p.mi)}`;
  }
  const time = parseTime(s.time); const at = time ? `${pad(time.h)}:${pad(time.m)}` : s.time;
  if (s.kind === 'daily') return `every day at ${at}`;
  const sorted = [...new Set(s.days)].sort((a, b) => a - b);
  if (sorted.join() === '1,2,3,4,5') return `every weekday at ${at}`;
  if (sorted.join() === '0,6') return `every weekend at ${at}`;
  return `every ${sorted.map((d) => DAYS[d]).join(', ')} at ${at}`;
}

/** Checks what the model (or the user) asked for and turns it into a Schedule. */
export function buildSchedule(input: { when?: string; time?: string; days?: unknown; at?: string }, now: Date = new Date(), tz: string = DEFAULT_TZ): { ok: true; schedule: Schedule } | { ok: false; error: string } {
  const when = String(input.when ?? '').toLowerCase();
  if (when === 'once') {
    const at = Date.parse(String(input.at ?? ''));
    if (!Number.isFinite(at)) return { ok: false, error: 'For a one-time task give "at" as a date and time, for example 2026-12-04T16:00:00+02:00.' };
    if (at <= now.getTime()) return { ok: false, error: 'That moment has already passed.' };
    if (at > now.getTime() + 366 * 86_400_000) return { ok: false, error: 'A one-time task can be at most a year ahead.' };
    return { ok: true, schedule: { kind: 'once', at: new Date(at).toISOString() } };
  }
  const time = parseTime(input.time);
  if (!time) return { ok: false, error: 'Give the time as HH:MM, for example 07:30 or 16:00.' };
  const hhmm = `${pad(time.h)}:${pad(time.m)}`;
  if (when === 'daily') return { ok: true, schedule: { kind: 'daily', time: hhmm } };
  if (when === 'weekly') {
    const days = Array.isArray(input.days) ? [...new Set(input.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))] : [];
    if (!days.length) return { ok: false, error: 'For a weekly task say which days (0 = Sunday ... 6 = Saturday), for example [5] for Fridays or [1,2,3,4,5] for weekdays.' };
    return { ok: true, schedule: { kind: 'weekly', time: hhmm, days } };
  }
  return { ok: false, error: 'Say when: once, daily or weekly.' };
}
