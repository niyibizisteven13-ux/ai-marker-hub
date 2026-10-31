import sharp from 'sharp';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-routes-'));
process.env.FILE_STORE_DIR = path.join(root, 'files');
process.env.JOBS_DIR = path.join(root, 'jobs');
process.env.ASSESSMENTS_DIR = path.join(root, 'assessments');
process.env.FILE_URL_SECRET ??= 'test-file-url-secret-0123456789abcdef';

const { analyticsRouter, assessmentRouter, documentsRouter, jobsRouter } = await import('../server/routes/educationRoutes.js');
const { examsRouter } = await import('../server/routes/examRoutes.js');
const { fileStore, fileJobQueue } = await import('../server/services/AiService.js');
const { createFileRouter } = await import('../server/services/ai/files/FileStore.js').then(async () => import('../server/services/ai/fileRouter.js'));
const { startEducationRuntime } = await import('../server/services/educationRuntime.js');
const { createAssessmentService } = await import('../server/services/assessment/service.js');
const { OwnedRecordStore } = await import('../server/services/storage/ownedRecordStore.js');
const { FileJobQueue } = await import('../server/services/ai/jobs/fileJobQueue.js');
const { validateHtmlArtifact } = await import('../server/services/analytics/htmlReport.js');

await startEducationRuntime();

const app = express();
app.use(express.json());
// Test auth: the user id comes from a header (the real app uses requireAuth + JWT).
app.use((req, res, next) => {
  const u = req.headers['x-test-user'];
  if (typeof u !== 'string') return res.status(401).json({ error: 'unauthorized' });
  (req as any).user = { userId: u };
  (req as any).requestId = 'req-test';
  next();
});
app.use('/api/analytics', analyticsRouter);
app.use('/api/assessment', assessmentRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/documents', documentsRouter);
app.use('/api/exams', examsRouter);
const files = express();
files.use('/api/files', createFileRouter(fileStore));
const server = app.listen(0);
const fileServer = files.listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const fileBase = `http://127.0.0.1:${(fileServer.address() as AddressInfo).port}`;

test.after(async () => {
  await fileJobQueue.stop();
  server.close();
  fileServer.close();
  await fs.rm(root, { recursive: true, force: true });
});

const as = (user: string, init: RequestInit = {}) => ({ ...init, headers: { ...(init.headers ?? {}), 'x-test-user': user } });
const json = (user: string, body: unknown) => as(user, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// SYNTHETIC test data, not real statistics.
const CSV = ['district,year,score,hours', ...Array.from({ length: 48 }, (_, i) => `${['Gasabo', 'Huye', 'Musanze'][i % 3]},${2019 + (i % 4)},${40 + ((i * 7) % 50)},${1 + ((i * 5) % 9)}`)].join('\n');

async function upload(user: string, name = 'scores.csv', content = CSV) {
  const fd = new FormData();
  fd.append('file', new Blob([content], { type: 'text/csv' }), name);
  return fetch(`${base}/api/analytics/datasets`, as(user, { method: 'POST', body: fd }));
}

async function pollJob(user: string, id: string) {
  for (let i = 0; i < 300; i++) {
    const r = await (await fetch(`${base}/api/jobs/${id}`, as(user))).json();
    if (['completed', 'failed'].includes(r.job.status)) return r.job;
    await new Promise((res) => setTimeout(res, 50));
  }
  throw new Error('job did not finish');
}

test('dataset upload, profile, cross-user isolation and synchronous analysis', async () => {
  const res = await upload('alice');
  assert.equal(res.status, 201);
  const ds = await res.json();
  assert.equal(ds.rows, 48);
  assert.deepEqual(ds.columns.map((c: any) => c.type), ['categorical', 'numeric', 'numeric', 'numeric']);
  assert.equal(ds.preview.rows.length, 10);

  assert.equal((await fetch(`${base}/api/analytics/datasets/${ds.datasetId}`, as('alice'))).status, 200);
  assert.equal((await fetch(`${base}/api/analytics/datasets/${ds.datasetId}`, as('mallory'))).status, 404, 'other users get 404, not 403');
  assert.equal((await fetch(`${base}/api/analytics/datasets/${ds.datasetId}/analyze`, json('mallory', {}))).status, 404);

  const an = await (await fetch(`${base}/api/analytics/datasets/${ds.datasetId}/analyze`, json('alice', { analyses: [{ type: 'regression', y: 'score', x: ['hours'] }, { type: 'crosstab', row: 'district', column: 'year' }] }))).json();
  assert.equal(an.analysis.results[0].ok, true);
  assert.ok(an.charts.some((c: any) => c.chartType === 'scatter-trend'));

  assert.equal((await fetch(`${base}/api/analytics/datasets/${ds.datasetId}/analyze`, json('alice', { analyses: [{ type: 'magic' }] }))).status, 400);
  assert.equal((await upload('alice', 'evil.exe', 'MZ')).status, 400);
  const bad = await upload('alice', 'broken.json', '{"rows": [1');
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).code, 'MALFORMED');
});

