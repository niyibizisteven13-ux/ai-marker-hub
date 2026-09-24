import { PrismaClient } from '@prisma/client';
import { AiService } from './AiService.js';
import { ExecutionSandbox } from './ExecutionSandbox.js';
import logger from '../utils/logger.js';

const prisma = new PrismaClient();

export abstract class AgentPillarBase {
  protected aiService = AiService.getInstance();
  protected sandbox = ExecutionSandbox.getInstance();
  protected executionHistory: any[] = [];
  protected maxLoops = 5;

  /**
   * Pillar 1: Perceive & Observe
   * Gather environmental data, database records, and file artifacts.
   */
  abstract perceive(contextId: string): Promise<any>;

  /**
   * Pillar 2: Reason & Plan
   * Use LLM to decompose goal into a task DAG or script.
   */
  abstract reason(userGoal: string, observation: any): Promise<any>;

  /**
   * Pillar 3: Use Tools
   * Execute generated logic or tools inside the sandbox.
   */
  protected async useTools(toolName: string, args: any) {
    return this.sandbox.dispatchTool(toolName, args);
  }

  /**
   * Pillar 4: Act Autonomously
   * The iterative loop that performs work and recovers from errors.
   */
  public async act(sessionId: string, userGoal: string) {
    const observation = await this.perceive(sessionId);
    let loopCount = 0;

    while (loopCount < this.maxLoops) {
      loopCount++;
      logger.info(`Agent Cycle: ${loopCount}/${this.maxLoops}`);

      const plan = await this.reason(userGoal, observation);
      this.executionHistory.push({ role: 'assistant', content: plan.thought });

      if (plan.tool_to_use) {
        const result = await this.useTools(plan.tool_to_use, plan.args || {});
        this.executionHistory.push({ role: 'tool_output', content: result });

        const resObj = result as any;
        if (resObj && resObj.error) {
          logger.warn(`Agent encountered error: ${resObj.error}. Retrying...`);
          userGoal += ` (Fix this error: ${resObj.error})`;
          continue;
        }
      }

      // Success or termination condition
      if (plan.finished) break;
    }

    await this.serializeState(sessionId);
    return this.executionHistory[this.executionHistory.length - 1];
  }

  /**
   * Pillar 5: Context & Memory
   * Serialize state back to database and summarize long histories.
   */
  protected async serializeState(sessionId: string) {
    logger.info(`Serializing state for session ${sessionId}`);
    // Summarize history if too long
    if (this.executionHistory.length > 10) {
      const summary = await this.summarizeMemory();
      this.executionHistory = [{ role: 'system', content: `Context Summary: ${summary}` }];
    }
  }

  private async summarizeMemory(): Promise<string> {
    const { text } = await this.aiService.sendClaudeChat({
      system: 'You are a memory compression utility. Summarize the following execution log into a single dense paragraph.',
      messages: [{ role: 'user', content: JSON.stringify(this.executionHistory) }]
    });
    return text;
  }
}
