import test from 'node:test';
import assert from 'node:assert/strict';
import { AiService } from '../server/services/AiService.js';

test('Telegram Discussion Mode: GonkaRouter answers post-grading questions using student results context', async () => {
  const originalApiKey = process.env.GONKA_API_KEY;
  const originalBaseUrl = process.env.GONKA_BASE_URL;
  const originalFetch = globalThis.fetch;

  process.env.GONKA_API_KEY = 'test-gonka-key';
  process.env.GONKA_BASE_URL = 'https://gonka.test/v1';

  let receivedSystem = '';
  let receivedUserPrompt = '';

  globalThis.fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body));
    receivedSystem = body.messages[0].content;
    receivedUserPrompt = body.messages[1].content;

    const mockResponse = {
      choices: [{
        message: {
          role: 'assistant',
          content: 'Student #3 lost 4 marks on Question 2 because they forgot to state Newton\'s Third Law explicitly, though their formula calculation was correct.',
        },
      }],
    };

    return new Response(JSON.stringify(mockResponse), {
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const batchContext = `DISCUSS SESSION FOR GRADED BATCH JOB job-12345:\n[STUDENT Student #3]: Score 16/20. Details: [{"questionNumber": 1, "score": 10, "maxScore": 10}, {"questionNumber": 2, "score": 6, "maxScore": 10, "feedback": "Formula correct but Newton Third Law statement missing"}]`;
    const userQuery = 'Why did Student #3 lose marks on Question 2?';

    const fullPrompt = `${batchContext}\n\nUSER FOLLOW-UP QUESTION: ${userQuery}`;

    const aiService = AiService.getInstance();
    const result = await aiService.sendGonkaChat(fullPrompt, {
      system: 'You are Bwenge AI Assistant on Telegram helping a teacher analyze class results.',
    });

    assert.ok(result.includes('Student #3 lost 4 marks on Question 2'));
    assert.ok(result.includes('Newton'));
    assert.ok(receivedUserPrompt.includes('Student #3'));
    assert.ok(receivedSystem.includes('Bwenge AI Assistant'));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.GONKA_API_KEY;
    else process.env.GONKA_API_KEY = originalApiKey;
    if (originalBaseUrl === undefined) delete process.env.GONKA_BASE_URL;
    else process.env.GONKA_BASE_URL = originalBaseUrl;
  }
});
