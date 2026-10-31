import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import type { ProviderAdapter } from '../ai/providers/types.js';
import { generateStructured } from '../ai/llm/structuredJson.js';
import { loadPages } from '../documents/pages.js';
import { visionCalls } from '../../utils/concurrency.js';

/**
 * One PDF holding a whole class (the school scanner's single file) becomes one PDF per student.
 * With "N pages per student" it is cut every N pages. Otherwise the AI looks at small pictures of the pages,
 * eight at a time, and says which pages start a new student's script (a name or number at the top, or
 * question 1 starting again); the file is cut there.
 */

export interface ClassPiece { name: string; buffer: Buffer; pages: number; firstPage: number; writtenName: string | null }

const MAX_CLASS_PAGES = 2000;
const PER_CALL = 8;

const START_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['pages'],
  properties: {
    pages: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['page', 'startsNewStudent', 'name'],
        properties: { page: { type: 'integer' }, startsNewStudent: { type: 'boolean' }, name: { type: ['string', 'null'] } },
      },
    },
  },
} as const;

const SYSTEM = `You look at scanned pages from one file that holds the answer scripts of a whole class, one student after another.
For each page, decide whether it is the FIRST page of a student's script: a name, student number or class written at the top, a cover page, or the answers starting again from question 1. A page that continues the same student's answers is not a start.
name: the student's name or number written on a starting page, exactly as written, or null if none can be read.`;

/** Page numbers (1-based) where a new student's script starts; page 1 always does. */
export async function detectStarts(adapter: ProviderAdapter, model: string, images: Buffer[], signal?: AbortSignal): Promise<Map<number, string | null>> {
  const starts = new Map<number, string | null>([[1, null]]);
  for (let i = 0; i < images.length; i += PER_CALL) {
    const batch = images.slice(i, i + PER_CALL);
    const urls = await Promise.all(batch.map(async (img) => `data:image/jpeg;base64,${(await sharp(img).resize({ width: 700, height: 1000, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer()).toString('base64')}`));
    const first = i + 1;
    const res = await visionCalls.run(() => generateStructured<{ pages: Array<{ page: number; startsNewStudent: boolean; name: string | null }> }>(adapter, {
      model, system: SYSTEM, schema: START_SCHEMA, images: urls, maxTokens: 2000, signal,
      prompt: `These are pages ${first} to ${first + batch.length - 1} of the file, in order (image 1 is page ${first}). Answer for every page.`,
    }));
    for (const p of res.data.pages) {
      if (p.page < first || p.page >= first + batch.length) continue;
      if (p.startsNewStudent || p.page === 1) starts.set(p.page, p.name?.trim().slice(0, 80) || starts.get(p.page) || null);
    }
  }
  return starts;
}

/** Cuts the PDF at the given start pages. */
export async function cutPdf(pdf: Buffer, startPages: number[], baseName: string, names: Map<number, string | null> = new Map()): Promise<ClassPiece[]> {
  const src = await PDFDocument.load(pdf, { ignoreEncryption: true });
  const total = src.getPageCount();
  const starts = [...new Set(startPages.filter((p) => p >= 1 && p <= total))].sort((a, b) => a - b);
  if (starts[0] !== 1) starts.unshift(1);
  const pieces: ClassPiece[] = [];
  for (let i = 0; i < starts.length; i++) {
    const from = starts[i];
    const to = (starts[i + 1] ?? total + 1) - 1;
    const doc = await PDFDocument.create();
    const copied = await doc.copyPages(src, Array.from({ length: to - from + 1 }, (_, k) => from - 1 + k));
    for (const pg of copied) doc.addPage(pg);
    // "student 3" in the name gives the script a fallback id (STUDENT3); the name written on the paper replaces it.
    pieces.push({ name: `student ${i + 1} - ${baseName}.pdf`, buffer: Buffer.from(await doc.save()), pages: to - from + 1, firstPage: from, writtenName: names.get(from) ?? null });
  }
  return pieces;
}

/** Splits a class PDF: every `pagesPerStudent` pages when given, otherwise where the AI sees a new student start. */
export async function splitClassPdf(pdf: Buffer, fileName: string, opts: { pagesPerStudent?: number; ai?: { adapter: ProviderAdapter; model: string }; signal?: AbortSignal }): Promise<ClassPiece[]> {
  const base = fileName.replace(/\.pdf$/i, '').slice(0, 60) || 'class';
  const total = (await PDFDocument.load(pdf, { ignoreEncryption: true })).getPageCount();
  if (total > MAX_CLASS_PAGES) throw new Error(`${fileName} has ${total} pages; at most ${MAX_CLASS_PAGES} can be marked in one job.`);
  if (opts.pagesPerStudent && opts.pagesPerStudent > 0) {
    const n = Math.floor(opts.pagesPerStudent);
    return cutPdf(pdf, Array.from({ length: Math.ceil(total / n) }, (_, i) => i * n + 1), base);
  }
  if (!opts.ai) throw new Error('Say how many pages each student has (for example "4 pages per student") so the file can be split.');
  const { pages } = await loadPages(pdf, fileName, { maxPages: MAX_CLASS_PAGES, pdfScale: 1 });
  const starts = await detectStarts(opts.ai.adapter, opts.ai.model, pages.map((p) => p.image), opts.signal);
  return cutPdf(pdf, [...starts.keys()], base, starts);
}

/** "4 pages per student", "each student has 3 pages", "2 pages each". */
export function pagesPerStudentFrom(text: string): number | undefined {
  const m = /\b(\d{1,2})\s*pages?\s*(?:per|for each|each|a)\s*(?:student|learner|candidate|script|paper|pupil)?\b/i.exec(text)
    ?? /\beach\s+(?:student|learner|candidate|script|paper|pupil)\s+(?:has|is|wrote)\s+(\d{1,2})\s*pages?\b/i.exec(text);
  const n = m ? Number(m[1]) : NaN;
  return n >= 1 && n <= 40 ? n : undefined;
}
