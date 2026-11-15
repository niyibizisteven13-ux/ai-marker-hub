/**
 * Drop-in Express middleware for an exam site that is NOT this server (e.g. bwenge.space).
 * It asks the MySEB server "is this request from a live MySEB session of this exam?" using the exam secret
 * the teacher got from "Generate Code". No database access needed. Copy this one file into the exam site.
 *
 *   import { remoteMySebGuard } from './remoteGuard.js';
 *   app.use('/f/:formId', remoteMySebGuard({
 *     mysebUrl: process.env.MYSEB_URL,
 *     secretFor: async (req) => (await loadForm(req.params.formId)).mysebSecret,   // null = this exam does not require MySEB
 *   }));
 *
 * Put it in front of the exam's pages AND its API routes. Needs Node 18+ (global fetch).
 */
const cache = new Map(); // key+secret -> { at, result } : a 4 s cache keeps a busy exam from hammering MySEB

export function remoteMySebGuard({ mysebUrl, secretFor, cacheMs = 4000 }) {
  const base = String(mysebUrl).replace(/\/$/, '');
  const deny = (req, res, msg) => ((req.get('accept') || '').includes('application/json')
    ? res.status(403).json({ error: msg })
    : res.status(403).type('html').send(`<!doctype html><meta charset=utf-8><title>${msg}</title><body style="font-family:system-ui;text-align:center;padding:15vh 16px"><h1>${msg}</h1><p>Open this exam in the MySEB app.</p>`));

  return async (req, res, next) => {
    try {
      const secret = await secretFor(req);
      if (!secret) return next();
      const key = req.get('x-myseb-key') || (req.get('cookie') || '').match(/(?:^|;\s*)myseb_s=([\w-]{20,80})/)?.[1];
      if (!key) return deny(req, res, 'MySEB Needed');

      const client = req.get('x-myseb-client') || (req.get('cookie')?.includes('myseb_s=') ? 'mobile' : '');
      const ck = `${secret}|${key}|${client}|${req.get('x-myseb-device') || ''}|${req.get('user-agent') || ''}`;
      let hit = cache.get(ck);
      if (!hit || Date.now() - hit.at > cacheMs) {
        const r = await fetch(`${base}/api/gate`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-MySEB-Exam-Secret': secret },
          body: JSON.stringify({ key, client, device: req.get('x-myseb-device') || '', userAgent: req.get('user-agent') || '' }),
          signal: AbortSignal.timeout(4000),
        });
        hit = { at: Date.now(), result: await r.json() };
        cache.set(ck, hit);
        if (cache.size > 5000) cache.clear();
      }
      if (!hit.result.allowed) return deny(req, res, hit.result.reason === 'PAUSED' ? 'Exam paused' : hit.result.reason === 'ENDED' ? 'Exam ended' : 'MySEB Needed');
      req.myseb = { studentName: hit.result.studentName };
      next();
    } catch (e) {
      next(e);   // MySEB unreachable: fail closed (the request is not served)
    }
  };
}
