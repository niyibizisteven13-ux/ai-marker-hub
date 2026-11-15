import test from 'node:test';
import assert from 'node:assert/strict';
import { fromSchema, buildSchema } from '../src/components/FormBuilder.js';

// The builder is what saves a form. If it dropped the explanation, the lecturer's words would silently vanish on the first save.
const quiz = {
  title: 'Cells quiz', isQuiz: true,
  fields: [
    { id: 'n', type: 'text', label: 'Full name', required: true },
    { id: 'q1', type: 'radio', label: 'Powerhouse of the cell?', options: ['Nucleus', 'Mitochondria'], points: 2, correctAnswer: 'Mitochondria', explanation: 'Mitochondria release energy from glucose.' },
    { id: 'q2', type: 'text', label: 'Pigment in leaves?', points: 1, correctAnswer: 'chlorophyll' },
  ],
};

test('the form builder keeps a question explanation through open, edit and save', () => {
  const state = fromSchema(quiz);
  const q1 = state.items.find((i: any) => i.id === 'q1') as any;
  assert.equal(q1.explanation, 'Mitochondria release energy from glucose.');
  const saved: any = buildSchema(state);
  assert.equal(saved.fields.find((f: any) => f.id === 'q1').explanation, 'Mitochondria release energy from glucose.');
  assert.equal(saved.fields.find((f: any) => f.id === 'q2').explanation, undefined, 'no empty explanation is written');
  assert.equal(saved.fields.find((f: any) => f.id === 'q1').correctAnswer, 'Mitochondria', 'and the answer key is untouched');
  // editing it
  q1.explanation = '  Changed.  '; assert.equal((buildSchema(state) as any).fields.find((f: any) => f.id === 'q1').explanation, 'Changed.');
  q1.explanation = '   '; assert.equal((buildSchema(state) as any).fields.find((f: any) => f.id === 'q1').explanation, undefined, 'clearing it removes it');
});

test('a form that is not a quiz never stores explanations', () => {
  const state = fromSchema({ ...quiz, isQuiz: false });
  assert.equal((buildSchema(state) as any).fields.some((f: any) => 'explanation' in f), false);
});