test('report job: 202, idempotent resubmit, owner-only status/result, downloadable validated HTML', async () => {
  const ds = await (await upload('alice')).json();
  const body = { title: 'Scores by district', researchQuestion: 'Do study hours relate to scores?', analysis: { analyses: [{ type: 'describe', columns: ['score', 'hours'], groupBy: 'district' }, { type: 'regression', y: 'score', x: ['hours'] }, { type: 'timeseries', time: 'year', value: 'score', groupBy: 'district' }] } };
  const r1 = await fetch(`${base}/api/analytics/datasets/${ds.datasetId}/reports`, json('alice', body));
  assert.equal(r1.status, 202);
  const j1 = await r1.json();
  const r2 = await fetch(`${base}/api/analytics/datasets/${ds.datasetId}/reports`, json('alice', body));
  const j2 = await r2.json();
  assert.equal(j2.duplicate, true);
  assert.equal(j2.job.id, j1.job.id);

  const job = await pollJob('alice', j1.job.id);
  assert.equal(job.status, 'completed', JSON.stringify(job.error));
  assert.equal((await fetch(`${base}/api/jobs/${j1.job.id}`, as('mallory'))).status, 404);
  assert.equal((await fetch(`${base}/api/jobs/${j1.job.id}/result`, as('mallory'))).status, 404);

  const result = await (await fetch(`${base}/api/jobs/${j1.job.id}/result`, as('alice'))).json();
  assert.equal(result.result.interpretation, 'deterministic');
  assert.ok(result.result.charts.length >= 4);
  assert.ok(result.result.charts.every((c: any) => c.ok));
  assert.match(result.artifact.url, /^\/api\/files\/[0-9a-f-]{36}\?exp=\d+&sig=/);

  const dl = await fetch(`${fileBase}${result.artifact.url}`);
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get('content-type')!, /text\/html/);
  assert.match(dl.headers.get('content-disposition')!, /^attachment/);
  assert.match(dl.headers.get('content-security-policy')!, /sandbox/);
  const html = await dl.text();
  assert.equal(validateHtmlArtifact(html).valid, true);
  assert.match(html, /Do study hours relate to scores\?/);
  assert.doesNotMatch(html, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'no server paths in the artifact');

  const tampered = result.artifact.url.replace(/sig=[^&]+/, 'sig=AAAA');
  assert.equal((await fetch(`${fileBase}${tampered}`)).status, 403);
});

test('report request validation and unknown resources', async () => {
  const ds = await (await upload('alice')).json();
  assert.equal((await fetch(`${base}/api/analytics/datasets/${ds.datasetId}/reports`, json('alice', { title: '' }))).status, 400);
  assert.equal((await fetch(`${base}/api/analytics/datasets/${ds.datasetId}/reports`, json('alice', { title: 'x', html: '<script>' }))).status, 400, 'unknown fields rejected');
  assert.equal((await fetch(`${base}/api/analytics/datasets/00000000-0000-4000-8000-000000000000/reports`, json('alice', { title: 'x' }))).status, 404);
  assert.equal((await fetch(`${base}/api/jobs/not-a-job`, as('alice'))).status, 404);
});

