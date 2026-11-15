import crypto from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import type { Express, Request, Response } from 'express';

/**
 * Runs the MySEB exam server on this same machine, in its OWN process, and passes /myseb to it.
 * Its own process means its own CPU core and event loop: a crowd of students cannot slow the website, and marking
 * jobs cannot slow an exam. Used when MYSEB_URL is not set (MYSEB_EMBED=0 turns it off).
 * It shares this server's PostgreSQL (its own tables) and derives its secrets from JWT_SECRET: nothing to configure.
 */
export const mysebEmbeddedWanted = () => !process.env.MYSEB_URL && process.env.MYSEB_EMBED !== '0';

const freePort = () => new Promise<number>((resolve, reject) => {
  const s = net.createServer(); s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); });
});
const ready = async (port: number, ms = 20_000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const ok = await new Promise<boolean>((r) => { http.get({ host: '127.0.0.1', port, path: '/readyz', timeout: 1500 }, (x) => { x.resume(); r(x.statusCode === 200); }).on('error', () => r(false)); });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
};

export interface EmbeddedHandle { port: number; stop(): void }

export async function mountEmbeddedMySeb(app: Express, sitePort: number): Promise<EmbeddedHandle | null> {
  if (!mysebEmbeddedWanted()) return null;
  const e = process.env;
  const secret = e.JWT_SECRET || 'dev-secret';
  const derive = (label: string) => crypto.createHmac('sha256', secret).update(`myseb:${label}`).digest('hex');
  const site = (e.APP_URL || e.APP_BASE_URL || e.RENDER_EXTERNAL_URL || (e.VERCEL_PROJECT_PRODUCTION_URL ? `https://${e.VERCEL_PROJECT_PRODUCTION_URL}` : '') || `http://127.0.0.1:${sitePort}`).replace(/\/$/, '');
  const teacherKey = e.TEACHER_KEY || derive('teacher-key');
  const port = await freePort();
  const childEnv = {
    ...e, PORT: String(port), TEACHER_KEY: teacherKey, PEPPER: e.PEPPER || derive('pepper'),
    PUBLIC_URL: e.PUBLIC_URL || `${site}/myseb`, TRUST_PROXY: '1', HOST: '127.0.0.1',
  };
  e.MYSEB_SERVICE_KEY ||= teacherKey;
  e.MYSEB_URL = `http://127.0.0.1:${port}`;            // bwenge talks to MySEB directly, not through its own proxy

  const script = path.join(process.cwd(), 'myseb/backend/src/server.js');
  let child: ChildProcess | null = null, stopping = false, restarts = 0;
  const state: { running: boolean; restarts: number; lastExit: { code: number | null; signal: string | null; at: string } | null } = { running: false, restarts: 0, lastExit: null };
  const start = () => {
    // Every waiting student is an open connection. Where the system allows it, raise this process's limit on open connections to the
    // maximum, so a big room does not run out ("too many open files") and crash.
    child = process.platform === 'win32'
      ? spawn(process.execPath, [script], { env: childEnv, stdio: ['ignore', 'inherit', 'inherit'] })
      : spawn('sh', ['-c', 'ulimit -n "$(ulimit -Hn)" 2>/dev/null; exec "$0" "$@"', process.execPath, script], { env: childEnv, stdio: ['ignore', 'inherit', 'inherit'] });
    state.running = true;
    child.on('exit', (code, signal) => {
      state.running = false; state.lastExit = { code, signal, at: new Date().toISOString() };
      if (stopping) return;
      console.error(`[MySEB] exited (code ${code}, signal ${signal}); restarting`);
      state.restarts = ++restarts;
      setTimeout(start, Math.min(1000 * restarts, 30_000)).unref();   // never gives up: a crash loop backs off to one try every 30 s
    });
  };
  start();
  const stop = () => { stopping = true; child?.kill('SIGTERM'); };
  process.once('exit', stop); process.once('SIGTERM', stop); process.once('SIGINT', stop);
  // A slow or failing start is not fatal: the website keeps working, /myseb answers 502 until MySEB is up, and the restart loop keeps trying.
  if (!(await ready(port))) console.error('[MySEB] is not ready after 20 s; the site continues and /myseb/_status shows how it last stopped');

  // Everything under /myseb goes to the MySEB process. Streams straight through (long waits for signalling included).
  const agent = new http.Agent({ keepAlive: true, maxSockets: 2000 });
  // /myseb/_status is answered here (not by MySEB), so it still works while MySEB is down: it says whether it runs and how it last stopped.
  let inFlight = 0, shed = 0;
  const MAX_INFLIGHT = Number(e.MYSEB_MAX_INFLIGHT || 1500);
  app.get('/myseb/_status', (_req: Request, res: Response) => { res.set('Cache-Control', 'no-store').json({ ...state, inFlight, shed }); });
  app.use('/myseb', (req: Request, res: Response) => {
    // Too many requests at once (an overload): answer "busy, try again" straight away instead of queueing without limit until memory runs out.
    if (inFlight >= MAX_INFLIGHT) { shed++; res.set('Retry-After', '3').status(503).json({ error: 'MySEB is busy, try again in a moment.' }); return; }
    inFlight++; let counted = true; const leave = () => { if (counted) { counted = false; inFlight--; } };
    res.on('close', leave); res.on('finish', leave);
    const headers = { ...req.headers, host: req.headers.host ?? '', 'x-forwarded-for': req.ip || req.socket.remoteAddress || '' } as http.OutgoingHttpHeaders;
    const up = http.request({ host: '127.0.0.1', port, method: req.method, path: req.url || '/', headers, agent }, (r) => { res.writeHead(r.statusCode || 502, r.headers); r.pipe(res); });
    up.on('error', () => { if (!res.headersSent) res.status(502).json({ error: 'MySEB is restarting, try again in a moment.' }); else res.destroy(); });
    up.setTimeout(40_000, () => up.destroy());      // a request that gets no answer for 40 s is dropped, never held forever
    res.on('close', () => up.destroy());
    req.pipe(up);
  });
  return { port, stop };
}
