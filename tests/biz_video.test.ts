// Videos on a business page: made to play steadily (720p with the index first, a 360p version, a poster, the real picture size), served in pieces and cached,
// framed by their real shape, and kept as uploaded when this server cannot process them. Uses the real ffmpeg.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBizService, resetBizLimitsForTests, type Kv } from '../server/services/biz/service.js';
import { memoryMediaStore } from '../server/services/biz/media.js';
import { createVideoPipeline, canRemux, parseProbe, scaleFilter, type VideoPipeline } from '../server/services/biz/videoPipeline.js';
import { publicMedia } from '../server/services/biz/model.js';

const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const memKv = (): Kv => { const data = new Map<string, unknown>(); return { async get<T>(k: string) { return (data.has(k) ? JSON.parse(JSON.stringify(data.get(k))) : null) as T | null; }, async put(k: string, v: unknown) { data.set(k, JSON.parse(JSON.stringify(v))); }, async del(k: string) { data.delete(k); } } as Kv; };
const tmp = mkdtempSync(path.join(os.tmpdir(), 'bwvt-')); test.after(() => rmSync(tmp, { recursive: true, force: true }));
/** A test video the way a phone makes one: big, high bitrate, the index (moov) at the END. */
const film = (name: string, size: string, opts: { seconds?: number; rotate?: number; bitrate?: string; audio?: boolean } = {}) => {
  const out = path.join(tmp, name); const src = path.join(tmp, `src-${name}`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=30`, ...(opts.audio === false ? [] : ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100']), '-t', String(opts.seconds ?? 3), '-c:v', 'libx264', '-b:v', opts.bitrate ?? '9M', '-pix_fmt', 'yuv420p', ...(opts.audio === false ? [] : ['-c:a', 'aac']), '-f', 'mp4', src]);
  if (opts.rotate) execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-display_rotation', String(opts.rotate), '-i', src, '-c', 'copy', '-f', 'mp4', out]); else execFileSync('cp', [src, out]);
  return readFileSync(out);
};
const boxes = (b: Buffer) => { const out: string[] = []; for (let i = 0; i + 8 <= b.length;) { const size = b.readUInt32BE(i); out.push(b.subarray(i + 4, i + 8).toString('latin1')); if (size < 8) break; i += size; } return out; };
const probeOf = (b: Buffer) => { const f = path.join(tmp, `probe-${Math.random().toString(36).slice(2)}.mp4`); require_fs().writeFileSync(f, b); return parseProbe(JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', f]).toString()))!; };
import * as fs from 'node:fs'; const require_fs = () => fs;
const MP4 = Buffer.from('ftyp');

const rig = (opts: { ffmpeg?: string } = {}) => {
  const store = memoryMediaStore(); let pipe!: VideoPipeline; let svcRef!: ReturnType<typeof createBizService>;
  svcRef = createBizService({ kv: memKv(), media: store, isPaid: async () => true, onVideo: (j) => pipe.enqueue(j) }); resetBizLimitsForTests();
  pipe = createVideoPipeline({ store, ffmpeg: opts.ffmpeg, onDone: (b, i, p) => svcRef.setVideoInfo(b, i, p) });
  return { store, svc: svcRef, pipe };
};

test('the plan: a light ordinary mp4 only gets its index moved; a heavy, rotated or odd one is re-encoded; sizes keep the shape and stay even', () => {
  const p = (o: object) => ({ w: 1080, h: 1920, duration: 30, rotation: 0, vcodec: 'h264', pixFmt: 'yuv420p', acodec: 'aac', bitrate: 2_500_000, fps: 30, ...o });
  assert.equal(canRemux(p({}) as any, 'mp4'), true); for (const o of [{ bitrate: 12_000_000 }, { rotation: 90 }, { vcodec: 'hevc' }, { pixFmt: 'yuv422p' }, { acodec: 'opus' }, { fps: 60 }, { w: 3840, h: 2160 }]) assert.equal(canRemux(p(o) as any, 'mp4'), false, JSON.stringify(o)); assert.equal(canRemux(p({}) as any, 'webm'), false);
  assert.match(scaleFilter(720), /min\(720,iw\).*min\(720,ih\)/s);
  const rot = parseProbe({ streams: [{ codec_type: 'video', width: 1920, height: 1080, codec_name: 'h264', pix_fmt: 'yuv420p', avg_frame_rate: '30/1', side_data_list: [{ rotation: -90 }] }], format: { duration: '12.5', bit_rate: '8000000' } })!;
  assert.deepEqual([rot.w, rot.h, rot.rotation, rot.duration], [1080, 1920, 270, 12.5], 'a phone video filmed upright is stored sideways with a rotation flag; the viewer sees it upright'); assert.equal(parseProbe({ streams: [{ codec_type: 'audio' }] }), null);
});

test('a phone video becomes a smooth one: index first, 720p, a 360p version, a poster, the right shape, and the page is told', { skip: !hasFfmpeg && 'ffmpeg is not installed here' }, async () => {
  const { store, svc, pipe } = rig(); const biz = await svc.create('o', { name: 'Clip Shop' });
  const original = film('portrait.mp4', '1080x1920', { seconds: 3 }); assert.deepEqual(boxes(original).filter((b) => b === 'moov' || b === 'mdat'), ['mdat', 'moov'], 'as filmed: the index is at the end, so it cannot start playing before the whole file arrives');
  const m = await svc.addMedia('o', biz.id, { name: 'minute.mp4', data: original, scope: 'feed' }); assert.equal(m.video?.state, 'processing');
  assert.equal(((await svc.publicBySlug('clip-shop')) ?? { gallery: [] }).gallery.length, 0);
  await pipe.whenIdle(); const done = (await svc.list('o'))[0].media.find((x) => x.id === m.id)!; const v = done.video!;
  assert.equal(v.state, 'ready'); assert.deepEqual([v.w, v.h], [720, 1280], 'a portrait video stays portrait, short side 720'); assert.ok(v.duration! > 2.5 && v.duration! < 3.5); assert.equal(v.lq, true); assert.equal(v.poster, true); assert.ok(v.rev);
  const hq = (store.files.get(`${biz.id}/${m.id}.mp4`))!; assert.deepEqual(boxes(hq).filter((b) => b === 'moov' || b === 'mdat'), ['moov', 'mdat'], 'the index is first: playback starts at once'); assert.ok(hq.length < original.length / 2, `${hq.length} < ${original.length}/2`); assert.equal(done.size, hq.length);
  const hp = probeOf(hq); assert.equal(hp.vcodec, 'h264'); assert.equal(hp.acodec, 'aac'); assert.ok(hp.bitrate < 3_600_000, `bitrate ${hp.bitrate}`);
  const lq = store.files.get(`${biz.id}/${m.id}-lq.mp4`)!; const lp = probeOf(lq); assert.deepEqual([lp.w, lp.h], [360, 640]); assert.ok(lq.length < hq.length);
  const poster = store.files.get(`${biz.id}/${m.id}-poster.jpg`)!; assert.deepEqual([...poster.subarray(0, 3)], [0xff, 0xd8, 0xff], 'a real picture');
  const pub = publicMedia(done); assert.deepEqual(pub.video, { state: 'ready', w: 720, h: 1280, duration: v.duration, lq: true, poster: true, rev: v.rev }); assert.ok(!JSON.stringify(pub).includes('size'), 'nothing private on the public side');
});

test('a landscape video and a sideways-stored phone video both end up the right way round; a light mp4 is only remuxed; metadata (place, device) is dropped', { skip: !hasFfmpeg && 'ffmpeg is not installed here' }, async () => {
  const { store, svc, pipe } = rig(); const biz = await svc.create('o', { name: 'Shapes' });
  const land = await svc.addMedia('o', biz.id, { name: 'land.mp4', data: film('land.mp4', '1920x1080', { seconds: 2 }), scope: 'feed' });
  const side = await svc.addMedia('o', biz.id, { name: 'side.mp4', data: film('side.mp4', '1920x1080', { seconds: 2, rotate: 90 }), scope: 'feed' });
  const light = await svc.addMedia('o', biz.id, { name: 'light.mp4', data: film('light.mp4', '640x360', { seconds: 2, bitrate: '600k', audio: false }), scope: 'feed' });
  await pipe.whenIdle(); const ms = (await svc.list('o'))[0].media; const by = (id: string) => ms.find((x) => x.id === id)!.video!;
  assert.deepEqual([by(land.id).w, by(land.id).h], [1280, 720]); assert.deepEqual([by(side.id).w, by(side.id).h], [720, 1280], 'filmed upright on a phone: shown upright');
  const sp = probeOf(store.files.get(`${biz.id}/${side.id}.mp4`)!); assert.equal(sp.rotation, 0, 'the rotation is applied to the picture, not left as a flag some players ignore'); assert.deepEqual([sp.w, sp.h], [720, 1280]);
  assert.equal(by(light.id).state, 'ready'); assert.ok(!by(light.id).lq, 'a small light video needs no second version'); assert.deepEqual(boxes(store.files.get(`${biz.id}/${light.id}.mp4`)!).filter((b) => b === 'moov' || b === 'mdat'), ['moov', 'mdat']);
});

test('without ffmpeg, or with a file that is not a video, nothing breaks: the video is kept as uploaded', async () => {
  const none = rig({ ffmpeg: '/nonexistent/ffmpeg' }); const b1 = await none.svc.create('o', { name: 'No Tools' }); const raw = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), MP4, Buffer.from('mp42'), Buffer.alloc(300, 1)]);
  const m1 = await none.svc.addMedia('o', b1.id, { name: 'a.mp4', data: raw, scope: 'feed' }); await none.pipe.whenIdle(); const v1 = (await none.svc.list('o'))[0].media.find((x) => x.id === m1.id)!; assert.deepEqual([v1.video?.state, v1.video?.raw], ['ready', true]); assert.equal(none.store.files.get(`${b1.id}/${m1.id}.mp4`)!.length, raw.length, 'untouched');
  if (!hasFfmpeg) return; const junk = rig(); const b2 = await junk.svc.create('o', { name: 'Junk' }); const m2 = await junk.svc.addMedia('o', b2.id, { name: 'b.mp4', data: raw, scope: 'feed' }); await junk.pipe.whenIdle();
  assert.equal((await junk.svc.list('o'))[0].media.find((x) => x.id === m2.id)!.video?.state, 'failed'); assert.equal(junk.store.files.get(`${b2.id}/${m2.id}.mp4`)!.length, raw.length, 'the upload is still there');
});

test('the other versions are served and cleaned up: light video and poster only when they exist, visibility is respected, removal deletes everything', { skip: !hasFfmpeg && 'ffmpeg is not installed here' }, async () => {
  const { store, svc, pipe } = rig(); const biz = await svc.create('o', { name: 'Serve Me' }); await svc.update('o', biz.id, { about: 'x' });
  const m = await svc.addMedia('o', biz.id, { name: 'v.mp4', data: film('serve.mp4', '1280x720', { seconds: 2 }), scope: 'feed' }); await pipe.whenIdle();
  assert.equal(await svc.mediaFor('serve-me', m.id), null, 'a feed video is public only while a post shows it, and the page is not published');
  await svc.setPublished('o', biz.id, true); await svc.addPost('o', biz.id, { text: 'Look', mediaIds: [m.id] });
  const main = (await svc.mediaFor('serve-me', m.id))!; const lq = (await svc.mediaFor('serve-me', m.id, 'lq'))!; const poster = (await svc.mediaFor('serve-me', m.id, 'poster'))!;
  assert.equal(main.mime, 'video/mp4'); assert.equal(lq.mime, 'video/mp4'); assert.equal(poster.mime, 'image/jpeg'); assert.ok(lq.size < main.size); assert.match(main.etag, /^W\/"[\w-]+-\d+-\d+"$/); assert.notEqual(main.etag, lq.etag);
  assert.equal(await svc.mediaFor('serve-me', m.id, 'huge'), null, 'unknown versions do not exist'); assert.equal(await svc.mediaFor('serve-me', 'nope'), null);
  const piece = await main.open({ start: 0, end: 99 }); const chunks: Buffer[] = []; for await (const c of piece.stream as any) chunks.push(Buffer.from(c)); assert.equal(Buffer.concat(chunks).length, 100, 'a piece of 100 bytes');
  await svc.setPublished('o', biz.id, false); assert.equal(await svc.mediaFor('serve-me', m.id), null, 'unpublishing hides it at once, not after the cache runs out');
  await svc.removeMedia('o', biz.id, m.id); assert.deepEqual([...store.files.keys()].filter((k) => k.startsWith(biz.id)), [], 'the file, its light version and its poster are all gone');
});

import React from 'react';
import { renderToString } from 'react-dom/server';
import { VideoPlayer, frameFor, startQuality, videoUrls } from '../src/components/biz/VideoPlayer.js';

test('frames: the whole video always fits; portrait sits in a 4:5 frame at most, square in a square, landscape in a wide frame; unknown shapes are treated as wide', () => {
  assert.deepEqual(frameFor(720, 1280), { kind: 'portrait', aspect: 0.8 }); assert.deepEqual(frameFor(1080, 1350), { kind: 'portrait', aspect: 0.8 }); assert.equal(frameFor(1080, 1920).kind, 'portrait');
  assert.deepEqual(frameFor(1080, 1080), { kind: 'square', aspect: 1 }); assert.equal(frameFor(1000, 1100).kind, 'square');
  assert.deepEqual(frameFor(1280, 720), { kind: 'landscape', aspect: 1280 / 720 }); assert.equal(frameFor(1440, 1080).aspect, 1440 / 1080, 'a 4:3 video has a 4:3 frame: no empty bars'); assert.equal(frameFor(2560, 800).aspect, 1.91, 'an ultra-wide video is capped');
  assert.deepEqual(frameFor(undefined, undefined), { kind: 'landscape', aspect: 16 / 9 }); assert.deepEqual(frameFor(0, 0), { kind: 'landscape', aspect: 16 / 9 });
});

test('which file to start with, and the addresses: light on slow or data-saving connections, the revision in every address so browsers may keep it for a year', () => {
  assert.equal(startQuality(true, { effectiveType: '4g', downlink: 10 }), 'hq'); assert.equal(startQuality(true, { saveData: true }), 'lq'); assert.equal(startQuality(true, { effectiveType: '3g' }), 'lq'); assert.equal(startQuality(true, { effectiveType: '4g', downlink: 0.9 }), 'lq');
  assert.equal(startQuality(false, { saveData: true }), 'hq', 'no light file: nothing to switch to'); assert.equal(startQuality(true, null), 'hq'); assert.equal(startQuality(true, undefined), 'hq');
  assert.deepEqual(videoUrls('/api/biz/public/x/media/m1', { state: 'ready', lq: true, poster: true, rev: 17 }), { hq: '/api/biz/public/x/media/m1?r=17', lq: '/api/biz/public/x/media/m1?q=lq&r=17', poster: '/api/biz/public/x/media/m1/poster?r=17' });
  assert.deepEqual(videoUrls('/m/1', { state: 'ready', raw: true }), { hq: '/m/1', lq: null, poster: null }); assert.deepEqual(videoUrls('/m/1', undefined), { hq: '/m/1', lq: null, poster: null }, 'an older video with no information still plays');
});

test('the player renders each state: preparing placeholder, a portrait frame with a poster behind it, an old video without information', () => {
  const src = (id: string) => `/api/biz/public/x/media/${id}`;
  const prep = renderToString(React.createElement(VideoPlayer, { media: { id: 'a', kind: 'video', video: { state: 'processing' } }, src })); assert.match(prep, /Preparing this video/); assert.match(prep, /role="status"/); assert.doesNotMatch(prep, /<video/, 'nothing to play yet');
  const ok = renderToString(React.createElement(VideoPlayer, { media: { id: 'b', kind: 'video', caption: 'Our kitchen', video: { state: 'ready', w: 720, h: 1280, duration: 42, lq: true, poster: true, rev: 5 } }, src }));
  assert.match(ok, /data-frame="portrait"/); assert.match(ok, /aspect-ratio:0\.8/); assert.match(ok, /<video[^>]*src="\/api\/biz\/public\/x\/media\/b\?r=5"/); assert.match(ok, /poster="\/api\/biz\/public\/x\/media\/b\/poster\?r=5"/); assert.match(ok, /playsInline|playsinline/i); assert.match(ok, /aria-label="Our kitchen"/); assert.match(ok, /0:00(<!-- -->)? \/ (<!-- -->)?0:42/); assert.match(ok, /blur-2xl/);
  const old = renderToString(React.createElement(VideoPlayer, { media: { id: 'c', kind: 'video' }, src })); assert.match(old, /data-frame="landscape"/); assert.match(old, /<video[^>]*src="\/api\/biz\/public\/x\/media\/c"/);
  const fill = renderToString(React.createElement(VideoPlayer, { media: { id: 'd', kind: 'video', video: { state: 'ready', w: 1000, h: 1000 } }, src, fill: true })); assert.match(fill, /absolute inset-0/); assert.doesNotMatch(fill, /aspect-ratio/, 'inside a post the post sets the shape');
});

test('profile videos keep their native aspect and fit inside the player', () => {
  for (const [w, h] of [[1920, 1080], [1080, 1920], [1080, 1080], [2560, 800]]) {
    const html = renderToString(React.createElement(VideoPlayer, {
      media: { id: 'profile-video', kind: 'video', video: { state: 'ready', w, h } },
      src: () => '/m/profile-video',
      naturalAspect: true,
    }));
    assert.ok(html.includes(`aspect-ratio:${w / h};`));
    assert.match(html, /<video[^>]*object-contain/);
  }
});
