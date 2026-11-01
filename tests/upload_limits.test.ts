import test from 'node:test';
import assert from 'node:assert/strict';
import { PLANS, UPLOAD_CEILING_BYTES, applyBillingSettings, uploadLimitBytes, uploadTooLargeMessage } from '../server/services/billing/plans.js';
import { DEFAULT_MARKING_LIMITS } from '../shared/markingLimits.js';

const MB = 1024 * 1024;

test('uploads: Pro Plus and Institution take files up to 200 MB; every other plan keeps 100 MB', () => {
  applyBillingSettings({});
  assert.equal(PLANS.PLUS.limits.maxUploadMb, 200);
  assert.equal(PLANS.INSTITUTION.limits.maxUploadMb, 200);
  for (const id of ['FREE', 'GO', 'STARTER', 'PRO'] as const) assert.equal(PLANS[id].limits.maxUploadMb, 100, id);
  // The server accepts the largest plan's file; each plan's own limit is checked after the upload.
  assert.ok(UPLOAD_CEILING_BYTES >= 200 * MB);
  // A whole-class PDF of 200 MB plus its marking scheme fits in one marking upload.
  assert.ok(DEFAULT_MARKING_LIMITS.maxFileBytes >= 200 * MB);
  assert.ok(DEFAULT_MARKING_LIMITS.maxUploadBytes > DEFAULT_MARKING_LIMITS.maxFileBytes);
});

test('uploads: an unknown account gets the Free limit, and the message points to Pro Plus', async () => {
  const { bytes, plan } = await uploadLimitBytes('no-such-user-for-upload-limits');
  assert.equal(plan.id, 'FREE');
  assert.equal(bytes, 100 * MB);
  assert.equal(uploadTooLargeMessage('class.pdf', PLANS.PRO, 100 * MB), 'class.pdf is larger than 100 MB, the largest file your Pro plan can upload. Pro Plus uploads files up to 200 MB.');
  assert.equal(uploadTooLargeMessage('class.pdf', PLANS.PLUS, 200 * MB), 'class.pdf is larger than 200 MB, the largest file your Pro Plus plan can upload.');
});

test('uploads: an admin-saved limit still applies, within the server ceiling', () => {
  applyBillingSettings({ schema: 2, limits: { PRO: { maxUploadMb: 150 } } });
  assert.equal(PLANS.PRO.limits.maxUploadMb, 150);
  applyBillingSettings({});
  assert.equal(PLANS.PRO.limits.maxUploadMb, 100);
});
