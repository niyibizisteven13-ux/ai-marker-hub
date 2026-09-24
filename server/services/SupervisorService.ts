import { PrismaClient } from '@prisma/client';
import { AiService } from './AiService.js';
import { WorkerService } from './WorkerService.js';
import { ExecutionSandbox } from './ExecutionSandbox.js';
import logger from '../utils/logger.js';

const prisma = new PrismaClient();

export class SupervisorService {
  private static instance: SupervisorService;
  private aiService = AiService.getInstance();
  private workerService = WorkerService.getInstance();
  private sandbox = ExecutionSandbox.getInstance();

  private constructor() {}

  public static getInstance(): SupervisorService {
    if (!SupervisorService.instance) {
      SupervisorService.instance = new SupervisorService();
    }
    return SupervisorService.instance;
  }

  /**
   * Evaluates Worker output against strict success criteria.
   */
  private async validateWork(taskTitle: string, result: string): Promise<boolean> {
    const prompt = `You are a strict Validator Agent.
Evaluate the following worker result for task: "${taskTitle}".
RESULT:
${result}

Is the work completed successfully according to the goal?
Return ONLY "YES" or "NO".`;

    const { text } = await this.aiService.sendClaudeChat({
      system: 'You are a critical validator. Be objective.',
      messages: [{ role: 'user', content: prompt }]
    });

    return text.includes('YES');
  }

  /**
   * Initializes a new agent session and generates the initial task DAG.
   */
  public async initializeSession(userId: string, goal: string) {
    const session = await prisma.agentSession.create({
      data: {
        userId,
        status: 'RUNNING',
        globalBudget: 5.0,
      },
    });

    logger.info(`Initialized Agent Session: ${session.id}`);

    await prisma.taskDAG.create({
      data: {
        sessionId: session.id,
        title: 'Primary Mission',
        description: goal,
        status: 'PENDING',
        executionOrder: 0,
      },
    });

    return session;
  }

  /**
   * Core Agentic Loop Execution
   */
  public async executeIteration(sessionId: string) {
    const session = await prisma.agentSession.findUnique({
      where: { id: sessionId },
      include: {
        tasks: { where: { status: 'PENDING' }, orderBy: { executionOrder: 'asc' } }
      },
    });

    if (!session || session.status !== 'RUNNING') return;

    if (session.currentIteration >= session.maxIterations) {
      await this.terminateSession(sessionId, 'FAILED', 'Iteration limit exceeded.');
      return;
    }

    // Convergence check
    const isLooped = await this.sandbox.detectInfiniteLoop(process.cwd());
    if (isLooped) {
      await this.terminateSession(sessionId, 'PAUSED_HITL', 'Infinite Loop Trap triggered.');
      return;
    }

    const currentTask = session.tasks[0];
    if (!currentTask) {
      await this.terminateSession(sessionId, 'COMPLETED', 'Mission accomplished.');
      return;
    }

    try {
      // 1. Worker Execution
      const { text: resultText } = await this.workerService.processTask(currentTask.title, currentTask.description || '');

      // 2. Validation
      const isValid = await this.validateWork(currentTask.title, resultText);

      if (isValid) {
        await prisma.taskDAG.update({
          where: { id: currentTask.id },
          data: { status: 'COMPLETED', result: resultText }
        });
      } else {
        logger.warn(`Task ${currentTask.id} failed validation. Retrying in next iteration.`);
      }

      // 3. Update Session
      await prisma.agentSession.update({
        where: { id: sessionId },
        data: {
          currentIteration: { increment: 1 },
          spentBudget: { increment: 0.05 } // Simulated cost per iteration
        }
      });

      // 4. Persistence Log
      await prisma.executionLog.create({
        data: {
          sessionId,
          iteration: session.currentIteration + 1,
          agentName: 'SUPERVISOR',
          actionType: isValid ? 'COMPLETED' : 'RETRY',
          input: currentTask.title,
          output: resultText,
        }
      });

    } catch (error: any) {
      logger.error(`Loop Error [${sessionId}]:`, error.message);
      await this.terminateSession(sessionId, 'FAILED', error.message);
    }
  }

  private async terminateSession(sessionId: string, status: string, reason: string) {
    logger.info(`Terminating Session ${sessionId}: ${status} (${reason})`);
    await prisma.agentSession.update({
      where: { id: sessionId },
      data: { status }
    });
  }
}
