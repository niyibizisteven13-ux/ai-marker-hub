import { describe, expect, it } from 'vitest';
import mammoth from 'mammoth';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { PDFParse } from 'pdf-parse';
import { generateDocx } from '../src/ai/files/generators/docx.js';
import { generatePdf } from '../src/ai/files/generators/pdf.js';
import { generateHtml, generateMarkdown } from '../src/ai/files/generators/html-md.js';
import { generateXlsx } from '../src/ai/files/generators/xlsx.js';
import { generatePptx } from '../src/ai/files/generators/pptx.js';
import { generateCsv, generateTextFile, generateZip } from '../src/ai/files/generators/simple.js';
import type { DocumentSpec, ImageResolver } from '../src/ai/files/generators/spec.js';

// 1x1 red PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const resolver: ImageResolver = async (ref) => (ref.fileId === 'img1' ? { data: PNG, type: 'png', width: 1, height: 1 } : null);

const spec: DocumentSpec = {
  title: 'Rapport de notation / Marking report',
  subtitle: 'Classe 6A \u2014 Term 2',
  author: 'Bwenge',
  language: 'fr',
  footer: 'Bwenge',
  blocks: [
    { type: 'heading', level: 1, text: 'R\u00e9sum\u00e9 g\u00e9n\u00e9ral' },
    { type: 'paragraph', text: 'Les \u00e9l\u00e8ves ont obtenu **de bons r\u00e9sultats**. Kinyarwanda: Muraho, murakaza neza!' },
    { type: 'list', items: ['First item', 'Second item'] },
    { type: 'list', ordered: true, items: ['One', 'Two', 'Three'] },
    { type: 'table', header: ['Student', 'Score'], rows: [['Amina', '18/20'], ['Eric', '15/20']] },
    { type: 'quote', text: 'Well done to everyone.' },
    { type: 'code', text: 'total = sum(scores)\nprint(total)' },
    { type: 'image', fileId: 'img1', caption: 'A tiny chart' },
    { type: 'pageBreak' },
    { type: 'heading', level: 2, text: 'Page two' },
    { type: 'paragraph', text: 'Veryveryveryveryveryveryveryveryveryveryveryveryveryveryveryveryveryveryveryveryveryveryveryveryveryverylongword end.' },
  ],
};

