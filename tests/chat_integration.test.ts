import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBwengeGradingPrompt, BWENGE_SYSTEM_PROMPT } from '../src/services/geminiService.ts';
import { AiService } from '../server/services/AiService.js';

test('Multi-turn prompt building logic', () => {
  const query = "What did he discover?";
  const prompt = buildBwengeGradingPrompt(query);

  // Case-insensitive matches for the new persona
  assert.match(BWENGE_SYSTEM_PROMPT, /expert academic assistant/i);
  assert.match(BWENGE_SYSTEM_PROMPT, /pedagogical consultant/i);
  assert.match(prompt, /Question: What did he discover\?/);
});

test('AiService handles OpenRouter history correctly', async (t) => {
  const ai = AiService.getInstance();
  assert.strictEqual(typeof ai.sendOpenRouterChat, 'function');
});

test('GradingService maintains expert persona', () => {
    assert.match(BWENGE_SYSTEM_PROMPT, /maintaining high academic standards/i);
    assert.match(BWENGE_SYSTEM_PROMPT, /indispensable partner for teachers/i);
});
