import type { Request, Response } from 'express';

/** Stream persisted snapshots across any web node; never stream an unvalidated model proposal. */
export async function streamExam(
  req: Request, res: Response,
  read: () => Promise<{ id: string; data: unknown }>,
  options: { intervalMs?: number; lifetimeMs?: number } = {},
) {
  // Resolve ownership and validate query parameters before sending SSE headers.
  const initial = await read();
  if (res.destroyed) return;
  res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  let closed = false;
  let previous = initial.id;
  let timer: ReturnType<typeof setTimeout>;
  const send = (event: string, data: unknown, id?: string) => {
    if (closed || res.destroyed) return;
    return res.write(`${id ? `id: ${id}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  // Always replay authoritative state when reconnecting, including with Last-Event-ID.
  send('snapshot', initial.data, initial.id);
  const close = () => { closed = true; clearTimeout(timer); clearInterval(heartbeat); clearTimeout(expiry); };
  const heartbeat = setInterval(() => { if (!closed && !res.writableNeedDrain) res.write(': heartbeat\n\n'); }, 15_000);
  const expiry = setTimeout(() => { close(); res.end(); }, options.lifetimeMs ?? 120_000);
  res.on('close', close);
  const tick = async () => {
    if (closed) return;
    try {
      if (!res.writableNeedDrain) {
        const next = await read();
        if (!closed && next.id !== previous) { send('snapshot', next.data, next.id); previous = next.id; }
      }
    } catch {
      send('stream_error', { message: 'Live updates interrupted. Reconnecting to saved results.' });
      close(); res.end(); return;
    }
    if (!closed) timer = setTimeout(tick, options.intervalMs ?? 750);
  };
  timer = setTimeout(tick, options.intervalMs ?? 750);
}
