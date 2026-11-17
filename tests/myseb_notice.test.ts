import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const { pickNotice } = createRequire(import.meta.url)('../myseb/desktop/src/notice.js');

// A message from the teacher reaches the laptop app on the heartbeat; the app reads it without trusting the shape and shows it once.
test('the laptop app shows a teacher message once, cleaned and short, and ignores anything odd', () => {
  assert.deepEqual(pickNotice({ status: 'IN_EXAM', notice: { id: 'a1', text: 'Ten minutes were added.' } }, ''), { id: 'a1', title: 'Message from your teacher', text: 'Ten minutes were added.' });
  assert.equal(pickNotice({ notice: { id: 'a1', text: 'Same one' } }, 'a1'), null, 'not shown twice');
  assert.equal(pickNotice({ notice: { id: 'a2', text: 'A new one' } }, 'a1')!.text, 'A new one');
  assert.equal(pickNotice({ notice: null }, ''), null); assert.equal(pickNotice({}, ''), null); assert.equal(pickNotice(null, ''), null); assert.equal(pickNotice('x', ''), null);
  assert.equal(pickNotice({ notice: { id: 5, text: 'x' } }, ''), null); assert.equal(pickNotice({ notice: { id: 'a', text: 42 } }, ''), null); assert.equal(pickNotice({ notice: { id: 'a', text: '   ' } }, ''), null);
  const long = pickNotice({ notice: { id: 'a', text: `${'x'.repeat(500)}\u0000\n` } }, '')!; assert.equal(long.text.length, 300);
  assert.equal(pickNotice({ notice: { id: 'a', text: 'a\u0000b\nc' } }, '')!.text, 'a b c');
});

// The phone app is Dart and is built in CI; here we only make sure both apps still read the same field the server sends.
test('both apps read the notice the server sends on the heartbeat', () => {
  const server = readFileSync('myseb/backend/src/routes.js', 'utf8'); assert.match(server, /notice: noticeFor\(session\.exam_id, session\.id\)/);
  const dart = readFileSync('myseb/mobile/lib/services/api.dart', 'utf8'); assert.match(dart, /j\['notice'\]/); assert.match(dart, /HeartbeatResult\.noticeOf\(j\)/);
  const screen = readFileSync('myseb/mobile/lib/screens/exam_screen.dart', 'utf8'); assert.match(screen, /MESSAGE FROM YOUR TEACHER/); assert.match(screen, /_seenNotice = _noticeId/);
  const main = readFileSync('myseb/desktop/src/main.js', 'utf8'); assert.match(main, /pickNotice\(r\.json, lastNoticeId\)/);
  for (const f of ['myseb/mobile/lib/services/api.dart', 'myseb/mobile/lib/screens/exam_screen.dart']) { const t = readFileSync(f, 'utf8'); for (const [a, b] of [['(', ')'], ['{', '}'], ['[', ']']]) assert.equal(t.split(a).length, t.split(b).length, `${f}: ${a}${b} balanced`); }
});