test('rubric validation endpoint and assessment input errors', async () => {
  const ok = await fetch(`${base}/api/assessment/rubrics/validate`, json('alice', { rubricText: 'Analysis (6 marks): uses data\nClarity (4 marks): clear writing\nTotal: 10 marks' }));
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).rubric.criteria.length, 2);
  const bad = await fetch(`${base}/api/assessment/rubrics/validate`, json('alice', { rubric: { totalMarks: 12, criteria: [{ name: 'A', maxMarks: 10 }] } }));
  assert.equal(bad.status, 422);
  assert.match((await bad.json()).errors[0], /add up to 10/);
  const noSubmission = await fetch(`${base}/api/assessment/assessments`, json('alice', { rubricText: 'A (5 marks): x\nTotal: 5' }));
  assert.equal(noSubmission.status, 422);
  assert.equal((await fetch(`${base}/api/assessment/assessments/00000000-0000-4000-8000-000000000000`, as('alice'))).status, 404);
});

test('assessment service end-to-end with a scripted model: job, record, review, confirm, isolation', async () => {
  const dir = await fs.mkdtemp(path.join(root, 'svc-'));
  const queue = new FileJobQueue({ storageDir: path.join(dir, 'jobs') });
  const store = new OwnedRecordStore<any>(path.join(dir, 'records'));
  const answer = {
    criteria: [
      { criterionId: 'C1', proposedMarks: 5, levelLabel: null, evidence: [{ paragraph: 'P1', quote: 'Prices fall when supply rises' }], rationale: 'Correct definition.', missingRequirements: [], factualErrors: [], improvements: [], confidence: 'high' },
      { criterionId: 'C2', proposedMarks: 2, levelLabel: null, evidence: [{ paragraph: 'P2', quote: 'invented sentence' }], rationale: 'Weak example.', missingRequirements: ['A Rwandan example'], factualErrors: [], improvements: ['Use a local market example.'], confidence: 'low' },
    ],
    overallFeedback: 'Good grasp of the definition.', ambiguities: [],
  };
  const adapter = { name: 'fake', async *stream() { yield { type: 'text' as const, text: JSON.stringify(answer) }; } };
  const svc = createAssessmentService({ fileStore, queue, store, agent: () => ({ adapter, model: 'claude-haiku-5-5' }) });
  const sub = await svc.submit('teacher', { rubricText: 'Definition (5 marks): defines supply\nApplication (5 marks): gives an example\nTotal: 10 marks', submissionText: 'Prices fall when supply rises and demand is unchanged.\n\nFor example, tomatoes in season are cheap.', studentLabel: 'S-01' });
  const done = await (async () => { for (let i = 0; i < 200; i++) { const j = await queue.get(sub.job.id, 'teacher'); if (j && ['completed', 'failed'].includes(j.status)) return j; await new Promise((r) => setTimeout(r, 25)); } throw new Error('timeout'); })();
  assert.equal(done.status, 'completed', JSON.stringify(done.error));
  const { assessmentId } = done.result as any;

  const view = await svc.get('teacher', assessmentId);
  assert.equal(view!.status, 'proposed');
  assert.equal(view!.outcome.proposedTotal, 7);
  assert.deepEqual(view!.final.unresolved, ['C2'], 'low confidence + unverified quote need review');
  assert.equal(await svc.get('student', assessmentId), null);
  await assert.rejects(svc.setConfirmed('teacher', assessmentId, true), /Review these criteria/);
  await assert.rejects(svc.review('teacher', assessmentId, { criterionId: 'C2', marks: 6 }), /between 0 and 5/);
  const reviewed = await svc.review('teacher', assessmentId, { criterionId: 'C2', marks: 3, comment: 'Example is valid but thin.' });
  assert.equal(reviewed!.final.finalTotal, 8);
  const confirmed = await svc.setConfirmed('teacher', assessmentId, true);
  assert.equal(confirmed!.status, 'instructor_confirmed');
  const report = await fileStore.read(confirmed!.reportFileId!, 'teacher');
  const html = report.data.toString('utf8');
  assert.match(html, /Instructor-confirmed grade/);
  assert.match(html, /8 \/ 10/);
  assert.equal(validateHtmlArtifact(html).valid, true);
  await assert.rejects(fileStore.read(confirmed!.reportFileId!, 'student'));
  await queue.stop();
});

