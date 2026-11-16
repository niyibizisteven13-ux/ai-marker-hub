import test from 'node:test';
import assert from 'node:assert/strict';
import { isBusyCameraError, isPermissionCameraError, openCamera } from '../src/utils/openCamera.js';

// A phone camera can be held by one app at a time. The camera opener keeps trying in the ways that can work, and stops where trying cannot help.
const err = (name: string) => Object.assign(new Error(name), { name });
const stream = (id: string) => ({ id } as unknown as MediaStream);
const fake = (script: Array<(c: MediaStreamConstraints) => MediaStream | Error>, devices: Array<{ kind: string; deviceId: string }> = []) => {
  const seen: MediaStreamConstraints[] = []; let i = 0;
  return {
    seen,
    md: {
      getUserMedia: async (c: MediaStreamConstraints) => { seen.push(c); const r = script[Math.min(i++, script.length - 1)](c); if (r instanceof Error) throw r; return r; },
      enumerateDevices: async () => devices as MediaDeviceInfo[],
    },
  };
};

test('it classifies the two kinds of failure', () => {
  for (const n of ['NotReadableError', 'TrackStartError', 'AbortError']) assert.ok(isBusyCameraError(err(n)), n);
  for (const n of ['NotAllowedError', 'SecurityError', 'PermissionDeniedError']) assert.ok(isPermissionCameraError(err(n)), n);
  assert.ok(!isBusyCameraError(err('NotAllowedError')) && !isPermissionCameraError(err('NotReadableError')));
});

test('the first try works: one call, front camera, the wished settings', async () => {
  const f = fake([() => stream('a')]);
  const s = await openCamera({ video: { width: { ideal: 640 } }, mediaDevices: f.md });
  assert.equal((s as any).id, 'a'); assert.equal(f.seen.length, 1);
  assert.deepEqual((f.seen[0].video as any).facingMode, 'user'); assert.deepEqual((f.seen[0].video as any).width, { ideal: 640 });
});

test('another app holds the camera at first and lets go: it opens by itself on a later try', async () => {
  const f = fake([() => err('NotReadableError'), () => err('NotReadableError'), () => err('NotReadableError'), () => stream('ok')]);
  const tries: number[] = [];
  const s = await openCamera({ mediaDevices: f.md, pauseMs: 1, onTry: (t) => tries.push(t.attempt) });
  assert.equal((s as any).id, 'ok'); assert.deepEqual(tries, [1, 2, 3, 4]);
});

test('simpler settings are tried: a phone that refuses the size while the camera is shared still opens', async () => {
  const f = fake([(c) => ((c.video as any)?.width ? err('OverconstrainedError') : stream('simple'))]);
  const s = await openCamera({ video: { width: { ideal: 1280 } }, mediaDevices: f.md });
  assert.equal((s as any).id, 'simple');
  assert.ok(f.seen.length >= 2 && !(f.seen.at(-1)!.video as any)?.width);
});

test('each camera on the phone is tried by name, after the general tries', async () => {
  const f = fake([(c) => ((c.video as any)?.deviceId ? stream('by-name') : err('NotReadableError'))], [{ kind: 'audioinput', deviceId: 'mic' }, { kind: 'videoinput', deviceId: 'front' }, { kind: 'videoinput', deviceId: 'back' }]);
  const s = await openCamera({ mediaDevices: f.md, pauseMs: 1 });
  assert.equal((s as any).id, 'by-name');
  assert.deepEqual((f.seen.at(-1)!.video as any).deviceId, { exact: 'front' }, 'the first camera in the list, never the microphone');
});

test('a refusal stops at once: it does not ask again and again', async () => {
  const f = fake([() => err('NotAllowedError')]);
  await assert.rejects(openCamera({ mediaDevices: f.md, pauseMs: 1 }), (e: any) => e.name === 'NotAllowedError');
  assert.equal(f.seen.length, 1);
});

test('if it never opens, the last real reason is passed on after the rounds', async () => {
  const f = fake([() => err('NotReadableError')]);
  await assert.rejects(openCamera({ mediaDevices: f.md, rounds: 2, pauseMs: 1 }), (e: any) => e.name === 'NotReadableError');
  assert.ok(f.seen.length >= 6, 'both rounds were tried');
});

test('a busy or refused microphone does not cost the student their picture', async () => {
  const f = fake([(c) => (c.audio ? err('NotAllowedError') : stream('video-only'))]);
  const s = await openCamera({ audio: { echoCancellation: true }, mediaDevices: f.md });
  assert.equal((s as any).id, 'video-only'); assert.equal(f.seen[0].audio !== false, true); assert.equal(f.seen[1].audio, false);
});
