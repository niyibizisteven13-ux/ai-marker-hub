import type express from 'express';
import logger from './logger.js';

/**
 * Server-sent events for one chat reply. Every stream sends a heartbeat comment every 15 s, so proxies and the
 * browser never cut a long answer for being idle. With `progress`, the reply also carries live steps
 * ({type:"status", id, label, state}) the chat shows as a checklist: "Understanding your request" until the first
 * words or tool, then "Writing the answer" until done. Routes add their own steps (reading files, marking).
 */
export function makeEmitter(res: express.Response, opts: { progress?: boolean } = {}) {
  let closed = false;
  // nginx and similar proxies buffer responses by default, which would deliver every step at the end at once.
  if (typeof res.setHeader === 'function' && !res.headersSent) res.setHeader('X-Accel-Buffering', 'no');
  let phase: 'think' | 'act' | 'review' | 'write' = 'think';
  let openTools = 0;
  let reviews = 0;
  const heartbeat = setInterval(() => {
    if (closed) return;
    try { res.write(':\n\n'); } catch { /* client gone */ }
  }, 15_000);
  heartbeat.unref?.();
  res.on('close', () => {
    closed = true;
    clearInterval(heartbeat);
  });

  const raw = (type: string, data: Record<string, any> = {}) => {
    if (closed) return;
    try {
      res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
    } catch (err) {
      logger.warn('SSE write failed (client likely disconnected)', err);
    }
  };
  const status = (id: string, label: string, state: 'running' | 'done' | 'error' = 'running', detail?: string) =>
    raw('status', { id, label, state, ...(detail ? { detail } : {}) });

  // Steps stay in the order they happened: writing that pauses for tools is closed, and a new writing step
  // ("Summarising the results") opens after them.
  let writes = 0;
  const writeLabel = () => (writes > 1 ? 'Summarising the results' : 'Writing the answer');
  const send = (type: string, data: Record<string, any> = {}) => {
    if (opts.progress) {
      const words = type === 'text' && !data.isThinking && String(data.text ?? '').trim() !== '';
      if (phase === 'think' && (type === 'tool_call' || words)) {
        status('think', 'Understanding your request', 'done');
        phase = 'act';
      }
      if (phase === 'write' && type === 'tool_call') {
        status(`write-${writes}`, writeLabel(), 'done');
        phase = 'act';
      }
      // Tools finished and the model is reading their results: keep a step running so the work never looks done.
      if (type === 'tool_call') openTools++;
      if (type === 'tool_result') {
        openTools = Math.max(0, openTools - 1);
        if (openTools === 0 && phase === 'act') { reviews++; status(`review-${reviews}`, 'Checking the results'); phase = 'review'; }
      }
      if (phase === 'review' && (words || type === 'tool_call')) {
        status(`review-${reviews}`, 'Checking the results', 'done');
        phase = 'act';
      }
      if (phase !== 'write' && words) {
        writes++;
        status(`write-${writes}`, writeLabel());
        phase = 'write';
      }
    }
    raw(type, data);
  };

  const done = () => {
    if (closed) return;
    if (opts.progress) {
      if (phase === 'think') status('think', 'Understanding your request', 'done');
      if (phase === 'write') status(`write-${writes}`, writeLabel(), 'done');
      if (phase === 'review') status(`review-${reviews}`, 'Checking the results', 'done');
    }
    clearInterval(heartbeat);
    res.write('data: [DONE]\n\n');
    res.end();
  };

  const isClosed = () => closed;
  if (opts.progress) status('think', 'Understanding your request');

  return { send, status, done, isClosed };
}
