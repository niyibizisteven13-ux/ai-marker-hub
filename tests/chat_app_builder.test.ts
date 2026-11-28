import assert from 'node:assert/strict';
import test from 'node:test';
import { chatAppLink, chatAppRequest, featureBuilderEndpoint, isChatAppProject } from '../shared/chatAppBuilder.js';

test('chat accepts app builds and follow-up edits while leaving unrelated chat alone', () => {
  assert.equal(chatAppRequest('Build a booking app with an appointment dashboard', false), true);
  assert.equal(chatAppRequest('/app make a gallery', false), true);
  assert.equal(chatAppRequest('Add search and make the menu smaller', true), true);
  assert.equal(chatAppRequest('Add search and make the menu smaller', false), false);
  assert.equal(chatAppRequest('How do I build a website?', false), false);
  assert.equal(chatAppRequest('Update my Bwenge4Biz app', true), false);
});

test('chat workspace links refer to a validated project and do not overwrite the default workspace', () => {
  assert.equal(isChatAppProject('session-1234'), true);
  assert.equal(isChatAppProject('../someone-else'), false);
  assert.equal(chatAppLink('session-1234'), '/builder?workspace=custom&project=session-1234');
  assert.equal(featureBuilderEndpoint('custom', 'session-1234'), '/api/agent/builder/custom?project=session-1234');
  assert.equal(featureBuilderEndpoint('business', 'session-1234'), '/api/agent/builder/business');
});

test('app build returns streaming progress before the saved revision', async () => {
  const { readBuilderRun } = await import('../src/utils/builderStream.js');
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('{"type":"progress","id":"compile",'));
      controller.enqueue(encoder.encode('"label":"Compiling","state":"running"}\n{"type":"result","data":{"revision":2}}\n'));
      controller.close();
    },
  });
  const progress: string[] = [];
  const response = new Response(stream, { headers: { 'content-type': 'application/x-ndjson' } });
  assert.deepEqual(await readBuilderRun(response, event => progress.push(event.label)), { revision: 2 });
  assert.deepEqual(progress, ['Compiling']);
  const incomplete = new Response('', { headers: { 'content-type': 'application/x-ndjson' } });
  await assert.rejects(readBuilderRun(incomplete, () => undefined), /before saving/);
});

test('revision history captures prior source and keeps workspace release pinned', async () => {
  const { nextRevision, revisionStateSchema, snapshot } = await import('../server/services/featureRevisions.js');
  const files = { 'App.jsx': 'old source', 'styles.css': 'old styles' };
  const initial = revisionStateSchema.parse({ revision: 5, files, summary: 'Previous build' });
  const released = { ...initial, published: snapshot(initial) };
  const updated = nextRevision(released, { ...files, 'App.jsx': 'new source' }, 'Next build');
  assert.equal(updated.revision, 6);
  assert.deepEqual(updated.history, [snapshot(initial)]);
  assert.deepEqual(updated.published, snapshot(initial));
  let latest = updated;
  for (let i = 0; i < 15; i++) latest = nextRevision(latest, latest.files, 'Another edit');
  assert.equal(latest.history.length, 12);
  assert.equal(latest.published?.revision, 5);
  assert.equal(revisionStateSchema.safeParse(latest).success, true);
});

test('browser check output requires a completed browser report', async () => {
  const { browserCheckDocument, readBrowserCheck } = await import('../server/services/featureScreenshot.js');
  const instrumented = browserCheckDocument('<head></head><div id="root"></div>');
  assert.match(instrumented, /bwenge-browser-check/);
  assert.deepEqual(readBrowserCheck('<meta name="bwenge-browser-check" content="0,1,2,3">'), {
    rendered: true, horizontalOverflow: true, runtimeErrors: 2, controlsWithoutNames: 3,
  });
  assert.throws(() => readBrowserCheck('<div id="root"></div>'), /did not finish/);
});
