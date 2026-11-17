import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../../production/auth.js';
import { writeAuditLog } from '../../production/auth.js';
import { prisma } from '../db.js';
import { buildAuthenticatedUser, signAccessToken, startSession } from '../controllers/authController.js';
import {
  PasskeyError, assertionOptions, burnTicket, failTicket, finishRegistration, grantProof, loadRecord, readTicket, regenerateRecovery,
  registrationOptions, removeCred, resetAll, setRequired, takeProof, useRecoveryCode, verifyAssertion,
} from '../auth/passkeys.js';

/**
 * /api/auth/passkey
 *   signed in:   GET /status · POST /register/options · POST /register/verify · POST /settings · POST /assert/options · POST /assert/verify
 *                DELETE /:id · POST /recovery/regenerate
 *   second step (ticket cookie, no session yet): POST /mfa/options · POST /mfa/verify · POST /mfa/recovery
 * Changing or removing protection while it is on needs a fresh passkey check ("proof"), so a stolen open session cannot switch it off.
 */
const router = Router();
const limiter = rateLimit({ windowMs: 10 * 60_000, limit: 60, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Please wait a few minutes.' } });
router.use(limiter);

const me = (req: Request) => String((req as any).user?.userId ?? '');
const fail = (res: Response, e: unknown) => {
  if (e instanceof PasskeyError) return res.status(e.status).json({ error: e.message });
  return res.status(500).json({ error: 'Something went wrong. Please try again.' });
};
const publicView = (r: Awaited<ReturnType<typeof loadRecord>>) => ({
  creds: r.creds.map((c) => ({ id: c.id, name: c.name, createdAt: c.createdAt, lastUsedAt: c.lastUsedAt ?? null, deviceType: c.deviceType ?? null })),
  required: r.required, recoveryLeft: r.recovery.length,
});
/** A change to protection that is on needs a fresh check first. */
async function allowed(userId: string): Promise<boolean> { const r = await loadRecord(userId); return !r.required || (await takeProof(userId)); }

/* ------------------------------------------------------------ signed in */
router.get('/status', requireAuth, async (req, res) => { try { res.json(publicView(await loadRecord(me(req)))); } catch (e) { fail(res, e); } });

router.post('/register/options', requireAuth, async (req, res) => {
  try {
    const u = await (prisma as any).user.findUnique({ where: { id: me(req) } });
    if (!u) return res.status(401).json({ error: 'Sign in again.' });
    res.json(await registrationOptions({ id: u.id, email: u.email, name: u.name }));
  } catch (e) { fail(res, e); }
});

router.post('/register/verify', requireAuth, async (req, res) => {
  try {
    const out = await finishRegistration(me(req), req.body?.response, req.body?.name);
    await writeAuditLog(me(req), 'PASSKEY_ADDED', 'User', me(req), { name: out.cred.name });
    res.status(201).json({ ok: true, recoveryCodes: out.recoveryCodes, ...publicView(await loadRecord(me(req))) });
  } catch (e) { fail(res, e); }
});

router.post('/assert/options', requireAuth, async (req, res) => {
  try { const slot = req.body?.purpose === 'manage' ? 'manage' : 'unlock'; res.json(await assertionOptions(me(req), `${slot}:${me(req)}`)); } catch (e) { fail(res, e); }
});
router.post('/assert/verify', requireAuth, async (req, res) => {
  try {
    const slot = req.body?.purpose === 'manage' ? 'manage' : 'unlock';
    if (!(await verifyAssertion(me(req), `${slot}:${me(req)}`, req.body?.response))) return res.status(401).json({ error: 'That did not match. Please try again.' });
    if (slot === 'manage') await grantProof(me(req));
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
});

router.post('/settings', requireAuth, async (req, res) => {
  try {
    const want = req.body?.required === true;
    if (!want && !(await allowed(me(req)))) return res.status(403).json({ error: 'Confirm with your passkey first.', code: 'PROOF_REQUIRED' });
    await setRequired(me(req), want);
    await writeAuditLog(me(req), want ? 'PASSKEY_REQUIRED_ON' : 'PASSKEY_REQUIRED_OFF', 'User', me(req), {});
    res.json(publicView(await loadRecord(me(req))));
  } catch (e) { fail(res, e); }
});

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    if (!(await allowed(me(req)))) return res.status(403).json({ error: 'Confirm with your passkey first.', code: 'PROOF_REQUIRED' });
    if (!(await removeCred(me(req), req.params.id))) return res.status(404).json({ error: 'That passkey was not found.' });
    await writeAuditLog(me(req), 'PASSKEY_REMOVED', 'User', me(req), {});
    res.json(publicView(await loadRecord(me(req))));
  } catch (e) { fail(res, e); }
});

