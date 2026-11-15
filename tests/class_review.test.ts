import test from 'node:test';
import assert from 'node:assert/strict';
import { classReview, styleOf, type ReviewQuestion, type ReviewResponse } from '../server/services/forms/classReview.js';

const Q: ReviewQuestion[] = [
  { id: 'e1', label: 'Explain osmosis', kind: 'long_text' },
  ...Array.from({ length: 6 }, (_, i) => ({ id: `m${i}`, label: `MCQ ${i}`, kind: 'choice' as const })),
];
const T = Date.parse('2026-11-16T09:00:00Z');
const r = (id: string, who: string, answers: Record<string, unknown>, extra: Partial<ReviewResponse> = {}): ReviewResponse => ({ id, who, submittedAt: T, answers, ...extra });
const osmosis = 'Osmosis is the movement of water molecules from a region of low solute concentration to a region of high solute concentration across a partially permeable membrane until the concentrations are balanced on both sides';

test('answers that are almost the same are flagged on both students; different wording and short answers are not', () => {
  const out = classReview(Q, [
    r('1', '222001', { e1: osmosis }),
    r('2', '222002', { e1: osmosis.replace('movement', 'net movement') }),
    r('3', '222003', { e1: 'Water goes through the cell wall when the cell is placed in a salty solution, and the cell shrinks because it loses water by diffusion into the surrounding liquid which is more concentrated outside' }),
    r('4', '222004', { e1: 'Transpiration' }), r('5', '222005', { e1: 'Transpiration' }),
  ]);
  assert.equal(out['1'].length, 1); assert.equal(out['1'][0].code, 'SIMILAR_ANSWER'); assert.match(out['1'][0].message, /222002/);
  assert.equal(out['2'][0].other, '222001');
  assert.equal(out['3'], undefined);
  assert.equal(out['4'], undefined, 'short answers are not compared');
  // The same person submitting twice is not "copying".
  assert.deepEqual(classReview(Q, [r('a', 'X1', { e1: osmosis }), r('b', 'x1', { e1: osmosis })]), {});
});

test('the same wrong answers on many questions are flagged; the same right answers are not', () => {
  const wrong = new Set(['m0', 'm1', 'm2', 'm3', 'm4']);
  const same = { m0: 'B', m1: 'C', m2: 'A', m3: 'D', m4: 'B' };
  const out = classReview(Q, [r('1', 'S1', same, { wrong }), r('2', 'S2', same, { wrong }), r('3', 'S3', { m0: 'A', m1: 'A', m2: 'B', m3: 'B', m4: 'C' }, { wrong })]);
  assert.equal(out['1'][0].code, 'SHARED_WRONG_ANSWERS');
  assert.match(out['1'][0].message, /S2.*5 questions/);
  assert.equal(out['3'], undefined, 'different mistakes');
  assert.deepEqual(classReview(Q, [r('1', 'S1', same), r('2', 'S2', same)]), {}, 'nobody got anything wrong');
});

test('one device for two people is flagged; a lab on one network is not; two people close together on one network is a note', () => {
  const dev = classReview(Q, [r('1', 'A', {}, { device: 'd1' }), r('2', 'B', {}, { device: 'd1' }), r('3', 'C', {}, { device: 'd2' })]);
  assert.equal(dev['1'][0].code, 'SAME_DEVICE'); assert.equal(dev['3'], undefined);
  assert.deepEqual(classReview(Q, [r('1', 'A', {}, { device: 'd1' }), r('2', 'a', {}, { device: 'd1' })]), {}, 'the same person on their own device');
  const lab = Array.from({ length: 30 }, (_, i) => r(`l${i}`, `S${i}`, {}, { network: 'campus' }));
  assert.deepEqual(classReview(Q, lab), {});
  const pair = classReview(Q, [r('1', 'A', {}, { network: 'n1' }), r('2', 'B', {}, { network: 'n1', submittedAt: T + 5 * 60_000 })]);
  assert.equal(pair['1'][0].code, 'SAME_NETWORK'); assert.equal(pair['1'][0].level, 'info');
  assert.deepEqual(classReview(Q, [r('1', 'A', {}, { network: 'n1' }), r('2', 'B', {}, { network: 'n1', submittedAt: T + 3 * 3600_000 })]), {}, 'hours apart');
});

test('a very different writing style within one student is a note; ordinary variation is not', () => {
  const plain = (n: number) => `I think the answer is ${n} because it works. We did this in class. It is simple, and I know it. My notes say so. The result is clear to me.`.repeat(2);
  const fancy = 'Notwithstanding the aforementioned considerations, the phenomenon under investigation demonstrates, unequivocally, a sophisticated interplay between concentration gradients, semipermeable membranes, and thermodynamic equilibrium; consequently, comprehensive understanding necessitates rigorous, multidimensional analytical engagement with fundamental physicochemical principles governing molecular transport mechanisms in heterogeneous biological systems, particularly where electrochemical potentials fluctuate considerably.';
  const Q4: ReviewQuestion[] = Array.from({ length: 5 }, (_, i) => ({ id: `e${i}`, label: `Essay ${i}`, kind: 'long_text' as const }));
  const odd = classReview(Q4, [r('1', 'S1', { e0: plain(1), e1: plain(2), e2: plain(3), e3: plain(4), e4: fancy })]);
  assert.equal(odd['1']?.[0].code, 'STYLE_SHIFT'); assert.equal(odd['1'][0].questionId, 'e4'); assert.equal(odd['1'][0].level, 'info');
  assert.equal(classReview(Q4, [r('1', 'S1', { e0: plain(1), e1: plain(2), e2: plain(3), e3: plain(4), e4: plain(5) })])['1'], undefined);
  assert.equal(classReview(Q4, [r('1', 'S1', { e0: plain(1), e1: fancy })])['1'], undefined, 'not enough answers to compare');
  assert.equal(styleOf('too short'), null);
});
