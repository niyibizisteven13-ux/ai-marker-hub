import test from 'node:test';
import assert from 'node:assert/strict';
import { AiService } from '../server/services/AiService.js';
import { vi } from 'vitest';

// We'll mock the Anthropic client to see what messages it receives
test('AiService.generalAssist injects files into the agent loop messages', async () => {
  const aiService = AiService.getInstance();

  // Mock the anthropicClient.messages.create method
  const mockCreate = vi.fn().mockResolvedValue({
    content: [{ type: 'text', text: 'I see your document.' }],
    usage: { input_tokens: 10, output_tokens: 10 },
    stop_reason: 'end_turn'
  });

  (aiService as any).anthropicClient = {
    messages: {
      create: mockCreate
    }
  };

  const messages = [{ role: 'user', content: 'What is in this file?' }];
  const files = [{
    type: 'document' as const,
    base64: 'dGVzdCBjb250ZW50', // "test content" in base64
    mediaType: 'application/pdf'
  }];

  await aiService.generalAssist({
    userId: 'test-user',
    messages,
    files,
    tools: [{ name: 'dummy_tool', description: 'desc', input_schema: { type: 'object' } }],
    executeTool: async () => 'result'
  });

  // Check the messages passed to the agent loop (which calls create internally)
  const lastCall = mockCreate.mock.calls[0][0];
  const lastMessage = lastCall.messages[lastCall.messages.length - 1];

  assert.ok(Array.isArray(lastMessage.content), 'Content should be an array');
  assert.strictEqual(lastMessage.content[0].type, 'document', 'First content block should be the document');
  assert.strictEqual(lastMessage.content[1].text, 'What is in this file?', 'Second content block should be the text');
});
