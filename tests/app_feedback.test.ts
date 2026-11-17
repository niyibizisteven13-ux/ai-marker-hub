import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { FeedbackError, adminFeedback, feedbackCsv, publicStats, resetLimitsForTests, submitFeedback, validateFeedback, visitorKey } from '../server/services/appFeedback.js';
import appRoutes from '../server/routes/appRoutes.js';

// Ratings and the survey on the Get the app page: tidy input, one per visitor per day, spam protection, a public average, and private comments.
// The test database keeps its data between runs, so numbers are compared with what was there before.
const stats = async (app: 'bwenge' | 'myseb') => (await publicStats()).apps[app].rating;

test('input is checked and tidied: stars 1 to 5, known choices only, short text, control characters removed', () => {
  const ok = validateFeedback({ app: 'bwenge', rating: 4, platform: 'android', ease: 'easy', use: 'marking', improve: '  Faster\u0007   marking   please \n\n\n\nthanks ', contact: ' a@b.rw ', contactOk: true });
  assert.deepEqual(ok, { app: 'bwenge', rating: 4, platform: 'android', ease: 'easy', use: 'marking', improve: 'Faster marking please \n\nthanks', contact: 'a@b.rw', contactOk: true });
  assert.deepEqual(validateFeedback({ app: 'myseb', rating: 5, platform: 'beos', ease: 'wow', use: 7 }), { app: 'myseb', rating: 5 }, 'unknown choices are dropped');
  assert.equal(validateFeedback({ app: 'bwenge', rating: 3, contact: 'x@y.rw' }).contactOk, false, 'contact is used only when they agree');
  assert.equal(validateFeedback({ app: 'bwenge', rating: 3, improve: 'x'.repeat(5000) }).improve!.length, 1000);
  for (const bad of [{}, { app: 'x', rating: 3 }, { app: 'bwenge' }, { app: 'bwenge', rating: 0 }, { app: 'bwenge', rating: 6 }, { app: 'bwenge', rating: 3.5 }, { app: 'bwenge', rating: '5; drop' }]) assert.throws(() => validateFeedback(bad), FeedbackError, JSON.stringify(bad));
});

test('a rating changes the public average, and each visitor can rate an app once a day', async () => {
  resetLimitsForTests(); const before = await stats('bwenge'); const me = visitorKey('9.9.9.1', 'UA');
  assert.equal((await submitFeedback({ app: 'bwenge', rating: 5, improve: 'Great' }, me)).saved, true);
  await assert.rejects(submitFeedback({ app: 'bwenge', rating: 1 }, me), (e: any) => e.status === 429 && /already sent/.test(e.message));
  assert.equal((await submitFeedback({ app: 'myseb', rating: 3 }, me)).saved, true, 'another app is another rating');
  assert.equal((await submitFeedback({ app: 'bwenge', rating: 4 }, visitorKey('9.9.9.2', 'UA'))).saved, true);
  const after = await stats('bwenge'); assert.equal(after.count - before.count, 2);
  const avgBefore = (before.average ?? 0) * before.count; assert.ok(Math.abs((after.average ?? 0) * after.count - (avgBefore + 9)) < 0.3 * after.count, 'the average moved by the two ratings (rounded to one decimal)');
});

test('a robot that fills the hidden field is thanked and ignored; a flood from one visitor is stopped', async () => {
  resetLimitsForTests(); const before = (await adminFeedback()).items.length;
  assert.deepEqual(await submitFeedback({ app: 'bwenge', rating: 5, website: 'http://spam.example' }, visitorKey('8.8.8.1', 'bot')), { saved: false });
  assert.equal((await adminFeedback()).items.length, before, 'nothing saved');
  const flood = visitorKey('8.8.8.2', 'bot'); let blocked = 0;
  for (let i = 0; i < 12; i++) { try { await submitFeedback({ app: i % 2 ? 'bwenge' : 'myseb', rating: 5 }, flood); } catch (e: any) { if (e.status === 429) blocked++; } }
  assert.ok(blocked >= 6, 'most of the flood was refused');
});

test('the public gets only numbers; comments and contact stay with the administrator, newest first', async () => {
  resetLimitsForTests(); const v = visitorKey('7.7.7.1', 'UA');
  await submitFeedback({ app: 'myseb', rating: 2, platform: 'windows', ease: 'hard', use: 'exams', improve: 'Install failed twice', contact: 'stu@school.rw', contactOk: true }, v);
  const pub = JSON.stringify(await publicStats()); assert.ok(!pub.includes('Install failed') && !pub.includes('stu@school.rw'));
  const a = await adminFeedback(); assert.equal(a.items[0].improve, 'Install failed twice'); assert.equal(a.items[0].contact, 'stu@school.rw'); assert.equal(a.ratings.myseb.hist.length, 5);
  assert.ok(!JSON.stringify(a.items[0]).match(/\b7\.7\.7\.1\b/), 'no address is stored');
});

test('the CSV cannot carry a spreadsheet formula from a visitor', () => {
  const csv = feedbackCsv([{ id: '1', at: '2026-11-17T10:00:00Z', app: 'bwenge', rating: 5, improve: '=HYPERLINK("http://x")', contact: '+250788000000' } as any]);
  assert.ok(csv.includes(`"'=HYPERLINK(""http://x"")"`)); assert.ok(csv.includes(`"'+250788000000"`)); assert.ok(csv.startsWith('﻿"Date"'));
});

const app = express(); app.use(express.json()); app.use('/api/app', appRoutes);
const srv = app.listen(0); const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/app`; test.after(() => srv.close());
test('the routes: stats are public and cached briefly; feedback answers 201, and a bad one 400 with a plain message', async () => {
  resetLimitsForTests();
  const st = await fetch(`${base}/stats`); assert.equal(st.status, 200); assert.match(st.headers.get('cache-control') ?? '', /max-age=60/);
  const j = await st.json(); assert.ok(j.apps.bwenge && j.apps.myseb && 'downloads' in j.apps.bwenge && 'average' in j.apps.bwenge.rating);
  const post = (b: unknown) => fetch(`${base}/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '5.5.5.5' }, body: JSON.stringify(b) });
  const bad = await post({ app: 'bwenge', rating: 9 }); assert.equal(bad.status, 400); assert.match((await bad.json()).error, /1 to 5/);
  assert.equal((await post({ app: 'myseb', rating: 4, ease: 'easy' })).status, 201);
});
