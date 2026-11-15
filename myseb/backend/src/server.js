import express from 'express';
import { downloadRouter } from './downloads.js';
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


app.use('/download', downloadRouter);

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