test('documents API: input validation, 503 without a vision model, 404 for unknown/other users', async () => {
  assert.equal((await fetch(`${base}/api/documents`, as('alice', { method: 'POST' }))).status, 400);
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.from('%PDF-1.4 x')], { type: 'application/pdf' }), 'scan.pdf');
  const res = await fetch(`${base}/api/documents`, as('alice', { method: 'POST', body: fd }));
  assert.equal(res.status, 503, 'no vision model configured in this test environment');
  assert.equal((await res.json()).code, 'VISION_MODEL_UNAVAILABLE');
  const bad = new FormData();
  bad.append('file', new Blob(['x']), 'a.png');
  bad.append('surprise', 'field');
  assert.equal((await fetch(`${base}/api/documents`, as('alice', { method: 'POST', body: bad }))).status, 400, 'unknown fields rejected');
  for (const p of ['', '/text']) assert.equal((await fetch(`${base}/api/documents/00000000-0000-4000-8000-000000000000${p}`, as('alice'))).status, 404);
  assert.equal((await fetch(`${base}/api/documents/00000000-0000-4000-8000-000000000000/ask`, json('alice', { question: 'x' }))).status, 404);
});

test('exams API: owner scoping, validation, scheme versions and status codes', async () => {
  // Marking is part of the paid plans (Free has none).
  const { prisma } = await import('../server/db.js');
  await (prisma as any).subscription.deleteMany({ where: { userId: 'alice' } });
  await (prisma as any).subscription.create({ data: { id: `sub-alice-${Date.now()}`, userId: 'alice', planType: 'STARTER', status: 'ACTIVE', startDate: new Date(), endDate: new Date(Date.now() + 30 * 86_400_000) } });
  const created = await fetch(`${base}/api/exams`, json('alice', { title: 'Mock exam', passPercent: 60 }));
  assert.equal(created.status, 201);
  const { examId, requestId } = await created.json();
  assert.equal(requestId, 'req-test');
  assert.equal((await fetch(`${base}/api/exams`, json('alice', { title: 'x', extra: 1 }))).status, 400, 'unknown fields rejected');
  assert.equal((await fetch(`${base}/api/exams/${examId}`, as('bob'))).status, 404, 'another user sees nothing');
  assert.equal((await fetch(`${base}/api/exams/${examId}/results`, as('bob'))).status, 404);
  const bad = await fetch(`${base}/api/exams/${examId}/rubric`, json('alice', { scheme: { title: 'T', totalMarks: 10, questions: [{ id: 'Q1', number: '1', maxMarks: 5, criteria: [{ id: 'a', description: 'x', marks: 5 }] }] } }));
  assert.equal(bad.status, 422);
  assert.match((await bad.json()).errors.join(' '), /add up to 5 marks, but the stated total is 10/);
  const good = await fetch(`${base}/api/exams/${examId}/rubric`, json('alice', { scheme: { title: 'T', totalMarks: 5, questions: [{ id: 'Q1', number: '1', text: 'Q', maxMarks: 5, criteria: [{ id: 'a', description: 'x', marks: 5 }] }] } }));
  assert.equal(good.status, 201);
  assert.deepEqual(await good.json().then((b) => [b.version, b.status]), [2, 'needs_confirmation']);
  assert.equal((await fetch(`${base}/api/exams/${examId}/mark`, json('alice', {}))).status, 409, 'marking waits for a confirmed scheme');
  const conf = await fetch(`${base}/api/exams/${examId}/rubric/confirm`, json('alice', {}));
  assert.deepEqual(await conf.json().then((b) => [b.version, b.status]), [2, 'confirmed']);
  const versions = await (await fetch(`${base}/api/exams/${examId}/rubric`, as('alice'))).json();
  assert.deepEqual(versions.versions.map((v: any) => v.status), ['invalid', 'confirmed']);
  assert.equal((await fetch(`${base}/api/exams/${examId}/submissions`, as('alice', { method: 'POST' }))).status, 400);
  const fd = new FormData();
  fd.append('scripts', new Blob([Buffer.from('not a pdf')]), 'C001.pdf');
  const rej = await fetch(`${base}/api/exams/${examId}/submissions`, as('alice', { method: 'POST', body: fd }));
  assert.equal(rej.status, 422);
  assert.equal((await rej.json()).rejected[0].code, 'UNSUPPORTED_FORMAT');
  assert.equal((await fetch(`${base}/api/exams/${examId}/submissions/C001/marks/1`, as('alice', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ marks: 2, reason: 'x' }) }))).status, 404);
  assert.equal((await fetch(`${base}/api/exams/${examId}/exports`, json('alice', {}))).status, 409, 'nothing to export yet');
  assert.equal((await fetch(`${base}/api/exams/${examId}/jobs/00000000-0000-4000-8000-000000000000`, as('alice'))).status, 404);
  assert.equal((await fetch(`${base}/api/exams/not-a-uuid`, as('alice'))).status, 404);
});

