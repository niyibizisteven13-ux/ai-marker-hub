import test from 'node:test';
import assert from 'node:assert/strict';
import { AiPausedError, isAiRequest, setAiPaused } from '../server/services/billing/aiKillSwitch.ts';
import { describeChatFailure } from '../server/services/ai/chatFailure.ts';
import http from 'node:http';

test('AI provider requests are recognised; other traffic is not', () => {
  for (const u of ['https://api.anthropic.com/v1/messages', 'https://api.gonkarouter.io/v1/chat/completions', 'https://openrouter.ai/api/v1/chat/completions', 'https://generativelanguage.googleapis.com/v1beta/models/x:generateContent', 'https://my-llm.example/v1/chat/completions'])
    assert.ok(isAiRequest(u), u);
  for (const u of ['https://api.telegram.org/bot123/sendMessage', 'https://sandbox.momodeveloper.mtn.com/collection/v1_0/requesttopay', 'http://127.0.0.1:3000/v1/chat/completions', 'https://api.tavily.com/search'])
    assert.ok(!isAiRequest(u), u);
});

test('Pause AI refuses new provider calls and cancels a stream in progress; resume lets them through', async () => {
  // A slow streaming "provider" on localhost, reached through a provider-looking host via the URL check bypass.
  const server = http.createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); const t = setInterval(() => res.write('data: x\n\n'), 20); res.on('close', () => clearInterval(t)); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as any).port;
  process.env.OLLAMA_BASE_URL = `http://127.0.0.1:${port}`; // a configured provider host counts as AI
  const url = `http://127.0.0.1:${port}/api/chat`;
  try {
    setAiPaused(false);
    const res = await fetch(url);
    const reader = res.body!.getReader();
    await reader.read();
    setAiPaused(true);
    await assert.rejects(async () => { for (;;) { const { done } = await reader.read(); if (done) break; } }, AiPausedError);
    await assert.rejects(() => fetch(url), AiPausedError);
    assert.equal(describeChatFailure(new Error('socket hang up')).code, 'AI_PAUSED');
    setAiPaused(false);
    const ok = await fetch(url);
    assert.equal(ok.status, 200);
    await ok.body!.cancel();
  } finally {
    setAiPaused(false);
    delete process.env.OLLAMA_BASE_URL;
    server.closeAllConnections?.(); server.close();
  }
});
