import { PDFParse } from 'pdf-parse';
import sharp, { type Metadata } from 'sharp';

/** Turns an upload (image or PDF) into page images, keeping any real PDF text layer per page. */

export interface SourcePage {
  page: number;
  image: Buffer;
  /** Text from the PDF's own text layer (born-digital pages). Empty for scans and images. */
  textLayer: string;
}

export class DocumentInputError extends Error {
  constructor(public code: 'UNSUPPORTED_FORMAT' | 'TOO_MANY_PAGES' | 'TOO_LARGE' | 'UNREADABLE', message: string) {
    super(message);
  }
}

const IMAGE_FORMATS = new Set(['jpeg', 'png', 'webp', 'tiff', 'gif', 'heif']);

export async function loadPages(data: Buffer, filename: string, opts: { maxPages?: number; pdfScale?: number } = {}): Promise<{ pages: SourcePage[]; format: 'pdf' | 'image'; totalPages: number }> {
  const maxPages = opts.maxPages ?? 20;
  const isPdf = data.subarray(0, 5).toString('latin1') === '%PDF-';
  if (isPdf) {
    const parser = new PDFParse({ data: new Uint8Array(data) });
    try {
      const text = await parser.getText({ first: maxPages });
      if (text.total > maxPages) throw new DocumentInputError('TOO_MANY_PAGES', `The PDF has ${text.total} pages; at most ${maxPages} can be processed in one job. Split it into smaller files.`);
      // ~180 DPI for A4: enough for handwriting while keeping images within model limits.
      const shots = await parser.getScreenshot({ scale: opts.pdfScale ?? 2.5, first: maxPages, imageBuffer: true, imageDataUrl: false });
      const byNum = new Map(text.pages.map((p) => [p.num, p.text]));
      return {
        format: 'pdf', totalPages: text.total,
        pages: shots.pages.map((s) => ({ page: s.pageNumber, image: Buffer.from(s.data), textLayer: (byNum.get(s.pageNumber) ?? '').trim() })),
      };
    } catch (e) {
      if (e instanceof DocumentInputError) throw e;
      throw new DocumentInputError('UNREADABLE', 'The PDF could not be opened (it may be damaged or password-protected).');
    } finally {
      await parser.destroy().catch(() => {});
    }
  }
  let meta: Metadata;
  try {
    meta = await sharp(data, { limitInputPixels: 80_000_000 }).metadata();
  } catch {
    throw new DocumentInputError('UNSUPPORTED_FORMAT', 'Upload a PDF or an image (JPEG, PNG, WebP, TIFF).');
  }
  if (!meta.format || !IMAGE_FORMATS.has(meta.format)) throw new DocumentInputError('UNSUPPORTED_FORMAT', 'Upload a PDF or an image (JPEG, PNG, WebP, TIFF).');
  const n = meta.pages && meta.format === 'tiff' ? meta.pages : 1;
  if (n > maxPages) throw new DocumentInputError('TOO_MANY_PAGES', `The image has ${n} pages; at most ${maxPages} can be processed in one job.`);
  const pages: SourcePage[] = [];
  for (let i = 0; i < n; i++) pages.push({ page: i + 1, image: n > 1 ? await sharp(data, { page: i }).png().toBuffer() : data, textLayer: '' });
  return { format: 'image', totalPages: n, pages };
}
