import { authSession } from './sessions.js';
import { q } from './db.js';
import { config } from './config.js';

const page = (msg, sub = '') => `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>${msg}</title>
<body style="font-family:system-ui;background:#0f172a;color:#e2e8f0;display:grid;place-items:center;height:100vh;margin:0;text-align:center">
<div><h1 style="margin:0 0 8px">${msg}</h1><p style="color:#94a3b8;max-width:32em">${sub}</p></div>`;

function deny(req, res, msg = 'MySEB Needed', sub = 'This exam can only be opened inside the MySEB app. Open MySEB and enter your exam code.') {
  res.set('Cache-Control', 'no-store');
  if ((req.get('accept') || '').includes('application/json')) return res.status(403).json({ error: msg });
  return res.status(403).type('html').send(page(msg, sub));
}

/**
 * Express middleware. Put it in front of EVERY route of an exam site (pages, scripts, API, images).
 * `getExamId(req)` says which exam the request is for (null = not an exam route, let it through).
 * If the exam has "Require MySEB" off, requests pass. Otherwise:
 *   no/unknown key, wrong client, or wrong device  -> 403 "MySEB Needed"
 *   key valid but the student is paused/left/ended -> 403 with the reason
 * It sets req.myseb = { session, exam }.
 */
export function mySebGuard(getExamId) {
  return async (req, res, next) => {
    try {
      const examId = await getExamId(req);
      if (!examId) return next();
      const { rows } = await q('SELECT id, require_myseb, status FROM exams WHERE id=$1', [examId]);
      const exam = rows[0];
      if (!exam) return res.status(404).type('text').send('Not found');
      if (!exam.require_myseb) return next();

      const auth = await authSession(req, { allowCookie: true });
      if (auth.error || auth.session.exam_id !== exam.id) return deny(req, res);
      const s = auth.session;
      if (s.status === 'ENDED' || exam.status === 'ended') return deny(req, res, 'Exam ended', 'Your exam has ended.');
      if (s.status !== 'IN_EXAM') return deny(req, res, 'Exam paused', 'Your teacher has been told. Wait for them to let you continue.');
      req.myseb = { session: s, exam: auth.exam };
      // Mobile web views can't add a header to sub-resources: hand the app an HttpOnly cookie on its first header-authenticated request.
      if (s.client_type === 'mobile' && req.get('x-myseb-key')) {
        const secure = config.publicUrl.startsWith('https') ? '; Secure' : '';
        res.append('Set-Cookie', `myseb_s=${req.get('x-myseb-key')}; Path=/; HttpOnly; SameSite=Lax${secure}`);
      }
      res.set('Cache-Control', 'no-store');
      next();
    } catch (e) { next(e); }
  };
}
