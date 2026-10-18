import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRetrievalBenchmark, rankHybridKnowledgeChunks, rankKnowledgeChunks } from '../server/services/KnowledgeRetrievalService.js';
import { isExecutionTraceExample, isSourceGroundedExample } from '../server/services/DatasetQualityService.js';
import { getDocumentExtractionIssue, splitDocumentIntoChunks } from '../server/services/ExtractionQualityService.js';
import { validateEvidenceCitations } from '../server/services/GroundedAnswerService.js';
import { extractChatCompletionText, readProviderJson } from '../server/utils/providerResponse.js';

test('retrieval ranks factual matches above unrelated chunks and applies the threshold', () => {
  const ranked = rankKnowledgeChunks(
    [
      { id: 'unrelated', text: 'A short guide to school enrollment and admission requirements.' },
      { id: 'relevant', text: 'Rwanda GDP grew by 8.2 percent in 2023 according to national accounts.' },
      { id: 'partial', text: 'National accounts are compiled using quarterly production data.' },
    ],
    'What was Rwanda GDP growth in 2023?',
    { limit: 5, threshold: 0.2 },
  );

  assert.equal(ranked[0]?.chunk.id, 'relevant');
  assert.ok(ranked[0].score > 0);
  assert.ok(ranked.every((item) => item.matchedTerms > 0));
});

test('retrieval returns no chunks when no meaningful terms match', () => {
  const ranked = rankKnowledgeChunks(
    [{ id: 'one', text: 'National accounts describe production and expenditure.' }],
    'How are you doing?',
  );

  assert.deepEqual(ranked, []);
});

test('retrieval matches synonym-heavy growth phrasing without relying on brittle exact wording', () => {
  const ranked = rankKnowledgeChunks(
    [
      { id: 'economy', text: 'The national production increased by eight percent during the year.' },
      { id: 'school', text: 'School enrollment and admission requirements are managed locally.' },
    ],
    'How fast did the economy increase?',
    { limit: 5, threshold: 0.1 },
  );

  assert.equal(ranked[0]?.chunk.id, 'economy');
  assert.ok(ranked[0].score > 0);
});

test('retrieval honors top-K and excludes chunks below the relevance threshold', () => {
  const ranked = rankKnowledgeChunks(
    [
      { id: 'strong', text: 'Rwanda GDP growth rate was 8.2 percent in 2023.' },
      { id: 'weak', text: 'Rwanda has a diverse landscape.' },
      { id: 'none', text: 'The school opens in September.' },
    ],
    'Rwanda GDP growth in 2023',
    { limit: 1, threshold: 0.3 },
  );

  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].chunk.id, 'strong');
});

test('dataset examples reject unsupported figures and operational traces', () => {
  const source = 'Rwanda GDP grew by 8.2 percent in 2023 according to national accounts.';

  assert.equal(
    isSourceGroundedExample({ output: 'Rwanda GDP grew by 8.2 percent in 2023.' }, source),
    true,
  );
  assert.equal(
    isSourceGroundedExample({ output: 'Rwanda GDP grew by 10 percent in 2023.' }, source),
    false,
  );
  assert.equal(
    isExecutionTraceExample({
      instruction: 'Extract facts from the document.',
      output: 'Processed content snippet. Verified knowledge source successfully ingested.',
    }),
    true,
  );
  assert.equal(
    isExecutionTraceExample({ output: 'Executed via GonkaRouter with 54 output tokens in 340ms.' }),
    true,
  );
});

test('semantic retrieval finds paraphrased evidence and rejects weak vector matches', () => {
  const ranked = rankHybridKnowledgeChunks(
    [
      { id: 'paraphrased', text: 'Annual national output expanded by eight percent.', embedding: '[1,0]' },
      { id: 'weak', text: 'The school opened in September.', embedding: '[0.2,0.98]' },
    ],
    'How fast did the economy grow?',
    [1, 0],
    { threshold: 0.35, minimumSemanticSimilarity: 0.55 },
  );

  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].chunk.id, 'paraphrased');
  assert.equal(ranked[0].retrievalMethod, 'semantic');
});

