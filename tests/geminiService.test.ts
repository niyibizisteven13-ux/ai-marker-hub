import test from 'node:test';
import assert from 'node:assert/strict';
import { BWENGE_SYSTEM_PROMPT, buildBwengeGradingPrompt } from '../src/services/geminiService.ts';

test('buildBwengeGradingPrompt includes extracted document content', () => {
  const prompt = buildBwengeGradingPrompt('Grade this letter', 'Dear Sir, I am applying for the role.', 'recommendation-letter.txt');

  assert.match(prompt, /ATTACHED DOCUMENT START: recommendation-letter.txt/);
  assert.match(prompt, /Dear Sir, I am applying for the role\./);
  assert.match(prompt, /Analyze the attached document thoroughly/);
});

test('buildBwengeGradingPrompt asks for uploaded content when text is missing', () => {
  const prompt = buildBwengeGradingPrompt('Grade this letter');

  assert.match(prompt, /No document text was provided/);
  assert.match(prompt, /attach or re-upload the document/);
  assert.match(BWENGE_SYSTEM_PROMPT, /EXECUTIVE SUMMARY/);
});
