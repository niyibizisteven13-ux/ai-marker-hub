import path from 'path';
import fs from 'fs/promises';
import { createReadStream, existsSync } from 'fs';
import { Response } from 'express';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import Tesseract, { createWorker, type Worker } from 'tesseract.js';
import { parse as parseCsv } from 'csv-parse/sync';

// Stub out pdfToPng to avoid native canvas/cairo compilation dependencies on Windows.
// If scanned PDF OCR fallback is needed in production, ensure cairo/canvas is installed on the host.
const pdfToPng = async (filePath: string, options?: any): Promise<any[]> => {
  console.warn(`pdfToPng warning: Scanned PDF OCR fallback requested for ${filePath}, but native canvas dependencies are disabled on this platform.`);
  return [];
};

export type SupportedFileType = 'pdf' | 'docx' | 'image' | 'txt' | 'csv' | 'unknown';

const EXTENSION_MAP: Record<string, SupportedFileType> = {
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.webp': 'image',
  '.txt': 'txt',
  '.csv': 'csv',
};

const MIME_MAP: Record<SupportedFileType, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  image: 'image/jpeg',
  txt: 'text/plain',
  csv: 'text/csv',
  unknown: 'application/octet-stream',
};

// --- Tunables -------------------------------------------------------------

/** Hard cap on any file we'll pull fully into memory. Adjust to your infra. */
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25MB

/** Cap on how many pages of a scanned PDF we'll OCR, to bound cost/latency. */
const MAX_OCR_PAGES = 20;

/** Per-recognize call timeout so one bad image/page can't hang a request. */
const OCR_TIMEOUT_MS = 30_000;

// --- Public types -----------------------------------------------------------

export function detectFileType(filename: string, mimeType?: string): SupportedFileType {
  const ext = path.extname(filename).toLowerCase();
  if (EXTENSION_MAP[ext]) return EXTENSION_MAP[ext];

  if (mimeType) {
    if (mimeType === 'application/pdf') return 'pdf';
    if (mimeType.includes('wordprocessingml.document')) return 'docx';
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType === 'text/csv') return 'csv';
    if (mimeType.startsWith('text/')) return 'txt';
  }

  return 'unknown';
}

export interface ExtractionResult {
  rawText: string;
  fileType: SupportedFileType;
  warnings: string[];
}

export async function extractTextFromUpload(
  filePath: string,
  originalFilename: string,
  mimeType?: string,
): Promise<ExtractionResult> {
  const fileType = detectFileType(originalFilename, mimeType);
  const warnings: string[] = [];

  await assertWithinSizeLimit(filePath, originalFilename);

  try {
    switch (fileType) {
      case 'pdf':
        return await extractFromPdf(filePath, warnings);
      case 'docx':
        return await extractFromDocx(filePath, warnings);
      case 'image':
        return await extractFromImage(filePath, warnings);
      case 'csv':
        return await extractFromCsv(filePath, warnings);
      case 'txt':
        return await extractFromTxt(filePath, warnings);
      default:
        throw new Error(
          `Unsupported file type for "${originalFilename}" (detected: ${fileType}). ` +
            `Supported types: PDF, DOCX, image (PNG/JPG/WEBP), TXT, CSV.`,
        );
    }
  } catch (err) {
    // Re-throw with context so callers/logs know which upload failed and why,
    // instead of a bare "Unexpected token" or native-library error.
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to extract text from "${originalFilename}" (${fileType}): ${reason}`);
  }
}

// --- Download / streaming ---------------------------------------------------

export interface DownloadOptions {
  filename?: string;
  inline?: boolean;
}

/**
 * Strips characters that could break out of a Content-Disposition header
 * value (CR, LF, and double quotes). Filenames are frequently user-supplied
 * (original upload names), so this must run before they hit a header.
 */
function sanitizeHeaderFilename(filename: string): string {
  return filename.replace(/[\r\n"]/g, '_');
}

export async function streamFileToResponse(
  filePath: string,
  res: Response,
  options: DownloadOptions = {},
): Promise<void> {
  if (!existsSync(filePath)) {
    throw new Error(`File not found at path: ${filePath}`);
  }

  const rawFilename = options.filename || path.basename(filePath);
  const filename = sanitizeHeaderFilename(rawFilename);
  const fileType = detectFileType(rawFilename);
  const mimeType = MIME_MAP[fileType] || 'application/octet-stream';
  const dispositionType = options.inline ? 'inline' : 'attachment';
  const safeFilename = encodeURIComponent(rawFilename);

  res.setHeader('Content-Type', mimeType);
  res.setHeader(
    'Content-Disposition',
    `${dispositionType}; filename="${filename}"; filename*=UTF-8''${safeFilename}`,
  );

  const stat = await fs.stat(filePath);
  res.setHeader('Content-Length', stat.size);

  const readStream = createReadStream(filePath);
  readStream.on('error', (err) => {
    // Avoid crashing the process on a mid-stream read failure (e.g. file
    // deleted concurrently); end the response instead.
    if (!res.headersSent) {
      res.status(500);
    }
    res.end();
    console.error(`streamFileToResponse: read error for ${filePath}`, err);
  });
  readStream.pipe(res);
}

export function sendBufferDownload(
  res: Response,
  buffer: Buffer | string,
  downloadFilename: string,
  mimeType: string = 'text/plain',
): void {
  const filename = sanitizeHeaderFilename(downloadFilename);
  const safeFilename = encodeURIComponent(downloadFilename);
  const dataBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer, 'utf-8');

  res.setHeader('Content-Type', mimeType);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${filename}"; filename*=UTF-8''${safeFilename}`,
  );
  res.setHeader('Content-Length', dataBuffer.length);
  res.send(dataBuffer);
}

