import test from 'node:test';
import assert from 'node:assert/strict';
import { AiService } from '../server/services/AiService.js';
import { GradingService } from '../server/services/GradingService.js';
import { QueueService } from '../server/services/QueueService.js';

test('AiService is a singleton', () => {
  const instance1 = AiService.getInstance();
  const instance2 = AiService.getInstance();
  assert.strictEqual(instance1, instance2);
});

test('GradingService is a singleton', () => {
  const instance1 = GradingService.getInstance();
  const instance2 = GradingService.getInstance();
  assert.strictEqual(instance1, instance2);
});

test('QueueService is a singleton', () => {
  const instance1 = QueueService.getInstance();
  const instance2 = QueueService.getInstance();
  assert.strictEqual(instance1, instance2);
});

test('AiService parses model JSON correctly', () => {
  const ai = AiService.getInstance();
  const raw = '```json\n{"score": 10}\n```';
  const parsed = ai.parseModelJson(raw);
  assert.strictEqual(parsed.score, 10);
});

test('AiService handles malformed JSON gracefully', () => {
  const ai = AiService.getInstance();
  const raw = 'not a json';
  const parsed = ai.parseModelJson(raw);
  assert.deepStrictEqual(parsed, {});
});

test('AiService prefers the first valid JSON payload in surrounding prose', () => {
  const ai = AiService.getInstance();
  const raw = 'Here is the first result: {"status":"ok","items":[1,2]} and later another payload {"status":"later"}';
  const parsed = ai.parseModelJson(raw);
  assert.deepStrictEqual(parsed, { status: 'ok', items: [1, 2] });
});

test('AiService createInteraction is defined', () => {
  const ai = AiService.getInstance();
  assert.strictEqual(typeof ai.createInteraction, 'function');
});

