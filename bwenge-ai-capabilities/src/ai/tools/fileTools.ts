import { generateDocx } from '../files/generators/docx.js';
import { generatePdf } from '../files/generators/pdf.js';
import { generateHtml, generateMarkdown } from '../files/generators/html-md.js';
import { generatePptx } from '../files/generators/pptx.js';
import { generateXlsx, type WorkbookSpec } from '../files/generators/xlsx.js';
import { generateCsv, generateTextFile, generateZip } from '../files/generators/simple.js';
import type { Block, DocumentSpec } from '../files/generators/spec.js';
import { MIME, TEXT_EXTENSIONS } from '../files/mime.js';
import type { AttachmentRef, Tool } from '../types.js';
import { err, formatSize, makeImageResolver, saveFile } from './helpers.js';

const BLOCK_TYPES = ['heading', 'paragraph', 'list', 'table', 'image', 'quote', 'code', 'pageBreak'];

const blockSchema = {
  type: 'object',
  required: ['type'],
  properties: {
    type: { type: 'string', enum: BLOCK_TYPES },
    level: { type: 'integer', minimum: 1, maximum: 4, description: 'heading level' },
    text: { type: 'string', description: 'heading, paragraph, quote, or code text. Inline **bold**, *italic*, `code` are supported in headings, paragraphs, lists, and tables.' },
    align: { type: 'string', enum: ['left', 'center', 'right', 'justify'] },
    ordered: { type: 'boolean' },
    items: { type: 'array', items: { type: 'string' } },
    header: { type: 'array', items: { type: 'string' } },
    rows: { type: 'array', items: { type: 'array', items: { type: ['string', 'number', 'boolean', 'null'] } } },
    columnWidths: { type: 'array', items: { type: 'number' } },
    fileId: { type: 'string', description: 'id of an image/drawing/chart created earlier in this conversation' },
    dataUrl: { type: 'string' },
    widthPx: { type: 'number' },
    caption: { type: 'string' },
    alt: { type: 'string' },
    language: { type: 'string' },
  },
};

