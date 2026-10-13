import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { loadInter } from '../../util/fonts.js';
import { parseInline } from '../../util/text.js';
import type { Block, DocumentSpec, ImageResolver } from './spec.js';
import { validateDocumentSpec } from './spec.js';

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 56;
const CONTENT_W = PAGE_W - MARGIN * 2;
const TEXT = rgb(0.1, 0.1, 0.12);
const MUTED = rgb(0.4, 0.4, 0.45);

interface Word { text: string; font: PDFFont; width: number; space: number }

class Layout {
  page!: PDFPage;
  y = 0;
  pages: PDFPage[] = [];
  private supported = new WeakMap<PDFFont, Set<number>>();

  constructor(
    readonly doc: PDFDocument,
    readonly regular: PDFFont,
    readonly bold: PDFFont,
    readonly mono: PDFFont,
    private header?: string,
  ) {
    this.newPage();
  }

  newPage() {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.pages.push(this.page);
    this.y = PAGE_H - MARGIN;
    if (this.header) {
      const w = this.regular.widthOfTextAtSize(this.safe(this.header, this.regular), 8.5);
      this.page.drawText(this.safe(this.header, this.regular), { x: PAGE_W - MARGIN - w, y: PAGE_H - 34, size: 8.5, font: this.regular, color: MUTED });
    }
  }

  ensure(h: number) {
    if (this.y - h < MARGIN + 14) this.newPage();
  }

  /** Replace characters the font cannot draw so PDF generation never throws. */
  safe(text: string, font: PDFFont): string {
    let set = this.supported.get(font);
    if (!set) { set = new Set(font.getCharacterSet()); this.supported.set(font, set); }
    let out = '';
    for (const ch of text.replace(/\t/g, '    ').replace(/\r/g, '')) {
      const cp = ch.codePointAt(0)!;
      if (ch === '\n') out += ' ';
      else if (cp === 0x200b || cp === 0xfeff || cp < 32) continue;
      else out += set.has(cp) ? ch : '?';
    }
    return out;
  }

  /** Wrap mixed-style text into lines. */
  wrap(text: string, size: number, maxW: number, baseBold = false): Word[][] {
    const words: Word[] = [];
    for (const run of parseInline(text)) {
      const font = run.code ? this.mono : run.bold || baseBold ? this.bold : this.regular;
      const clean = this.safe(run.text, font);
      for (const piece of clean.split(/(\s+)/)) {
        if (!piece) continue;
        if (/^\s+$/.test(piece)) {
          if (words.length) words[words.length - 1].space = font.widthOfTextAtSize(' ', size);
          continue;
        }
        words.push({ text: piece, font, width: font.widthOfTextAtSize(piece, size), space: 0 });
      }
    }
    const lines: Word[][] = [];
    let line: Word[] = [];
    let x = 0;
    for (const w of words) {
      const pieces: Word[] = [];
      if (w.width > maxW) {
        let chunk = '';
        for (const ch of w.text) {
          if (w.font.widthOfTextAtSize(chunk + ch, size) > maxW && chunk) { pieces.push({ text: chunk, font: w.font, width: w.font.widthOfTextAtSize(chunk, size), space: 0 }); chunk = ch; }
          else chunk += ch;
        }
        if (chunk) pieces.push({ text: chunk, font: w.font, width: w.font.widthOfTextAtSize(chunk, size), space: w.space });
      } else pieces.push(w);
      for (const p of pieces) {
        if (x + p.width > maxW && line.length) { lines.push(line); line = []; x = 0; }
        line.push(p);
        x += p.width + p.space;
      }
    }
    if (line.length) lines.push(line);
    return lines.length ? lines : [[]];
  }

  drawLines(lines: Word[][], size: number, x0: number, leading: number, color = TEXT, align: 'left' | 'center' | 'right' = 'left', maxW = CONTENT_W) {
    for (const line of lines) {
      this.ensure(leading);
      const total = line.reduce((a, w, i) => a + w.width + (i < line.length - 1 ? w.space : 0), 0);
      let x = align === 'center' ? x0 + (maxW - total) / 2 : align === 'right' ? x0 + maxW - total : x0;
      this.y -= leading;
      for (const w of line) {
        this.page.drawText(w.text, { x, y: this.y + (leading - size) * 0.3, size, font: w.font, color });
        x += w.width + w.space;
      }
    }
  }
}

