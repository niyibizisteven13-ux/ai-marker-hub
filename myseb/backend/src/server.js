import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, safeEqual } from './config.js';
import { migrate, pool } from './db.js';
import { api } from './routes.js';
import { mySebGuard } from './guard.js';
import { purgeOld, sweep } from './sessions.js';
import { liveStats } from './live.js';
import { q } from './db.js';
import { examRouter } from './exam.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const app = express();
app.set('trust proxy', process.env.TRUST_PROXY ? 1 : false);
app.disable('x-powered-by');
app.use((_req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); res.set('Referrer-Policy', 'no-referrer'); next(); });

// For a load balancer or an uptime monitor. /healthz: the process is alive. /readyz: and the database answers.
app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.get('/readyz', async (_req, res) => { try { await q('SELECT 1'); res.json({ ok: true }); } catch { res.status(503).json({ ok: false }); } });

// Numbers for monitoring (Prometheus text format). Needs the teacher key: it says how busy the exam server is.
app.get('/metrics', async (req, res) => {
  const key = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!key || !safeEqual(key, config.teacherKey)) return res.status(401).type('text').send('unauthorized\n');
  const by = (await q(`SELECT status, count(*)::int AS n FROM exam_sessions GROUP BY status`)).rows;
  const exams = (await q(`SELECT count(*)::int AS n FROM exams WHERE status='active'`)).rows[0].n;
  const live = liveStats(); const mem = process.memoryUsage();
  const lines = [
    '# TYPE myseb_students gauge', ...['IN_EXAM', 'PAUSED', 'LEFT', 'ENDED'].map((st) => `myseb_students{status="${st}"} ${by.find((r) => r.status === st)?.n ?? 0}`),
    '# TYPE myseb_exams_active gauge', `myseb_exams_active ${exams}`,
    '# TYPE myseb_live_entries gauge', `myseb_live_entries ${live.reports}`, `myseb_signal_mailboxes ${live.mailboxes}`,
    '# TYPE myseb_process_resident_bytes gauge', `myseb_process_resident_bytes ${mem.rss}`,
    '# TYPE myseb_process_uptime_seconds gauge', `myseb_process_uptime_seconds ${Math.round(process.uptime())}`,
  ];
  res.type('text/plain; version=0.0.4').send(lines.join('\n') + '\n');
});

// The exam site: EVERY request under /exam/:id goes through the guard first.
// Only real UUIDs are exam routes; anything else under /exam is a 404 (never "let through").
app.get('/exam/:examId([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})', (req, res, next) => (req.originalUrl.split('?')[0].endsWith('/') ? next() : res.redirect(301, `${config.basePath}/exam/${req.params.examId}/`)));
app.use('/exam/:examId([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})', mySebGuard((req) => req.params.examId), examRouter);

process.on('unhandledRejection', (e) => console.error('unhandledRejection', e));   // one bad request must never take the exam server down
app.use('/api', express.json({ limit: '100kb' }), api);
app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }));


