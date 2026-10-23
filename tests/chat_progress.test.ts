import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

// Live progress in the chat: the server's step sequence (understanding → writing → tools → checking → summarising),
// the heartbeat that keeps long answers alive through proxies, and the client merging steps in place.

const { makeEmitter } = await import('../server/utils/sseEmitter.js');
const { applyStatusEvent, applyToolEvent } = await import('../src/utils/toolSteps.js');

function fakeRes() {
  const res = new EventEmitter() as any;
  res.chunks = [] as string[];
  res.ended = false;
  res.write = (c: string) => { res.chunks.push(c); return true; };
  res.end = () => { res.ended = true; };
  res.events = () => res.chunks.filter((c: string) => c.startsWith('data: {')).map((c: string) => JSON.parse(c.slice(6)));
  return res;
}
const steps = (res: any) => res.events().filter((e: any) => e.type === 'status').map((e: any) => `${e.id}:${e.state}`);

test('progress: steps follow the work in order and are all finished at the end', () => {
  const res = fakeRes();
  const em = makeEmitter(res, { progress: true });
  em.send('text', { text: "I'll build the chart." });
  em.send('tool_call', { id: 't1', name: 'create_output' });
  em.send('tool_call', { id: 't2', name: 'create_output' });
  em.send('tool_result', { id: 't1' });
  em.send('tool_result', { id: 't2' });
  em.send('text', { text: 'Here are your files.' });
  em.done();
  assert.deepEqual(steps(res), [
    'think:running', 'think:done',
    'write-1:running', 'write-1:done', // writing pauses while the tools run
    'review-1:running', 'review-1:done', // the model reads the tool results
    'write-2:running', 'write-2:done',
  ]);
  const labels = Object.fromEntries(res.events().filter((e: any) => e.type === 'status').map((e: any) => [e.id, e.label]));
  assert.equal(labels['write-2'], 'Summarising the results');
  assert.equal(res.chunks.at(-1), 'data: [DONE]\n\n');
  assert.ok(res.ended);
});

test('progress: a plain answer is understanding then writing; thinking text does not count as writing', () => {
  const res = fakeRes();
  const em = makeEmitter(res, { progress: true });
  em.send('text', { text: 'considering…', isThinking: true });
  em.send('text', { text: '' });
  assert.deepEqual(steps(res), ['think:running']);
  em.send('text', { text: 'Photosynthesis turns light into chemical energy.' });
  em.status('files', 'Read 2 files', 'done', 'a.pdf, b.jpg');
  em.done();
  assert.deepEqual(steps(res), ['think:running', 'think:done', 'write-1:running', 'files:done', 'write-1:done']);
  const plain = fakeRes();
  makeEmitter(plain).send('text', { text: 'hi' });
  assert.deepEqual(steps(plain), [], 'limit and error messages carry no steps');
});

test('heartbeat: a comment every 15 s keeps long generations alive; it stops when the stream ends', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const res = fakeRes();
  const em = makeEmitter(res);
  t.mock.timers.tick(15_000 * 4);
  assert.equal(res.chunks.filter((c: string) => c === ':\n\n').length, 4);
  em.done();
  t.mock.timers.tick(60_000);
  assert.equal(res.chunks.filter((c: string) => c === ':\n\n').length, 4);
  const closed = fakeRes();
  makeEmitter(closed);
  closed.emit('close');
  t.mock.timers.tick(60_000);
  assert.equal(closed.chunks.length, 0, 'no writes after the client left');
});

test('client: status events update one step in place next to tool steps', () => {
  let s = applyStatusEvent([], { id: 'think', label: 'Understanding your request', state: 'running' });
  s = applyToolEvent(s, { type: 'tool_call', id: 't1', name: 'create_output', input: { spec: { kind: 'chart', title: 'Scores' } } });
  s = applyStatusEvent(s, { id: 'think', label: 'Understanding your request', state: 'done' });
  s = applyStatusEvent(s, { id: 'exam-marking', label: 'Marked 3 of 20 scripts', state: 'running' });
  s = applyStatusEvent(s, { id: 'exam-marking', label: 'Marked 4 of 20 scripts', state: 'running', detail: 'Class 4B' });
  assert.deepEqual(s.map((x) => [x.label, x.status]), [['Understanding your request', 'done'], ['Creating chart: Scores', 'running'], ['Marked 4 of 20 scripts', 'running']]);
  assert.equal(s[2].summary, 'Class 4B');
  assert.equal(applyStatusEvent(s, { label: 'no id' }), s);
});
