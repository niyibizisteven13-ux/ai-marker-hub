import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import logger from '../utils/logger.js';

export interface IngestedDocument {
  // Claude natively accepts these two as file blocks (base64) — everything
  // else must be converted to plain text before it reaches the model.
  mode: 'native_file' | 'extracted_text';
  type?: 'image' | 'document'; // only set when mode === 'native_file'
  base64?: string;
  mediaType?: string;
  text?: string; // set when mode === 'extracted_text'
  sourceFileName: string;
  warning?: string; // surfaced to the model/user when extraction is lossy
}

const MAX_EXTRACTED_CHARS = 400_000; // ~100K tokens of headroom, leaves room for the rest of the conversation

export async function ingestDocument(buffer: Buffer, mimeType: string, fileName: string): Promise<IngestedDocument> {
  // --- Types Claude accepts natively — no extraction needed ---
  if (mimeType.startsWith('image/')) {
    return { mode: 'native_file', type: 'image', base64: buffer.toString('base64'), mediaType: mimeType, sourceFileName: fileName };
  }
  if (mimeType === 'application/pdf') {
    return { mode: 'native_file', type: 'document', base64: buffer.toString('base64'), mediaType: mimeType, sourceFileName: fileName };
  }

  // --- Everything else: extract to plain text first ---
  try {
    switch (mimeType) {
      case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
        const result = await mammoth.extractRawText({ buffer });
        return truncateWithWarning(result.value, fileName);
      }

      case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      case 'application/vnd.ms-excel': {
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const sheets = workbook.SheetNames.map(name => {
          const sheet = workbook.Sheets[name];
          const csv = XLSX.utils.sheet_to_csv(sheet);
          return `## Sheet: ${name}\n${csv}`;
        });
        return truncateWithWarning(sheets.join('\n\n'), fileName);
      }

      case 'text/csv': {
        const parsed = Papa.parse(buffer.toString('utf-8'), { header: true });
        const asMarkdownTable = jsonToMarkdownTable(parsed.data as any[]);
        return truncateWithWarning(asMarkdownTable, fileName);
      }

      case 'text/plain':
      case 'text/markdown': {
        return truncateWithWarning(buffer.toString('utf-8'), fileName);
      }

      default:
        return {
          mode: 'extracted_text',
          text: '',
          sourceFileName: fileName,
          warning: `Unsupported file type (${mimeType}) — could not extract content from ${fileName}.`,
        };
    }
  } catch (err: any) {
    logger.error('Document ingestion failed', { fileName, mimeType, error: err.message });
    return {
      mode: 'extracted_text',
      text: '',
      sourceFileName: fileName,
      warning: `Failed to extract content from ${fileName}: ${err.message}`,
    };
  }
}

function truncateWithWarning(text: string, fileName: string): IngestedDocument {
  if (text.length > MAX_EXTRACTED_CHARS) {
    return {
      mode: 'extracted_text',
      text: text.slice(0, MAX_EXTRACTED_CHARS),
      sourceFileName: fileName,
      warning: `${fileName} was truncated — it exceeded the size this assistant can process in one request (showing the first portion only).`,
    };
  }
  return { mode: 'extracted_text', text, sourceFileName: fileName };
}

function jsonToMarkdownTable(rows: any[]): string {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const headerLine = `| ${headers.join(' | ')} |`;
  const separatorLine = `| ${headers.map(() => '---').join(' | ')} |`;
  const dataLines = rows.map(row => `| ${headers.map(h => row[h] ?? '').join(' | ')} |`);
  return [headerLine, separatorLine, ...dataLines].join('\n');
}
