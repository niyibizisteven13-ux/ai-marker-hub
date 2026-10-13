import {
  AlignmentType, BorderStyle, Document, Footer, Header, HeadingLevel, ImageRun, LevelFormat, Packer,
  PageBreak, PageNumber, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType,
} from 'docx';
import { parseInline } from '../../util/text.js';
import type { Block, DocumentSpec, ImageResolver } from './spec.js';
import { validateDocumentSpec } from './spec.js';

const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4];
const ALIGN = {
  left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED,
} as const;

function runs(text: string, base: { size?: number; font?: string; color?: string; bold?: boolean } = {}) {
  return parseInline(text).map(
    (r) => new TextRun({
      text: r.text,
      bold: r.bold || base.bold,
      italics: r.italic,
      font: r.code ? 'Consolas' : base.font,
      size: base.size,
      color: base.color,
      shading: r.code ? { type: ShadingType.CLEAR, fill: 'EFEFEF' } : undefined,
    }),
  );
}

export async function generateDocx(spec: DocumentSpec, resolveImage: ImageResolver): Promise<Buffer> {
  validateDocumentSpec(spec);
  const children: Array<Paragraph | Table> = [];
  let orderedInstance = 0;

  children.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: spec.title, bold: true })], spacing: { after: 120 } }));
  if (spec.subtitle) {
    children.push(new Paragraph({ children: [new TextRun({ text: spec.subtitle, color: '666666', size: 26 })], spacing: { after: 240 } }));
  }

  for (const block of spec.blocks as Block[]) {
    switch (block.type) {
      case 'heading':
        children.push(new Paragraph({ heading: HEADINGS[Math.min(Math.max(block.level, 1), 4) - 1], children: runs(block.text), spacing: { before: 240, after: 100 } }));
        break;
      case 'paragraph':
        children.push(new Paragraph({ alignment: ALIGN[block.align ?? 'left'], children: runs(block.text), spacing: { after: 140, line: 300 } }));
        break;
      case 'list': {
        const instance = block.ordered ? ++orderedInstance : 0;
        for (const item of block.items) {
          children.push(new Paragraph({
            children: runs(item),
            ...(block.ordered ? { numbering: { reference: 'ordered', level: 0, instance } } : { bullet: { level: 0 } }),
            spacing: { after: 60 },
          }));
        }
        break;
      }
      case 'quote':
        children.push(new Paragraph({
          children: runs(block.text, { color: '555555' }),
          indent: { left: 480 },
          border: { left: { style: BorderStyle.SINGLE, size: 12, color: 'BBBBBB', space: 8 } },
          spacing: { before: 80, after: 160 },
        }));
        break;
      case 'code':
        for (const line of block.text.split('\n')) {
          children.push(new Paragraph({
            children: [new TextRun({ text: line || ' ', font: 'Consolas', size: 20 })],
            shading: { type: ShadingType.CLEAR, fill: 'F3F3F3' },
            spacing: { after: 0 },
          }));
        }
        children.push(new Paragraph({ children: [], spacing: { after: 120 } }));
        break;
      case 'table': {
        const cols = Math.max(block.header?.length ?? 0, ...block.rows.map((r) => r.length), 1);
        const widths = block.columnWidths && block.columnWidths.length === cols ? block.columnWidths : Array(cols).fill(1);
        const total = widths.reduce((a, b) => a + b, 0);
        const cell = (text: string, i: number, head: boolean) =>
          new TableCell({
            width: { size: Math.round((widths[i] / total) * 100), type: WidthType.PERCENTAGE },
            shading: head ? { type: ShadingType.CLEAR, fill: 'EAEAEA' } : undefined,
            margins: { top: 60, bottom: 60, left: 100, right: 100 },
            children: [new Paragraph({ children: runs(String(text ?? ''), { bold: head }) })],
          });
        const rows: TableRow[] = [];
        if (block.header?.length) rows.push(new TableRow({ tableHeader: true, children: Array.from({ length: cols }, (_, i) => cell(block.header![i] ?? '', i, true)) }));
        for (const r of block.rows) rows.push(new TableRow({ children: Array.from({ length: cols }, (_, i) => cell(r[i] ?? '', i, false)) }));
        children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }));
        children.push(new Paragraph({ children: [], spacing: { after: 160 } }));
        break;
      }
      case 'image': {
        const img = await resolveImage({ fileId: block.fileId, dataUrl: block.dataUrl });
        if (!img) {
          children.push(new Paragraph({ children: [new TextRun({ text: '[image unavailable]', italics: true, color: '999999' })] }));
          break;
        }
        const targetW = Math.min(block.widthPx ?? 560, 600);
        const targetH = Math.round((targetW * img.height) / img.width);
        children.push(new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new ImageRun({ type: img.type, data: img.data, transformation: { width: targetW, height: targetH }, altText: { title: block.alt ?? block.caption ?? 'image', description: block.alt ?? block.caption ?? 'image', name: 'image' } })],
          spacing: { before: 120, after: block.caption ? 40 : 160 },
        }));
        if (block.caption) children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: block.caption, italics: true, size: 20, color: '666666' })], spacing: { after: 160 } }));
        break;
      }
      case 'pageBreak':
        children.push(new Paragraph({ children: [new PageBreak()] }));
        break;
    }
  }

  const footerChildren = [];
  if (spec.footer) footerChildren.push(new TextRun({ text: spec.footer + (spec.pageNumbers !== false ? '   ' : ''), size: 18, color: '777777' }));
  if (spec.pageNumbers !== false) footerChildren.push(new TextRun({ children: ['Page ', PageNumber.CURRENT, ' / ', PageNumber.TOTAL_PAGES], size: 18, color: '777777' }));

  const doc = new Document({
    creator: spec.author ?? 'Bwenge',
    title: spec.title,
    styles: { default: { document: { run: { font: 'Calibri', size: 22, ...(spec.language ? { language: { value: spec.language } } : {}) } } } },
    numbering: {
      config: [{
        reference: 'ordered',
        levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.START, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }],
      }],
    },
    sections: [{
      properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
      headers: spec.header ? { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: spec.header, size: 18, color: '777777' })] })] }) } : undefined,
      footers: footerChildren.length ? { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: footerChildren })] }) } : undefined,
      children,
    }],
  });
  return Packer.toBuffer(doc);
}
