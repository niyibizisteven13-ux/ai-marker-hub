import test from 'node:test';
import assert from 'node:assert/strict';
import { AiService } from '../server/services/AiService.js';
import { FormScoringService } from '../server/services/FormScoringService.js';
import { FormOrchestrator } from '../server/services/FormOrchestrator.js';
import { GradingService } from '../server/services/GradingService.js';

function overrideMethod(target: object, name: string, value: (...args: any[]) => unknown) {
  const original = Object.getOwnPropertyDescriptor(target, name);
  Object.defineProperty(target, name, { configurable: true, writable: true, value });
  return () => {
    if (original) Object.defineProperty(target, name, original);
    else Reflect.deleteProperty(target, name);
  };
}

const examPaper = {
  questions: [{ id: 'q1', number: '1', maxMarks: 5, modelAnswer: 'A documented model answer.' }],
};

const studentScript = {
  studentName: 'Test Student',
  studentId: 'student-1',
  answers: [{ questionId: 'q1', questionNumber: '1', answerText: 'A sufficiently long student answer for the marking check.' }],
};

test('grading with no configured AI provider rejects instead of creating a marked result', async () => {
  const aiService = AiService.getInstance();
  const previousProvider = process.env.AI_PROVIDER;
  process.env.AI_PROVIDER = '';
  const restoreAvailability = overrideMethod(aiService, 'providerAvailable', async () => false);

  try {
    await assert.rejects(
      GradingService.getInstance().evaluateStudentScriptWithAI(examPaper, studentScript),
      /remains pending/
    );
  } finally {
    restoreAvailability();
    if (previousProvider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = previousProvider;
  }
});

test('grading timeout rejects without returning scores or feedback', async () => {
  const aiService = AiService.getInstance();
  const previousProvider = process.env.AI_PROVIDER;
  process.env.AI_PROVIDER = 'gonkarouter';
  const restoreAvailability = overrideMethod(aiService, 'providerAvailable', async (name: string) => name === 'gonkarouter');
  const restoreGonka = overrideMethod(aiService, 'sendGonkaChat', async () => {
    throw Object.assign(new Error('upstream timeout'), { timeout: true, timeoutKind: 'request' });
  });

  try {
    await assert.rejects(
      GradingService.getInstance().evaluateStudentScriptWithAI(examPaper, studentScript),
      /remains pending/
    );
  } finally {
    restoreGonka();
    restoreAvailability();
    if (previousProvider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = previousProvider;
  }
});

test('incomplete model grading output rejects instead of becoming a zero-mark result', async () => {
  const aiService = AiService.getInstance();
  const previousProvider = process.env.AI_PROVIDER;
  process.env.AI_PROVIDER = 'gonkarouter';
  const restoreAvailability = overrideMethod(aiService, 'providerAvailable', async (name: string) => name === 'gonkarouter');
  const restoreGonka = overrideMethod(aiService, 'sendGonkaChat', async () => '[]');

  try {
    await assert.rejects(
      GradingService.getInstance().evaluateStudentScriptWithAI(examPaper, studentScript),
      /remains pending/
    );
  } finally {
    restoreGonka();
    restoreAvailability();
    if (previousProvider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = previousProvider;
  }
});

test('form scoring failure rejects instead of inventing a score or feedback', async () => {
  const aiService = AiService.getInstance();
  const restoreGonka = overrideMethod(aiService, 'sendGonkaChat', async () => {
    throw new Error('upstream unavailable');
  });

  try {
    await assert.rejects(
      FormScoringService.getInstance().scoreSubmission(
        { title: 'Assessment', schema: JSON.stringify({ questions: [{ id: 'q1', title: 'Explain your answer' }] }) },
        { q1: 'A response that would previously have received a fabricated completeness score.' }
      ),
      /remains unscored/
    );
  } finally {
    restoreGonka();
  }
});

test('form generation failure rejects instead of creating substitute questions', async () => {
  const aiService = AiService.getInstance();
  const restoreGonka = overrideMethod(aiService, 'sendGonkaChat', async () => {
    throw new Error('upstream unavailable');
  });

  try {
    await assert.rejects(FormOrchestrator.getInstance().reason('Create a science assessment', {}), /could not be completed/);
  } finally {
    restoreGonka();
  }
});
