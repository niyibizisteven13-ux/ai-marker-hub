import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileJobQueue, JobError, type FileJob } from '../server/services/ai/jobs/fileJobQueue.js';

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'jobs-'));

async function waitFor(q: FileJobQueue, id: string, owner: string, states: string[], ms = 5000): Promise<FileJob> {
  const end = Date.now() + ms;
  for (;;) {
    const j = await q.get(id, owner);
    if (j && states.includes(j.status)) return j;
    if (Date.now() > end) throw new Error(`timeout waiting for ${states} (now ${j?.status})`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

test('submit → completed with progress and result, persisted to disk', async () => {
  const dir = await tmp();
  const q = new FileJobQueue({ storageDir: dir });
  q.register('double', async (job: FileJob<{ n: number }>, ctx) => { await ctx.progress('working', 50); return { value: job.payload.n * 2 }; });
  const { job } = await q.submit({ type: 'double', ownerId: 'alice', payload: { n: 21 } });
  const done = await waitFor(q, job.id, 'alice', ['completed']);
  assert.deepEqual(done.result, { value: 42 });
  assert.equal(done.progress.percent, 100);
  const onDisk = JSON.parse(await fs.readFile(path.join(dir, `${job.id}.json`), 'utf8'));
  assert.equal(onDisk.status, 'completed');
  await q.stop();
});

test('owner isolation and idempotent duplicate submissions', async () => {
  const q = new FileJobQueue({ storageDir: await tmp() });
  let runs = 0;
  q.register('t', async () => { runs++; return 'ok'; });
  const a = await q.submit({ type: 't', ownerId: 'alice', payload: { x: 1 }, idempotencyKey: 'k1' });
  const b = await q.submit({ type: 't', ownerId: 'alice', payload: { x: 1 }, idempotencyKey: 'k1' });
  const c = await q.submit({ type: 't', ownerId: 'bob', payload: { x: 1 }, idempotencyKey: 'k1' });
  assert.equal(b.duplicate, true);
  assert.equal(b.job.id, a.job.id);
  assert.notEqual(c.job.id, a.job.id, 'keys are per owner');
  assert.equal(await q.get(a.job.id, 'bob'), null, "bob cannot read alice's job");
  assert.equal(await q.cancel(a.job.id, 'bob'), null);
  assert.equal(await q.get('not-a-uuid', 'alice'), null);
  await waitFor(q, a.job.id, 'alice', ['completed']);
  await waitFor(q, c.job.id, 'bob', ['completed']);
  assert.equal(runs, 2);
  await q.stop();
});

test('retryable errors retry within the attempt budget; other errors fail with a safe message', async () => {
  const q = new FileJobQueue({ storageDir: await tmp(), retryDelayMs: 20, maxAttempts: 3 });
  let n = 0;
  q.register('flaky', async () => { if (++n < 3) throw new JobError('AI_PROVIDER_BUSY', 'busy', true); return 'third time'; });
  q.register('broken', async () => { throw new Error('secret internal path /srv/x failed'); });
  q.register('invalid', async () => { throw new JobError('DATASET_UNAVAILABLE', 'Upload it again.'); });
  const f = await q.submit({ type: 'flaky', ownerId: 'u', payload: {} });
  const done = await waitFor(q, f.job.id, 'u', ['completed', 'failed']);
  assert.equal(done.status, 'completed');
  assert.equal(done.attempts, 3);
  const b = await q.submit({ type: 'broken', ownerId: 'u', payload: {} });
  const failed = await waitFor(q, b.job.id, 'u', ['failed']);
  assert.equal(failed.error!.code, 'INTERNAL_ERROR');
  assert.doesNotMatch(failed.error!.message, /secret|\/srv/);
  assert.equal(failed.attempts, 1, 'unknown errors are not retried');
  const i = await q.submit({ type: 'invalid', ownerId: 'u', payload: {} });
  assert.deepEqual((await waitFor(q, i.job.id, 'u', ['failed'])).error, { code: 'DATASET_UNAVAILABLE', message: 'Upload it again.' });
  await q.stop();
});

test('deadline aborts long jobs; cancellation stops a running job', async () => {
  const q = new FileJobQueue({ storageDir: await tmp(), deadlineMs: 50 });
  q.register('slow', (_job, ctx) => new Promise((_res, rej) => ctx.signal.addEventListener('abort', () => rej(ctx.signal.reason))));
  const s = await q.submit({ type: 'slow', ownerId: 'u', payload: {}, maxAttempts: 1 });
  const failed = await waitFor(q, s.job.id, 'u', ['failed']);
  assert.equal(failed.error!.code, 'DEADLINE_EXCEEDED');

  const q2 = new FileJobQueue({ storageDir: await tmp(), deadlineMs: 10_000 });
  q2.register('slow', (_job, ctx) => new Promise((_res, rej) => ctx.signal.addEventListener('abort', () => rej(ctx.signal.reason))));
  const c = await q2.submit({ type: 'slow', ownerId: 'u', payload: {} });
  await waitFor(q2, c.job.id, 'u', ['processing']);
  await q2.cancel(c.job.id, 'u');
  assert.equal((await q2.get(c.job.id, 'u'))!.status, 'cancelled');
  await q.stop();
  await q2.stop();
});

test('per-user active job cap', async () => {
  const q = new FileJobQueue({ storageDir: await tmp(), maxActivePerUser: 2, concurrency: 1 });
  q.register('hang', (_j, ctx) => new Promise((_r, rej) => ctx.signal.addEventListener('abort', () => rej(new Error('x')))));
  await q.submit({ type: 'hang', ownerId: 'u', payload: 1 });
  await q.submit({ type: 'hang', ownerId: 'u', payload: 2 });
  await assert.rejects(q.submit({ type: 'hang', ownerId: 'u', payload: 3 }), (e: any) => e.code === 'TOO_MANY_JOBS');
  await q.submit({ type: 'hang', ownerId: 'other', payload: 1 });
  await assert.rejects(q.submit({ type: 'nope', ownerId: 'u', payload: 1 }), (e: any) => e.code === 'UNKNOWN_JOB_TYPE');
  await q.stop();
});

test('worker restart: an interrupted job is re-queued and completed by the next process; exhausted ones fail', async () => {
  const dir = await tmp();
  const q1 = new FileJobQueue({ storageDir: dir, maxAttempts: 2 });
  q1.register('work', (_j, ctx) => new Promise((_r, rej) => ctx.signal.addEventListener('abort', () => rej(new Error('crash')))));
  const { job } = await q1.submit({ type: 'work', ownerId: 'u', payload: { n: 1 } });
  await waitFor(q1, job.id, 'u', ['processing']);
  // Simulate a crash: the on-disk record still says "processing".
  await fs.writeFile(path.join(dir, `${job.id}.json`), JSON.stringify({ ...(await q1.get(job.id, 'u')), status: 'processing' }));

  const q2 = new FileJobQueue({ storageDir: dir });
  q2.register('work', async (j: FileJob<{ n: number }>) => ({ resumed: j.payload.n }));
  await q2.init();
  const done = await waitFor(q2, job.id, 'u', ['completed']);
  assert.deepEqual(done.result, { resumed: 1 });

  const exhausted = { ...done, id: '11111111-1111-4111-8111-111111111111', status: 'processing', attempts: 2, maxAttempts: 2, result: undefined };
  await fs.writeFile(path.join(dir, `${exhausted.id}.json`), JSON.stringify(exhausted));
  const q3 = new FileJobQueue({ storageDir: dir });
  q3.register('work', async () => 'x');
  await q3.init();
  assert.equal((await q3.get(exhausted.id, 'u'))!.error!.code, 'WORKER_RESTARTED');
  await q1.stop(); await q2.stop(); await q3.stop();
});

test('expired jobs are hidden and purged', async () => {
  const dir = await tmp();
  const q = new FileJobQueue({ storageDir: dir, ttlMs: 1 });
  q.register('t', async () => 'ok');
  const { job } = await q.submit({ type: 't', ownerId: 'u', payload: {} });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(await q.get(job.id, 'u'), null);
  assert.deepEqual(await q.purgeExpired(), [job.id]);
  await assert.rejects(fs.stat(path.join(dir, `${job.id}.json`)));
  await q.stop();
});

test('a handler that ignores its abort signal is still stopped at the deadline', async () => {
  const q = new FileJobQueue({ storageDir: await tmp(), deadlineMs: 40 });
  q.register('stubborn', () => new Promise(() => {}));
  const { job } = await q.submit({ type: 'stubborn', ownerId: 'u', payload: {}, maxAttempts: 1 });
  const failed = await waitFor(q, job.id, 'u', ['failed'], 2000);
  assert.equal(failed.error!.code, 'DEADLINE_EXCEEDED');
  await q.stop();
});