test('retrieval benchmark reports measurable recall, precision, and reciprocal rank', () => {
  const metrics = evaluateRetrievalBenchmark(
    [
      {
        query: 'Rwanda GDP growth 2023',
        relevantChunkIds: ['gdp'],
        chunks: [
          { id: 'unrelated', text: 'Rwanda school enrollment numbers increased.' },
          { id: 'gdp', text: 'Rwanda GDP growth reached 8.2 percent in 2023.' },
        ],
      },
      {
        query: 'quarterly inflation',
        relevantChunkIds: ['inflation'],
        chunks: [
          { id: 'inflation', text: 'Quarterly inflation data for the year.' },
          { id: 'finance', text: 'Quarterly government spending across sectors.' },
        ],
      },
    ],
    2,
  );

  assert.equal(metrics.caseCount, 2);
  assert.equal(metrics.recallAtK, 1);
  assert.equal(metrics.precisionAtK, 0.5);
  assert.ok(metrics.meanReciprocalRank >= 0.75);
});

test('document extraction rejects partial/garbled text and chunking preserves readable boundaries', () => {
  assert.equal(getDocumentExtractionIssue('Readable PDF text with enough content.', ['PDF text layer was empty or near-empty — OCR used.']), null);
  assert.match(
    getDocumentExtractionIssue('Readable PDF text with enough content.', ['Page 4 failed OCR and was skipped.']) || '',
    /Could not fully extract/,
  );
  assert.match(getDocumentExtractionIssue('abc\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD', []) || '', /invalid or replacement/);

  const chunks = splitDocumentIntoChunks('First paragraph with enough words to form a useful chunk.\nSecond paragraph continues the source with more details.', 100, 20);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 100));
  assert.ok(chunks.some((chunk) => chunk.includes('Second paragraph')));
});

test('grounded answer validation accepts only citations belonging to retrieved passages', () => {
  assert.deepEqual(
    validateEvidenceCitations('GDP increased. [EVIDENCE:chunk-1]', ['chunk-1']),
    { valid: true, citedChunkIds: ['chunk-1'], invalidChunkIds: [] },
  );
  assert.equal(validateEvidenceCitations('GDP increased. [EVIDENCE:made-up]', ['chunk-1']).valid, false);
  assert.equal(validateEvidenceCitations('GDP increased without a citation.', ['chunk-1']).valid, false);
  assert.deepEqual(
    validateEvidenceCitations('GDP increased. [EVIDENCE:chunk-1, chunk-2]', ['chunk-1']),
    { valid: false, citedChunkIds: ['chunk-1'], invalidChunkIds: ['chunk-2'] },
  );
});

test('provider response parsing reports HTML gateway errors clearly instead of leaking JSON parse errors', async () => {
  const htmlResponse = new Response('<!DOCTYPE html><html><title>Gateway Error</title></html>', {
    status: 502,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });

  await assert.rejects(
    readProviderJson(htmlResponse, 'GonkaRouter', 'chat completions endpoint'),
    /GonkaRouter returned an HTML response.*HTTP 502.*Check the configured provider URL and gateway availability/,
  );

  const jsonResponse = new Response(JSON.stringify({ choices: [{ message: { content: 'answer' } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  const parsed = await readProviderJson(jsonResponse, 'GonkaRouter', 'chat completions endpoint');
  assert.equal((parsed.choices as Array<{ message: { content: string } }>)[0].message.content, 'answer');
});

test('chat completion parser handles string and multipart text responses', () => {
  assert.equal(extractChatCompletionText({ choices: [{ message: { content: '  Notes  ' } }] }), 'Notes');
  assert.equal(
    extractChatCompletionText({
      choices: [{ message: { content: [{ type: 'text', text: 'First fact.' }, { type: 'text', text: 'Second fact.' }] } }],
    }),
    'First fact.\nSecond fact.',
  );
  assert.equal(extractChatCompletionText({ choices: [{ message: { content: [] } }] }), '');
});
