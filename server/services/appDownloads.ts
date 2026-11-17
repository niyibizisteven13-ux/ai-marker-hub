import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../db.js';

/**
 * Counting downloads and installs on the "Get the app" page, and the version of the running site (for the "new version" notice).
 * Counts live in AppSetting, one key per app and device: dl:<app>:<platform> -> { click, installed, days: { "2026-11-17": { click, installed } } }.
 * "click" = pressed the download or install button; "installed" = the browser said the app was installed. Counts are for the administrator only.
 */
const db = prisma as any;
export const APPS = ['bwenge', 'myseb'] as const;
export const PLATFORMS = ['android', 'ios', 'windows', 'mac', 'linux'] as const;
export const KINDS = ['click', 'installed'] as const;
export type App = (typeof APPS)[number]; export type Platform = (typeof PLATFORMS)[number]; export type Kind = (typeof KINDS)[number];
const KEEP_DAYS = 120;

export const isApp = (v: unknown): v is App => (APPS as readonly string[]).includes(String(v));
export const isPlatform = (v: unknown): v is Platform => (PLATFORMS as readonly string[]).includes(String(v));
export const isKind = (v: unknown): v is Kind => (KINDS as readonly string[]).includes(String(v));

interface Row { click: number; installed: number; days: Record<string, { click?: number; installed?: number }> }
const key = (app: App, platform: Platform) => `dl:${app}:${platform}`;
const day = (now = Date.now()) => new Date(now + 2 * 3600_000).toISOString().slice(0, 10);   // Kigali date

async function read(app: App, platform: Platform): Promise<Row> {
  const r = await db.appSetting.findUnique({ where: { key: key(app, platform) } }).catch(() => null);
  const v = r?.value && typeof r.value === 'object' ? (r.value as Partial<Row>) : {};
  return { click: Number(v.click) || 0, installed: Number(v.installed) || 0, days: v.days && typeof v.days === 'object' ? v.days : {} };
}

// The same person pressing twice in a minute is one download (and a refresh does not count).
const recent = new Map<string, number>();
export function isRepeat(who: string, app: App, platform: Platform, kind: Kind, now = Date.now()): boolean {
  const k = `${who}|${app}|${platform}|${kind}`; const last = recent.get(k) ?? 0;
  if (recent.size > 5000) for (const [kk, t] of recent) if (now - t > 60_000) recent.delete(kk);
  if (now - last < 60_000) return true;
  recent.set(k, now); return false;
}

/** Adds one to the count. Concurrent presses may very rarely be counted once; these numbers are for orientation, not accounting. */
export async function count(app: App, platform: Platform, kind: Kind, now = Date.now()): Promise<void> {
  const row = await read(app, platform);
  row[kind] += 1;
  const d = day(now); row.days[d] = { ...row.days[d], [kind]: (row.days[d]?.[kind] ?? 0) + 1 };
  for (const old of Object.keys(row.days).sort().slice(0, Math.max(0, Object.keys(row.days).length - KEEP_DAYS))) delete row.days[old];
  const k = key(app, platform); const at = new Date(now);
  const ex = await db.appSetting.findUnique({ where: { key: k } }).catch(() => null);
  if (ex) await db.appSetting.update({ where: { key: k }, data: { value: row, updatedBy: 'downloads', updatedAt: at } });
  else await db.appSetting.create({ data: { key: k, value: row, updatedBy: 'downloads', updatedAt: at } });
}

export interface Summary { rows: Array<{ app: App; platform: Platform; click: number; installed: number; last7: number; last30: number }>; total: { click: number; installed: number }; days: Array<{ day: string; click: number; installed: number }> }
export async function summary(now = Date.now()): Promise<Summary> {
  const since = (n: number) => day(now - n * 86_400_000);
  const rows: Summary['rows'] = []; const perDay = new Map<string, { click: number; installed: number }>();
  for (const app of APPS) for (const platform of PLATFORMS) {
    const r = await read(app, platform);
    if (!r.click && !r.installed) continue;
    let last7 = 0, last30 = 0;
    for (const [d, v] of Object.entries(r.days)) {
      const n = (v.click ?? 0);
      if (d > since(7)) last7 += n; if (d > since(30)) last30 += n;
      if (d > since(30)) { const p = perDay.get(d) ?? { click: 0, installed: 0 }; p.click += v.click ?? 0; p.installed += v.installed ?? 0; perDay.set(d, p); }
    }
    rows.push({ app, platform, click: r.click, installed: r.installed, last7, last30 });
  }
  return {
    rows: rows.sort((a, b) => b.click - a.click),
    total: { click: rows.reduce((a, r) => a + r.click, 0), installed: rows.reduce((a, r) => a + r.installed, 0) },
    days: [...perDay].sort((a, b) => a[0].localeCompare(b[0])).map(([d, v]) => ({ day: d, ...v })),
  };
}

/* ---------------------------------------------------------------- site version */
let buildId: string | null = null;
/** A short id of the site that is running: APP_BUILD or the commit, else a hash of the built index page (it changes with every build). */
export function siteBuild(env: NodeJS.ProcessEnv = process.env, distDir = path.join(process.cwd(), 'dist')): string {
  if (buildId) return buildId;
  try { const built = JSON.parse(fs.readFileSync(path.join(distDir, 'build.json'), 'utf8')); if (typeof built.build === 'string') return (buildId = built.build); } catch { /* older build */ }
  const fromEnv = env.APP_BUILD || env.VERCEL_GIT_COMMIT_SHA || env.GIT_COMMIT || env.SOURCE_VERSION;
  if (fromEnv) return (buildId = String(fromEnv).slice(0, 12));
  try { return (buildId = crypto.createHash('sha256').update(fs.readFileSync(path.join(distDir, 'index.html'))).digest('hex').slice(0, 12)); } catch { return (buildId = 'dev'); }
}
export const resetBuildForTests = () => { buildId = null; };
