import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { prisma } from '../server/db.js';
import {
  burnTicket, failTicket, hasSecondFactor, issueTicket, loadRecord, makeRecoveryCodes, normalizeCode, readTicket, regenerateRecovery,
  relyingParty, removeCred, setRequired, useRecoveryCode, verifyAssertion, PasskeyError,
} from '../server/auth/passkeys.js';
import passkeyRoutes from '../server/routes/passkeyRoutes.js';

// Passkeys as the second step after Google or the emailed code: tickets, tries, recovery codes, and what a missing or wrong ticket can do.
const db = prisma as any;
let n = 0;
const uid = () => `pk-user-${Date.now()}-${++n}`;
const seed = async (userId: string, o: { required?: boolean; recovery?: string[] } = {}) => {
  const value = { creds: [{ id: `cred-${userId}`, publicKey: 'AAAA', counter: 0, name: 'My phone', createdAt: new Date().toISOString() }], required: o.required ?? false, recovery: o.recovery ?? [] };
  const key = `passkeys:${userId}`;
  if (await db.appSetting.findUnique({ where: { key } })) await db.appSetting.update({ where: { key }, data: { value } });
  else await db.appSetting.create({ data: { key, value, updatedBy: 't', updatedAt: new Date() } });
};

test('passkeys belong to the site’s domain, www included, and only to the origins we name', () => {
  assert.deepEqual(relyingParty({ APP_BASE_URL: 'https://www.bwenge.space' } as any), { id: 'bwenge.space', name: 'Bwenge', origins: ['https://bwenge.space', 'https://www.bwenge.space'] });
  assert.equal(relyingParty({ APP_BASE_URL: 'https://www.bwenge.space', PASSKEY_RP_ID: 'example.rw', PASSKEY_ORIGINS: 'https://example.rw, https://app.example.rw' } as any).origins.length, 2);
  const dev = relyingParty({ APP_BASE_URL: 'http://localhost:3000' } as any); assert.equal(dev.id, 'localhost'); assert.ok(dev.origins.every((o) => o.startsWith('http://localhost')));
});

test('a sign-in ticket works for the person, then is destroyed after five wrong tries', async () => {
  const t = await issueTicket('u-1', '/chat');
  assert.deepEqual({ userId: (await readTicket(t))!.userId, next: (await readTicket(t))!.next }, { userId: 'u-1', next: '/chat' });
  assert.equal(await readTicket('not-a-ticket'), null); assert.equal(await readTicket(undefined), null);
  const lefts = []; for (let i = 0; i < 5; i++) lefts.push(await failTicket(t));
  assert.deepEqual(lefts, [4, 3, 2, 1, 0]); assert.equal(await readTicket(t), null, 'five wrong tries end it');
  const t2 = await issueTicket('u-2', '/chat'); await burnTicket(t2); assert.equal(await readTicket(t2), null);
});

test('a ticket is only good for five minutes', async () => {
  const t = await issueTicket('u-3', '/chat'); const real = Date.now;
  try { Date.now = () => real() + 6 * 60_000; assert.equal(await readTicket(t), null); } finally { Date.now = real; }
});

test('recovery codes: eight, readable, one use each, and a new set cancels the old', async () => {
  const m = makeRecoveryCodes();
  assert.equal(m.codes.length, 8); assert.ok(m.codes.every((c) => /^[a-z2-9]{4}-[a-z2-9]{4}$/.test(c))); assert.equal(new Set(m.codes).size, 8);
  assert.equal(normalizeCode(' K3M9-X7QD '), 'k3m9x7qd');
  const u = uid(); await seed(u, { recovery: m.hashes });
  assert.equal(await useRecoveryCode(u, m.codes[0].toUpperCase().replace('-', ' ')), true, 'case and spacing do not matter');
  assert.equal(await useRecoveryCode(u, m.codes[0]), false, 'once only'); assert.equal(await useRecoveryCode(u, 'zzzz-zzzz'), false);
  assert.equal((await loadRecord(u)).recovery.length, 7);
  const fresh = await regenerateRecovery(u); assert.equal(await useRecoveryCode(u, m.codes[1]), false, 'the old set is dead'); assert.equal(await useRecoveryCode(u, fresh[0]), true);
});

