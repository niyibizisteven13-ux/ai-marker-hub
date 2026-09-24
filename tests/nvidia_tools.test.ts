import { describe, it, expect, vi } from 'vitest';
import { AiService } from '../server/services/AiService';

describe('NVIDIA NIM Tool Use', () => {
  it('should correctly trigger the build_form tool', async () => {
    const aiService = AiService.getInstance();

    // We mock the fetch for NVIDIA NIM
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: 'call_123',
              function: {
                name: 'build_form',
                arguments: JSON.stringify({ title: 'Math Quiz', fields: [] })
              }
            }]
          }
        }],
        usage: { prompt_tokens: 10, completion_tokens: 20 }
      })
    });

    global.fetch = mockFetch as any;

    const onEvent = vi.fn();
    const executeTool = vi.fn().mockResolvedValue('<form_schema>{}</form_schema>');

    // We only test one turn to avoid infinite loop or needing complex mocking
    // Note: The actual runNvidiaAgentLoop has a loop, so we might need a second mock response for the "done" turn
    mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          choices: [{
            message: {
              content: null,
              tool_calls: [{
                id: 'call_123',
                function: {
                  name: 'build_form',
                  arguments: JSON.stringify({ title: 'Math Quiz', fields: [] })
                }
              }]
            }
          }],
          usage: { prompt_tokens: 10, completion_tokens: 20 }
        })
    }).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          choices: [{
            message: {
              content: 'Form built successfully.',
              tool_calls: []
            }
          }],
          usage: { prompt_tokens: 5, completion_tokens: 10 }
        })
    });

    await aiService.runNvidiaAgentLoop({
      prompt: 'Create a math form',
      system: 'You are a helpful assistant',
      tools: [{ name: 'build_form', description: 'Builds a form', input_schema: {} }],
      executeTool,
      onEvent
    });

    expect(executeTool).toHaveBeenCalledWith('build_form', { title: 'Math Quiz', fields: [] });
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'tool_call', data: expect.objectContaining({ name: 'build_form' }) }));
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'done' }));
  });
});
