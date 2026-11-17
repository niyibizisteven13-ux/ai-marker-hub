import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

test('Upgrade always shows manual payment with old live gateway metadata and keeps WhatsApp usable without purchase API', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://bwenge.space/upgrade' });
  const before = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const limits = { monthly: 400, maxUploadMb: 100, maxAttachments: 10, memory: false, memoryItems: 0 };
  const requests: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input); requests.push(url);
    if (url.endsWith('/plans')) return Response.json({ payments: 'live', manual: null, fxUsdRwf: 1500, plans: [{ id: 'FREE', name: 'Free', limits }, { id: 'GO', name: 'Top-up', limits, packs: [] }, { id: 'PLUS', name: 'Pro Plus', priceRwf: 7000, priceUsd: 4.67, limits }] });
    if (url.endsWith('/me')) return Response.json({ plan: 'FREE', planName: 'Free', wallet: 0, subscription: null, usage: { day: { used: 0, limit: 15 }, month: { used: 0, limit: 50 } } });
    if (url.endsWith('/pay-ref')) return Response.json({ code: 'BW-TEST01', email: 'login@example.com' });
    return Response.json({ error: 'Old server' }, { status: 404 });
  };
  const { setAccessToken } = await import('../src/utils/authFetch.js');
  setAccessToken('test-only');
  const { default: UpgradePage } = await import('../src/pages/UpgradePage.js');
  const root = createRoot(document.getElementById('root')!);
  try {
    await act(async () => { root.render(React.createElement(UpgradePage, { onBack() {}, onSuccess() {} })); await new Promise(r => setTimeout(r, 20)); });
    const choose = [...document.querySelectorAll('button')].find(b => b.textContent?.includes('Choose · 7,000 RWF'));
    assert.ok(choose);
    await act(async () => { choose.click(); await new Promise(r => setTimeout(r, 20)); });
    const dialog = document.querySelector('[role="dialog"]')!;
    assert.match(dialog.textContent!, /Automatic MTN payment is not available/);
    assert.match(dialog.textContent!, /2191184/); assert.match(dialog.textContent!, /Niyibizi Steven/);
    assert.match(dialog.textContent!, /250799691108/); assert.match(dialog.textContent!, /confirmation SMS/);
    assert.equal(dialog.querySelector('input[inputmode="tel"]'), null);
    assert.doesNotMatch(dialog.textContent!, /Enter your MoMo PIN|MTN Mobile Money number/);
    const link = dialog.querySelector('a[href^="https://wa.me/250799691108"]')!;
    assert.ok(link, 'manual proof is not blocked by the old server');
    assert.match(decodeURIComponent(link.getAttribute('href')!), /login@example.com/);
    assert.match(decodeURIComponent(link.getAttribute('href')!), /7,000 RWF/);
    assert.ok(!requests.some(p => p.endsWith('/billing/checkout')), 'no automatic checkout request');
  } finally { await act(async () => root.unmount()); dom.window.close(); Object.assign(globalThis, before); }
});
