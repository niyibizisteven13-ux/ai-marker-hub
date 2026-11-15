import { dockerAvailable, dockerRunner } from './docker.js';
import { localUnsafeRunner } from './local.js';
import type { CodeRunner } from './types.js';

/**
 * Which runner this server uses. CODE_RUNNER=docker (default when Docker works), off, or local-unsafe
 * (development only: refused in production unless ALLOW_UNSAFE_CODE_RUNNER=yes, because it does not isolate the
 * program from the rest of the server).
 */
let cache: { at: number; value: { runner: CodeRunner | null; reason: string } } | null = null;

export async function codeRunnerStatus(): Promise<{ runner: CodeRunner | null; reason: string }> {
  if (cache && Date.now() - cache.at < 60_000) return cache.value;
  const want = (process.env.CODE_RUNNER || '').toLowerCase();
  let value: { runner: CodeRunner | null; reason: string };
  if (want === 'off') value = { runner: null, reason: 'Code testing is switched off on this server.' };
  else if (want === 'local-unsafe') {
    value = process.env.NODE_ENV === 'production' && process.env.ALLOW_UNSAFE_CODE_RUNNER !== 'yes'
      ? { runner: null, reason: 'The development code runner is not allowed in production. Use Docker.' }
      : { runner: localUnsafeRunner, reason: 'Development runner (not safe for real students).' };
  } else value = (await dockerAvailable()) ? { runner: dockerRunner, reason: 'Docker' } : { runner: null, reason: 'Code testing needs Docker on the server. Ask the administrator to install Docker and build the code runner image (docker/code-runner/Dockerfile).' };
  cache = { at: Date.now(), value };
  return value;
}
export function resetCodeRunnerCache() { cache = null; }
