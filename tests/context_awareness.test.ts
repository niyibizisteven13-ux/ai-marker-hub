import test from 'node:test';
import assert from 'node:assert/strict';
import { ContextAwareService } from '../server/services/ContextAwareService.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

test('ContextAwareService builds a valid hydrated prompt', async () => {
  const service = ContextAwareService.getInstance();

  // Create mock user
  const user = await prisma.user.create({
    data: {
      email: `context-test-${Date.now()}@example.com`,
      name: 'Context Tester',
      passwordHash: 'hash',
      role: 'ADMIN'
    }
  });

  const prompt = await service.buildHydratedPrompt(user.id);

  assert.match(prompt, /\[CONTEXTUAL ANCHORS\]/);
  assert.match(prompt, /TEMPORAL:/);
  assert.match(prompt, /USER STATE:/);
  assert.match(prompt, /Context Tester/);
  assert.match(prompt, /ADMIN/);
});

test('Temporal context includes accurate day of week', async () => {
  const service = ContextAwareService.getInstance();
  const prompt = await service.buildHydratedPrompt('fake-id');

  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const hasDay = days.some(day => prompt.includes(day));

  assert.strictEqual(hasDay, true, 'Prompt should include the current day of the week');
});
