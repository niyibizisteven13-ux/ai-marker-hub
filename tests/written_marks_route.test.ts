import { test as baseTest } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';

// The lecturer marks a written answer by hand: only for their own quiz, only a written question, only within its points.
const NO_PG = !process.env.DATABASE_URL && 'needs PostgreSQL (DATABASE_URL); CI provides it';
const test = (name: string, fn: () => Promise<void>) => baseTest(name, { skip: NO_PG }, fn);

test('marking by hand updates the score, grade and pass; strangers and wrong questions are refused', async () => {
  const { prisma } = await import('../server/db.js');
  const { getJwtSecret } = await import('../server/auth/secrets.js');
  const formRoutes = (await import('../server/routes/formRoutes.js')).default;
  const db = prisma as any;
  const owner = `lect-${randomUUID().slice(0, 8)}`; const other = `lect-${randomUUID().slice(0, 8)}`;
  for (const id of [owner, other]) await db.user.create({ data: { id, email: `${id}@test.local`, name: id, passwordHash: 'x', role: 'INSTRUCTOR' } });   // not swallowed: a missing user must fail here, not later
  const schema = { title: 'CAT 1', isQuiz: true, assessment: { kind: 'CAT', title: 'CAT 1', outOf: 20, passPercent: 50, aiMarking: true }, fields: [
    { id: 'n', type: 'text', label: 'Full name' },
    { id: 'q1', type: 'radio', label: 'Powerhouse?', options: ['Nucleus', 'Mitochondria'], points: 4, correctAnswer: 'Mitochondria' },
    { id: 'q2', type: 'long_text', label: 'Explain osmosis.', points: 6, correctAnswer: 'Water moves across a membrane.' },
  ] };
  const form = await db.applicationForm.create({ data: { id: randomUUID(), userId: owner, title: 'CAT 1', schema: JSON.stringify(schema) } });
  const sub = await db.formSubmission.create({ data: { formId: form.id, data: JSON.stringify({ n: 'Amy', q1: 'Mitochondria', q2: 'Water moves.', _quiz: { score: 4, maxScore: 10, percent: 40, pending: 1, correct: ['q1'] } }) } });
  const app = express(); app.use(express.json()); app.use('/api/forms', formRoutes); const srv = app.listen(0); const base = `http://127.0.0.1:${(srv.address() as any).port}/api/forms`;
  const bearer = (uid: string) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign({ userId: uid }, getJwtSecret(), { algorithm: 'HS256', issuer: 'bwenge', audience: 'bwenge-web', expiresIn: 60 })}` });
  const put = (uid: string | null, body: any, id = sub.id) => fetch(`${base}/${form.id}/responses/${id}/marks`, { method: 'PUT', headers: uid ? bearer(uid) : { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.equal((await put(null, { questionId: 'q2', marks: 3 })).status, 401);
    assert.equal((await put(other, { questionId: 'q2', marks: 3 })).status, 404, 'not their quiz');
    assert.equal((await put(owner, { questionId: 'q1', marks: 2 })).status, 400, 'a choice question is marked by the key');
    assert.equal((await put(owner, { questionId: 'nope', marks: 2 })).status, 400);
    assert.equal((await put(owner, { questionId: 'q2', marks: 7 })).status, 400, 'more than the question is worth');
    assert.equal((await put(owner, { questionId: 'q2', marks: -1 })).status, 400);
    assert.equal((await put(owner, { questionId: 'q2', marks: 3 }, randomUUID())).status, 404, 'no such response');
    const ok = await put(owner, { questionId: 'q2', marks: 4.3, feedback: 'Good start.' });
    assert.equal(ok.status, 200); const b = await ok.json();
    assert.deepEqual([b.quiz.score, b.quiz.maxScore, b.quiz.percent, b.quiz.pending, b.quiz.mark, b.quiz.outOf, b.quiz.grade, b.quiz.passed], [8.5, 10, 85, 0, 17, 20, 'A', true]);
    assert.deepEqual([b.written.q2.marks, b.written.q2.by, b.written.q2.feedback], [4.5, 'lecturer', 'Good start.']);
    const saved = JSON.parse((await db.formSubmission.findUnique({ where: { id: sub.id } })).data); assert.equal(saved._quiz.score, 8.5); assert.equal(saved._written.q2.by, 'lecturer');
    // the AI batch needs the switch on
    const off = await db.applicationForm.create({ data: { id: randomUUID(), userId: owner, title: 'Plain', schema: JSON.stringify({ title: 'Plain', isQuiz: true, fields: [] }) } });
    assert.equal((await fetch(`${base}/${off.id}/marks/ai`, { method: 'POST', headers: bearer(owner) })).status, 409);
  } finally {
    srv.close();
    await db.formSubmission.deleteMany({ where: { form: { userId: owner } } }).catch(() => undefined);
    await db.applicationForm.deleteMany({ where: { userId: owner } }).catch(() => undefined);
    await db.user.deleteMany({ where: { id: { in: [owner, other] } } }).catch(() => undefined);
  }
});
