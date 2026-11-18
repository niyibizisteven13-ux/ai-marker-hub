/** Run with node --import tsx scripts/claude-smoke.ts. The key stays in the environment. */
import 'dotenv/config';
import { AnthropicAdapter } from '../server/services/ai/providers/anthropicAdapter.js';
import { loadClaudeAgentConfig } from '../server/services/ai/router/agentProvider.js';
import { normalizeError } from '../server/services/ai/providers/types.js';

const { config, reason } = loadClaudeAgentConfig();
if (!config) {
  console.error(`Claude check unavailable. ${reason}.`);
  process.exitCode = 2;
} else {
  const started = Date.now();
  const adapter = new AnthropicAdapter({ apiKey: config.apiKey, requestTimeoutMs: 30_000 });
  let firstTextAt: number | undefined;
  try {
    for await (const chunk of adapter.stream({
      model: config.model,
      messages: [{ role: 'user', content: 'Say hello in one short sentence.' }],
      maxTokens: 128,
      signal: AbortSignal.timeout(30_000),
    })) {
      if (chunk.type === 'text' && chunk.text.trim()) firstTextAt ??= Date.now();
    }
    if (firstTextAt === undefined) throw new Error('No reply text');
    console.log(`Claude passed. First text in ${firstTextAt - started} ms, finished in ${Date.now() - started} ms.`);
  } catch (error) {
    const { category, statusCode } = normalizeError(error);
    console.error(`Claude check failed (${category}${statusCode ? `, HTTP ${statusCode}` : ''}).`);
    process.exitCode = 1;
  }
}
