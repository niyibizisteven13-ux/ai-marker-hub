import test from 'node:test';
import assert from 'node:assert/strict';
import { TINY_ABOVE, WATCH_BATCH, WATCH_GAP_MS, clampQuality, gridQuality, qualityParams, startUpMs, watchBatches } from '../src/utils/liveQuality.js';

// 500 live students means 500 streams to decode: the more students are live, the lighter each picture is.
test('the grid is tiny beyond 48 live students, and zoom is always full size', () => {
  assert.equal(TINY_ABOVE, 48);
  assert.equal(gridQuality(1), 'low'); assert.equal(gridQuality(48), 'low'); assert.equal(gridQuality(49), 'tiny'); assert.equal(gridQuality(500), 'tiny');
  assert.equal(clampQuality('high'), 'high'); assert.equal(clampQuality('tiny'), 'tiny'); assert.equal(clampQuality('ultra'), 'low'); assert.equal(clampQuality(undefined), 'low');
});

test('each level is lighter than the one before: size, pictures per second and bits per second', () => {
  for (const screen of [false, true]) {
    const hi = qualityParams('high', screen), lo = qualityParams('low', screen), ti = qualityParams('tiny', screen);
    assert.ok(hi.maxBitrate > lo.maxBitrate && lo.maxBitrate > ti.maxBitrate, `bits ${screen}`);
    assert.ok(hi.maxFramerate > lo.maxFramerate && lo.maxFramerate > ti.maxFramerate, `rate ${screen}`);
    assert.ok(hi.scaleResolutionDownBy < lo.scaleResolutionDownBy && lo.scaleResolutionDownBy < ti.scaleResolutionDownBy, `size ${screen}`);
  }
  // the whole grid at 500 stays small enough for one computer's connection: about 20 Mbit/s of faces
  assert.ok(500 * qualityParams('tiny', false).maxBitrate <= 20_000_000);
  assert.ok(qualityParams('tiny', false).scaleResolutionDownBy >= 4, 'a quarter of the size or less');
});

test('students are asked to start in small groups with a pause, so 500 do not answer in one second', () => {
  const ids = Array.from({ length: 500 }, (_, i) => `s${i}`);
  const groups = watchBatches(ids);
  assert.equal(groups[0].length, WATCH_BATCH); assert.equal(groups.flat().length, 500, 'nobody is skipped');
  assert.ok(groups.every((g) => g.length <= WATCH_BATCH));
  assert.equal(startUpMs(500), (Math.ceil(500 / WATCH_BATCH) - 1) * WATCH_GAP_MS);
  assert.ok(startUpMs(500) < 40_000, 'everyone has been asked in well under a minute');
  assert.equal(startUpMs(0), 0); assert.equal(startUpMs(WATCH_BATCH), 0, 'one group: no wait');
  assert.deepEqual(watchBatches([], 5), []); assert.equal(watchBatches([1, 2, 3], 0).length, 3, 'a silly size still works');
});
