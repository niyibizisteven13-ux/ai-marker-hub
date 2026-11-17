import test from 'node:test';
import assert from 'node:assert/strict';
import { upgradeBody, estimateTokens, whatsappLinkFor } from '../server/services/billing/aiMeter.js';
import { PLANS } from '../server/services/billing/plans.js';
import { markSubmissionWithAi } from '../server/services/forms/aiMarking.js';

const gate = (code: any, extra: any = {}) => ({ allowed: false, plan: PLANS.FREE, code, message: 'Used up. Pro is 4,500 RWF.', upgrade: { plan: 'PRO', url: '/upgrade?reason=limit' }, ...extra }) as any;

test('over the limit is a 402 with an upgrade link; a pause or a profit guard is a 503 without one', () => {
  const a = upgradeBody(gate('DAILY'));
  assert.equal(a.status, 402); assert.equal(a.body.code, 'UPGRADE_REQUIRED'); assert.equal(a.body.upgrade?.url, '/upgrade?reason=limit'); assert.equal(a.body.plan, 'FREE'); assert.match(a.body.error, /Pro is 4,500 RWF/);
  assert.equal(upgradeBody(gate('FEATURE')).status, 402);
  const b = upgradeBody(gate('PAUSED', { upgrade: undefined })); assert.equal(b.status, 503); assert.equal(b.body.code, 'UNAVAILABLE'); assert.equal(b.body.upgrade, undefined);
  assert.equal(upgradeBody(gate('PROTECTED')).status, 503);
});

test('tokens are estimated at four characters each', () => { assert.equal(estimateTokens('abcd'), 1); assert.equal(estimateTokens('abcde'), 2); assert.equal(estimateTokens(400), 100); assert.equal(estimateTokens(''), 0); });

test('the upgrade message opens WhatsApp to the one payment number (the live room’s), with a ready message', () => {
  const link = whatsappLinkFor('+250 799 691 108', 'Free');
  assert.ok(link.startsWith('https://wa.me/250799691108?text=')); assert.match(decodeURIComponent(link), /upgrade my Bwenge account \(now on Free\)/);
});

test('the Free plan keeps a small daily allowance and no AI marking', () => {
  assert.ok(PLANS.FREE.limits.daily > 0 && PLANS.FREE.limits.daily <= 20); assert.equal(PLANS.FREE.limits.perDay.marking, 0);
});

test('AI marking asks the lecturer’s meter first: with no credits nothing is sent to the model and the answers wait', async () => {
  const schema = { isQuiz: true, assessment: { aiMarking: true }, fields: [{ id: 'q', type: 'long_text', label: 'Explain', points: 4 }] };
  const row = { id: 's1', data: JSON.stringify({ q: 'An answer' }) };
  const db: any = { formSubmission: { findUnique: async () => row, update: async () => { throw new Error('must not save'); } } };
  let called = 0; const ai = { async json() { called++; return { marks: 4, feedback: '', confidence: 'high' }; } };
  assert.equal(await markSubmissionWithAi(db, 's1', schema, ai, { gate: async () => false, charge: () => { throw new Error('must not charge'); } }), false);
  assert.equal(called, 0);
});

test('AI marking charges the lecturer for the answers it marked', async () => {
  const schema = { isQuiz: true, assessment: { aiMarking: true }, fields: [{ id: 'q', type: 'long_text', label: 'Explain', points: 4 }] };
  let data = JSON.stringify({ q: 'An answer' });
  const db: any = { formSubmission: { findUnique: async () => ({ id: 's1', data }), update: async (a: any) => { data = a.data.data; } } };
  const ai = { async json() { return { marks: 3, feedback: 'ok', confidence: 'high' }; } };
  let charged = 0;
  assert.equal(await markSubmissionWithAi(db, 's1', schema, ai, { gate: async () => true, charge: (n) => { charged += n; } }), true);
  assert.equal(charged, 1); assert.equal(JSON.parse(data)._written.q.marks, 3);
});