describe('generators round-trip', () => {
  it('docx opens and contains text, list and table', async () => {
    const buf = await generateDocx(spec, resolver);
    expect(buf.subarray(0, 2).toString()).toBe('PK');
    const { value } = await mammoth.extractRawText({ buffer: buf });
    expect(value).toContain('R\u00e9sum\u00e9 g\u00e9n\u00e9ral');
    expect(value).toContain('de bons r\u00e9sultats');
    expect(value).toContain('Amina');
    expect(value).toContain('Three');
    expect(value).toContain('Muraho');
  });

  it('pdf opens, has 2+ pages, and keeps accents', async () => {
    const buf = await generatePdf(spec, resolver);
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
    const doc = await PDFDocument.load(buf);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(2);
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    const { text } = await parser.getText();
    expect(text).toContain('Amina');
    expect(text).toContain('R\u00e9sum\u00e9');
    await parser.destroy?.();
  });

  it('pdf embeds full fonts (subsetting dropped glyphs when rendered)', async () => {
    const buf = await generatePdf(spec, resolver);
    const doc = await PDFDocument.load(buf);
    const names: string[] = [];
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      if (obj instanceof PDFDict && obj.get(PDFName.of('Type')) === PDFName.of('Font')) {
        const base = obj.get(PDFName.of('BaseFont'));
        if (base) names.push(base.toString());
      }
    }
    expect(names.some((n) => /Inter/.test(n))).toBe(true);
    expect(names.some((n) => /^\/[A-Z]{6}\+/.test(n))).toBe(false);
  });

  it('pdf survives unsupported characters instead of throwing', async () => {
    const buf = await generatePdf({ title: 'Emoji test \ud83d\ude00 \u4e2d\u6587', blocks: [{ type: 'paragraph', text: 'Hello \ud83d\ude00 world \u4e2d\u6587' }, { type: 'code', text: 'x = \ud83d\ude00' }] }, resolver);
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('html escapes content and embeds images', async () => {
    const buf = await generateHtml({ ...spec, blocks: [{ type: 'paragraph', text: '<script>alert(1)</script>' }, { type: 'image', fileId: 'img1' }] }, resolver);
    const html = buf.toString('utf8');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('data:image/png;base64,');
  });

  it('markdown renders table and list', async () => {
    const md = (await generateMarkdown(spec)).toString('utf8');
    expect(md).toContain('| Student | Score |');
    expect(md).toContain('1. One');
  });

  it('xlsx keeps values, formulas, formats, and unique sheet names', async () => {
    const buf = await generateXlsx({
      title: 'Marks',
      sheets: [
        { name: 'Class 6A', columns: [{ header: 'Student' }, { header: 'Score', type: 'number' }], rows: [['Amina', 18], ['Eric', 15], ['Total', '=SUM(B2:B3)']], autoFilter: true },
        { name: 'Class 6A', rows: [['x']] },
      ],
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as any);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Class 6A', 'Class 6A 2']);
    const ws = wb.worksheets[0];
    expect(ws.getCell('A2').value).toBe('Amina');
    expect((ws.getCell('B4').value as any).formula).toBe('SUM(B2:B3)');
    expect(ws.getRow(1).font?.bold).toBe(true);
  });

  it('pptx has the expected number of slides and text', async () => {
    const buf = await generatePptx({
      title: 'Bwenge overview', subtitle: 'Demo',
      slides: [
        { layout: 'bullets', title: 'Why', bullets: ['Fast', '**Accurate**'] },
        { layout: 'two-column', title: 'Compare', leftBullets: ['A'], rightBullets: ['B'] },
        { layout: 'table', title: 'Scores', table: { header: ['N', 'S'], rows: [['Amina', '18']] } },
        { layout: 'image', title: 'Chart', image: { fileId: 'img1', caption: 'cap' } },
        { layout: 'section', title: 'Part two' },
        { layout: 'quote', quote: 'Hello', attribution: 'Me', notes: 'speaker notes' },
      ],
    }, resolver);
    const zip = await JSZip.loadAsync(buf);
    const slides = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
    expect(slides.length).toBe(7);
    const xml = await zip.file('ppt/slides/slide2.xml')!.async('string');
    expect(xml).toContain('Why');
    expect(xml).toContain('Accurate');
    expect(Object.keys(zip.files).some((f) => f.startsWith('ppt/media/'))).toBe(true);
  });

  it('csv escapes quotes, adds BOM, and neutralises formula injection', () => {
    const csv = generateCsv([['=cmd|calc', 'a,b', 'say "hi"', -5, '-x']], ['A', 'B', 'C', 'D', 'E']).toString('utf8');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("'=cmd|calc");
    expect(csv).toContain('"a,b"');
    expect(csv).toContain('"say ""hi"""');
    expect(csv).toContain(',-5,');
    expect(csv).toContain("'-x");
  });

  it('text files only allow listed extensions and reject binary', () => {
    expect(generateTextFile('py', 'print(1)').ext).toBe('py');
    expect(() => generateTextFile('exe', 'x')).toThrow(/Unsupported/);
    expect(() => generateTextFile('txt', 'a\0b')).toThrow(/binary/);
  });

  it('zip blocks path traversal and dedupes names', async () => {
    const buf = await generateZip([
      { name: '../../etc/passwd', data: Buffer.from('x') },
      { name: 'a.txt', data: Buffer.from('1') },
      { name: 'a.txt', data: Buffer.from('2') },
    ]);
    const zip = await JSZip.loadAsync(buf);
    const names = Object.values(zip.files).filter((f) => !f.dir).map((f) => f.name).sort();
    expect(names).toEqual(['a-2.txt', 'a.txt', 'etc/passwd']);
  });
});