// The page to give students: detects the device and shows the right download first. Public, no key.
const RELEASE = () => (process.env.MYSEB_RELEASE_URL || 'https://github.com/niyibizisteven13-ux/ai-marker-hub/releases/latest/download').replace(/\/$/, '');
const links = () => {
  const e = process.env; const r = RELEASE();
  return {
    windows: e.MYSEB_DL_WINDOWS || `${r}/MySEB-win.exe`, mac: e.MYSEB_DL_MAC || `${r}/MySEB-mac.dmg`,
    linux: e.MYSEB_DL_LINUX || `${r}/MySEB-linux.AppImage`, android: e.MYSEB_DL_ANDROID || `${r}/MySEB.apk`,
  };
};
app.get('/download', (req, res) => {
  const ua = String(req.get('user-agent') || '');
  const mine = /android/i.test(ua) ? 'android' : /iphone|ipad/i.test(ua) ? 'ios' : /windows/i.test(ua) ? 'windows' : /mac os/i.test(ua) ? 'mac' : /linux|x11/i.test(ua) ? 'linux' : '';
  const l = links();
  const label = { windows: 'Windows laptop', mac: 'Mac laptop', linux: 'Linux laptop', android: 'Android phone' };
  const btn = (k, big) => `<a href="${l[k]}" style="display:block;margin:10px 0;padding:${big ? '18px' : '12px'};border-radius:12px;text-align:center;text-decoration:none;font-weight:700;font-size:${big ? '20px' : '15px'};${big ? 'background:#B4502F;color:#fff' : 'background:#f1f1f1;color:#222'}">Download for ${label[k]}</a>`;
  const others = Object.keys(label).filter((k) => k !== mine).map((k) => btn(k, false)).join('');
  const intro = mine === 'ios' ? '<p style="color:#b00">iPhone and iPad are not supported yet. Please use a laptop or an Android phone.</p>' : mine ? btn(mine, true) : '';
  res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'").type('html').send(
    `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Get MySEB</title>
<body style="font-family:system-ui;max-width:420px;margin:0 auto;padding:28px 16px"><h2 style="text-align:center">Get MySEB</h2>
<p style="text-align:center;color:#555">The secure exam app. Install it once, then open it and type the code from your lecturer.</p>${intro}
<p style="color:#777;font-size:13px;margin-top:22px">${mine ? 'Other devices:' : 'Choose your device:'}</p>${others}
<p style="color:#777;font-size:12px;margin-top:22px">Windows may say "unknown publisher": choose More info, then Run anyway. On Android, allow installing from this source when asked.</p>`);
});

app.get('/join/:code', (req, res) => {
  const code = /^\d{6}$/.test(req.params.code) ? req.params.code : '';
  const dl = `${config.publicUrl}/download`;
  res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'").type('html').send(
    `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Join exam</title>
<body style="font-family:system-ui;text-align:center;padding:32px"><h2>Open MySEB</h2><p>Your exam code is</p>
<p style="font-size:34px;letter-spacing:4px;font-weight:700">${code || '—'}</p>
<p><a href="myseb://join?code=${code}&api=${encodeURIComponent(config.publicUrl)}" style="font-size:18px">Open in the MySEB app</a></p>
<p style="color:#666">Exams cannot be taken in the browser. Install MySEB, then enter the code.</p>${dl ? `<p><a href="${dl}" style="font-size:18px">Download MySEB</a></p>` : ''}`);
});

if (config.dashboardEnabled) app.use('/dashboard', express.static(path.join(here, '../public/dashboard'), {
  setHeaders: (res) => res.set('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'"),
}));
app.get('/', (_req, res) => (config.dashboardEnabled ? res.redirect(`${config.basePath}/dashboard/`) : res.json({ name: 'MySEB', ok: true })));

app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: 'server error' }); });

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await migrate();
  const tick = () => sweep().catch((e) => console.error('sweep', e));
  setInterval(tick, 5000).unref();
  // Retention: once at start, then every hour.
  const purge = () => purgeOld().then((r) => { if (r.sessions || r.exams) console.log(`retention: removed ${r.sessions} finished students and ${r.exams} old exams (older than ${config.retentionDays} days)`); }).catch((e) => console.error('purge', e));
  purge(); setInterval(purge, 3_600_000).unref();
  const server = app.listen(config.port, process.env.HOST || '0.0.0.0', () => console.log(`MySEB backend on :${config.port}${config.dashboardEnabled ? `  dashboard: ${config.publicUrl}/dashboard/` : '  (standalone dashboard off)'}`));
  // Graceful stop (deploys, restarts): stop taking new work, let short requests finish, drop waiting long-polls after 3 s.
  let stopping = false;
  const stop = (sig) => {
    if (stopping) return; stopping = true; console.log(`${sig}: shutting down`);
    server.close(() => pool.end().finally(() => process.exit(0)));
    server.closeIdleConnections?.();
    setTimeout(() => { server.closeAllConnections?.(); }, 3000).unref();
    setTimeout(() => process.exit(0), 15000).unref();
  };
  process.on('SIGTERM', () => stop('SIGTERM')); process.on('SIGINT', () => stop('SIGINT'));
}
