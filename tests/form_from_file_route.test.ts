import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { Document, Packer, Paragraph } from 'docx';
import { PDFDocument } from 'pdf-lib';
import { sanitizePublicFormSchema } from '../server/services/forms/publicSchema.js';
import { gradeQuiz, quizRecord } from '../server/services/forms/quiz.js';
import { quizCompletion, quizReview } from '../server/services/forms/quizReceipt.js';

process.env.FROM_FILE_PER_HOUR = '5';
const { createFormFromFileRouter } = await import('../server/routes/formFromFileRoutes.js');
const { ownForm } = await import('../server/services/forms/service.js');

const NOTES = [
  'Photosynthesis is the process by which green plants make glucose from carbon dioxide and water using light energy.',
  'It takes place in the chloroplasts, which contain the green pigment chlorophyll. Oxygen is released as a by-product.',
  'The word equation is: carbon dioxide + water -> glucose + oxygen. Plants absorb carbon dioxide through small pores called stomata.',
  'Respiration is the opposite process: glucose and oxygen react to release energy, carbon dioxide and water. It happens in all living cells.',
];
const REPLY = { title: 'Photosynthesis', questions: [
  { type: 'choice', question: 'Which gas do plants absorb?', options: ['Oxygen', 'Carbon dioxide', 'Nitrogen'], answer: 'Carbon dioxide', sourceQuote: 'Plants absorb carbon dioxide through small pores called stomata' },
  { type: 'short', question: 'Which pigment makes leaves green?', answer: 'chlorophyll', sourceQuote: 'contain the green pigment chlorophyll' },
  { type: 'truefalse', question: 'Respiration happens only in animals.', answer: 'False', sourceQuote: 'It happens in all living cells' },
] };
const charged: Array<{ userId: string; i: number; o: number }> = [];
let calls = 0; let aiMode: 'ok' | 'fail' = 'ok';
const ai = { json: async () => { calls++; if (aiMode === 'fail') throw new Error('down'); return REPLY; } };

const app = express();
app.use((req, _res, next) => { (req as any).user = { userId: req.get('x-user') || 'lect1' }; next(); });
app.use('/api/forms/from-file', createFormFromFileRouter({ ai, meter: { allow: async (res, userId) => { if (userId === 'broke') { res.status(402).json({ code: 'UPGRADE_REQUIRED', error: 'Used up. Pro is 4,500 RWF.', upgrade: { plan: 'PRO', url: '/upgrade?reason=limit' } }); return false; } return true; }, charge: (userId, i, o) => { charged.push({ userId, i, o }); } } }));
const srv = app.listen(0); const base = `http://127.0.0.1:${(srv.address() as any).port}/api/forms/from-file`;
test.after(() => srv.close());

const docx = async () => Buffer.from(await Packer.toBuffer(new Document({ sections: [{ children: NOTES.map((t) => new Paragraph(t)) }] })));
const send = async (name: string, data: Buffer | string, extra: Record<string, string> = {}, user = 'lect1') => {
  const f = new FormData(); f.append('file', new Blob([data as any]), name); for (const [k, v] of Object.entries(extra)) f.append(k, v);
  const r = await fetch(base, { method: 'POST', body: f, headers: { 'x-user': user } }); return { status: r.status, body: await r.json() };
};

test('a Word file becomes a closed quiz owned by the lecturer, with a review', async () => {
  const r = await send('Week 3 notes.docx', await docx(), { count: '3', kinds: 'choice,short,truefalse' });
  assert.equal(r.status, 201, JSON.stringify(r.body)); assert.equal(r.body.review.made, 3); assert.equal(r.body.review.fileName, 'Week 3 notes.docx');
  const { schema } = await ownForm('lect1', r.body.formId);
  assert.equal(schema.isQuiz, true); assert.equal(schema.acceptingResponses, false); assert.equal(schema.title, 'Photosynthesis');
  assert.deepEqual(schema.fields.map((f: any) => f.label), ['Full name', 'Registration number', 'Which gas do plants absorb?', 'Which pigment makes leaves green?', 'Respiration happens only in animals.']);
  assert.equal(schema.importReview.made, 3); assert.deepEqual(schema.importReview.flags, []);
  await assert.rejects(ownForm('someone-else', r.body.formId), /not found|someone else/i, 'only the owner can open it');
});