test('exams API: live events replay over SSE, cancel and preferences validate', async () => {
  const { examId } = await (await fetch(`${base}/api/exams`, json('alice', { title: 'Live' }))).json();
  const { examService } = await import('../server/services/educationRuntime.js');
  assert.equal((await fetch(`${base}/api/exams/${examId}/cancel`, json('alice', {}))).status, 409, 'nothing to cancel');
  assert.equal((await fetch(`${base}/api/exams/${examId}/cancel`, json('bob', {}))).status, 404, 'another user cannot cancel');
  const put = (user: string, body: unknown) => fetch(`${base}/api/exams/${examId}/preferences`, as(user, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  assert.equal((await put('alice', { credit: 'lenient' })).status, 400);
  assert.equal((await put('alice', { credit: 'strict', extra: 1 })).status, 400);
  const ok = await put('alice', { credit: 'strict', corrections: false });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json().then((b) => [b.preferences.credit, b.preferences.corrections, b.preferences.feedback]), ['strict', false, 'brief']);
  assert.equal((await put('bob', { credit: 'strict' })).status, 404);
  assert.equal((await fetch(`${base}/api/exams/${examId}/activity`, as('bob'))).status, 404, 'events are owner-scoped');

  // Two stored events: a fresh viewer gets both; one resuming after event 1 gets only the second.
  await examService.mutate('alice', examId, (e) => {
    e.events = [
      { v: 1, seq: 1, type: 'job_created', at: new Date().toISOString(), message: 'Marking 2 scripts.' },
      { v: 1, seq: 2, type: 'job_completed', at: new Date().toISOString(), message: 'Marking finished.' },
    ];
    e.eventSeq = 2;
  });
  const read = async (headers: Record<string, string> = {}) => {
    const ctrl = new AbortController();
    const res = await fetch(`${base}/api/exams/${examId}/activity`, { ...as('alice', { headers }), signal: ctrl.signal });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);
    const reader = res.body!.getReader();
    let text = '';
    const until = Date.now() + 2000;
    while (Date.now() < until && (text.match(/^id: /gm)?.length ?? 0) < (headers['Last-Event-ID'] ? 1 : 2)) text += new TextDecoder().decode((await reader.read()).value);
    ctrl.abort();
    return [...text.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]));
  };
  assert.deepEqual(await read(), [1, 2]);
  assert.deepEqual(await read({ 'Last-Event-ID': '1' }), [2], 'a reconnecting viewer gets only what it missed');
});

