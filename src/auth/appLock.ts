/** "Lock the app on this phone": a per-device setting, kept in the phone's own storage (never sent to the server). */
const KEY = 'bwenge:applock';
export interface AppLockConfig { on: boolean; minutes: number }
export const MINUTE_CHOICES = [0, 1, 5, 15] as const;       // 0 = every time the app is opened or returns to the screen

export function readAppLock(): AppLockConfig {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { on: v?.on === true, minutes: (MINUTE_CHOICES as readonly number[]).includes(v?.minutes) ? v.minutes : 1 };
  } catch { return { on: false, minutes: 1 }; }
}
export function writeAppLock(c: AppLockConfig) {
  try { localStorage.setItem(KEY, JSON.stringify(c)); window.dispatchEvent(new Event('bwenge:applock-changed')); } catch { /* private mode: the lock simply stays off */ }
}
/** Should the lock show now? `awayMs` is how long the app was out of sight; `null` = it was just opened. */
export function shouldLock(c: AppLockConfig, awayMs: number | null): boolean {
  if (!c.on) return false;
  return awayMs === null || awayMs >= c.minutes * 60_000;
}
