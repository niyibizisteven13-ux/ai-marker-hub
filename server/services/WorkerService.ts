import { AiService } from './AiService.js';
import logger from '../utils/logger.js';

export class WorkerService {
  private static instance: WorkerService;
  private aiService = AiService.getInstance();

  private constructor() {}

  public static getInstance(): WorkerService {
    if (!WorkerService.instance) {
      WorkerService.instance = new WorkerService();
    }
    return WorkerService.instance;
  }

  /**
   * Specialized Workers prompts with Tool awareness
   */
  private getWorkerSystemPrompt(role: string, context: string) {
    return `You are a ${role} specialized Worker Agent.
Your core mission is to execute academic tasks with 100% accuracy.

AVAILABLE TOOLS:
- analyze_class_results: Use when the user asks for statistics or batch insights.
- draft_application: Use when helping with university personal statements or recommendation letters.

COMMAND SYNTAX:
If you need to use a tool, output exactly:
<tool_call>{"tool": "tool_name", "args": {...}}</tool_call>
Wait for the output, which will be provided as:
<tool_output>...</tool_output>

CONTEXT:
${context}

RULES:
1. Only perform actions explicitly requested.
2. If a task is completed, summarize the outcome clearly.`;
  }


  /**
   * Dispatches a task to Claude 3.5 Sonnet with Tool Definitions
   */
  public async processTask(taskTitle: string, taskDescription: string) {
    if (!await this.aiService.providerAvailable('anthropic')) {
      throw new Error('Anthropic provider not available for Workers.');
    }

    logger.info(`Worker processing task: ${taskTitle}`);

    try {
      return await this.aiService.sendClaudeChat({
        model: 'claude-3-5-sonnet-20240620',
        system: this.getWorkerSystemPrompt('FileSystem & Researcher', taskDescription),
        messages: [
          { role: 'user', content: `Execute the following task: ${taskTitle}` }
        ],
        // Tool definitions would go here for Claude SDK
        // tools: [...]
      });
    } catch (error: any) {
      logger.error(`Worker failed task ${taskTitle}:`, error);
      throw error;
    }
  }
}
