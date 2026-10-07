import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import zlib from 'zlib';
import logger from '../utils/logger.js';

export interface IngestedDocument {
  mode: 'native_file' | 'extracted_text';
  type?: 'image' | 'document';
  base64?: string;
  mediaType?: string;
  text?: string;
  sourceFileName: string;
  warning?: string;
}

const MAX_EXTRACTED_CHARS = 400_000;

const CODE_EXTENSIONS: Record<string, string> = {
  js: 'javascript', ts: 'typescript', tsx: 'typescript', jsx: 'javascript',
  py: 'python', java: 'java', kt: 'kotlin', kts: 'kotlin',
  c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp', cs: 'csharp',
  rs: 'rust', go: 'go', rb: 'ruby', php: 'php', swift: 'swift',
  sh: 'bash', bash: 'bash', ps1: 'powershell', bat: 'cmd',
  sql: 'sql', html: 'html', css: 'css', scss: 'scss',
  json: 'json', xml: 'xml', yaml: 'yaml', yml: 'yaml',
  md: 'markdown', txt: 'plaintext', log: 'log', ini: 'ini',
  toml: 'toml', env: 'plaintext', rtf: 'plaintext',
};

export async function ingestDocument(buffer: Buffer, mimeType: string, fileName: string): Promise<IngestedDocument> {
  const lowerName = fileName.toLowerCase();
  const ext = lowerName.split('.').pop() || '';

  // --- Native Vision/Document Models Support (Images & PDFs) ---
  if (mimeType.startsWith('image/')) {
    return { mode: 'native_file', type: 'image', base64: buffer.toString('base64'), mediaType: mimeType, sourceFileName: fileName };
  }
  if (mimeType === 'application/pdf' || ext === 'pdf') {
    return { mode: 'native_file', type: 'document', base64: buffer.toString('base64'), mediaType: 'application/pdf', sourceFileName: fileName };
  }

  try {
    // 1. Word Documents (.docx)
    if (ext === 'docx' || mimeType.includes('wordprocessingml.document')) {
      const result = await mammoth.extractRawText({ buffer });
      return truncateWithWarning(result.value, fileName);
    }

    // 2. Excel Spreadsheets (.xlsx, .xls)
    if (ext === 'xlsx' || ext === 'xls' || mimeType.includes('spreadsheetml') || mimeType.includes('excel')) {
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const sheets = workbook.SheetNames.map(name => {
        const sheet = workbook.Sheets[name];
        const csv = XLSX.utils.sheet_to_csv(sheet);
        return `## Sheet: ${name}\n${csv}`;
      });
      return truncateWithWarning(sheets.join('\n\n'), fileName);
    }

    // 3. CSV Data
    if (ext === 'csv' || mimeType === 'text/csv') {
      const parsed = Papa.parse(buffer.toString('utf-8'), { header: true });
      const asMarkdownTable = jsonToMarkdownTable(parsed.data as any[]);
      const outputText = asMarkdownTable.length > 0 ? asMarkdownTable : buffer.toString('utf-8');
      return truncateWithWarning(outputText, fileName);
    }

    // 4. Source Code & Development Scripts
    if (CODE_EXTENSIONS[ext] || isSourceCodeMime(mimeType)) {
      const lang = CODE_EXTENSIONS[ext] || 'plaintext';
      const codeText = buffer.toString('utf-8');
      const formattedCode = `\`\`\`${lang}\n// File: ${fileName}\n${codeText}\n\`\`\``;
      return truncateWithWarning(formattedCode, fileName);
    }

    // 5. PowerPoint & OpenDocument XML Archives (.pptx, .odt, .ods, .odp)
    if (['pptx', 'odt', 'ods', 'odp'].includes(ext) || mimeType.includes('presentationml') || mimeType.includes('opendocument')) {
      const extractedText = extractXmlArchiveText(buffer, ext);
      if (extractedText && extractedText.length > 20) {
        return truncateWithWarning(`[Extracted from ${fileName}]\n\n${extractedText}`, fileName);
      }
    }

    // 6. ZIP Archives (.zip)
    if (ext === 'zip' || mimeType.includes('zip')) {
      const zipSummary = inspectZipArchive(buffer, fileName);
      return truncateWithWarning(zipSummary, fileName);
    }

    // 7. Universal Text Fallback (Checks if UTF-8 string is non-binary printable)
    const textContent = buffer.toString('utf-8');
    if (isPrintableText(textContent)) {
      return truncateWithWarning(textContent, fileName);
    }

    // 8. Non-Text Binary File Fallback Metadata Summary
    const fileSizeKb = Math.round(buffer.length / 1024);
    const summary = `[Attached File: ${fileName} | Size: ${fileSizeKb} KB | MIME: ${mimeType || 'application/octet-stream'}]\nNote: This is a non-text binary file. The file details are available for reference.`;
    return {
      mode: 'extracted_text',
      text: summary,
      sourceFileName: fileName,
      warning: `${fileName} is a binary file. A metadata summary was provided to the AI model.`,
    };

  } catch (err: any) {
    logger.error('Document ingestion failed', { fileName, mimeType, error: err.message });
    return {
      mode: 'extracted_text',
      text: `[File Attachment: ${fileName}]\nFailed to process content: ${err.message}`,
      sourceFileName: fileName,
      warning: `Failed to extract full content from ${fileName}: ${err.message}`,
    };
  }
}

