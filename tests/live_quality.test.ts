import test from 'node:test';
import assert from 'node:assert/strict';
import { AUDIO_MAX_BITRATE, LIVE_GIVE_UP_MS, TINY_ABOVE, WATCH_BATCH, WATCH_GAP_MS, captureFor, clampQuality, gridQuality, qualityParams, startUpMs, tileLiveState, tuneOpus, watchBatches } from '../src/utils/liveQuality.js';

// 500 live students means 500 streams to decode: the more students are live, the lighter each picture; the fewer, the sharper.
test('the grid is tiny beyond 48 live students; with few students and big tiles it gets sharper; the lecturer can ask for more or less', () => {
  assert.equal(TINY_ABOVE, 48);
  assert.equal(gridQuality(1), 'mid', 'one student on a medium tile');
  assert.equal(gridQuality(20), 'low'); assert.equal(gridQuality(48), 'low'); assert.equal(gridQuality(49), 'tiny'); assert.equal(gridQuality(500), 'tiny');
  assert.equal(gridQuality(12, 'L'), 'mid'); assert.equal(gridQuality(13, 'L'), 'low'); assert.equal(gridQuality(6, 'M'), 'mid'); assert.equal(gridQuality(7, 'M'), 'low'); assert.equal(gridQuality(3, 'S'), 'low');
  assert.equal(gridQuality(20, 'M', 'sharp'), 'mid'); assert.equal(gridQuality(30, 'M', 'sharp'), 'low'); assert.equal(gridQuality(200, 'L', 'sharp'), 'tiny', 'never heavier than the grid can carry');
  assert.equal(gridQuality(3, 'L', 'light'), 'low'); assert.equal(gridQuality(500, 'M', 'light'), 'tiny');
  assert.equal(clampQuality('high'), 'high'); assert.equal(clampQuality('mid'), 'mid'); assert.equal(clampQuality('tiny'), 'tiny'); assert.equal(clampQuality('ultra'), 'low'); assert.equal(clampQuality(undefined), 'low');
});

test('each level is lighter than the one above: size, pictures per second and bits per second', () => {
  for (const screen of [false, true]) {
    const [hi, mid, lo, ti] = (['high', 'mid', 'low', 'tiny'] as const).map((l) => qualityParams(l, screen));
    assert.ok(hi.maxBitrate > mid.maxBitrate && mid.maxBitrate > lo.maxBitrate && lo.maxBitrate > ti.maxBitrate, `bits ${screen}`);
    assert.ok(hi.maxFramerate >= mid.maxFramerate && mid.maxFramerate >= lo.maxFramerate && lo.maxFramerate > ti.maxFramerate, `rate ${screen}`);
    assert.ok(hi.scaleResolutionDownBy <= mid.scaleResolutionDownBy && mid.scaleResolutionDownBy < lo.scaleResolutionDownBy && lo.scaleResolutionDownBy < ti.scaleResolutionDownBy, `size ${screen}`);
  }
  // the whole grid at 500 stays small enough for one computer's connection: about 20 Mbit/s of faces
  assert.ok(500 * qualityParams('tiny', false).maxBitrate <= 20_000_000);
  assert.ok(qualityParams('tiny', false).scaleResolutionDownBy >= 4, 'a quarter of the size or less');
});

test('a shared screen is kept sharp: text stays readable in the grid at a few pictures per second, and zoomed it is full size', () => {
  const zoom = qualityParams('high', true), grid = qualityParams('mid', true);
  assert.equal(zoom.scaleResolutionDownBy, 1); assert.ok(zoom.maxBitrate >= 2_000_000, 'enough bits for 1080p text');
  assert.ok(grid.scaleResolutionDownBy <= 2 && grid.maxBitrate >= 700_000, 'half size or better in a big tile');
  assert.ok(qualityParams('high', true).maxBitrate > qualityParams('high', false).maxBitrate, 'a screen needs more bits than a face');
  assert.ok(qualityParams('high', false).maxFramerate >= 24, 'a zoomed face moves smoothly');
});

test('the student captures big only while the lecturer is zoomed in', () => {
  const hd = captureFor(true), sd = captureFor(false);
  assert.deepEqual(hd.camera.width, { ideal: 1280 }); assert.deepEqual(hd.camera.height, { ideal: 720 });
  assert.deepEqual(sd.camera.width, { ideal: 640 }); assert.deepEqual(sd.camera.height, { ideal: 480 });
  assert.ok((hd.screen.frameRate as { ideal: number }).ideal > (sd.screen.frameRate as { ideal: number }).ideal);
});

test('Opus is tuned for a voice over a weak connection, and nothing else in the offer changes', () => {
  const sdp = ['v=0', 'm=audio 9 UDP/TLS/RTP/SAVPF 111 63', 'a=rtpmap:111 opus/48000/2', 'a=fmtp:111 minptime=10;useinbandfec=1', 'a=rtpmap:63 red/48000/2', 'm=video 9 UDP/TLS/RTP/SAVPF 96', 'a=rtpmap:96 VP8/90000', ''].join('\r\n');
  const out = tuneOpus(sdp);
  const line = /a=fmtp:111 (.*)\r\n/.exec(out)![1]; const kv = new Map(line.split(';').map((p) => p.split('=') as [string, string]));
  assert.equal(kv.get('minptime'), '10', 'what was there is kept'); assert.equal(kv.get('useinbandfec'), '1'); assert.equal(kv.get('usedtx'), '1');
  assert.equal(kv.get('stereo'), '0'); assert.equal(kv.get('maxaveragebitrate'), String(AUDIO_MAX_BITRATE));
  assert.equal(out.replace(/a=fmtp:111 .*\r\n/, ''), sdp.replace(/a=fmtp:111 .*\r\n/, ''), 'every other line is untouched');
  // no fmtp line yet: one is added right after the rtpmap line
  const bare = ['m=audio 9 UDP/TLS/RTP/SAVPF 111', 'a=rtpmap:111 opus/48000/2', 'a=rtcp-fb:111 transport-cc', ''].join('\r\n');
  assert.match(tuneOpus(bare), /a=rtpmap:111 opus\/48000\/2\r\na=fmtp:111 useinbandfec=1;usedtx=1/);
  assert.equal(tuneOpus('m=video 9 UDP/TLS/RTP/SAVPF 96\r\na=rtpmap:96 VP8/90000\r\n'), 'm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=rtpmap:96 VP8/90000\r\n', 'no Opus: nothing changes');
  assert.equal(tuneOpus(tuneOpus(sdp)), tuneOpus(sdp), 'safe to apply twice');
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

test('a tile says what it is doing: live, connecting, or showing a picture because live is not available', () => {
  const t0 = 1_000_000;
  assert.equal(tileLiveState(true, t0, t0 + 999_999), 'live');
  assert.equal(tileLiveState(false, undefined, t0), 'connecting', 'not asked yet');
  assert.equal(tileLiveState(false, t0, t0 + 5_000), 'connecting');
  assert.equal(tileLiveState(false, t0, t0 + LIVE_GIVE_UP_MS + 1), 'picture');
  assert.equal(tileLiveState(false, t0, t0 + LIVE_GIVE_UP_MS + 1, 10_000), 'connecting', 'a big room is given longer to start');
});