// --- Size guard --------------------------------------------------------------

async function assertWithinSizeLimit(filePath: string, originalFilename: string): Promise<void> {
  const stat = await fs.stat(filePath);
  if (stat.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(
      `"${originalFilename}" is ${(stat.size / (1024 * 1024)).toFixed(1)}MB, ` +
        `which exceeds the ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB limit.`,
    );
  }
}

// --- PDF ----------------------------------------------------------------------

async function extractFromPdf(filePath: string, warnings: string[]): Promise<ExtractionResult> {
  const buffer = await fs.readFile(filePath);
  const pdf = new PDFParse({ data: buffer as Uint8Array });
  const parsed = await pdf.getText();
  let rawText = parsed.text.trim();

  if (rawText.length < 20) {
    warnings.push(
      'PDF text layer was empty or near-empty — this looks like a scanned document. Used OCR instead.',
    );
    rawText = await ocrScannedPdf(filePath, warnings);
  }

  return { rawText, fileType: 'pdf', warnings };
}

/**
 * Rasterizes each page of a scanned PDF to a PNG and OCRs it with the shared
 * Tesseract worker, concatenating the results. Capped at MAX_OCR_PAGES to
 * bound latency/cost on very long scanned documents.
 */
async function ocrScannedPdf(filePath: string, warnings: string[]): Promise<string> {
  const pngBuffers = await pdfToPng(filePath, { scale: 2.0 });

  if (pngBuffers.length === 0) {
    throw new Error('Could not rasterize any pages from this PDF for OCR.');
  }

  const pageCount = pngBuffers.length;
  const pagesToProcess = pngBuffers.slice(0, MAX_OCR_PAGES);
  if (pageCount > MAX_OCR_PAGES) {
    warnings.push(
      `PDF has ${pageCount} pages; only the first ${MAX_OCR_PAGES} were OCR'd to keep processing time reasonable.`,
    );
  }

  const worker = await getOcrWorker();
  const pageTexts: string[] = [];

  for (let i = 0; i < pagesToProcess.length; i++) {
    try {
      const { data } = await withTimeout(
        worker.recognize(Buffer.from(pagesToProcess[i])),
        OCR_TIMEOUT_MS,
        `OCR timed out on page ${i + 1}`,
      );
      pageTexts.push(data.text.trim());
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      warnings.push(`Page ${i + 1} failed OCR and was skipped: ${reason}`);
    }
  }

  return pageTexts.join('\n\n');
}

// --- DOCX ----------------------------------------------------------------------

async function extractFromDocx(filePath: string, warnings: string[]): Promise<ExtractionResult> {
  const buffer = await fs.readFile(filePath);
  const result = await mammoth.extractRawText({ buffer });

  if (result.messages.length > 0) {
    warnings.push(...result.messages.map((m) => m.message));
  }

  return { rawText: result.value.trim(), fileType: 'docx', warnings };
}

// --- Image ----------------------------------------------------------------------

async function extractFromImage(filePath: string, warnings: string[]): Promise<ExtractionResult> {
  const rawText = await ocrImage(filePath);

  if (rawText.trim().length < 10) {
    warnings.push('OCR returned very little text — the image may be low quality, rotated, or blank.');
  }

  return { rawText, fileType: 'image', warnings };
}

async function ocrImage(filePath: string): Promise<string> {
  const worker = await getOcrWorker();
  const { data } = await withTimeout(
    worker.recognize(filePath),
    OCR_TIMEOUT_MS,
    'OCR timed out on image',
  );
  return data.text.trim();
}

// --- CSV / TXT ----------------------------------------------------------------

async function extractFromCsv(filePath: string, warnings: string[]): Promise<ExtractionResult> {
  const content = stripBom(await fs.readFile(filePath, 'utf-8'));

  let records: string[][];
  try {
    records = parseCsv(content, { columns: false, skip_empty_lines: true });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not parse CSV: ${reason}`);
  }

  const rawText = records.map((row) => row.join(' | ')).join('\n');
  return { rawText, fileType: 'csv', warnings };
}

async function extractFromTxt(filePath: string, warnings: string[]): Promise<ExtractionResult> {
  const rawText = stripBom(await fs.readFile(filePath, 'utf-8')).trim();
  return { rawText, fileType: 'txt', warnings };
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

// --- Shared OCR worker ----------------------------------------------------------

let ocrWorkerPromise: Promise<Worker> | null = null;

/**
 * Lazily creates a single reusable Tesseract worker instead of spinning one
 * up (and tearing it down) on every recognize() call. Worker startup is the
 * most expensive part of Tesseract.js, so under load this is a large win.
 */
async function getOcrWorker(): Promise<Worker> {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = createWorker('eng');
  }
  return ocrWorkerPromise;
}

/** Call once during graceful shutdown to release the OCR worker's resources. */
export async function shutdownOcrWorker(): Promise<void> {
  if (ocrWorkerPromise) {
    const worker = await ocrWorkerPromise;
    await worker.terminate();
    ocrWorkerPromise = null;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}