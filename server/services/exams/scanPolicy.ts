import { PDFParse } from 'pdf-parse';
import { isImage, isPdf } from './inputs.js';
import type { UploadFile } from './service.js';

export const SCANNED_PAPER_MESSAGE = 'AI grading accepts typed answers and text-based PDFs. Scanned papers can be submitted as files and marked by your teacher.';

/** Check the PDF text layer locally, before any OCR, visual splitting or grading. */
export async function needsScanRecognition(file: UploadFile): Promise<boolean> {
  if (!isPdf(file)) return isImage(file);
  const parser = new PDFParse({ data: new Uint8Array(file.buffer) });
  try {
    const { pages } = await parser.getText();
    return !pages.length || pages.some(page => !page.text.trim());
  } catch {
    return true;
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}
