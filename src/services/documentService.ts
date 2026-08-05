import path from 'path';
import fs from 'fs/promises';
import { createReadStream, existsSync } from 'fs';
import { Response } from 'express';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import Tesseract from 'tesseract.js';
import { parse as parseCsv } from 'csv-parse/sync';

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

  switch (fileType) {
    case 'pdf':
      return extractFromPdf(filePath, warnings);
    case 'docx':
      return extractFromDocx(filePath, warnings);
    case 'image':
      return extractFromImage(filePath, warnings);
    case 'csv':
      return extractFromCsv(filePath, warnings);
    case 'txt':
      return extractFromTxt(filePath, warnings);
    default:
      throw new Error(
        `Unsupported file type for "${originalFilename}" (detected: ${fileType}). ` +
          `Supported types: PDF, DOCX, image (PNG/JPG/WEBP), TXT, CSV.`,
      );
  }
}

export interface DownloadOptions {
  filename?: string;
  inline?: boolean;
}

export async function streamFileToResponse(
  filePath: string,
  res: Response,
  options: DownloadOptions = {},
): Promise<void> {
  if (!existsSync(filePath)) {
    throw new Error(`File not found at path: ${filePath}`);
  }

  const filename = options.filename || path.basename(filePath);
  const fileType = detectFileType(filename);
  const mimeType = MIME_MAP[fileType] || 'application/octet-stream';
  const dispositionType = options.inline ? 'inline' : 'attachment';
  const safeFilename = encodeURIComponent(filename);

  res.setHeader('Content-Type', mimeType);
  res.setHeader(
    'Content-Disposition',
    `${dispositionType}; filename="${filename}"; filename*=UTF-8''${safeFilename}`,
  );

  const stat = await fs.stat(filePath);
  res.setHeader('Content-Length', stat.size);

  const readStream = createReadStream(filePath);
  readStream.pipe(res);
}

export function sendBufferDownload(
  res: Response,
  buffer: Buffer | string,
  downloadFilename: string,
  mimeType: string = 'text/plain',
): void {
  const safeFilename = encodeURIComponent(downloadFilename);
  const dataBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer, 'utf-8');

  res.setHeader('Content-Type', mimeType);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${downloadFilename}"; filename*=UTF-8''${safeFilename}`,
  );
  res.setHeader('Content-Length', dataBuffer.length);
  res.send(dataBuffer);
}

async function extractFromPdf(filePath: string, warnings: string[]): Promise<ExtractionResult> {
  const buffer = await fs.readFile(filePath);
  const pdf = new PDFParse({ data: buffer as Uint8Array });
  const parsed = await pdf.getText();
  let rawText = parsed.text.trim();

  if (rawText.length < 20) {
    warnings.push(
      'PDF text layer was empty or near-empty — this looks like a scanned document. Used OCR instead.',
    );
    rawText = await ocrScannedPdf(filePath);
  }

  return { rawText, fileType: 'pdf', warnings };
}

async function extractFromDocx(filePath: string, warnings: string[]): Promise<ExtractionResult> {
  const buffer = await fs.readFile(filePath);
  const result = await mammoth.extractRawText({ buffer });

  if (result.messages.length > 0) {
    warnings.push(...result.messages.map((m) => m.message));
  }

  return { rawText: result.value.trim(), fileType: 'docx', warnings };
}

async function extractFromImage(filePath: string, warnings: string[]): Promise<ExtractionResult> {
  const rawText = await ocrImage(filePath);

  if (rawText.trim().length < 10) {
    warnings.push('OCR returned very little text — the image may be low quality, rotated, or blank.');
  }

  return { rawText, fileType: 'image', warnings };
}

async function extractFromCsv(filePath: string, warnings: string[]): Promise<ExtractionResult> {
  const content = await fs.readFile(filePath, 'utf-8');
  const records: string[][] = parseCsv(content, { columns: false, skip_empty_lines: true });
  const rawText = records.map((row) => row.join(' | ')).join('\n');

  return { rawText, fileType: 'csv', warnings };
}

async function extractFromTxt(filePath: string, warnings: string[]): Promise<ExtractionResult> {
  const rawText = (await fs.readFile(filePath, 'utf-8')).trim();
  return { rawText, fileType: 'txt', warnings };
}

async function ocrImage(filePath: string): Promise<string> {
  const { data } = await Tesseract.recognize(filePath, 'eng');
  return data.text.trim();
}

async function ocrScannedPdf(filePath: string): Promise<string> {
  throw new Error(
    `OCR fallback for scanned PDFs is not wired up yet for "${filePath}".`,
  );
}