function need(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

/** Checks each block has what its type needs, with messages the model can act on. */
export function normalizeBlocks(raw: any[]): Block[] {
  return raw.map((b, i): Block => {
    const at = `blocks[${i}] (${b?.type})`;
    switch (b?.type) {
      case 'heading': need(typeof b.text === 'string' && b.text, `${at}: needs "text"`); return { type: 'heading', level: ([1, 2, 3, 4].includes(b.level) ? b.level : 2) as 1 | 2 | 3 | 4, text: b.text };
      case 'paragraph': need(typeof b.text === 'string', `${at}: needs "text"`); return { type: 'paragraph', text: b.text, align: b.align };
      case 'list': need(Array.isArray(b.items) && b.items.length, `${at}: needs non-empty "items"`); return { type: 'list', ordered: !!b.ordered, items: b.items.map(String) };
      case 'table': need(Array.isArray(b.rows), `${at}: needs "rows"`); return { type: 'table', header: b.header?.map(String), rows: b.rows.map((r: any[]) => r.map((c) => (c === null || c === undefined ? '' : String(c)))), columnWidths: b.columnWidths };
      case 'image': need(b.fileId || b.dataUrl, `${at}: needs "fileId" or "dataUrl"`); return { type: 'image', fileId: b.fileId, dataUrl: b.dataUrl, widthPx: b.widthPx, caption: b.caption, alt: b.alt };
      case 'quote': need(typeof b.text === 'string', `${at}: needs "text"`); return { type: 'quote', text: b.text };
      case 'code': need(typeof b.text === 'string', `${at}: needs "text"`); return { type: 'code', text: b.text, language: b.language };
      case 'pageBreak': return { type: 'pageBreak' };
      default: throw new Error(`${at}: unknown block type. Use one of ${BLOCK_TYPES.join(', ')}`);
    }
  });
}

const done = (files: AttachmentRef[]) =>
  `Created ${files.map((f) => `${f.name} (${formatSize(f.size)}, fileId ${f.id})`).join('; ')}. The file${files.length > 1 ? 's are' : ' is'} attached for the user to download. Do not paste the full content again; summarise it briefly.`;

export const createDocument: Tool = {
  definition: {
    name: 'create_document',
    description: 'Create a downloadable document (Word .docx, PDF, HTML, or Markdown) from structured content. Use for reports, letters, lesson plans, exam papers, CVs, contracts, certificates, minutes, handouts. Put the full real content in blocks; do not use placeholders.',
    parameters: {
      type: 'object',
      required: ['spec'],
      properties: {
        formats: { type: 'array', items: { type: 'string', enum: ['docx', 'pdf', 'html', 'md'] }, minItems: 1, maxItems: 4, default: ['docx'] },
        fileName: { type: 'string', description: 'Base name without extension.' },
        spec: {
          type: 'object',
          required: ['title', 'blocks'],
          properties: {
            title: { type: 'string' },
            subtitle: { type: 'string' },
            author: { type: 'string' },
            language: { type: 'string', description: 'BCP-47, e.g. en, fr, rw' },
            header: { type: 'string' },
            footer: { type: 'string' },
            pageNumbers: { type: 'boolean', default: true },
            blocks: { type: 'array', items: blockSchema, maxItems: 2000 },
          },
        },
      },
    },
  },
  async execute(input, ctx) {
    let spec: DocumentSpec;
    try {
      spec = { ...input.spec, blocks: normalizeBlocks(input.spec.blocks) };
    } catch (e: any) {
      return err(`Invalid document: ${e.message}`);
    }
    const formats: string[] = [...new Set<string>(input.formats?.length ? input.formats : ['docx'])];
    const resolve = makeImageResolver(ctx);
    const base = input.fileName || spec.title;
    const files: AttachmentRef[] = [];
    try {
      for (const f of formats) {
        if (f === 'docx') files.push(await saveFile(ctx, { name: base, ext: 'docx', mime: MIME.docx, kind: 'document', data: await generateDocx(spec, resolve) }));
        else if (f === 'pdf') files.push(await saveFile(ctx, { name: base, ext: 'pdf', mime: MIME.pdf, kind: 'pdf', data: await generatePdf(spec, resolve) }));
        else if (f === 'html') files.push(await saveFile(ctx, { name: base, ext: 'html', mime: MIME.html, kind: 'code', data: await generateHtml(spec, resolve) }));
        else if (f === 'md') files.push(await saveFile(ctx, { name: base, ext: 'md', mime: MIME.md, kind: 'text', data: await generateMarkdown(spec) }));
      }
    } catch (e: any) {
      return err(`Could not create the document: ${String(e.message).slice(0, 300)}`);
    }
    return { text: done(files), attachments: files };
  },
};

export const createSpreadsheet: Tool = {
  definition: {
    name: 'create_spreadsheet',
    description: 'Create an Excel workbook (.xlsx) or CSV. Use for mark sheets, budgets, trackers, data tables. Strings starting with "=" become live formulas (for example "=SUM(B2:B10)"), so totals and averages stay correct when the user edits values.',
    parameters: {
      type: 'object',
      required: ['workbook'],
      properties: {
        formats: { type: 'array', items: { type: 'string', enum: ['xlsx', 'csv'] }, default: ['xlsx'] },
        fileName: { type: 'string' },
        workbook: {
          type: 'object',
          required: ['sheets'],
          properties: {
            title: { type: 'string' },
            sheets: {
              type: 'array', minItems: 1, maxItems: 20,
              items: {
                type: 'object', required: ['name', 'rows'],
                properties: {
                  name: { type: 'string' },
                  columns: { type: 'array', items: { type: 'object', required: ['header'], properties: { header: { type: 'string' }, width: { type: 'number' }, type: { type: 'string', enum: ['text', 'number', 'currency', 'percent', 'date'] } } } },
                  rows: { type: 'array', items: { type: 'array', items: { type: ['string', 'number', 'boolean', 'null'] } } },
                  freezeHeader: { type: 'boolean' },
                  autoFilter: { type: 'boolean' },
                },
              },
            },
          },
        },
      },
    },
  },
  async execute(input, ctx) {
    const wb = input.workbook as WorkbookSpec;
    const formats: string[] = [...new Set<string>(input.formats?.length ? input.formats : ['xlsx'])];
    const base = input.fileName || wb.title || wb.sheets[0]?.name || 'spreadsheet';
    const files: AttachmentRef[] = [];
    try {
      if (formats.includes('xlsx')) files.push(await saveFile(ctx, { name: base, ext: 'xlsx', mime: MIME.xlsx, kind: 'spreadsheet', data: await generateXlsx(wb) }));
      if (formats.includes('csv')) {
        const s = wb.sheets[0];
        files.push(await saveFile(ctx, { name: base, ext: 'csv', mime: MIME.csv, kind: 'text', data: generateCsv(s.rows, s.columns?.map((c) => c.header)) }));
      }
    } catch (e: any) {
      return err(`Could not create the spreadsheet: ${String(e.message).slice(0, 300)}`);
    }
    return { text: done(files), attachments: files };
  },
};

export const createPresentation: Tool = {
  definition: {
    name: 'create_presentation',
    description: 'Create a PowerPoint presentation (.pptx). Use for lessons, pitches, reports. Keep slides concise (3 to 6 bullets). Charts and drawings created earlier can be placed with layout "image" and image.fileId.',
    parameters: {
      type: 'object',
      required: ['spec'],
      properties: {
        fileName: { type: 'string' },
        spec: {
          type: 'object', required: ['title', 'slides'],
          properties: {
            title: { type: 'string' }, subtitle: { type: 'string' }, author: { type: 'string' },
            theme: { type: 'object', properties: { accent: { type: 'string', description: '6-digit hex, e.g. D2691E' }, background: { type: 'string' }, text: { type: 'string' } } },
            slides: {
              type: 'array', maxItems: 100,
              items: {
                type: 'object',
                properties: {
                  layout: { type: 'string', enum: ['section', 'bullets', 'two-column', 'image', 'table', 'quote'] },
                  title: { type: 'string' }, subtitle: { type: 'string' },
                  bullets: { type: 'array', items: { type: 'string' } },
                  leftBullets: { type: 'array', items: { type: 'string' } },
                  rightBullets: { type: 'array', items: { type: 'string' } },
                  image: { type: 'object', properties: { fileId: { type: 'string' }, dataUrl: { type: 'string' }, caption: { type: 'string' } } },
                  table: { type: 'object', properties: { header: { type: 'array', items: { type: 'string' } }, rows: { type: 'array', items: { type: 'array', items: { type: ['string', 'number', 'null'] } } } } },
                  quote: { type: 'string' }, attribution: { type: 'string' }, notes: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  },
  async execute(input, ctx) {
    try {
      const spec = input.spec;
      for (const s of spec.slides) if (s.table) s.table.rows = s.table.rows.map((r: any[]) => r.map((c) => (c === null || c === undefined ? '' : String(c))));
      const data = await generatePptx(spec, makeImageResolver(ctx));
      const f = await saveFile(ctx, { name: input.fileName || spec.title, ext: 'pptx', mime: MIME.pptx, kind: 'presentation', data });
      return { text: done([f]), attachments: [f] };
    } catch (e: any) {
      return err(`Could not create the presentation: ${String(e.message).slice(0, 300)}`);
    }
  },
};

export const createTextFile: Tool = {
  definition: {
    name: 'create_text_file',
    description: `Create a downloadable text or code file. Allowed extensions: ${Object.keys(TEXT_EXTENSIONS).join(', ')}. Use for scripts, configs, data files (json, csv), web pages (html), notes. fileName must include the extension.`,
    parameters: {
      type: 'object', required: ['fileName', 'content'],
      properties: { fileName: { type: 'string', description: 'for example "report.md" or "script.py"' }, content: { type: 'string' } },
    },
  },
  async execute(input, ctx) {
    const ext = String(input.fileName).split('.').pop() ?? '';
    try {
      const { data, ext: e } = generateTextFile(ext, input.content);
      const f = await saveFile(ctx, { name: String(input.fileName).replace(/\.[^.]+$/, ''), ext: e, mime: TEXT_EXTENSIONS[e].mime, kind: TEXT_EXTENSIONS[e].kind, data });
      return { text: done([f]), attachments: [f] };
    } catch (e: any) {
      return err(`Could not create the file: ${e.message}`);
    }
  },
};

export const createArchive: Tool = {
  definition: {
    name: 'create_archive',
    description: 'Bundle files created earlier in this conversation into one .zip download. Pass their fileIds.',
    parameters: { type: 'object', required: ['fileIds'], properties: { fileName: { type: 'string' }, fileIds: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 100 } } },
  },
  async execute(input, ctx) {
    try {
      const entries = [];
      for (const id of input.fileIds as string[]) {
        const { meta, data } = await ctx.files.read(id, ctx.userId);
        entries.push({ name: meta.name, data });
      }
      const f = await saveFile(ctx, { name: input.fileName || 'files', ext: 'zip', mime: MIME.zip, kind: 'archive', data: await generateZip(entries) });
      return { text: done([f]), attachments: [f] };
    } catch (e: any) {
      return err(`Could not create the archive: ${e.message}`);
    }
  },
};
