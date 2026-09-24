import test from 'node:test';
import assert from 'node:assert/strict';
import { AiService } from '../server/services/AiService.js';
import { vi } from 'vitest';

test('AiService.runAgentLoop emits thinking events when tags are present', async () => {
  const aiService = AiService.getInstance();

  // Mock Anthropic stream
  const mockStream = {
    on: vi.fn(),
    finalMessage: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: '<thinking>I need to search memory.</thinking> Final answer.' }],
      usage: { input_tokens: 10, output_tokens: 10 },
      stop_reason: 'end_turn'
    })
  };

  (aiService as any).anthropicClient = {
    messages: {
      stream: () => {
        // Simulate the 'text' events being emitted
        setTimeout(() => {
          const textHandler = (mockStream.on.mock.calls.find(c => c[0] === 'text') || [])[1];
          if (textHandler) {
            textHandler('<thinking>');
            textHandler('I need to search memory.');
            textHandler('</thinking>');
            textHandler(' Final answer.');
          }
        }, 10);
        return mockStream;
      }
    }
  };

  const onEvent = vi.fn();
  await aiService.runAgentLoop({
    messages: [{ role: 'user', content: 'test' }],
    tools: [],
    systemPrompt: 'test',
    executeTool: async () => 'test',
    onEvent
  });

  // Check if events were emitted with isThinking flag
  const thinkingEvent = onEvent.mock.calls.find(c => c[0].data?.text === 'I need to search memory.');
  assert.ok(thinkingEvent, 'Should have emitted a thinking event');
  assert.strictEqual(thinkingEvent[0].data.isThinking, true, 'isThinking should be true');

  const finalEvent = onEvent.mock.calls.find(c => c[0].data?.text === ' Final answer.');
  assert.ok(finalEvent, 'Should have emitted final answer event');
  assert.strictEqual(finalEvent[0].data.isThinking, false, 'isThinking should be false');
});