export async function generatePdf(spec: DocumentSpec, resolveImage: ImageResolver): Promise<Buffer> {
  validateDocumentSpec(spec);
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(spec.title);
  doc.setAuthor(spec.author ?? 'Bwenge');
  doc.setCreator('Bwenge');
  if (spec.language) doc.setLanguage(spec.language);
  const regular = await doc.embedFont(await loadInter('regular'), { subset: false });
  const bold = await doc.embedFont(await loadInter('bold'), { subset: false });
  const mono = await doc.embedFont(StandardFonts.Courier);
  const L = new Layout(doc, regular, bold, mono, spec.header);

  L.drawLines(L.wrap(spec.title, 24, CONTENT_W, true), 24, MARGIN, 30);
  if (spec.subtitle) L.drawLines(L.wrap(spec.subtitle, 13, CONTENT_W), 13, MARGIN, 18, MUTED);
  L.y -= 6;
  L.page.drawLine({ start: { x: MARGIN, y: L.y }, end: { x: PAGE_W - MARGIN, y: L.y }, thickness: 0.6, color: rgb(0.8, 0.8, 0.82) });
  L.y -= 14;

  const sizes: Record<number, number> = { 1: 18, 2: 15, 3: 13, 4: 11.5 };
  let ordinal = 0;

  for (const block of spec.blocks as Block[]) {
    switch (block.type) {
      case 'heading': {
        const s = sizes[block.level] ?? 13;
        L.y -= 8;
        L.ensure(s * 2.2);
        L.drawLines(L.wrap(block.text, s, CONTENT_W, true), s, MARGIN, s * 1.35);
        L.y -= 3;
        break;
      }
      case 'paragraph':
        L.drawLines(L.wrap(block.text, 10.5, CONTENT_W), 10.5, MARGIN, 15.5, TEXT, block.align === 'center' ? 'center' : block.align === 'right' ? 'right' : 'left');
        L.y -= 6;
        break;
      case 'list': {
        ordinal = 0;
        for (const item of block.items) {
          const marker = block.ordered ? `${++ordinal}.` : '\u2022';
          const lines = L.wrap(item, 10.5, CONTENT_W - 20);
          L.ensure(15.5);
          const startY = L.y;
          L.drawLines(lines, 10.5, MARGIN + 20, 15.5);
          L.page.drawText(L.safe(marker, regular), { x: MARGIN + 4, y: startY - 15.5 + 1.8, size: 10.5, font: regular, color: TEXT });
          L.y -= 2;
        }
        L.y -= 4;
        break;
      }
      case 'quote': {
        const lines = L.wrap(block.text, 10.5, CONTENT_W - 18);
        const h = lines.length * 15.5 + 4;
        L.ensure(Math.min(h, 120));
        const top = L.y;
        L.drawLines(lines, 10.5, MARGIN + 14, 15.5, MUTED);
        L.page.drawLine({ start: { x: MARGIN + 4, y: top }, end: { x: MARGIN + 4, y: L.y }, thickness: 2, color: rgb(0.75, 0.75, 0.78) });
        L.y -= 8;
        break;
      }
      case 'code': {
        const lines = block.text.split('\n').flatMap((ln) => {
          const w = L.safe(ln, mono);
          const max = Math.floor((CONTENT_W - 16) / mono.widthOfTextAtSize('M', 9));
          const out: string[] = [];
          for (let i = 0; i < Math.max(w.length, 1); i += max) out.push(w.slice(i, i + max));
          return out;
        });
        for (const ln of lines) {
          L.ensure(12.5);
          L.page.drawRectangle({ x: MARGIN, y: L.y - 12.5, width: CONTENT_W, height: 12.5, color: rgb(0.95, 0.95, 0.96) });
          L.y -= 12.5;
          L.page.drawText(ln, { x: MARGIN + 8, y: L.y + 3, size: 9, font: mono, color: TEXT });
        }
        L.y -= 8;
        break;
      }
      case 'table': {
        const cols = Math.max(block.header?.length ?? 0, ...block.rows.map((r) => r.length), 1);
        const ws = block.columnWidths && block.columnWidths.length === cols ? block.columnWidths : Array(cols).fill(1);
        const total = ws.reduce((a, b) => a + b, 0);
        const colW = ws.map((w) => (w / total) * CONTENT_W);
        const drawRow = (cells: string[], head: boolean) => {
          const wrapped = colW.map((cw, i) => L.wrap(String(cells[i] ?? ''), 9.5, cw - 10, head));
          const rowH = Math.max(...wrapped.map((l) => l.length)) * 13 + 8;
          L.ensure(Math.min(rowH, PAGE_H - MARGIN * 2));
          const top = L.y;
          if (head) L.page.drawRectangle({ x: MARGIN, y: top - rowH, width: CONTENT_W, height: rowH, color: rgb(0.93, 0.93, 0.95) });
          let x = MARGIN;
          wrapped.forEach((lines, i) => {
            L.y = top - 4;
            L.drawLines(lines, 9.5, x + 5, 13);
            x += colW[i];
          });
          L.y = top - rowH;
          L.page.drawLine({ start: { x: MARGIN, y: L.y }, end: { x: MARGIN + CONTENT_W, y: L.y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.83) });
        };
        L.page.drawLine({ start: { x: MARGIN, y: L.y }, end: { x: MARGIN + CONTENT_W, y: L.y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.83) });
        if (block.header?.length) drawRow(block.header, true);
        for (const r of block.rows) drawRow(r, false);
        L.y -= 10;
        break;
      }
      case 'image': {
        const img = await resolveImage({ fileId: block.fileId, dataUrl: block.dataUrl });
        if (!img) { L.drawLines(L.wrap('[image unavailable]', 10, CONTENT_W), 10, MARGIN, 14, MUTED); break; }
        const embedded = img.type === 'png' ? await doc.embedPng(img.data) : await doc.embedJpg(img.data);
        const w = Math.min(block.widthPx ? block.widthPx * 0.75 : CONTENT_W, CONTENT_W);
        const h = Math.min((w * img.height) / img.width, 380);
        const finalW = (h * img.width) / img.height;
        L.ensure(h + 8);
        L.page.drawImage(embedded, { x: MARGIN + (CONTENT_W - finalW) / 2, y: L.y - h, width: finalW, height: h });
        L.y -= h + 6;
        if (block.caption) L.drawLines(L.wrap(block.caption, 9, CONTENT_W), 9, MARGIN, 13, MUTED, 'center');
        L.y -= 6;
        break;
      }
      case 'pageBreak':
        L.newPage();
        break;
    }
  }

  if (spec.pageNumbers !== false || spec.footer) {
    const n = L.pages.length;
    L.pages.forEach((p, i) => {
      const label = [spec.footer, spec.pageNumbers !== false ? `Page ${i + 1} / ${n}` : ''].filter(Boolean).join('   ');
      const text = L.safe(label, regular);
      const w = regular.widthOfTextAtSize(text, 8.5);
      p.drawText(text, { x: (PAGE_W - w) / 2, y: 28, size: 8.5, font: regular, color: MUTED });
    });
  }
  return Buffer.from(await doc.save());
}