test('the sign-in step is asked only when it is switched on and a passkey exists', async () => {
  const a = uid(); assert.equal(await hasSecondFactor(a), false, 'a person with nothing set up');
  await assert.rejects(setRequired(a, true), PasskeyError, 'cannot require what does not exist');
  await seed(a); assert.equal(await hasSecondFactor(a), false, 'a passkey alone does not change sign-in');
  await setRequired(a, true); assert.equal(await hasSecondFactor(a), true);
  await setRequired(a, false); assert.equal(await hasSecondFactor(a), false);
});

test('removing the last passkey switches the step off and clears the recovery codes, so nobody is locked out', async () => {
  const a = uid(); await seed(a, { required: true, recovery: makeRecoveryCodes().hashes });
  assert.equal(await removeCred(a, 'someone-elses'), false);
  assert.equal(await removeCred(a, `cred-${a}`), true);
  const r = await loadRecord(a); assert.deepEqual([r.creds.length, r.required, r.recovery.length], [0, false, 0]); assert.equal(await hasSecondFactor(a), false);
});

test('a passkey answer with no waiting challenge, or for an unknown passkey, is refused', async () => {
  const a = uid(); await seed(a, { required: true });
  assert.equal(await verifyAssertion(a, 'ticket:nothing', { id: `cred-${a}` } as any), false, 'no challenge was issued');
  assert.equal(await verifyAssertion(a, 'ticket:nothing', { id: 'other-device' } as any), false);
});

// ---- the HTTP surface
const app = express(); app.use(express.json()); app.use((req: any, _res, next) => { req.cookies = Object.fromEntries(String(req.headers.cookie ?? '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0])); next(); }); app.use('/api/auth/passkey', passkeyRoutes);
const srv = app.listen(0); const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/auth/passkey`;
test.after(() => srv.close());
const post = (path: string, body: unknown, cookie?: string) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });

test('without a sign-in ticket the second step is closed', async () => {
  for (const path of ['/mfa/options', '/mfa/verify', '/mfa/recovery']) { const r = await post(path, { code: 'abcd-efgh', response: {} }); assert.equal(r.status, 401, path); assert.equal((await r.json()).code, 'TICKET_EXPIRED'); }
  assert.equal((await post('/mfa/verify', { response: {} }, 'mfa_ticket=forged')).status, 401);
});

test('a wrong recovery code is refused, counts as a try, and five wrong ones end the sign-in', async () => {
  const u = uid(); await seed(u, { required: true, recovery: makeRecoveryCodes().hashes });
  const t = await issueTicket(u, '/chat'); const cookie = `mfa_ticket=${t}`;
  for (let i = 4; i >= 1; i--) { const r = await post('/mfa/recovery', { code: 'wrong-code' }, cookie); assert.equal(r.status, 401); assert.equal((await r.json()).triesLeft, i); }
  const last = await post('/mfa/recovery', { code: 'wrong-code' }, cookie); assert.equal(last.status, 401); assert.equal((await last.json()).code, 'TICKET_EXPIRED');
  assert.equal((await post('/mfa/recovery', { code: 'whatever' }, cookie)).status, 401, 'the ticket is gone');
});

test('protection that is on cannot be switched off or removed without a fresh passkey check (and a session is needed at all)', async () => {
  assert.equal((await fetch(base + '/status')).status, 401, 'signed-in routes need a session');
  assert.equal((await post('/settings', { required: false })).status, 401);
  assert.equal((await fetch(base + '/some-id', { method: 'DELETE' })).status, 401);
});
