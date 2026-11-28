import { authFetch } from './authFetch';

export type BuilderProgress = { id: string; label: string; state: 'running' | 'done' | 'error'; detail?: string };

export async function requestBuilderRun<T>(
  endpoint: string,
  body: { prompt: string; revision?: number; mode?: 'quick' | 'standard' },
  onProgress: (event: BuilderProgress) => void,
  signal?: AbortSignal,
): Promise<T> {
  const response = await authFetch(endpoint, {
    method: 'POST', headers: { Accept: 'application/x-ndjson' }, body: JSON.stringify(body), signal,
  });
  return readBuilderRun<T>(response, onProgress);
}

export async function readBuilderRun<T>(response: Response, onProgress: (event: BuilderProgress) => void): Promise<T> {
  if (!response.ok || !response.body || !response.headers.get('Content-Type')?.includes('application/x-ndjson')) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error || 'The build could not start.');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let result: T | undefined;
  function accept(line: string) {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === 'progress') onProgress(event);
    if (event.type === 'error') throw new Error(event.message);
    if (event.type === 'result') result = event.data;
  }
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split('\n');
      pending = lines.pop() || '';
      lines.forEach(accept);
    }
    accept(pending + decoder.decode());
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  if (result === undefined) throw new Error('The build ended before saving a result.');
  return result;
}
