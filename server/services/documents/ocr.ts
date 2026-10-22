import path from 'node:path';
import { createWorker, type Worker } from 'tesseract.js';
import type { IndependentOcr } from './verify.js';

/**
 * Tesseract as an independent OCR cross-check. It reads print well and handwriting poorly, so verify.ts
 * only treats a confident Tesseract reading as evidence. Uses the bundled eng.traineddata (offline).
 */

let worker: Promise<Worker> | null = null;
let queue: Promise<unknown> = Promise.resolve();

function getWorker(): Promise<Worker> {
  const dir = path.resolve(process.env.TESSERACT_DATA_DIR ?? process.cwd());
  worker ??= createWorker(process.env.TESSERACT_LANG ?? 'eng', 1, { cachePath: dir, langPath: dir, gzip: false } as Parameters<typeof createWorker>[2]);
  return worker;
}

export const tesseractOcr: IndependentOcr = (png) => {
  // One recognition at a time per worker.
  const run = queue.then(async () => {
    const w = await getWorker();
    const { data } = await w.recognize(png);
    return { text: data.text ?? '', confidence: data.confidence ?? 0 };
  });
  queue = run.catch(() => {});
  return run;
};

export async function shutdownOcr(): Promise<void> {
  const w = worker;
  worker = null;
  if (w) await (await w).terminate().catch(() => {});
}
