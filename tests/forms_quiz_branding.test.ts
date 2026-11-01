import test from 'node:test';
import assert from 'node:assert/strict';
import { gradeQuiz } from '../server/services/forms/quiz.js';
import { normalizeBranding, FORM_TEMPLATES } from '../shared/formBranding.js';
import { sanitizeAppearance, AppearanceError } from '../server/services/appearance.js';

const quiz = {
  isQuiz: true,
  fields: [
    { id: 'q1', label: 'Capital of Rwanda?', type: 'radio', options: ['Kigali', 'Huye'], points: 2, correctAnswer: 'Kigali' },
    { id: 'q2', label: 'Even numbers', type: 'checkbox', options: ['1', '2', '3', '4'], points: 3, correctAnswer: ['2', '4'] },
    { id: 'q3', label: '2 + 2', type: 'text', points: 1, correctAnswer: '4|four' },
    { id: 'q4', label: 'Your name', type: 'text' },
    { id: 'q5', label: 'Pi to 2 places', type: 'number', points: 1, correctAnswer: '3.14' },
  ],
};

test('quiz: marked against the key at once, with partial credit per question', () => {
  const r = gradeQuiz(quiz, { q1: 'kigali ', q2: ['4', '2'], q3: 'Four', q4: 'Aline', q5: '3,14' })!;
  assert.equal(r.score, 7);
  assert.equal(r.maxScore, 7);
  assert.equal(r.percent, 100);
  assert.equal(r.items.length, 4, 'questions without points or a key are not marked');
  const w = gradeQuiz(quiz, { q1: 'Huye', q2: ['2'], q3: '5' })!;
  assert.equal(w.score, 0);
  assert.deepEqual(w.items.map((x) => x.correct), [false, false, false, false]);
  assert.equal(gradeQuiz({ ...quiz, isQuiz: false }, { q1: 'Kigali' }), null, 'not a quiz');
  assert.equal(gradeQuiz({ isQuiz: true, fields: [{ id: 'a', label: 'x' }] }, {}), null, 'no marked questions');
});

test('form branding: only known looks and safe pictures are kept', () => {
  const b = normalizeBranding({ template: 'campus', mode: 'light', header: 'banner', font: 'serif', logoUrl: 'javascript:alert(1)', bannerUrl: 'data:image/png;base64,AAAA', backgroundUrl: 'https://example.org/bg.jpg', wash: false, extra: 'x' });
  assert.equal(b.template, 'campus');
  assert.equal(b.mode, 'light');
  assert.equal(b.header, 'banner');
  assert.equal(b.logoUrl, undefined, 'script URLs are dropped');
  assert.equal(b.bannerUrl, 'data:image/png;base64,AAAA');
  assert.equal(b.backgroundUrl, 'https://example.org/bg.jpg');
  assert.equal((b as any).extra, undefined);
  assert.equal(normalizeBranding({ header: 'banner' }).header, 'band', 'a picture header needs a picture');
  assert.equal(normalizeBranding({ backgroundUrl: 'https://x.org/a.jpg") ; background: red' }).backgroundUrl, undefined, 'no CSS injection through a URL');
  assert.ok(FORM_TEMPLATES.length >= 6);
});

test('appearance: saved with the account only in a safe shape', () => {
  const a = JSON.parse(sanitizeAppearance({ mode: 'light', color: '#1E9E5A', style: 'tinted', background: 'aurora', veil: 2, junk: 1 }));
  assert.deepEqual(a, { mode: 'light', color: '#1E9E5A', style: 'tinted', background: 'aurora', veil: 0.95 });
  assert.equal(JSON.parse(sanitizeAppearance({ color: 'red; x', background: 'image' })).background, 'none', 'no picture, no picture background');
  assert.throws(() => sanitizeAppearance({ image: 'data:text/html;base64,PHNjcmlwdD4=' }), AppearanceError);
  assert.throws(() => sanitizeAppearance({ image: `data:image/jpeg;base64,${'A'.repeat(950_000)}` }), /too large/);
});
