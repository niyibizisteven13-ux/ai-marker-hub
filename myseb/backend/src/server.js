import express from 'express';
import { updateRouter } from './updates.js';
import { downloadRouter } from './downloads.js';
import { favicon, markImg } from './brand.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, safeEqual } from './config.js';
import { migrate, pool } from './db.js';
import { api } from './routes.js';
import { mySebGuard } from './guard.js';
import { flushHeartbeats, purgeOld, sweep } from './sessions.js';
import { liveStats } from './live.js';
import { loadControls, retentionDays } from './admin.js';
import { eventStats } from './events.js';
import { monitorEventLoopDelay } from 'node:perf_hooks';
const loopDelay = monitorEventLoopDelay({ resolution: 20 }); loopDelay.enable();
import { q } from './db.js';
import { linkRooms } from './linkRooms.js';
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
  const lag = Math.round(loopDelay.percentile(99) / 1e6); loopDelay.reset();
  const lines = [
    '# TYPE myseb_students gauge', ...['IN_EXAM', 'PAUSED', 'LEFT', 'ENDED'].map((st) => `myseb_students{status="${st}"} ${by.find((r) => r.status === st)?.n ?? 0}`),
    '# TYPE myseb_exams_active gauge', `myseb_exams_active ${exams}`,
    '# TYPE myseb_live_entries gauge', `myseb_live_entries ${live.reports}`, `myseb_signal_mailboxes ${live.mailboxes}`, `myseb_signal_waiting ${live.waiting}`, `myseb_picture_megabytes ${live.pictureMb}`, `myseb_room_streams ${eventStats().streams}`, `myseb_db_pool_waiting ${pool.waitingCount}`, `myseb_db_pool_busy ${pool.totalCount - pool.idleCount}`, `myseb_event_loop_lag_ms ${lag}`,
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
// Saved answers may be longer than everything else the API takes (a long essay); the route itself caps them at 200 KB.
const smallJson = express.json({ limit: '100kb' }); const answersJson = express.json({ limit: '260kb' });
app.use('/liveroom/api', smallJson, linkRooms);
app.use('/liveroom', express.static(path.join(here, '../public/liveroom'), {
  setHeaders: res => res.set('Content-Security-Policy', "default-src 'self'; img-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'"),
}));
app.use('/api', (req, res, next) => (req.path === '/partial' ? answersJson : smallJson)(req, res, next), api);
app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }));


app.use('/download', downloadRouter);
app.use('/updates', updateRouter);

/**
 * The link a lecturer shares with students (/join/<code>, also the QR). One link for everyone:
 *  - the app is installed: it opens with the code and name filled in and starts the test;
 *  - it is not installed: MySEB downloads at once for that device;
 *  - iPhone / iPad (no app exists): the test starts in the browser, if the lecturer allowed it, and goes straight to the quiz.
 * Nothing secret is in the link: the code is the same one the lecturer reads out.
 */
