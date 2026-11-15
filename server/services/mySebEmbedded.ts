import crypto from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Express } from 'express';

/**
 * Runs the MySEB exam server inside this same server, under /myseb, so no second machine is needed.
 * It is used when MYSEB_URL is not set. If MYSEB_URL is set, MySEB is somewhere else and nothing is mounted.
 * It shares this server's database (its own tables) and derives its secrets from JWT_SECRET, so there is nothing new to configure.
 */
export const mysebEmbeddedWanted = () => !process.env.MYSEB_URL && process.env.MYSEB_EMBED !== '0';

export async function mountEmbeddedMySeb(app: Express, port: number): Promise<boolean> {
  if (!mysebEmbeddedWanted()) return false;
  const e = process.env;
  const secret = e.JWT_SECRET || 'dev-secret';
  const derive = (label: string) => crypto.createHmac('sha256', secret).update(`myseb:${label}`).digest('hex');
  const site = (e.APP_URL || e.APP_BASE_URL || e.RENDER_EXTERNAL_URL || (e.VERCEL_PROJECT_PRODUCTION_URL ? `https://${e.VERCEL_PROJECT_PRODUCTION_URL}` : '') || `http://127.0.0.1:${port}`).replace(/\/$/, '');
  e.TEACHER_KEY ||= derive('teacher-key');
  e.PEPPER ||= derive('pepper');
  e.PUBLIC_URL ||= `${site}/myseb`;
  e.TRUST_PROXY ||= '1';
  e.MYSEB_SERVICE_KEY ||= e.TEACHER_KEY;
  e.MYSEB_URL = `http://127.0.0.1:${port}/myseb`;      // bwenge talks to MySEB over the loopback
  // Loaded from disk at run time (not bundled), because it reads its own schema and dashboard files next to itself.
  const load = (f: string) => import(pathToFileURL(path.join(process.cwd(), 'myseb/backend/src', f)).href);
  const m = await load('server.js');
  const { migrate } = await load('db.js');
  const { sweep, purgeOld } = await load('sessions.js');
  await migrate();
  app.use('/myseb', m.app);
  setInterval(() => { sweep().catch(() => undefined); }, 5000).unref();
  const purge = () => { purgeOld().catch(() => undefined); };
  purge(); setInterval(purge, 3_600_000).unref();
  return true;
}
