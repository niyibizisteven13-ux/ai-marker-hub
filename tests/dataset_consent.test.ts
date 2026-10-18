import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExport } from '../server/services/DatasetQualityService.js';

const base = {
  type: 'instruction' as const,
  instruction: 'Explain how water evaporates.',
  output: 'Heat changes liquid water into water vapor.',
  origin: 'human_written' as const,
  status: 'approved' as const,
};

test('dataset export excludes examples without explicit consent or completed PII review', () => {
  const result = buildExport([
    { ...base, id: 'no-consent', consent: false, piiReviewed: true },
    { ...base, id: 'no-pii-review', consent: true, piiReviewed: false },
    { ...base, id: 'eligible', consent: true, piiReviewed: true },
  ], {
    version: 'test',
    now: '2026-01-01T00:00:00.000Z',
    minTrainExamples: 0,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.excluded.map(({ id, reasons }) => [id, ...reasons]),
    [
      ['no-consent', 'missing_consent'],
      ['no-pii-review', 'pii_not_reviewed'],
    ],
  );
  const exportedRows = Object.values(result.files)
    .flatMap((file) => file.split('\n'))
    .filter(Boolean);
  assert.equal(exportedRows.length, 1);
});