router.post('/recovery/regenerate', requireAuth, async (req, res) => {
  try {
    if (!(await loadRecord(me(req))).creds.length) return res.status(400).json({ error: 'Add a passkey first.' });
    if (!(await allowed(me(req)))) return res.status(403).json({ error: 'Confirm with your passkey first.', code: 'PROOF_REQUIRED' });
    res.json({ recoveryCodes: await regenerateRecovery(me(req)) });
  } catch (e) { fail(res, e); }
});

/* ------------------------------------------------------------ second step after Google or the emailed code */
const ticketOf = (req: Request) => String((req as any).cookies?.mfa_ticket ?? '');
const NO_TICKET = { error: 'Your sign-in expired. Please start again.', code: 'TICKET_EXPIRED' };

async function finish(req: Request, res: Response, userId: string, next: string) {
  const user = await (prisma as any).user.findUnique({ where: { id: userId }, include: { settings: true, subscription: true } });
  if (!user || user.disabledAt) return res.status(401).json(NO_TICKET);
  await burnTicket(ticketOf(req));
  res.clearCookie('mfa_ticket', { path: '/api/auth/passkey' });
  await (prisma as any).user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } }).catch(() => undefined);
  await startSession(req, res, userId);
  await writeAuditLog(userId, 'LOGIN_PASSKEY', 'User', userId, {});
  return res.json({ ok: true, next, accessToken: signAccessToken(user), expiresIn: 900, user: buildAuthenticatedUser(user) });
}

router.post('/mfa/options', async (req, res) => {
  try {
    const t = await readTicket(ticketOf(req)); if (!t) return res.status(401).json(NO_TICKET);
    res.json(await assertionOptions(t.userId, `ticket:${ticketOf(req).slice(0, 24)}`));
  } catch (e) { fail(res, e); }
});

router.post('/mfa/verify', async (req, res) => {
  try {
    const token = ticketOf(req); const t = await readTicket(token); if (!t) return res.status(401).json(NO_TICKET);
    if (!(await verifyAssertion(t.userId, `ticket:${token.slice(0, 24)}`, req.body?.response))) {
      const left = await failTicket(token);
      return res.status(401).json(left ? { error: 'That did not match. Please try again.', triesLeft: left } : NO_TICKET);
    }
    return await finish(req, res, t.userId, t.next);
  } catch (e) { fail(res, e); }
});

router.post('/mfa/recovery', async (req, res) => {
  try {
    const token = ticketOf(req); const t = await readTicket(token); if (!t) return res.status(401).json(NO_TICKET);
    if (!(await useRecoveryCode(t.userId, String(req.body?.code ?? '')))) {
      const left = await failTicket(token);
      return res.status(401).json(left ? { error: 'That recovery code is not valid.', triesLeft: left } : NO_TICKET);
    }
    await writeAuditLog(t.userId, 'PASSKEY_RECOVERY_CODE_USED', 'User', t.userId, {});
    return await finish(req, res, t.userId, t.next);
  } catch (e) { fail(res, e); }
});

export { resetAll as resetPasskeys };
export default router;
