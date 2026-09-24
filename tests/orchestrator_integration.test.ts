import test from 'node:test';
import assert from 'node:assert/strict';
import { SupervisorService } from '../server/services/SupervisorService.js';
import { ExecutionSandbox } from '../server/services/ExecutionSandbox.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

test('Orchestrator Convergence Detection', async () => {
  const sandbox = ExecutionSandbox.getInstance();
  const workspace = process.cwd();

  // Simulate 3 iterations with NO environment change
  await sandbox.detectInfiniteLoop(workspace);
  await sandbox.detectInfiniteLoop(workspace);
  const isLooped = await sandbox.detectInfiniteLoop(workspace);

  assert.strictEqual(isLooped, true, 'Should detect infinite loop after 3 stagnant iterations');
});

test('Supervisor Session Lifecycle', async () => {
  const supervisor = SupervisorService.getInstance();

  // 1. Create a dummy user for testing
  const user = await prisma.user.create({
    data: {
      email: `test-${Date.now()}@example.com`,
      name: 'Test Pilot',
      passwordHash: 'hash',
    }
  });

  // 2. Initialize Session
  const session = await supervisor.initializeSession(user.id, "Test the orchestrator loop.");
  assert.strictEqual(session.status, 'RUNNING');

  // 3. Verify Initial Task
  const task = await prisma.taskDAG.findFirst({ where: { sessionId: session.id } });
  assert.ok(task, 'Session should have an initial task');
  assert.strictEqual(task.status, 'PENDING');
});
