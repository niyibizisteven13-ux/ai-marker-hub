import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanId, identityFromPaper, isPlaceholderId } from '../server/services/exams/identity.js';

const page = (texts: Array<string | [string, number]>) => ({
  pages: [{
    page: 1, readingOrder: [] as string[],
    elements: texts.map((t, i) => {
      const [text, y0] = Array.isArray(t) ? t : [t, 40 + i * 30];
      return { id: `e${i}`, text, crossedOut: false, region: { x0: 50, y0, x1: 900, y1: y0 + 25 } };
    }),
  }],
}) as any;

test('name and number written at the top of the paper are found', () => {
  assert.deepEqual(identityFromPaper(page(['Name: Uwase Aline   Class: S3', 'Reg no: 2024/015', '1. Photosynthesis is…'])), { name: 'Uwase Aline', id: '2024-015' });
  assert.deepEqual(identityFromPaper(page(['Names : MUGISHA Eric', 'Student ID: S3B-12'])), { name: 'MUGISHA Eric', id: 'S3B-12' });
  assert.deepEqual(identityFromPaper(page(['Amazina: Keza Divine'])), { name: 'Keza Divine', id: null });
  assert.deepEqual(identityFromPaper(page(['Nom et prénom : Jean-Paul Habimana', 'Matricule : 77821'])), { name: 'Jean-Paul Habimana', id: '77821' });
  assert.deepEqual(identityFromPaper(page(['Full name: Ineza Grace Reg. No. 0043'])), { name: 'Ineza Grace', id: '0043' });
});

test('blank, unreadable or low-on-the-page labels give nothing', () => {
  assert.deepEqual(identityFromPaper(page(['Name: ____________', 'Reg no: ..........'])), { name: null, id: null });
  assert.deepEqual(identityFromPaper(page(['Name: [illegible] Aline'])), { name: null, id: null });
  assert.deepEqual(identityFromPaper(page([['Name: Uwase Aline', 800]])), { name: null, id: null }, 'an answer far down the page is not a header');
  assert.deepEqual(identityFromPaper(page(['1. The name: of the cell is 5'])), { name: null, id: null });
  assert.deepEqual(identityFromPaper({ pages: [] }), { name: null, id: null });
  assert.equal(cleanId('abc'), null, 'an id has a digit');
});

test('only made-up ids are replaced', () => {
  assert.equal(isPlaceholderId('C004', 'assigned'), true);
  assert.equal(isPlaceholderId('STUDENT1', 'filename'), true);
  assert.equal(isPlaceholderId('C004', 'filename'), false);
  assert.equal(isPlaceholderId('2024-015', 'manifest'), false);
});
