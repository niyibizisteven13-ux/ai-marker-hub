/**
 * Run from the Bwenge repo with the same environment as the server:
 *   node --import tsx scripts/gonka-smoke.ts
 *
 * GONKA_API_KEY comes from the process environment or the ignored local .env.
 * The check sends only a synthetic greeting and never prints the key or upstream body.
 */
import 'dotenv/config';
import { OpenAICompatibleAdapter } from '../server/services/ai/providers/openaiCompatible.js';
import { normalizeError, ProviderError } from '../server/services/ai/providers/types.js';
import { loadModelPolicies } from '../server/services/ai/router/modelPolicy.js';

async function main() {
  const apiKey = process.env.GONKA_API_KEY?.trim();
  if (!apiKey) {
    console.error('GonkaRouter check failed. GONKA_API_KEY is missing.');
    process.exitCode = 1;
    return;
  }

  const baseUrl = process.env.GONKA_BASE_URL || 'https://api.gonkarouter.io/v1';
  const model = loadModelPolicies().SIMPLE.model;
  const adapter = new OpenAICompatibleAdapter({
    name: 'GonkaRouter',
    baseUrl,
    apiKey,
    connectTimeoutMs: 12_000,
    idleTimeoutMs: 12_000,
    requestTimeoutMs: 25_000,
  });
  const start = Date.now();
  try {
    let hasReply = false;
    for await (const event of adapter.stream({
      model,
      messages: [{ role: 'user', content: 'Reply with OK.' }],
      maxTokens: 64,
    })) {
      if (event.type === 'text' && event.text.trim()) hasReply = true;
    }
    if (!hasReply) {
      console.error(`GonkaRouter check failed. The ${model} stream returned no reply.`);
      process.exitCode = 1;
      return;
    }
    console.log(`GonkaRouter returned a streamed reply from ${model} in ${Date.now() - start} ms.`);
  } catch (error) {
    const { category, statusCode } = normalizeError(error);
    const timeoutKind = error instanceof ProviderError ? error.timeoutKind : undefined;
    const details = [category, statusCode && `HTTP ${statusCode}`, timeoutKind && `${timeoutKind} timeout`].filter(Boolean).join(', ');
    console.error(`GonkaRouter check failed for ${model} (${details}, ${Date.now() - start} ms).`);
    process.exitCode = 1;
  }
}

await main();
