import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';

// HTTP contract of /api/outputs with the real service wiring. SYNTHETIC data only.
// Auth is simulated: the real app mounts outputsRouter behind requireAuth and the share router without it.
const { outputsRouter, sharedOutputsRouter } = await import('../server/routes/outputRoutes.js');
const { fileJobQueue, fileStore } = await import('../server/services/AiService.js');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use('/api/outputs/shared', sharedOutputsRouter);
app.use((req, res, next) => {
  const u = req.headers['x-test-user'];
  if (typeof u !== 'string') return res.status(401).json({ error: 'unauthorized' });
  (req as any).user = { userId: u };
  next();
});
app.use('/api/outputs', outputsRouter);
const server = app.listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
test.after(async () => { await fileJobQueue.stop(); server.close(); });

const owner = `out-owner-${Date.now()}`;
const other = `out-other-${Date.now()}`;
const as = (u: string, init: RequestInit = {}) => ({ ...init, headers: { ...(init.headers ?? {}), 'x-test-user': u } });
const json = (u: string, method: string, body: unknown) => as(u, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

async function settle(id: string) {
  for (let i = 0; i < 600; i++) {
    const a = (await (await fetch(`${base}/api/outputs/${id}`, as(owner))).json()).artifact;
    if (a.status === 'ready' || a.status === 'failed') return a;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('render did not finish');
}

test('outputs API: create, reuse, download safely, revise, share, and scope every request to its owner', async () => {
  const table = { columns: [{ key: 'd', label: 'District' }, { key: 'v', label: 'Rate', unit: '%' }], rows: [{ d: '<b>A</b>', v: 10 }, { d: 'B', v: 20 }] };
  const spec = { kind: 'widget', title: 'Explorer', sources: [{ type: 'inline', label: 'Synthetic' }], widget: { type: 'table_explorer', table } };
  const created = await fetch(`${base}/api/outputs`, json(owner, 'POST', spec));
  assert.equal(created.status, 201);
  const a = (await created.json()).artifact;
  assert.equal(a.status, 'ready');
  assert.equal(a.format, 'html');
  assert.equal(a.owner, owner);
  assert.equal(a.download, `/api/outputs/${a.id}/download`);
  const again = await fetch(`${base}/api/outputs`, json(owner, 'POST', spec));
  assert.equal(again.status, 200);
  assert.equal((await again.json()).artifact.id, a.id);

  const invalid = await fetch(`${base}/api/outputs`, json(owner, 'POST', { kind: 'chart', title: 'x', chart: { type: 'bar', x: { field: 'a', title: 'A' }, y: { field: 'b', title: 'B' }, data: [{ a: 1, b: 2 }], sourceNote: 'src' } }));
  assert.equal(invalid.status, 422);
  const ib = await invalid.json();
  assert.equal(ib.code, 'INVALID_SPEC');
  assert.ok(ib.details.some((d: string) => /unit/.test(d)));

  // Downloads: attachment by default; ?view=1 serves HTML inline under a sandboxing CSP.
  const dl = await fetch(`${base}/api/outputs/${a.id}/download`, as(owner));
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get('content-disposition')!, /^attachment/);
  assert.equal(dl.headers.get('content-type'), 'application/octet-stream');
  assert.equal(dl.headers.get('x-content-type-options'), 'nosniff');
  const view = await fetch(`${base}/api/outputs/${a.id}/download?view=1`, as(owner));
  assert.match(view.headers.get('content-type')!, /^text\/html/);
  assert.match(view.headers.get('content-security-policy')!, /sandbox allow-scripts/);
  assert.match(view.headers.get('content-security-policy')!, /connect-src 'none'/);
  const html = await view.text();
  assert.ok(!html.includes('<b>A</b>'), 'cell text is escaped');

  for (const [method, p] of [['GET', ''], ['GET', '/download'], ['GET', '/revisions'], ['POST', '/retry'], ['POST', '/share'], ['DELETE', '']] as const) {
    const r = await fetch(`${base}/api/outputs/${a.id}${p}`, method === 'POST' ? json(other, method, p === '/share' ? { mode: 'link' } : {}) : as(other, { method }));
    assert.equal(r.status, 404, `${method} ${p} as another user`);
  }
  assert.equal((await (await fetch(`${base}/api/outputs`, as(other))).json()).artifacts.length, 0);

  const rev = await fetch(`${base}/api/outputs/${a.id}/revisions`, json(owner, 'POST', { ...spec, title: 'Explorer v2' }));
  assert.equal(rev.status, 201);
  const r2 = (await rev.json()).artifact;
  assert.equal(r2.revision, 2);
  const revs = (await (await fetch(`${base}/api/outputs/${r2.id}/revisions`, as(owner))).json()).revisions;
  assert.deepEqual(revs.map((r: any) => r.revision), [1, 2]);

  // Link share: public, token-only, revocable.
  const sh = await (await fetch(`${base}/api/outputs/${a.id}/share`, json(owner, 'POST', { mode: 'link', expiresInHours: 1 }))).json();
  assert.ok(sh.shareToken);
  assert.equal(sh.sharePath, `/api/outputs/shared/${sh.shareToken}`);
  const pub = await fetch(`${base}${sh.sharePath}?view=1`);
  assert.equal(pub.status, 200);
  assert.match(pub.headers.get('content-security-policy')!, /sandbox/);
  const meta = (await (await fetch(`${base}${sh.sharePath}?meta=1`)).json()).artifact;
  assert.equal(meta.owner, undefined, 'owner id not exposed publicly');
  assert.equal((await fetch(`${base}/api/outputs/shared/${'a'.repeat(32)}`)).status, 404);
  assert.equal((await fetch(`${base}/api/outputs/shared/..%2F..%2Fetc`)).status, 404);
  await fetch(`${base}/api/outputs/${a.id}/share`, json(owner, 'POST', { mode: 'private' }));
  assert.equal((await fetch(`${base}${sh.sharePath}`)).status, 404);

  const del = await fetch(`${base}/api/outputs/${a.id}`, as(owner, { method: 'DELETE' }));
  assert.equal(del.status, 200);
  assert.equal((await fetch(`${base}/api/outputs/${a.id}`, as(owner))).status, 404);
});

test('outputs API: plan and analyze run against owned files only', async () => {
  const csv = 'hours,score\n1,52\n2,55\n3,61\n4,64\n5,70\n6,72\n7,79\n8,83';
  const f = await fileStore.put({ userId: owner, name: 'study.csv', mime: 'text/csv', kind: 'text', data: Buffer.from(csv) });

  const plan = (await (await fetch(`${base}/api/outputs/plan`, json(owner, 'POST', { message: 'Does study time correlate with score? Show a chart', sources: [{ type: 'file', id: f.id }] }))).json()).plan;
  assert.equal(plan.output, 'chart');
  assert.equal(plan.needsComputation, true);
  assert.deepEqual(plan.authorizedSources, [{ type: 'file', id: f.id }]);
  const planOther = (await (await fetch(`${base}/api/outputs/plan`, json(other, 'POST', { message: 'chart', sources: [{ type: 'file', id: f.id }] }))).json()).plan;
  assert.equal(planOther.rejectedSources.length, 1);

  const run = await fetch(`${base}/api/outputs/analyze`, json(owner, 'POST', { dataset: { type: 'file', id: f.id }, analysis: { operations: [{ op: 'correlation', columns: ['hours', 'score'] }, { op: 'regression', y: 'score', x: ['hours'] }], units: { score: 'points', hours: 'h' } } }));
  assert.ok([200, 202].includes(run.status), String(run.status));
  const a = await settle((await run.json()).artifact.id);
  assert.equal(a.status, 'ready', a.error);
  const analysis = (await (await fetch(`${base}/api/outputs/${a.id}/analysis`, as(owner))).json()).analysis;
  assert.equal(analysis.rowsIn, 8);
  assert.equal(analysis.units.score, 'points');
  const slope = analysis.results[1].coefficients.find((c: any) => c.term === 'hours').estimate;
  // Sxy / Sxx = 188 / 42 for this synthetic data.
  assert.ok(Math.abs(slope - 188 / 42) < 1e-9, String(slope));
  assert.equal((await fetch(`${base}/api/outputs/${a.id}/analysis`, as(other))).status, 404);

  const stolen = await fetch(`${base}/api/outputs/analyze`, json(other, 'POST', { dataset: { type: 'file', id: f.id }, analysis: { operations: [{ op: 'missing' }] } }));
  assert.equal(stolen.status, 404);
  assert.equal((await stolen.json()).code, 'SOURCE_NOT_FOUND');
  const badCol = await fetch(`${base}/api/outputs/analyze`, json(owner, 'POST', { dataset: { type: 'file', id: f.id }, analysis: { operations: [{ op: 'describe', columns: ['nope'] }] } }));
  const bc = await settle((await badCol.json()).artifact.id);
  assert.equal(bc.status, 'failed');
  assert.match(bc.error, /nope/);
});
