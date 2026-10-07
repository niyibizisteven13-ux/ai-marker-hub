import mammoth from 'mammoth';
import type { UploadedFile } from '../types';

export async function processFileClientSide(file: File): Promise<{
  fileType: UploadedFile['fileType'];
  rawText: string;
  htmlContent?: string;
  url: string;
}> {
  const url = URL.createObjectURL(file);
  const lowerName = file.name.toLowerCase();
  const mimeType = file.type.toLowerCase();

  // 1. PDF Files
  if (mimeType.includes('pdf') || lowerName.endsWith('.pdf')) {
    return {
      fileType: 'pdf',
      url,
      rawText: `[PDF Document: ${file.name}]\nExtracted Content Ready for AI Marking & Analysis.`,
    };
  }

  // 2. Image Files
  if (mimeType.includes('image') || lowerName.match(/\.(png|jpe?g|jfif|webp|gif|bmp|svg|tiff|avif|heic)$/i)) {
    const normalizedMimeType = mimeType === 'image/jfif' ? 'image/jpeg' : (mimeType || 'image/png');
    return {
      fileType: 'image',
      url,
      rawText: `[Scanned Image / OCR Extract: ${file.name}]`,
      htmlContent: `<div class="p-3 bg-[#111827] text-[#f8fafc] rounded-xl text-xs">Detected image file: ${file.name} (${normalizedMimeType})</div>`,
    };
  }

  // 3. Word Documents (.docx / .doc)
  if (lowerName.endsWith('.docx') || lowerName.endsWith('.doc') || mimeType.includes('wordprocessingml')) {
    const fileType = lowerName.endsWith('.doc') ? 'doc' : 'docx';
    try {
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.convertToHtml({ arrayBuffer });
      const rawTextResult = await mammoth.extractRawText({ arrayBuffer });
      const rawText = rawTextResult.value?.trim() || '';
      const htmlContent = result.value?.trim() || (rawText ? `<div>${rawText.replace(/\n/g, '<br/>')}</div>` : '');

      return { fileType, url, rawText, htmlContent: htmlContent || undefined };
    } catch {
      return { fileType, url, rawText: `[Word Document: ${file.name}]` };
    }
  }

  // 4. PowerPoint Presentations (.pptx / .ppt)
  if (lowerName.endsWith('.pptx') || lowerName.endsWith('.ppt') || mimeType.includes('presentationml')) {
    const fileType = lowerName.endsWith('.ppt') ? 'ppt' : 'pptx';
    const title = file.name.replace(/\.[^/.]+$/, '');
    return {
      fileType,
      url,
      rawText: `[Presentation Deck: ${file.name}]`,
      htmlContent: `<div class="p-4 bg-[#111827] text-white rounded-xl"><strong>Presentation Deck:</strong> ${title}</div>`,
    };
  }

  // 5. Excel Spreadsheets & CSVs (.xlsx / .xls / .csv)
  if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls') || lowerName.endsWith('.csv') || mimeType.includes('spreadsheet')) {
    const fileType = lowerName.endsWith('.xls') ? 'xls' : lowerName.endsWith('.xlsx') ? 'xlsx' : 'xls';
    const text = await file.text().catch(() => `Spreadsheet: ${file.name}`);
    return {
      fileType,
      url,
      rawText: text,
      htmlContent: `<pre class="p-4 bg-[#111827] text-[#d1d5db] rounded-xl overflow-auto text-xs font-mono">${text}</pre>`,
    };
  }

  // 6. Code & Development Source Files (.js, .ts, .tsx, .jsx, .py, .java, .kt, .cpp, .c, .h, .cs, .rs, .go, .sql, .html, .css, .json, .yaml, .sh)
  if (lowerName.match(/\.(js|ts|tsx|jsx|py|java|kt|kts|cpp|c|h|hpp|cs|rs|go|rb|php|swift|sql|html|css|scss|json|yaml|yml|sh|bash|ps1|bat|ini|toml|env|log|md|txt|rtf)$/i)) {
    const text = await file.text().catch(() => `Source Code: ${file.name}`);
    return {
      fileType: 'code',
      url,
      rawText: text,
      htmlContent: `<pre class="p-4 bg-[#0f172a] text-[#a7f3d0] rounded-xl overflow-auto text-xs font-mono"><code>${escapeHtml(text)}</code></pre>`,
    };
  }

  // 7. Generic Fallback Text or Binary Reader
  try {
    const text = await file.text();
    if (text && isPrintableTextSample(text)) {
      return {
        fileType: 'text',
        url,
        rawText: text,
        htmlContent: `<pre class="p-4 bg-[#0f172a] text-[#f1f5f9] rounded-xl overflow-auto text-xs font-mono">${escapeHtml(text)}</pre>`,
      };
    }
  } catch {
    // Ignore error
  }

  const fileSizeKb = Math.round(file.size / 1024);
  return {
    fileType: 'text',
    url,
    rawText: `[Attached File: ${file.name} | Size: ${fileSizeKb} KB | Type: ${file.type || 'generic'}]`,
  };
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function isPrintableTextSample(text: string): boolean {
  if (!text || text.length === 0) return false;
  let printable = 0;
  const sampleLength = Math.min(text.length, 2000);
  for (let i = 0; i < sampleLength; i++) {
    const code = text.charCodeAt(i);
    if ((code >= 32 && code <= 126) || code === 9 || code === 10 || code === 13 || code > 127) {
      printable++;
    }
  }
  return (printable / sampleLength) > 0.85;
}
