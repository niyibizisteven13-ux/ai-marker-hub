import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKnowledgeAccessWhere, buildOwnedFormWhere, buildUserContextScope } from '../server/services/ai/dataScope.js';

function matches(record: any, where: any): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, condition]: [string, any]) => {
    if (key === 'OR') return condition.some((part: any) => matches(record, part));
    if (key === 'AND') return condition.every((part: any) => matches(record, part));
    if (condition && typeof condition === 'object' && !Array.isArray(condition)) {
      if ('in' in condition) return condition.in.includes(record[key]);
      return matches(record[key], condition);
    }
    return record[key] === condition;
  });
}

test('knowledge retrieval scope excludes another account and includes only owner, organization, or approved global sources', () => {
  const whereA = buildKnowledgeAccessWhere('user-a', ['org-a']);
  const chunks = [
    { id: 'private-a', document: { userId: 'user-a', knowledgeBase: { userId: 'user-a' } } },
    { id: 'private-b', document: { userId: 'user-b', knowledgeBase: { userId: 'user-b' } } },
    { id: 'org-a', document: { organizationId: 'org-a', knowledgeBase: {} } },
    { id: 'global', document: { globalApproved: true, knowledgeBase: { globalApproved: true } } },
    { id: 'base-only', document: { globalApproved: false, knowledgeBase: { globalApproved: true } } },
  ];

  assert.deepEqual(chunks.filter((chunk) => matches(chunk, whereA)).map((chunk) => chunk.id), [
    'private-a',
    'org-a',
    'global',
  ]);
  assert.deepEqual(chunks.filter((chunk) => matches(chunk, buildKnowledgeAccessWhere('user-b', []))).map((chunk) => chunk.id), [
    'private-b',
    'global',
  ]);
});

test('hydrated forms, submissions, insights, datasets, examples, and chunks are owner-scoped', () => {
  const scopeA = buildUserContextScope('user-a', []);
  const forms = [
    { id: 'form-a', userId: 'user-a' },
    { id: 'form-b', userId: 'user-b' },
  ];
  const submissions = [
    { id: 'submission-a', form: { userId: 'user-a' } },
    { id: 'submission-b', form: { userId: 'user-b' } },
  ];
  const insights = [
    { id: 'insight-a', submission: { form: { userId: 'user-a' } } },
    { id: 'insight-b', submission: { form: { userId: 'user-b' } } },
  ];
  const datasets = [
    { id: 'dataset-a', userId: 'user-a', globalApproved: false },
    { id: 'dataset-b', userId: 'user-b', globalApproved: false },
  ];
  const examples = [
    { id: 'example-a', status: 'approved', consentGiven: true, piiReviewed: true, dataset: datasets[0] },
    { id: 'example-b', status: 'approved', consentGiven: true, piiReviewed: true, dataset: datasets[1] },
  ];

  assert.deepEqual(forms.filter((form) => matches(form, scopeA.forms)).map(({ id }) => id), ['form-a']);
  const documents = [
    { id: 'document-a', userId: 'user-a', knowledgeBase: { userId: 'user-a', globalApproved: false } },
    { id: 'document-b', userId: 'user-b', knowledgeBase: { userId: 'user-b', globalApproved: false } },
  ];
  assert.deepEqual(
    documents.filter((document) => matches({ document }, scopeA.chunks)).map(({ id }) => id),
    ['document-a'],
  );
  assert.deepEqual(submissions.filter((row) => matches(row, scopeA.submissions)).map(({ id }) => id), ['submission-a']);
  assert.deepEqual(insights.filter((row) => matches(row, scopeA.insights)).map(({ id }) => id), ['insight-a']);
  assert.deepEqual(datasets.filter((row) => matches(row, scopeA.datasets)).map(({ id }) => id), ['dataset-a']);
  assert.deepEqual(examples.filter((row) => matches(row, scopeA.examples)).map(({ id }) => id), ['example-a']);

  const chunkScopeA = scopeA.chunks;
  assert.equal(
    matches({ document: { userId: 'user-b', globalApproved: false, knowledgeBase: { globalApproved: true } } }, chunkScopeA),
    false,
  );
  assert.equal(matches({ id: 'form-b', userId: 'user-b' }, buildOwnedFormWhere('user-a', 'form-b')), false);
  assert.equal(matches({ id: 'form-a', userId: 'user-a' }, buildOwnedFormWhere('user-a', 'form-a')), true);
});
