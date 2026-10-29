import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';

// HTTP contract of /api/admin/knowledge and /api/knowledge/sources with the real service wiring.
// SYNTHETIC files only. Auth is simulated: the real app mounts these behind requireAuth + requireRole('ADMIN').
const { knowledgeAdminRouter, knowledgeSourcesRouter } = await import('../server/routes/knowledgeRepositoryRoutes.js');
const { fileJobQueue } = await import('../server/services/AiService.js');

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  const u = req.headers['x-test-user'];
  if (typeof u !== 'string') return res.status(401).json({ error: 'unauthorized' });
  (req as any).user = { userId: u };
  next();
});
app.use('/api/admin/knowledge', knowledgeAdminRouter);
app.use('/api/knowledge', knowledgeSourcesRouter);
const server = app.listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
test.after(async () => { await fileJobQueue.stop(); server.close(); });

const owner = `route-admin-${Date.now()}`;
const other = `route-other-${Date.now()}`;
const as = (u: string, init: RequestInit = {}) => ({ ...init, headers: { ...(init.headers ?? {}), 'x-test-user': u } });
const json = (u: string, method: string, body: unknown) => as(u, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

async function waitIndexed(repoId: string) {
  for (let i = 0; i < 400; i++) {
    const s = (await (await fetch(`${base}/api/admin/knowledge/repositories/${repoId}/statistics`, as(owner))).json()).data;
    if (!s.awaitingIndexing && !s.indexing) return s;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('indexing did not finish');
}

test('knowledge API: folder upload, browse, download safely, scope every request to its owner', async () => {
  const created = await fetch(`${base}/api/admin/knowledge/repositories`, json(owner, 'POST', { name: 'Route Repo', description: 'synthetic', settings: { assistant: false } }));
  assert.equal(created.status, 201);
  const repo = (await created.json()).data;
  assert.ok(repo.knowledgeBaseId);
  assert.equal(repo.settings.assistant, false, 'an admin can keep a dataset private');
  const pub = (await (await fetch(`${base}/api/admin/knowledge/repositories`, json(owner, 'POST', { name: 'Library Repo' }))).json()).data;
  assert.equal(pub.settings.assistant, true, 'admin datasets join the public library by default');
  const shelf = (await (await fetch(`${base}/api/knowledge/library`, as(other))).json()).data;
  assert.ok(shelf.some((d: any) => d.id === pub.id) && !shelf.some((d: any) => d.id === repo.id), 'other users see the public dataset, not the private one');
  assert.equal((await fetch(`${base}/api/knowledge/library/${repo.id}`, as(other))).status, 404);
  assert.equal((await (await fetch(`${base}/api/knowledge/library/${pub.id}?path=`, as(other))).json()).data.repository.name, 'Library Repo');
  assert.equal((await fetch(`${base}/api/admin/knowledge/repositories`, json(owner, 'POST', { name: 'x', extra: true }))).status, 400, 'unknown fields rejected');

  // Folder upload as a browser sends it: relative paths (webkitRelativePath) in a parallel JSON field.
  const fd = new FormData();
  fd.append('files', new Blob(['Lesson plan on fractions.']), 'plan.txt');
  fd.append('files', new Blob(['<p>Hello</p><script>alert(1)</script>']), 'page.html');
  fd.append('files', new Blob(['escape']), 'evil.txt');
  fd.append('relativePaths', JSON.stringify(['Course/Week 1/plan.txt', 'Course/page.html', '../../evil.txt']));
  fd.append('emptyFolders', JSON.stringify(['Course/Week 2']));
  const up = await fetch(`${base}/api/admin/knowledge/repositories/${repo.id}/folder-uploads`, as(owner, { method: 'POST', body: fd }));
  assert.equal(up.status, 201);
  const upBody = (await up.json()).data;
  assert.deepEqual(upBody.summary, { created: 2, replaced: 0, renamed: 0, unchanged: 0, skipped: 0, rejected: 1 });
  assert.match(upBody.results.find((r: any) => r.status === 'rejected').reason, /leave the repository/);

  // Paths in the multipart filename itself are kept too (preservePath).
  const fd2 = new FormData();
  fd2.append('files', new Blob(['Data notes']), 'Data/raw/notes.txt');
  assert.equal((await fetch(`${base}/api/admin/knowledge/repositories/${repo.id}/folder-uploads`, as(owner, { method: 'POST', body: fd2 }))).status, 201);

  const tree = (await (await fetch(`${base}/api/admin/knowledge/repositories/${repo.id}/tree`, as(owner))).json()).data;
  assert.deepEqual(tree.directories.map((d: any) => d.path), ['Course', 'Course/Week 1', 'Course/Week 2', 'Data', 'Data/raw']);
  const week1 = tree.directories.find((d: any) => d.path === 'Course/Week 1');
  const list = (await (await fetch(`${base}/api/admin/knowledge/repositories/${repo.id}/directories/${week1.id}/contents?sort=name`, as(owner))).json()).data;
  assert.deepEqual(list.files.map((f: any) => f.name), ['plan.txt']);
  assert.deepEqual(list.breadcrumbs.map((b: any) => b.name), ['Route Repo', 'Course', 'Week 1']);
  assert.equal((await fetch(`${base}/api/admin/knowledge/repositories/${repo.id}/contents?sort=bogus`, as(owner))).status, 400);

  const stats = await waitIndexed(repo.id);
  assert.equal(stats.files, 3);
  const plan = list.files[0];

  // Download: attachment by default, Range supported, nothing executable inline.
  const dl = await fetch(`${base}/api/admin/knowledge/files/${plan.id}/download`, as(owner));
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get('content-disposition')!, /^attachment; filename="plan.txt"/);
  assert.equal(dl.headers.get('x-content-type-options'), 'nosniff');
  assert.match(dl.headers.get('content-security-policy')!, /sandbox/);
  assert.equal(await dl.text(), 'Lesson plan on fractions.');
  const part = await fetch(`${base}/api/admin/knowledge/files/${plan.id}/download`, as(owner, { headers: { Range: 'bytes=0-5' } }));
  assert.equal(part.status, 206);
  assert.equal(await part.text(), 'Lesson');
  const htmlFile = (await (await fetch(`${base}/api/admin/knowledge/repositories/${repo.id}/search?q=page&scope=names`, as(owner))).json()).data.files[0];
  const htmlDl = await fetch(`${base}/api/admin/knowledge/files/${htmlFile.id}/download?inline=1`, as(owner));
  assert.match(htmlDl.headers.get('content-disposition')!, /^attachment/, 'HTML is never served inline');
  assert.equal(htmlDl.headers.get('content-type'), 'application/octet-stream');
  const prev = (await (await fetch(`${base}/api/admin/knowledge/files/${htmlFile.id}/preview`, as(owner))).json()).data;
  assert.doesNotMatch(prev.html, /script/);
  assert.equal((await fetch(`${base}/api/admin/knowledge/files/${plan.id}/preview?render=image`, as(owner))).status, 400);

  // Content search through the API (keyword; no embedding provider in tests).
  const found = (await (await fetch(`${base}/api/admin/knowledge/repositories/${repo.id}/search?q=fractions&scope=content`, as(owner))).json()).data;
  assert.equal(found.content[0].path, 'Course/Week 1/plan.txt');
  assert.equal(found.method, 'keyword');
  assert.equal((await (await fetch(`${base}/api/admin/knowledge/files/${plan.id}`, as(owner))).json()).data.indexing.status, 'pending_embeddings');

  // Rename, move, delete through the API.
  const ren = await fetch(`${base}/api/admin/knowledge/files/${plan.id}`, json(owner, 'PATCH', { name: 'lesson.txt' }));
  assert.equal((await ren.json()).data.file.path, 'Course/Week 1/lesson.txt');
  const course = tree.directories.find((d: any) => d.path === 'Course');
  assert.equal((await fetch(`${base}/api/admin/knowledge/directories/${course.id}`, as(owner, { method: 'DELETE' }))).status, 409, 'non-empty folders need recursive=true');
  assert.equal((await fetch(`${base}/api/admin/knowledge/repositories/${repo.id}`, as(owner, { method: 'DELETE' }))).status, 400, 'repository deletion needs confirmation');

  // Cited sources: owner can open, others cannot.
  const src = await fetch(`${base}/api/knowledge/sources/${plan.id}`, as(owner));
  assert.equal(src.status, 200);
  assert.equal((await fetch(`${base}/api/knowledge/sources/${plan.id}`, as(other))).status, 404);

  // Every admin endpoint is owner-scoped.
  for (const [method, url] of [
    ['GET', `/repositories/${repo.id}`], ['GET', `/repositories/${repo.id}/tree`], ['GET', `/repositories/${repo.id}/contents`], ['GET', `/repositories/${repo.id}/search?q=plan`],
    ['GET', `/files/${plan.id}`], ['GET', `/files/${plan.id}/preview`], ['GET', `/files/${plan.id}/download`], ['DELETE', `/files/${plan.id}`], ['POST', `/files/${plan.id}/index`],
    ['DELETE', `/directories/${course.id}?recursive=true`], ['GET', `/jobs/${upBody.indexJobId}`],
  ] as const) {
    const r = await fetch(`${base}/api/admin/knowledge${url}`, as(other, { method }));
    assert.equal(r.status, 404, `${method} ${url}`);
    assert.equal((await r.json()).success, false);
  }
  assert.deepEqual((await (await fetch(`${base}/api/admin/knowledge/repositories`, as(other))).json()).data, []);
  const job = (await (await fetch(`${base}/api/admin/knowledge/jobs/${upBody.indexJobId}`, as(owner))).json()).data;
  assert.equal(job.job.status, 'completed');
  assert.equal(job.files.length, 2);

  const del = await fetch(`${base}/api/admin/knowledge/directories/${course.id}?recursive=true`, as(owner, { method: 'DELETE' }));
  assert.deepEqual((await del.json()).data, { deletedFiles: 2, deletedFolders: 3 });
  assert.equal((await fetch(`${base}/api/admin/knowledge/repositories/${repo.id}?confirm=true`, as(owner, { method: 'DELETE' }))).status, 200);
});