test('exam live stream is owner-scoped and replays saved state without AI calls', async () => {
  const created = await (await fetch(`${base}/api/exams`, json('live-owner', { title: 'Saved live paper' }))).json();
  assert.equal((await fetch(`${base}/api/exams/${created.examId}/events`, as('other-owner'))).status, 404);
  assert.equal((await fetch(`${base}/api/exams/${created.examId}/events?submissionId=invalid`, as('live-owner'))).status, 400);
  const controller = new AbortController();
  const response = await fetch(`${base}/api/exams/${created.examId}/events`, as('live-owner', { signal: controller.signal }));
  assert.equal(response.status, 200);
  const reader = response.body!.getReader();
  const chunk = new TextDecoder().decode((await reader.read()).value);
  assert.match(chunk, /event: snapshot/);
  assert.match(chunk, /Saved live paper/);
  assert.match(chunk, /"candidates":\[\]/);
  controller.abort(); await reader.cancel().catch(() => undefined);
});


test('scanner limits are shared and stopping another teacher examination is rejected', async () => {
  const limits = await (await fetch(`${base}/api/exams/limits`, as('limits-owner'))).json();
  assert.equal(limits.maxCandidates, 300);
  assert.equal(limits.maxPagesPerPaper, 40);
  assert.ok(limits.maxUploadBytes >= limits.maxFileBytes);
  const exam = await (await fetch(`${base}/api/exams`, json('limits-owner', { title: 'Limits test' }))).json();
  assert.equal((await fetch(`${base}/api/exams/${exam.examId}/stop`, json('other-user', {}))).status, 404);
  assert.equal((await fetch(`${base}/api/exams/${exam.examId}/stop`, json('limits-owner', {}))).status, 200);
});


test('phone previews and thumbnails are smaller while page access remains owner-only', async () => {
  const created = await (await fetch(`${base}/api/exams`, json('preview-owner', { title: 'Responsive preview' }))).json();
  const jpeg = await sharp({ create: { width: 1800, height: 2400, channels: 3, background: 'white' } }).jpeg().toBuffer();
  const form = new FormData(); form.append('scripts', new Blob([jpeg], { type: 'image/jpeg' }), 'C001.jpg');
  const uploaded = await (await fetch(`${base}/api/exams/${created.examId}/submissions`, as('preview-owner', { method: 'POST', body: form }))).json();
  const url = `${base}/api/exams/${created.examId}/submissions/${uploaded.accepted[0].id}/pages/1`;
  const phone = await fetch(`${url}?width=1000`, as('preview-owner'));
  assert.equal(phone.status, 200);
  assert.equal((await sharp(Buffer.from(await phone.arrayBuffer())).metadata()).width, 1000);
  const thumb = await fetch(`${url}?thumbnail=1`, as('preview-owner'));
  assert.equal((await sharp(Buffer.from(await thumb.arrayBuffer())).metadata()).width, 140);
  assert.equal((await fetch(`${url}?width=3000`, as('preview-owner'))).status, 400);
  assert.equal((await fetch(`${url}?width=1000`, as('another-user'))).status, 404);
});


test('review controls accept criterion IDs, validate positions and remain owner-scoped', async () => {
  const { examId } = await (await fetch(`${base}/api/exams`, json('review-owner', { title: 'Review controls' }))).json();
  const layout = (user: string, item: string, body: unknown) => fetch(`${base}/api/exams/${examId}/submissions/missing/layout/${encodeURIComponent(item)}`, { ...json(user, body), method: 'PUT' });
  assert.equal((await layout('review-owner', 'Q1:criterion:Q1-M1', { page: 1, fx: .8, fy: .2 })).status, 404, 'valid criterion ID reaches owner-scoped service, not a schema rejection');
  assert.equal((await layout('another-owner', 'Q1:criterion:Q1-M1', { page: 1, fx: .8, fy: .2 })).status, 404);
  assert.equal((await layout('review-owner', 'Q1:criterion:Q1-M1', { page: 1, fx: 1.2, fy: .2 })).status, 400);
  assert.equal((await layout('review-owner', 'bad:item:unknown', { page: 1, fx: .8, fy: .2 })).status, 400);
  assert.equal((await fetch(`${base}/api/exams/${examId}/submissions/missing/confirm`, json('another-owner', { question: 'Q1' }))).status, 404);
});
