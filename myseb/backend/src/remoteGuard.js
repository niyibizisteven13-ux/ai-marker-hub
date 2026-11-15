/**
 * Drop-in Express middleware for an exam site that is NOT this server (e.g. bwenge.space).
 * It asks the MySEB server "is this request from a live MySEB session of this exam?". No database access needed.
 * Copy this one file into the exam site (bwenge keeps a TypeScript twin in server/services/mySeb.ts).
 *
 *   app.use('/api/forms/:id', remoteMySebGuard({
 *     mysebUrl: process.env.MYSEB_URL, serviceKey: process.env.MYSEB_SERVICE_KEY,
 *     examIdFor: async (req) => (await loadForm(req.params.id)).mysebExamId,   // null = this exam does not require MySEB
 *   }));
 *
 * `soft: true` never denies: it only hands a mobile app its HttpOnly cookie. Use it on the page shell
 * (/forms/:id), because a phone web view can send the header on the page request but NOT on later scripts/XHR.
 * Instead of `serviceKey` + `examIdFor` you can pass `secretFor` (the per-code exam secret).
 */
const cache = new Map(); // a 4 s cache keeps a busy exam from hammering MySEB

export function remoteMySebGuard({ mysebUrl, serviceKey = undefined, examIdFor = undefined, secretFor = undefined, bypass = undefined, soft = false, cacheMs = 4000 }) {
  const base = String(mysebUrl).replace(/\/$/, '');
  const deny = (req, res, msg, code = 'MYSEB_REQUIRED') => ((req.get('accept') || '').includes('text/html')
    ? res.status(403).type('html').send(`<!doctype html><meta charset=utf-8><title>${msg}</title><body style="font-family:system-ui;text-align:center;padding:15vh 16px"><h1>${msg}</h1><p>Open this exam in the MySEB app.</p>`)
    : res.status(403).json({ error: msg, code, mysebRequired: true }));

  async function check(req, ctx) {
    const header = req.get('x-myseb-key');
    const cookie = (req.get('cookie') || '').match(/(?:^|;\s*)myseb_s=([\w-]{20,80})/)?.[1];
    const key = header || cookie;
    if (!key) return { allowed: false, reason: 'MySEB Needed' };
    const client = header ? (req.get('x-myseb-client') || '') : 'mobile';   // the cookie only ever belongs to mobile sessions
    const device = req.get('x-myseb-device') || '';
    const ua = req.get('user-agent') || '';
    const ck = `${ctx.id}|${key}|${client}|${device}|${ua}`;
    let hit = cache.get(ck);
    if (!hit || Date.now() - hit.at > cacheMs) {
      const r = await fetch(`${base}/api/gate`, {
        method: 'POST', signal: AbortSignal.timeout(4000),
        headers: { 'Content-Type': 'application/json', ...(ctx.secret ? { 'X-MySEB-Exam-Secret': ctx.secret } : { 'X-MySEB-Service-Key': serviceKey }) },
        body: JSON.stringify({ key, client, device, userAgent: ua, examId: ctx.examId }),
      });
      hit = { at: Date.now(), result: await r.json().catch(() => ({ allowed: false })) };
      cache.set(ck, hit);
      if (cache.size > 5000) cache.clear();
    }
    return { ...hit.result, key, fromHeader: !!header };
  }

  return async (req, res, next) => {
    try {
      const examId = examIdFor ? await examIdFor(req) : null;
      const secret = secretFor ? await secretFor(req) : null;
      if (!examId && !secret) return next();                       // this exam does not require MySEB
      if (bypass && await bypass(req)) return next();               // e.g. the lecturer who owns the form
      const ctx = { id: examId || secret, examId, secret };
      const r = await check(req, ctx);
      if (soft) {
        if (r.allowed && r.fromHeader && r.clientType === 'mobile') {
          const secure = req.secure || req.get('x-forwarded-proto') === 'https' ? '; Secure' : '';
          res.append('Set-Cookie', `myseb_s=${r.key}; Path=/; HttpOnly; SameSite=Lax${secure}`);
        }
        return next();
      }
      if (!r.allowed) {
        const m = r.reason === 'PAUSED' || r.reason === 'LEFT' ? ['Exam paused', 'MYSEB_PAUSED'] : r.reason === 'ENDED' ? ['Exam ended', 'MYSEB_ENDED'] : ['MySEB Needed', 'MYSEB_REQUIRED'];
        return deny(req, res, m[0], m[1]);
      }
      if (r.clientType === 'mobile' && r.fromHeader) {
        const secure = req.secure || req.get('x-forwarded-proto') === 'https' ? '; Secure' : '';
        res.append('Set-Cookie', `myseb_s=${r.key}; Path=/; HttpOnly; SameSite=Lax${secure}`);
      }
      req.myseb = { studentName: r.studentName, clientType: r.clientType };
      res.set('Cache-Control', 'no-store');
      next();
    } catch (e) {
      // MySEB unreachable: fail closed, the request is not served.
      res.status(503).json({ error: 'The exam lock service is unavailable. Try again in a moment.', code: 'MYSEB_UNAVAILABLE' });
    }
  };
}
