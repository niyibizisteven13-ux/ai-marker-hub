import test from 'node:test';
import assert from 'node:assert/strict';
import { scanQualityWarnings } from '../src/services/scanQuality.ts';
import { clampPaperZoom } from '../src/components/PaperViewport.tsx';

test('capture warnings identify empty/low-detail and undersized scans without claiming grading confidence', () => {
  assert.equal(scanQualityWarnings(300, 400, new Uint8Array(128).fill(255)).length, 2);
  const detailed = new Uint8Array(128).map((_, i) => i % 8 < 4 ? 255 : 0);
  assert.deepEqual(scanQualityWarnings(1500, 2000, detailed), []);
});
test('paper pinch zoom remains bounded and can return to fit width', () => {
  assert.equal(clampPaperZoom(99), 100);
  assert.equal(clampPaperZoom(350), 300);
  assert.equal(clampPaperZoom(151.7), 152);
});
