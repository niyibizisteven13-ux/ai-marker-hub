/** Which kind of device is this? Used by the "Get the app" page to show the right download first. */
export type Platform = 'android' | 'ios' | 'windows' | 'mac' | 'linux' | 'other';

/**
 * From the browser's user-agent text. An iPad that asks for the desktop site says "Macintosh", so `touchPoints` (more than 1 means a touch
 * screen) tells it apart from a real Mac. ChromeOS counts as "other" (it installs web apps like a computer, but has no Linux app).
 */
export function detectPlatform(ua: string, touchPoints = 0): Platform {
  const s = String(ua ?? '');
  if (/iphone|ipad|ipod/i.test(s)) return 'ios';
  if (/macintosh|mac os x/i.test(s)) return touchPoints > 1 ? 'ios' : 'mac';
  if (/android/i.test(s)) return 'android';
  if (/windows/i.test(s)) return 'windows';
  if (/cros/i.test(s)) return 'other';
  if (/linux|x11/i.test(s)) return 'linux';
  return 'other';
}

export const PLATFORM_LABEL: Record<Platform, string> = { android: 'Android', ios: 'iPhone / iPad', windows: 'Windows', mac: 'Mac', linux: 'Linux', other: 'your device' };
