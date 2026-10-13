import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileStore } from '../src/ai/files/FileStore.js';
import { buildToolkit } from '../src/ai/tools/index.js';
import type { ToolContext, ToolServices } from '../src/ai/types.js';

export async function tempStore() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bwenge-'));
  const store = new FileStore({ dir, secret: 'test-secret-test-secret-123456' });
  return { store, dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

export function makeCtx(store: FileStore, userId = 'u1', services: ToolServices = {}): ToolContext {
  return { userId, files: store, services };
}

export { buildToolkit };

type Script = (req: http.IncomingMessage, body: any, res: http.ServerResponse, n: number) => void | Promise<void>;

/** Tiny OpenAI-compatible server: every request runs the next scripted responder. */
export async function mockServer(scripts: Script[]) {
  let n = 0;
  const bodies: any[] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      const body = raw ? JSON.parse(raw) : {};
      bodies.push(body);
      const script = scripts[Math.min(n, scripts.length - 1)];
      n++;
      await script(req, body, res, n);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as any).port as number;
  return { url: `http://127.0.0.1:${port}/v1`, bodies, close: () => new Promise<void>((r) => { server.closeAllConnections?.(); server.close(() => r()); }) };
}

export const sse = (res: http.ServerResponse) => res.writeHead(200, { 'Content-Type': 'text/event-stream' });
export const send = (res: http.ServerResponse, obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
export const delta = (d: any, extra: any = {}) => ({ choices: [{ index: 0, delta: d, finish_reason: null }], ...extra });