test('plain text works too, and the model is asked only once per request', async () => {
  const before = calls;
  const r = await send('notes.txt', NOTES.join('\n'), { count: '3' });
  assert.equal(r.status, 201); assert.equal(calls, before + 1);
});

test('clear errors for a photo, the wrong type, no file, a scan with no text, too little text, and an AI outage', async () => {
  assert.equal((await send('page.jpg', Buffer.from([1, 2, 3]))).body.code, 'IMAGE');
  assert.equal((await send('program.exe', Buffer.from('MZ'))).body.code, 'TYPE');
  const none = await fetch(base, { method: 'POST', body: new FormData() }); assert.equal(none.status, 400); assert.equal((await none.json()).code, 'NO_FILE');
  const pdf = await PDFDocument.create(); pdf.addPage([595, 842]);                      // a page with no text: like a scan
  const scan = await send('scan.pdf', Buffer.from(await pdf.save())); assert.equal(scan.status, 422); assert.equal(scan.body.code, 'NO_TEXT'); assert.match(scan.body.error, /scan/i);
  assert.equal((await send('tiny.txt', 'hello there')).body.code, 'TOO_SHORT');
  aiMode = 'fail'; const down = await send('notes.txt', NOTES.join('\n')); aiMode = 'ok';
  assert.equal(down.status, 502); assert.equal(down.body.code, 'AI_FAILED');
});

test('a lecturer who makes too many in an hour is slowed down; failed uploads do not count; another lecturer is not', async () => {
  for (let i = 0; i < 8; i++) assert.equal((await send('program.exe', Buffer.from('MZ'), {}, 'busy-lecturer')).status, 422);   // rejected before the model: free
  const results: number[] = [];
  for (let i = 0; i < 6; i++) results.push((await send('notes.txt', NOTES.join('\n'), { count: '3' }, 'busy-lecturer')).status);
  assert.deepEqual(results.slice(0, 5), [201, 201, 201, 201, 201]); assert.equal(results[5], 429);
  assert.equal((await send('notes.txt', NOTES.join('\n'), { count: '3' }, 'other-lecturer')).status, 201);
});

test('public forms hide private review and graded feedback appears only with answer review enabled', () => {
  const schema = {
    isQuiz: true,
    importReview: { fileName: 'notes.txt' },
    fields: [{
      id: 'q1', type: 'radio', label: 'Which gas do plants absorb?', points: 1,
      correctAnswer: 'Carbon dioxide', explanation: 'Plants absorb carbon dioxide.', correctFeedback: 'Good work.',
    }],
  };
  assert.deepEqual(sanitizePublicFormSchema(schema), {
    isQuiz: true, fields: [{ id: 'q1', type: 'radio', label: 'Which gas do plants absorb?', points: 1 }],
  });
  const quiz = gradeQuiz(schema, { q1: 'Carbon dioxide' })!;
  const score = quizRecord(quiz);
  assert.equal('results' in quizCompletion(score, undefined, true), false);
  const withReview = quizCompletion(score, undefined, true, quizReview(quiz, schema));
  assert.equal('results' in withReview && withReview.results?.[0].explanation, 'Plants absorb carbon dioxide.');
  assert.equal('results' in withReview && withReview.results?.[0].feedback, 'Good work.');
});

test('a lecturer out of credits is asked to upgrade: no model call, no quiz made, nothing charged; a made quiz is charged once', async () => {
  const before = calls; const chargedBefore = charged.length;
  const r = await send('notes.txt', NOTES.join('\n'), { count: '3' }, 'broke');
  assert.equal(r.status, 402); assert.equal(r.body.code, 'UPGRADE_REQUIRED'); assert.equal(r.body.upgrade.url, '/upgrade?reason=limit');
  assert.equal(calls, before, 'the model was not asked'); assert.equal(charged.length, chargedBefore, 'no charge');
  const ok = await send('notes.txt', NOTES.join('\n'), { count: '3' }, 'lect-paid');
  assert.equal(ok.status, 201); assert.equal(charged.length, chargedBefore + 1); assert.equal(charged.at(-1)!.userId, 'lect-paid');
});
