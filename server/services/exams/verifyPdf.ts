import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { renderPdfPages } from '../ai/files/pdfPages.js';

/**
 * Checks a marked PDF before it is offered for download: it must open, have the script's pages plus the
 * summary, carry the candidate, revision and total it was drawn from, and every page must render. When
 * marks were placed on the pages, red ink must actually be visible on them.
 */

export interface MarkedPdfExpectation {
  candidateId: string;
  revision: number;
  /** Pages of the candidate's own script inside the marked PDF. */
  sourcePages: number;
  total: number;
  maxTotal: number;
  /** Marks drawn on the script pages (0 when every mark went to the summary page). */
  placedMarks: number;
}

export interface MarkedPdfCheck { ok: boolean; pages: number; rendered: number; problems: string[] }

const MAX_RENDER_PAGES = 60;

/** Share of reddish pixels in a rendered page (the marking ink is pure red). */
async function redShare(jpeg: Buffer): Promise<number> {
  const { data, info } = await sharp(jpeg).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let red = 0;
  for (let i = 0; i < data.length; i += info.channels) if (data[i] > 150 && data[i + 1] < 90 && data[i + 2] < 90) red++;
  return red / (info.width * info.height);
}

export async function verifyMarkedPdf(pdf: Buffer, expect: MarkedPdfExpectation): Promise<MarkedPdfCheck> {
  const problems: string[] = [];
  let pages: number;
  let keywords: string;
  try {
    const doc = await PDFDocument.load(pdf, { updateMetadata: false });
    pages = doc.getPageCount();
    keywords = doc.getKeywords() ?? '';
  } catch {
    return { ok: false, pages: 0, rendered: 0, problems: ['the file does not open as a PDF'] };
  }
  if (pages < expect.sourcePages + 1) problems.push(`${pages} pages, expected the script's ${expect.sourcePages} plus a summary page`);
  for (const k of [`candidate:${expect.candidateId}`, `revision:${expect.revision}`, `total:${expect.total}/${expect.maxTotal}`]) {
    if (!keywords.includes(k)) problems.push(`missing "${k}" (the PDF does not match the stored marks)`);
  }
  let rendered = 0;
  try {
    const shots = await renderPdfPages(pdf, { maxPages: Math.min(pages, MAX_RENDER_PAGES), maxSide: 500 });
    rendered = shots.pages.length;
    if (rendered < Math.min(pages, MAX_RENDER_PAGES)) problems.push(`only ${rendered} of ${Math.min(pages, MAX_RENDER_PAGES)} pages render`);
    for (const [i, img] of shots.pages.entries()) {
      const stats = await sharp(img).stats();
      if (stats.channels.every((c) => c.stdev < 1)) problems.push(`page ${i + 1} renders blank`);
    }
    if (expect.placedMarks > 0) {
      const shares = await Promise.all(shots.pages.slice(0, expect.sourcePages).map(redShare));
      if (!shares.some((s) => s > 0.00005)) problems.push('marks were placed but no red ink is visible on the script pages');
    }
  } catch (err) {
    problems.push(`the pages could not be rendered (${err instanceof Error ? err.message.slice(0, 80) : 'error'})`);
  }
  return { ok: problems.length === 0, pages, rendered, problems };
}
