import test from 'node:test';
import assert from 'node:assert/strict';
import { BWENGE_SYSTEM_PROMPT, buildBwengeGradingPrompt } from '../src/services/geminiService.ts';

test('buildBwengeGradingPrompt includes extracted document content', () => {
  const prompt = buildBwengeGradingPrompt('Grade this letter', 'Dear Sir, I am applying for the role.', 'recommendation-letter.txt');

  assert.match(prompt, /Document Content:/);
  assert.match(prompt, /Dear Sir, I am applying for the role\./);
  assert.match(prompt, /teacher-ready grading report/);
});

test('buildBwengeGradingPrompt asks for uploaded content when text is missing', () => {
  const prompt = buildBwengeGradingPrompt('Grade this letter');

  assert.match(prompt, /No document text is available yet/);
  assert.match(prompt, /Ask the user to upload or rescan/);
  assert.match(BWENGE_SYSTEM_PROMPT, /Executive Summary/);
});

