import test from 'node:test';
import assert from 'node:assert/strict';
import { stripThinkingTags } from '../server/services/AiService.ts';
import { buildPromptForIntent } from '../src/utils/buildPromptForIntent.ts';

test('stripThinkingTags removes a <think> block and captures it as thinkingText', () => {
  const input = '<think>internal reasoning here</think>The final answer.';
  const result = stripThinkingTags(input);

  assert.strictEqual(result.text, 'The final answer.');
  assert.match(result.thinkingText ?? '', /internal reasoning here/);
});

test('stripThinkingTags removes unclosed <think> block at start of text', () => {
  const input = '<think>The user is asking what I can do. Let me give a clear overview.\n\nHere is what I can help you with:';
  const result = stripThinkingTags(input);

  assert.strictEqual(result.text, 'Here is what I can help you with:');
  assert.match(result.thinkingText ?? '', /The user is asking what I can do/);
});

test('stripThinkingTags removes a <thinking> block and captures it as thinkingText', () => {
  const input = 'Before.<thinking>step by step reasoning</thinking>After.';
  const result = stripThinkingTags(input);

  assert.doesNotMatch(result.text, /<thinking>/);
  assert.doesNotMatch(result.text, /step by step reasoning/);
  assert.match(result.thinkingText ?? '', /step by step reasoning/);
});

test('stripThinkingTags leaves plain text with no reasoning tags untouched', () => {
  const input = 'Just a normal response with no reasoning tags.';
  const result = stripThinkingTags(input);

  assert.strictEqual(result.text, input);
  assert.strictEqual(result.thinkingText, undefined);
});

test('buildPromptForIntent gives a structured-overview request for a vague query with an attachment', () => {
  const prompt = buildPromptForIntent({
    userQuery: 'how do you see this file attached here',
    hasAttachment: true,
  });

  assert.match(prompt, /structured overview/i);
});

test('buildPromptForIntent gives a structured-overview request for an empty query with an attachment', () => {
  const prompt = buildPromptForIntent({ userQuery: '', hasAttachment: true });

  assert.match(prompt, /structured overview/i);
  assert.doesNotMatch(prompt, /^$/);
});

test('buildPromptForIntent passes a specific query through unchanged even with an attachment', () => {
  const prompt = buildPromptForIntent({
    userQuery: 'Summarize the pricing section only',
    hasAttachment: true,
  });

  assert.strictEqual(prompt, 'Summarize the pricing section only');
});

test('buildPromptForIntent returns empty string when there is no query and no attachment', () => {
  const prompt = buildPromptForIntent({ userQuery: '', hasAttachment: false });
  assert.strictEqual(prompt, '');
});
