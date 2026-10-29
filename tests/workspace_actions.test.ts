import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';

// Exercise the real React handlers with deterministic API responses; no live model.
test('studio actions save marks, approve, export, navigate and clear stale forms', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-ui-'));
  await fs.symlink(path.resolve('node_modules'), path.join(temp, 'node_modules'));
  await build({ entryPoints: ['src/components/ScanMarkWorkspace.tsx'], outfile: path.join(temp, 'workspace.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', jsx: 'automatic', loader: { '.css': 'empty' }, plugins: [{ name: 'test-styles', setup(b) { b.onResolve({ filter: /\.css$/ }, args => ({ path: args.path, namespace: 'empty-style' })); b.onLoad({ filter: /.*/, namespace: 'empty-style' }, () => ({ contents: '', loader: 'js' })); } }], logLevel: 'silent' });
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/' });
  const prior = new Map<string, PropertyDescriptor | undefined>();
  const install = (key: string, value: any) => { prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { value, configurable: true, writable: true }); };
  install('window', dom.window); install('document', dom.window.document); install('sessionStorage', dom.window.sessionStorage);
  install('navigator', dom.window.navigator); install('IS_REACT_ACT_ENVIRONMENT', true);
  install('ResizeObserver', class { observe() {} disconnect() {} });
  const oldCreate = URL.createObjectURL, oldRevoke = URL.revokeObjectURL;
  URL.createObjectURL = () => 'blob:fixture'; URL.revokeObjectURL = () => {};
  const calls: Array<{ url: string; method: string; body: any }> = [];
  const candidates = ['Alice', 'Bob'].map((name, index) => ({ id: `student-${index}`, candidateId: `C${index}`, candidateName: name, pages: 2, state: 'completed' }));
  let marks = 2, approved = false, released = false, failSave = false, exported = false;
  const readyArtifact = { status: 'ready', stale: false, classPdfUrl: '/api/files/class.pdf', candidatePdfs: [] };
  const row = (s: typeof candidates[number]) => ({ submissionId: s.id, candidateId: s.candidateId, candidateName: s.candidateName, total: marks, maxTotal: 3, percent: marks / 3 * 100, complete: true, openFlags: 0, released });
  const item = { id: 'Q1:mark', questionId: 'Q1', number: '1', kind: 'mark', page: 1, fx: .7, fy: .2, w: .1, h: .02, placed: true, auto: true, hidden: false, symbols: ['tick'], label: '2/3' };
  const snapshot = (id: string) => ({ exam: { examId: 'exam', title: 'Mathematics · Term 1', scheme: { status: 'confirmed', errors: [] }, submissions: candidates, progress: { run: null, work: { percent: 100, savedQuestions: 2, totalQuestions: 2, finished: 2, failed: 0, total: 2, active: [] } } },
    candidates: candidates.map(row), jobs: [], schemePreview: null, artifacts: exported ? [readyArtifact] : [],
    review: { exam: { examId: 'exam', title: 'Mathematics', allowHalfMarks: false }, candidate: { submissionId: id }, layout: { pages: [{ page: 1, aspect: 1.4 }, { page: 2, aspect: 1.4 }], items: [item] },
      questions: [{ questionId: 'Q1', number: '1', maxMarks: 3, awardedMarks: marks, answerAsRead: 'x = 4', feedback: 'Check working.', lostMarks: '', criterionResults: [], openReviewFlags: [], confirmed: approved ? { by: 'teacher', at: '' } : null }], evidence: [] } });
  install('fetch', async (input: any, init: any = {}) => {
    const url = String(input), method = init.method || 'GET';
    if (url.includes('/auth/refresh')) return Response.json({ accessToken: 'fixture', expiresIn: 900 });
    if (url.includes('/events?')) {
      const selected = new URL(url, 'http://localhost').searchParams.get('submissionId') || candidates[0].id;
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(`event: snapshot\ndata: ${JSON.stringify(snapshot(selected))}\n\n`)); } }), { headers: { 'Content-Type': 'text/event-stream' } });
    }
    if (url.includes('/pages/')) return new Response(new Blob(['image']));
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    calls.push({ url, method, body });
    if (url.includes('/layout/')) { Object.assign(item, body); return Response.json(snapshot('student-0').review); }
    if (url.includes('/marks/')) { if (failSave) return Response.json({ error: 'Save failed. Retry.' }, { status: 503 }); marks = body.marks; return Response.json({ after: marks }); }
    if (url.endsWith('/confirm')) { approved = true; return Response.json({ resultRevision: 2 }); }
    if (url.endsWith('/release')) { released = true; return Response.json({ released: ['C0'], skipped: [], exportJobId: null }); }
    if (url.endsWith('/exports')) { exported = true; return Response.json({ fresh: true }); }
    if (url.endsWith('/artifacts')) return Response.json({ artifacts: exported ? [readyArtifact] : [] });
    throw new Error(`Unexpected request: ${method} ${url}`);
  });
  const Workspace = (await import(pathToFileURL(path.join(temp, 'workspace.mjs')).href)).default;
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root')!);
  let scans = 0, closes = 0;
  const settle = async (fn: () => void = () => {}) => { await act(async () => { fn(); await new Promise(resolve => setTimeout(resolve, 15)); }); };
  const button = (text: string) => { const b = [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => (b.getAttribute('aria-label') || b.textContent?.trim()) === text); assert.ok(b, `Missing button ${text}`); return b; };
  const change = async (element: HTMLInputElement | HTMLSelectElement, value: string) => {
    await settle(() => { Object.getOwnPropertyDescriptor(element instanceof dom.window.HTMLSelectElement ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new dom.window.Event(element instanceof dom.window.HTMLSelectElement ? 'change' : 'input', { bubbles: true })); });
  };
  try {
    await settle(() => root.render(React.createElement(Workspace, { batch: { id: 'batch', examId: 'exam', pages: [] }, onExamReady() {}, onClose() { closes++; }, onScan() { scans++; }, onResults() {}, chat: React.createElement('p', null, 'Paper chat') })));
    await settle();
    assert.match(document.body.textContent!, /Mathematics · Term 1/);
    await settle(() => button('New scan').click()); assert.equal(scans, 1);
    await settle(() => button('Back to workspace').click()); assert.equal(closes, 1);
    await change(document.querySelector<HTMLInputElement>('[aria-label="Find student"]')!, 'Alice');
    assert.equal(document.querySelectorAll('.scan-student-card').length, 1);
    await change(document.querySelector<HTMLInputElement>('[aria-label="Find student"]')!, '');
    await change(document.querySelector<HTMLSelectElement>('[aria-label="Filter student papers"]')!, 'approved');
    assert.equal(document.querySelectorAll('.scan-student-card').length, 0);
    await change(document.querySelector<HTMLSelectElement>('[aria-label="Filter student papers"]')!, 'all');
    await change(document.querySelector<HTMLSelectElement>('[aria-label="Paper zoom"]')!, '150');
    assert.equal((document.querySelector('.scan-paper-page') as HTMLElement).style.width, '150%');
    await settle(() => button('Next').click()); assert.ok(document.querySelector('img[alt="Page 2"]'));
    await settle(() => button('Previous').click());
    await settle(() => button('Toggle fullscreen paper').click());
    assert.match(document.querySelector('[role="alert"]')!.textContent!, /does not support fullscreen/);
    await settle(() => button('Move marks').click());
    const mark = document.querySelector<HTMLElement>('[role="button"][aria-label="Question 1: 2/3"]')!;
    await settle(() => mark.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 100 })));
    await settle(() => mark.dispatchEvent(new dom.window.MouseEvent('pointermove', { bubbles: true, clientX: 120, clientY: 120 })));
    await settle(() => mark.dispatchEvent(new dom.window.MouseEvent('pointerup', { bubbles: true, clientX: 120, clientY: 120 })));
    assert.ok(calls.some(c => c.method === 'PUT' && c.url.endsWith('/layout/Q1%3Amark') && c.body.fx > .7));
    await settle(() => button('Finish placement').click());
    await change(document.querySelector<HTMLSelectElement>('#review-question')!, 'Q1');
    await settle(() => button('Approve this answer').click());
    assert.ok(calls.some(c => c.url.endsWith('/student-0/confirm') && c.body.question === 'Q1'));
    await settle(() => button('Adjust mark').click());
    assert.equal(document.querySelector<HTMLInputElement>('[aria-label="Teacher mark"]')!.step, '1');
    await change(document.querySelector<HTMLInputElement>('[aria-label="Teacher mark"]')!, '3');
    await change(document.querySelector<HTMLInputElement>('[aria-label="Reason for mark adjustment"]')!, 'Valid method');
    await settle(() => document.querySelector<HTMLInputElement>('[aria-label="Teacher mark"]')!.form!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
    assert.ok(calls.some(c => c.method === 'PATCH' && c.body.marks === 3 && c.body.reason === 'Valid method'));
    await settle(() => button('Adjust mark').click());
    failSave = true;
    await settle(() => document.querySelector<HTMLInputElement>('[aria-label="Teacher mark"]')!.form!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
    assert.match(document.querySelector('[role="alert"]')!.textContent!, /Save failed/);
    assert.ok(document.querySelector('[aria-label="Teacher mark"]'), 'failed saves preserve the editor');
    failSave = false;
    await settle(() => button('Cancel').click());
    assert.equal(document.querySelector('[aria-label="Teacher mark"]'), null);
    await settle(() => button('Adjust mark').click());
    await settle(() => document.querySelector<HTMLButtonElement>('.scan-student-card:nth-last-child(1)')!.click());
    assert.equal(document.querySelector('[aria-label="Teacher mark"]'), null, 'student switch clears another paper’s editor');
    await settle(() => button('Export PDFs').click());
    assert.ok(document.querySelector('a[href="/api/files/class.pdf"]'));
    await settle(() => button('Results').click());
    assert.match(document.querySelector('[aria-label="Class results"]')!.textContent!, /Alice.*Bob/);
    await settle(() => button('Ask AI').click());
    assert.match(document.querySelector('[aria-label="Paper conversation"]')!.textContent!, /Paper chat/);
    await settle(() => button('Paper').click());
    await settle(() => button('Confirm reviewed paper').click());
    assert.ok(calls.some(c => c.url.endsWith('/release') && c.body.submissionIds[0] === 'student-1'));
  } finally {
    await act(async () => root.unmount());
    URL.createObjectURL = oldCreate; URL.revokeObjectURL = oldRevoke;
    for (const [key, descriptor] of prior) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete (globalThis as any)[key]; }
    dom.window.close(); await fs.rm(temp, { recursive: true, force: true });
  }
});
