import test from 'node:test';
import assert from 'node:assert/strict';
import { SupervisorService } from '../server/services/SupervisorService.js';
import { ExecutionSandbox } from '../server/services/ExecutionSandbox.js';
import { PrismaClient } from '@prisma/client';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const prisma = new PrismaClient();

test('Orchestrator Convergence Detection', async () => {
  const sandbox = ExecutionSandbox.getInstance();
  // A workspace of its own: the repository folder changes while other test files run in parallel.
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwenge-converge-'));

  // Simulate 3 iterations with NO environment change
  await sandbox.detectInfiniteLoop(workspace);
  await sandbox.detectInfiniteLoop(workspace);
  const isLooped = await sandbox.detectInfiniteLoop(workspace);

  assert.strictEqual(isLooped, true, 'Should detect infinite loop after 3 stagnant iterations');
});

test('Supervisor Session Lifecycle', { skip: !process.env.DATABASE_URL && 'needs PostgreSQL (DATABASE_URL); CI provides it' }, async () => {
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
