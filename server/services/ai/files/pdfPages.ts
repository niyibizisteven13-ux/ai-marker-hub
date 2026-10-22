import { PDFParse } from 'pdf-parse';
import sharp from 'sharp';

/**
 * Renders PDF pages to JPEG images for vision models: scans and handwriting have no text layer, so the
 * model has to look at the pages. Long side capped at 1568 px (what Claude reads at full detail),
 * JPEG keeps each page well under provider image limits.
 */
export async function renderPdfPages(data: Buffer, opts: { maxPages?: number; maxSide?: number } = {}): Promise<{ total: number; pages: Buffer[] }> {
  const maxPages = opts.maxPages ?? 8;
  const maxSide = opts.maxSide ?? 1568;
  const parser = new PDFParse({ data: new Uint8Array(data) });
  try {
    const info = await parser.getInfo();
    const total = info.total;
    const wanted = Array.from({ length: Math.min(total, maxPages) }, (_, i) => i + 1);
    if (!wanted.length) return { total, pages: [] };
    const shot = await parser.getScreenshot({ partial: wanted, scale: 2, imageBuffer: true, imageDataUrl: false });
    const pages: Buffer[] = [];
    for (const p of shot.pages) {
      if (!p.data) continue;
      pages.push(await sharp(Buffer.from(p.data)).flatten({ background: '#ffffff' }).resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer());
    }
    return { total, pages };
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}
