import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { streamExam } from '../server/services/exams/live.ts';
import { eventParser, readServerEvents } from '../src/services/examEvents.ts';

test('SSE parser accepts fragmented CRLF, comments, unicode, ids, and multiline data', () => {
  const events: any[] = [];
  const parse = eventParser(e => events.push(e));
  const source = ': heartbeat\r\nid: rev-1\r\nevent: snapshot\r\ndata: {"text":\r\ndata: "✓ handwriting"}\r\n\r\n';
  for (const char of source) parse(char);
  assert.equal(events.length, 1);
  assert.deepEqual(JSON.parse(events[0].data), { text: '✓ handwriting' });
  assert.equal(events[0].id, 'rev-1');
  assert.equal(events[0].event, 'snapshot');
});

test('SSE reader decodes split UTF-8 and can cancel an idle stream', async () => {
  const bytes = new TextEncoder().encode('event: snapshot\ndata: {"answer":"✓"}\n\n');
  const controller = new AbortController();
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(c) { for (const byte of bytes) c.enqueue(new Uint8Array([byte])); },
    cancel() { cancelled = true; },
  });
  const events: any[] = [];
  await readServerEvents(new Response(stream), e => { events.push(e); controller.abort(); }, controller.signal);
  assert.equal(JSON.parse(events[0].data).answer, '✓');
  assert.equal(cancelled, true);
});

test('live endpoint replays saved state on reconnect, sends only changed snapshots, and closes cleanly', async () => {
  let revision = 1, reads = 0;
  const app = express();
  app.get('/events', (req, res) => void streamExam(req, res, async () => ({ id: String(revision), data: { revision, read: ++reads } }), { intervalMs: 10, lifetimeMs: 2000 }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const controller = new AbortController();
    const response = await fetch(`${base}/events`, { signal: controller.signal, headers: { 'Last-Event-ID': '1' } });
    assert.match(response.headers.get('content-type')!, /text\/event-stream/);
    const events: any[] = [];
    await readServerEvents(response, e => {
      events.push(JSON.parse(e.data));
      if (events.length === 1) { assert.equal(events[0].revision, 1); setTimeout(() => { revision = 2; }, 45); }
      else controller.abort();
    }, controller.signal);
    assert.deepEqual(events.map(e => e.revision), [1, 2]);
    await new Promise(resolve => setTimeout(resolve, 30));
    const after = reads;
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(reads, after, 'disconnected clients do not keep background reads alive');
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
