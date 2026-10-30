import path from 'node:path';
import { createWorker, type Worker } from 'tesseract.js';
import type { IndependentOcr } from './verify.js';

/**
 * Tesseract as an independent OCR cross-check. It reads print well and handwriting poorly, so verify.ts
 * only treats a confident Tesseract reading as evidence. Uses the bundled eng.traineddata (offline).
 */

// A few workers so pages read in parallel are cross-checked in parallel too (each worker is one CPU thread).
const POOL = Math.max(1, Math.min(8, Number(process.env.TESSERACT_WORKERS) || 2));
const workers: Array<Promise<Worker> | null> = Array.from({ length: POOL }, () => null);
const queues: Array<Promise<unknown>> = Array.from({ length: POOL }, () => Promise.resolve());
const pending = new Array<number>(POOL).fill(0);

function getWorker(i: number): Promise<Worker> {
  const dir = path.resolve(process.env.TESSERACT_DATA_DIR ?? process.cwd());
  workers[i] ??= createWorker(process.env.TESSERACT_LANG ?? 'eng', 1, { cachePath: dir, langPath: dir, gzip: false } as Parameters<typeof createWorker>[2]);
  return workers[i]!;
}

export const tesseractOcr: IndependentOcr = (png) => {
  // One recognition at a time per worker; a new reading goes to the least busy one.
  const i = pending.indexOf(Math.min(...pending));
  pending[i]++;
  const run = queues[i].then(async () => {
    const w = await getWorker(i);
    const { data } = await w.recognize(png);
    return { text: data.text ?? '', confidence: data.confidence ?? 0 };
  }).finally(() => { pending[i]--; });
  queues[i] = run.catch(() => {});
  return run;
};

export async function shutdownOcr(): Promise<void> {
  const all = workers.splice(0, workers.length, ...workers.map(() => null));
  await Promise.all(all.map(async (w) => { if (w) await (await w).terminate().catch(() => {}); }));
}
