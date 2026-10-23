import test from 'node:test';
import assert from 'node:assert/strict';
import { PLANS } from '../server/services/billing/plans.js';
import { markingEntitled } from '../server/services/billing/entitlements.js';

// Autonomous marking is a premium feature: Free plans are refused unless the rollout flag opens it to all.

test('autonomous marking: GO, PRO and Institution are entitled, Free is not; the flag opens it to every plan', () => {
  delete process.env.MARKING_REQUIRES_UPGRADE;
  assert.deepEqual((['FREE', 'GO', 'PRO', 'INSTITUTION'] as const).map((p) => markingEntitled(PLANS[p].limits)), [false, true, true, true]);
  process.env.MARKING_REQUIRES_UPGRADE = 'false';
  assert.equal(markingEntitled(PLANS.FREE.limits), true);
  delete process.env.MARKING_REQUIRES_UPGRADE;
});
