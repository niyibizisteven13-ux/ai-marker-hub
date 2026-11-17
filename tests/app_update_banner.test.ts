import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

test('a stale installed page detects a new build on its first check and Later preserves current work', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://bwenge.space' });
  const old = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, __BWENGE_BUILD__: 'old-build', IS_REACT_ACT_ENVIRONMENT: true });
  globalThis.fetch = async () => new Response(JSON.stringify({ build: 'new-build' }), { headers: { 'Content-Type': 'application/json' } });
  const { default: UpdateBanner } = await import('../src/components/UpdateBanner.js');
  const root = createRoot(document.getElementById('root')!);
  try {
    await act(async () => { root.render(React.createElement(UpdateBanner)); await new Promise(r => setTimeout(r, 20)); });
    assert.match(document.body.textContent!, /Bwenge update available/);
    assert.match(document.body.textContent!, /Finish or save your work first/);
    const later = [...document.querySelectorAll('button')].find(b => b.textContent === 'Later')!;
    await act(async () => later.click());
    assert.doesNotMatch(document.body.textContent!, /Bwenge update available/);
    await act(async () => { dom.window.dispatchEvent(new dom.window.Event('online')); await new Promise(r => setTimeout(r, 10)); });
    assert.doesNotMatch(document.body.textContent!, /Bwenge update available/, 'same declined update is not repeatedly prompted');
  } finally { await act(async () => root.unmount()); dom.window.close(); Object.assign(globalThis, old); }
});
