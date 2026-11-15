import test from 'node:test';
import assert from 'node:assert/strict';
import { FaceWatch, frameStatus, normalizeExam } from '../shared/examRules.js';

const face = (x: number, y: number, w = 0.3, h = 0.4) => ({ x, y, w, h });

test('frame rule: one face in the middle is ok; none, cut-off, tiny and several are not', () => {
  assert.equal(frameStatus([face(0.35, 0.25)]), 'ok');
  assert.equal(frameStatus([]), 'no_face');
  assert.equal(frameStatus([face(0.9, 0.3)]), 'partial', 'mostly outside the picture');
  assert.equal(frameStatus([face(-0.2, 0.3)]), 'partial');
  assert.equal(frameStatus([face(0.45, 0.45, 0.05, 0.05)]), 'partial', 'too small to be a person at the desk');
  assert.equal(frameStatus([face(0.05, 0.25), face(0.6, 0.25)]), 'multiple');
  // A small face in the background does not count as a second person.
  assert.equal(frameStatus([face(0.35, 0.25), face(0.8, 0.1, 0.05, 0.05)]), 'ok');
  // Slightly cut off at the edge but mostly inside: still ok.
  assert.equal(frameStatus([face(0.7, 0.3, 0.3, 0.4)]), 'ok');
});

test('face watch: a short look away is only a countdown; a long one is reported once, with how long', () => {
  const w = new FaceWatch(8000);
  let t = 0;
  const feed = (s: Parameters<typeof frameStatus>[0] extends never ? never : any) => w.feed(s, t);
  assert.equal(feed('ok').state.state, 'ok');
  t = 1000; let r = feed('no_face');
  assert.equal(r.state.state, 'warning'); assert.equal(r.events.length, 0);
  t = 5000; r = feed('no_face'); assert.equal(r.state.secondsLeft, 4);
  t = 6000; r = feed('ok'); assert.equal(r.state.state, 'ok'); assert.equal(r.events.length, 0, 'back within the grace period: nothing happened');
  t = 10_000; feed('no_face');
  t = 17_999; assert.equal(feed('no_face').events.length, 0);
  t = 18_000; r = feed('no_face');
  assert.deepEqual(r.events, [{ type: 'face_lost', seconds: 8 }]);
  t = 25_000; r = feed('partial'); assert.deepEqual(r.events, [], 'reported once, not on every frame'); assert.equal(r.state.state, 'lost');
  t = 31_000; r = feed('ok');
  assert.deepEqual(r.events, [{ type: 'face_back', seconds: 21 }]);
});

test('face watch: several people are reported once per episode', () => {
  const w = new FaceWatch(5000);
  assert.deepEqual(w.feed('multiple', 0).events, [{ type: 'multiple_faces' }]);
  assert.deepEqual(w.feed('multiple', 500).events, []);
  assert.deepEqual(w.feed('ok', 1000).events, []);
  assert.deepEqual(w.feed('multiple', 1500).events, [{ type: 'multiple_faces' }]);
});

test('exam settings are bounded and the roster rule needs a class', () => {
  const e = normalizeExam({ enabled: true, minutes: 9999, camera: 'pause', graceSeconds: 1, requireRoster: true, courseId: 'nope', extra: 1 });
  assert.deepEqual(e, { enabled: true, minutes: 600, camera: 'pause', graceSeconds: 3, requireRoster: false, leaveAction: 'record', maxLeaves: 3, requireFullscreen: false, requireSeb: false, sebKeys: [] });
  assert.equal(normalizeExam(undefined).enabled, false);
  assert.equal(normalizeExam({ camera: 'weird' }).camera, 'off');
  const ok = normalizeExam({ enabled: true, courseId: '123e4567-e89b-12d3-a456-426614174000', requireRoster: true });
  assert.equal(ok.requireRoster, true);
});