app.get('/join/:code', (req, res) => {
  const code = /^\d{6}$/.test(req.params.code) ? req.params.code : '';
  res.set('Cache-Control', 'no-store').set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'").type('html').send(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Join your test</title>${favicon}
<style>body{font-family:system-ui;margin:0;background:#f6f7f9;color:#1b2430}main{max-width:420px;margin:0 auto;padding:28px 18px 40px;text-align:center}
h1{font-size:24px;margin:6px 0}p{line-height:1.55;color:#4a5565}.code{font:700 34px/1.1 ui-monospace,monospace;letter-spacing:6px;margin:6px 0 18px;color:#1b2430}
input{box-sizing:border-box;width:100%;min-height:48px;border:1px solid #c9d0da;border-radius:12px;padding:0 14px;font-size:17px;margin:0 0 12px}
button,a.btn{display:block;box-sizing:border-box;width:100%;min-height:50px;border:0;border-radius:12px;background:#1d4ed8;color:#fff;font:700 17px system-ui;text-decoration:none;line-height:50px;cursor:pointer;margin:0 0 10px}
button.alt,a.alt{background:#fff;color:#1d4ed8;border:1px solid #c9d0da;font-weight:600}button:disabled{opacity:.55}
#msg{min-height:24px;font-weight:600;margin:8px 0}#msg.err{color:#b42318}.small{font-size:13px;color:#667085}#more{display:none;margin-top:14px}</style>
<main>${markImg(84)}<h1>Join your test</h1>
${code ? `<p>Exam code</p><div class="code">${code.slice(0, 3)} ${code.slice(3)}</div>
<form id="f" autocomplete="off"><input id="name" required maxlength="80" placeholder="Your name" aria-label="Your name" autocomplete="name"><button id="go" type="submit">Continue</button></form>
<div id="msg" role="status"></div>
<div id="more"><a class="btn" id="dl" href="#">Download MySEB</a><button class="alt" id="retry" type="button">I have MySEB: open it</button></div>
<button class="alt" id="web" type="button" style="display:none">Use my browser instead</button>
<p class="small" id="note"></p>` : `<p style="color:#b42318;font-weight:600">This link is not valid. Ask your lecturer for a new one.</p>`}
</main>
${code ? `<script>(function(){
var CODE=${JSON.stringify(code)}, base=location.pathname.replace(/\\/join\\/[^\\/]*$/,'');
var ua=navigator.userAgent, ios=/iPhone|iPad|iPod/.test(ua)||(/Macintosh/.test(ua)&&navigator.maxTouchPoints>1);
var $=function(i){return document.getElementById(i)}, msg=function(t,e){var m=$('msg');m.textContent=t;m.className=e?'err':''};
var store={get:function(k){try{return localStorage.getItem(k)}catch(e){return null}},set:function(k,v){try{localStorage.setItem(k,v)}catch(e){}}};
$('name').value=store.get('myseb.name')||'';
function device(){var d=store.get('myseb.webDevice');if(!d){d='web-'+(window.crypto&&crypto.randomUUID?crypto.randomUUID():Math.random().toString(36).slice(2,14));store.set('myseb.webDevice',d)}return d}
function openApp(name){
  msg('Opening MySEB…');$('go').disabled=true;var left=false;
  var mark=function(){left=true;store.set('myseb.opened','1')};
  window.addEventListener('blur',mark);document.addEventListener('visibilitychange',function(){if(document.hidden)mark()});window.addEventListener('pagehide',mark);
  location.href='myseb://join?code='+CODE+'&name='+encodeURIComponent(name);
  setTimeout(function(){
    $('go').disabled=false;if(left)return msg('MySEB is opening. You can close this page.');
    $('more').style.display='block';$('dl').href=base+'/download';
    if(store.get('myseb.opened')){msg('MySEB did not open. Tap "I have MySEB: open it" to try again.',true);return}
    msg('MySEB is not installed here. Downloading it now…');location.href=base+'/download';
  },2600);
}
function joinBrowser(name){
  msg('Starting your test…');$('go').disabled=true;$('web').disabled=true;
  fetch(base+'/api/verify-code',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:CODE,studentName:name,deviceId:device(),clientType:'web',touch:(navigator.maxTouchPoints||0)>1,platform:navigator.platform||'browser'})})
   .then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j}})})
   .then(function(x){if(!x.ok)throw new Error(x.j.error||'That did not work.');location.href=x.j.examUrl})
   .catch(function(e){$('go').disabled=false;$('web').disabled=false;var t=(e&&e.message)||'That did not work.';if(/not allowed/.test(t))t=ios?'Your lecturer has not turned on the browser for this test yet. Ask them to, or use a laptop or an Android phone with MySEB.':'Your lecturer has not turned on the browser for this test. Use the MySEB app.';msg(t,true)});
}
if(ios){$('go').textContent='Start the test';$('note').textContent='There is no MySEB app for iPhone yet, so your test opens in this browser. Your camera must stay on with your face in it. If you leave the page, close it or move your face away, your test ends and you cannot start again.'}
else{$('web').style.display='block';$('note').textContent='MySEB opens by itself. If you do not have it, it downloads now.'}
$('f').addEventListener('submit',function(e){e.preventDefault();var n=$('name').value.trim();if(!n)return;store.set('myseb.name',n);ios?joinBrowser(n):openApp(n)});
$('retry').addEventListener('click',function(){var n=$('name').value.trim();if(n)openApp(n)});
$('web').addEventListener('click',function(){var n=$('name').value.trim();if(!n)return msg('Write your name first.',true);store.set('myseb.name',n);joinBrowser(n)});
})();</script>` : ''}</html>`);
});

if (config.dashboardEnabled) app.use('/dashboard', express.static(path.join(here, '../public/dashboard'), {
  setHeaders: (res) => res.set('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'"),
}));
app.get('/', (_req, res) => (config.dashboardEnabled ? res.redirect(`${config.basePath}/dashboard/`) : res.json({ name: 'MySEB', ok: true })));

app.use((err, _req, res, _next) => {
  // A body that is too big or not JSON is the caller's mistake (4xx), not a server error.
  const status = Number(err?.status ?? err?.statusCode);
  if (status >= 400 && status < 500) return res.status(status).json({ error: status === 413 ? 'That is too big.' : 'Bad request.' });
  console.error(err); res.status(500).json({ error: 'server error' });
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await migrate();
  await loadControls();
  const tick = () => sweep().catch((e) => console.error('sweep', e));
  setInterval(tick, 5000).unref();
  setInterval(() => flushHeartbeats().catch((e) => console.error('heartbeats', e)), 2000).unref();   // "still here" times, written for everyone at once
  // Retention: once at start, then every hour.
  const purge = () => q('DELETE FROM link_rooms WHERE expires_at <= now()').then(() => purgeOld()).then((r) => { if (r.sessions || r.exams) console.log(`retention: removed ${r.sessions} finished students and ${r.exams} old exams (older than ${retentionDays()} days)`); }).catch((e) => console.error('purge', e));
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
