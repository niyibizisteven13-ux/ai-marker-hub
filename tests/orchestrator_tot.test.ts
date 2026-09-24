import { AiService } from '../server/services/AiService.ts';

async function testOrchestrator() {
  const aiService = AiService.getInstance();
  console.log("Starting Tree-of-Thought Orchestrator Test...");

  const mockExecuteTool = async (name: string, input: any) => {
    console.log(`Tool Called: ${name}`, input);
    return "Mock Result: IB Physics standards verified.";
  };

  const mockOnEvent = (event: any) => {
    console.log(`Event: ${event.type}`, event.data);
  };

  try {
    const result = await aiService.runTreeOfThoughtOrchestrator({
      userId: 'test-user-v4',
      userQuery: "Design a lesson plan connecting Physics wave theory to Musical scales, and verify standard compliance.",
      tools: [],
      executeTool: mockExecuteTool,
      onEvent: mockOnEvent
    });

    console.log("Final Synthesis:", result);
  } catch (e) {
    console.error("Orchestrator Test Failed:", e);
  }
}

testOrchestrator();
