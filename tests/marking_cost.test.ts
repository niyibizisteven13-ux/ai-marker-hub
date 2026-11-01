import test from 'node:test';
import assert from 'node:assert/strict';
import { billableInput } from '../server/services/ai/providers/anthropicAdapter.js';
import { loadClaudeAgentConfig } from '../server/services/ai/router/agentProvider.js';

// Marking cost: cached tokens are priced at what Claude charges, and handwriting is read by a cheaper model by default.
test('cache reads and writes are priced as Claude prices them, not as full input', () => {
  const u = { input_tokens: 1000, cache_read_input_tokens: 100_000, cache_creation_input_tokens: 2000 };
  assert.equal(billableInput('claude-sonnet-5-5', u), 1000 + 10_000 + 2500);
  assert.equal(billableInput('claude-opus-5-5', u), 1000 + 5000 + 2500);
  assert.equal(billableInput('claude-fable-5-1', u), 1000 + 2500 + 2500);
  assert.equal(billableInput('claude-haiku-5-5', { input_tokens: 42 }), 42);
});

test('reading handwriting uses a cheaper model than an Opus marking model, unless set', () => {
  const base = { AI_AGENT_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' };
  const opus = loadClaudeAgentConfig({ ...base, CLAUDE_MARKING_MODEL: 'claude-opus-5-5', CLAUDE_MARKING_EFFORT: 'high' }).config!;
  assert.equal(opus.markingModel, 'claude-opus-5-5');
  assert.equal(opus.readingModel, 'claude-sonnet-5-5');
  assert.equal(opus.readingEffort, 'medium');
  const sonnet = loadClaudeAgentConfig({ ...base, CLAUDE_MARKING_MODEL: 'claude-sonnet-5-5' }).config!;
  assert.equal(sonnet.readingModel, 'claude-sonnet-5-5', 'already not Opus: same model');
  const own = loadClaudeAgentConfig({ ...base, CLAUDE_MARKING_MODEL: 'claude-opus-5-5', CLAUDE_READING_MODEL: 'claude-opus-5-5', CLAUDE_READING_EFFORT: 'high' }).config!;
  assert.equal(own.readingModel, 'claude-opus-5-5');
  assert.equal(own.readingEffort, 'high');
});
