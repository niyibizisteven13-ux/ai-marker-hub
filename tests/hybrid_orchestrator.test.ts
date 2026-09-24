import test from 'node:test';
import assert from 'node:assert/strict';
import { AiService } from '../server/services/AiService.js';
import { vi } from 'vitest';

test('runTreeOfThoughtOrchestrator correctly assigns providers to sub-tasks', async () => {
  const aiService = AiService.getInstance();

  // Mock Planning Turn (Orchestrator)
  const mockPlanningResponse = {
    text: JSON.stringify({
      tasks: [
        { id: 1, agent: 'Researcher', provider: 'nvidianim', instructions: 'Research physics data' },
        { id: 2, agent: 'Writer', provider: 'anthropic', instructions: 'Write the report' }
      ]
    })
  };

  vi.spyOn(aiService as any, 'sendClaudeChat').mockResolvedValue(mockPlanningResponse);

  // Mock Worker Loops
  const runNvidiaAgentLoopSpy = vi.spyOn(aiService, 'runNvidiaAgentLoop').mockResolvedValue([{ role: 'assistant', content: 'Nvidia Research Done' }] as any);
  const runAgentLoopSpy = vi.spyOn(aiService, 'runAgentLoop').mockResolvedValue([{ role: 'assistant', content: 'Claude Writing Done' }] as any);

  const onEvent = vi.fn();
  await aiService.runTreeOfThoughtOrchestrator({
    userId: 'test-user',
    userQuery: 'Conduct research and write a report.',
    tools: [],
    executeTool: async () => 'result',
    onEvent
  });

  // Verify NIM was used for research
  assert.strictEqual(runNvidiaAgentLoopSpy.mock.calls.length, 1, 'NVIDIA Agent Loop should be called once');

  // Verify Claude was used for writing
  // Note: runAgentLoop is called for each Claude task AND the final synthesis
  assert.ok(runAgentLoopSpy.mock.calls.length >= 2, 'Claude Agent Loop should be called for writing and synthesis');

  const nvidiaCall = runNvidiaAgentLoopSpy.mock.calls[0][0];
  assert.strictEqual(nvidiaCall.prompt, 'Research physics data');
});
