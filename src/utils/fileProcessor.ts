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

  let fileType: 'pdf' | 'image' | 'docx' | 'doc' | 'pptx' | 'ppt' | 'xlsx' | 'xls' | 'code' | 'text' = 'text';

  // PDF Files
  if (mimeType.includes('pdf') || lowerName.endsWith('.pdf')) {
    fileType = 'pdf';
    return {
      fileType,
      url,
      rawText: `[PDF Document: ${file.name}]\nExtracted Content Ready for AI Marking & Analysis.`,
    };
  }

  // Image Files
  if (mimeType.includes('image') || lowerName.match(/\.(png|jpe?g|jfif|webp|gif|bmp|svg)$/i)) {
    const normalizedMimeType = mimeType === 'image/jfif' ? 'image/jpeg' : mimeType;
    fileType = 'image';
    return {
      fileType,
      url,
      rawText: `[Scanned Image / OCR Extract: ${file.name}]`,
      htmlContent: `<div class="p-3 bg-[#111827] text-[#f8fafc] rounded-xl text-xs">Detected image file: ${file.name} (${normalizedMimeType})</div>`,
    };
  }

  // Word Documents (.docx / .doc)
  if (lowerName.endsWith('.docx') || lowerName.endsWith('.doc')) {
    fileType = lowerName.endsWith('.docx') ? 'docx' : 'doc';
    try {
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.convertToHtml({ arrayBuffer });
      const rawTextResult = await mammoth.extractRawText({ arrayBuffer });
      const rawText = rawTextResult.value?.trim() || '';
      const htmlContent = result.value?.trim() || (rawText ? `<div>${rawText.replace(/\n/g, '<br/>')}</div>` : '');

      return {
        fileType,
        url,
        rawText,
        htmlContent: htmlContent || undefined,
      };
    } catch {
      return {
        fileType,
        url,
        rawText: `[Word Document: ${file.name}]`,
      };
    }
  }

  // PowerPoint Presentations (.pptx / .ppt)
  if (lowerName.endsWith('.pptx') || lowerName.endsWith('.ppt')) {
    fileType = lowerName.endsWith('.pptx') ? 'pptx' : 'ppt';
    const title = file.name.replace(/\.[^/.]+$/, '');
    return {
      fileType,
      url,
      rawText: `[Presentation Deck: ${file.name}]`,
      htmlContent: `<div class="p-4 bg-[#111827] text-white rounded-xl"><strong>Presentation Deck:</strong> ${title}</div>`,
    };
  }

  // Excel Spreadsheets and CSVs (.xlsx / .xls / .csv)
  if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls') || lowerName.endsWith('.csv')) {
    fileType = lowerName.endsWith('.xlsx') ? 'xlsx' : lowerName.endsWith('.xls') ? 'xls' : 'xls';
    const text = await file.text().catch(() => `Spreadsheet: ${file.name}`);
    return {
      fileType,
      url,
      rawText: text,
      htmlContent: `<pre class="p-4 bg-[#111827] text-[#d1d5db] rounded-xl overflow-auto text-xs">${text}</pre>`,
    };
  }

  // Code & text files (.js, .ts, .tsx, .jsx, .py, .json, .html, .css, .md, .txt, .yml, .yaml, .ini, .rs, .go, .cpp, .c, .h)
  if (lowerName.match(/\.(js|ts|tsx|jsx|py|json|html|css|md|txt|yml|yaml|ini|rs|go|cpp|c|h)$/i)) {
    fileType = 'code';
    const text = await file.text().catch(() => `Source Code: ${file.name}`);
    return {
      fileType,
      url,
      rawText: text,
      htmlContent: `<pre class="p-4 bg-[#0f172a] text-[#a7f3d0] rounded-xl overflow-auto text-xs"><code>${text}</code></pre>`,
    };
  }

  // Fallback generic text reader for any other file type
  try {
    const text = await file.text();
    return {
      fileType: 'text',
      url,
      rawText: text || `Content from ${file.name}`,
    };
  } catch {
    return {
      fileType: 'text',
      url,
      rawText: `File: ${file.name} (Binary or unsupported stream)`,
    };
  }
}