function truncateWithWarning(text: string, fileName: string): IngestedDocument {
  if (text.length > MAX_EXTRACTED_CHARS) {
    return {
      mode: 'extracted_text',
      text: text.slice(0, MAX_EXTRACTED_CHARS),
      sourceFileName: fileName,
      warning: `${fileName} was truncated — it exceeded the size limit (showing the first ${Math.round(MAX_EXTRACTED_CHARS / 1000)}K chars).`,
    };
  }
  return { mode: 'extracted_text', text, sourceFileName: fileName };
}

function jsonToMarkdownTable(rows: any[]): string {
  if (!rows || !rows.length || typeof rows[0] !== 'object') return '';
  const headers = Object.keys(rows[0]);
  if (!headers.length) return '';
  const headerLine = `| ${headers.join(' | ')} |`;
  const separatorLine = `| ${headers.map(() => '---').join(' | ')} |`;
  const dataLines = rows.map(row => `| ${headers.map(h => row[h] ?? '').join(' | ')} |`);
  return [headerLine, separatorLine, ...dataLines].join('\n');
}

function isSourceCodeMime(mimeType: string): boolean {
  if (!mimeType) return false;
  return (
    mimeType.startsWith('text/') ||
    mimeType.includes('javascript') ||
    mimeType.includes('typescript') ||
    mimeType.includes('json') ||
    mimeType.includes('xml') ||
    mimeType.includes('sh')
  );
}

function isPrintableText(text: string): boolean {
  if (!text || text.length === 0) return false;
  let printableCount = 0;
  const sampleLength = Math.min(text.length, 4000);
  for (let i = 0; i < sampleLength; i++) {
    const code = text.charCodeAt(i);
    if ((code >= 32 && code <= 126) || code === 9 || code === 10 || code === 13 || code > 127) {
      printableCount++;
    }
  }
  return (printableCount / sampleLength) > 0.85;
}

function extractXmlArchiveText(buffer: Buffer, ext: string): string {
  try {
    const rawString = buffer.toString('latin1');
    const matches: string[] = [];
    const textRegex = /<[a-z0-9]+:t[^>]*>(.*?)<\/[a-z0-9]+:t>/gi;
    let match;
    while ((match = textRegex.exec(rawString)) !== null) {
      if (match[1] && match[1].trim().length > 0) {
        matches.push(match[1].trim());
      }
    }
    return matches.join('\n');
  } catch {
    return '';
  }
}

function inspectZipArchive(buffer: Buffer, fileName: string): string {
  try {
    const fileSizeKb = Math.round(buffer.length / 1024);
    return `[ZIP Archive: ${fileName} | Size: ${fileSizeKb} KB]\nArchive containing compressed files. The model can process individual unzipped files if uploaded separately.`;
  } catch {
    return `[ZIP Archive: ${fileName}]`;
  }
}
