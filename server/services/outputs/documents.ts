import JSZip from 'jszip';
import { PDFParse } from 'pdf-parse';
import { svgToPng } from '../ai/drawing/rasterize.js';
import { generateDocx } from '../ai/files/generators/docx.js';
import { generatePdf } from '../ai/files/generators/pdf.js';
import { generatePptx, type SlideSpec } from '../ai/files/generators/pptx.js';
import type { Block, DocumentSpec, ImageResolver } from '../ai/files/generators/spec.js';
import { generateXlsx, type SheetSpec } from '../ai/files/generators/xlsx.js';
import type { AnalysisReport } from './analysis.js';
import { renderChartSvg } from './charts.js';
import type { ChartConfig, SourceRef, SpecOf, TableSpec } from './spec.js';
import { analysisTables, fmt, unsupportedNumbers, type DisplayTable, type Row } from './tables.js';

/**
 * Real XLSX, PDF, DOCX and PPTX files (existing generators), editable templates filled from stored analysis
 * results, and a verifier that opens every generated file before it is stored.
 */

export interface Resolved {
  table: (t: TableSpec) => DisplayTable;
  chartRows: (c: ChartConfig) => Row[];
}

const dataUrlResolver: ImageResolver = async (ref) => {
  const m = ref.dataUrl ? /^data:image\/png;base64,(.+)$/.exec(ref.dataUrl) : null;
  if (!m) return null;
  const data = Buffer.from(m[1], 'base64');
  return { data, type: 'png', width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
};

export async function chartPngDataUrl(c: ChartConfig, title: string, rows: Row[]): Promise<string> {
  const svg = await renderChartSvg(c, title, rows);
  const png = svgToPng(svg, { width: 1400 });
  return `data:image/png;base64,${png.data.toString('base64')}`;
}

const tableBlock = (t: DisplayTable): Block => ({ type: 'table', header: t.columns.map((c) => `${c.label}${c.unit ? ` (${c.unit})` : ''}`), rows: t.rows.slice(0, 2000).map((r) => t.columns.map((c) => fmt(r[c.key], c.key))) });
const sheetOf = (name: string, t: DisplayTable): SheetSpec => ({ name, columns: t.columns.map((c) => ({ header: `${c.label}${c.unit ? ` (${c.unit})` : ''}`, type: t.rows.some((r) => typeof r[c.key] === 'number') ? 'number' : 'text' })), rows: t.rows.map((r) => t.columns.map((c) => (r[c.key] === undefined ? null : r[c.key]) as string | number | boolean | null)), freezeHeader: true, autoFilter: true });
const sourcesText = (s: SourceRef[]) => s.map((x) => `${x.label} (${x.type})`);

export async function renderDocument(spec: SpecOf<'document'>, res: Resolved): Promise<Buffer> {
  if (spec.format === 'xlsx') {
    const sheets: SheetSpec[] = spec.sheets!.map((sh) => sheetOf(sh.name, res.table(sh.table)));
    if (spec.sources.length) sheets.push({ name: 'Sources', columns: [{ header: 'Source' }, { header: 'Type' }], rows: spec.sources.map((s) => [s.label, s.type]) });
    return generateXlsx({ title: spec.title, sheets });
  }
  if (spec.format === 'pptx') {
    const slides: SlideSpec[] = [{ layout: 'title', title: spec.title }];
    for (const sl of spec.slides!) {
      if (sl.chart) slides.push({ layout: 'image', title: sl.title, image: { dataUrl: await chartPngDataUrl(sl.chart, sl.title, res.chartRows(sl.chart)), caption: `Source: ${sl.chart.sourceNote}` }, notes: sl.notes });
      else if (sl.table) { const t = res.table(sl.table); slides.push({ layout: 'table', title: sl.title, table: { header: t.columns.map((c) => c.label), rows: t.rows.slice(0, 12).map((r) => t.columns.map((c) => fmt(r[c.key], c.key))) }, notes: sl.notes }); }
      else slides.push({ layout: 'bullets', title: sl.title, bullets: sl.bullets ?? [], notes: sl.notes });
    }
    if (spec.sources.length) slides.push({ layout: 'bullets', title: 'Sources', bullets: sourcesText(spec.sources).slice(0, 8) });
    return generatePptx({ title: spec.title, slides }, dataUrlResolver);
  }
  const blocks: Block[] = [];
  for (const b of spec.blocks!) {
    if (b.type === 'table') blocks.push(tableBlock(res.table(b.table)));
    else if (b.type === 'chart') blocks.push({ type: 'image', dataUrl: await chartPngDataUrl(b.chart, spec.title, res.chartRows(b.chart)), caption: `Source: ${b.chart.sourceNote}`, alt: spec.title });
    else blocks.push(b as Block);
  }
  if (spec.sources.length) blocks.push({ type: 'heading', level: 2, text: 'Sources' }, { type: 'list', items: sourcesText(spec.sources) });
  const doc: DocumentSpec = { title: spec.title, pageNumbers: true, blocks };
  return spec.format === 'pdf' ? generatePdf(doc, dataUrlResolver) : generateDocx(doc, dataUrlResolver);
}

/** Editable templates filled from a stored analysis; narrative numbers not found in the results are flagged. */
export async function renderTemplate(spec: SpecOf<'template'>, rep: AnalysisReport): Promise<{ data: Buffer; format: 'docx' | 'pptx' | 'xlsx'; warnings: string[] }> {
  const tables = analysisTables(rep);
  const narrative = [spec.summary, spec.interpretation].filter(Boolean).join('\n');
  const flagged = narrative ? unsupportedNumbers(narrative, rep) : [];
  const warnings = flagged.length ? [`Numbers in the narrative that do not appear in the computed results: ${flagged.slice(0, 10).join(', ')}. Check them before sharing.`] : [];
  const dataLine = `${rep.source.label} (${rep.source.type}); ${rep.rowsIn} rows${rep.rowsAnalysed !== rep.rowsIn ? `, ${rep.rowsAnalysed} after filters` : ''}; retrieved ${rep.source.retrievedAt.slice(0, 10)}.`;
  const filters = rep.filters.map((f) => `${f.column} ${f.op} ${JSON.stringify(f.value)} (${f.rowsBefore} → ${f.rowsAfter} rows)`);
  const engine = `${rep.engine.name}${rep.isolation ? `, isolated subprocess${rep.isolation.networkNamespace ? ' without network' : ''}` : ''}`;
  if (spec.template === 'statistical_report') {
    const blocks: Block[] = [
      { type: 'heading', level: 1, text: 'Summary' }, { type: 'paragraph', text: spec.summary || `Results computed from ${rep.source.label}.` },
      { type: 'heading', level: 1, text: 'Data' }, { type: 'paragraph', text: dataLine }, ...(filters.length ? [{ type: 'list', items: filters } as Block] : []),
      ...(Object.keys(rep.units).length ? [{ type: 'paragraph', text: `Units: ${Object.entries(rep.units).map(([k, v]) => `${k} in ${v}`).join('; ')}.` } as Block] : []),
      { type: 'heading', level: 1, text: 'Method' }, { type: 'list', items: rep.methodology },
      { type: 'heading', level: 1, text: 'Results' },
      ...tables.flatMap((t): Block[] => [{ type: 'heading', level: 2, text: t.caption }, tableBlock(t), ...(t.note ? [{ type: 'paragraph', text: t.note } as Block] : [])]),
      ...(spec.interpretation ? [{ type: 'heading', level: 1, text: 'Interpretation' } as Block, { type: 'paragraph', text: spec.interpretation } as Block] : []),
      { type: 'heading', level: 1, text: 'Assumptions' }, { type: 'list', items: rep.assumptions.length ? rep.assumptions : ['No model assumptions beyond the data being recorded correctly.'] },
      { type: 'heading', level: 1, text: 'Limitations' }, { type: 'list', items: [...rep.limitations, ...warnings].length ? [...rep.limitations, ...warnings] : ['None reported by the engine.'] },
      { type: 'heading', level: 1, text: 'Reproducibility' }, { type: 'paragraph', text: `Computed by ${engine}. Tables contain engine output; narrative text was written separately${spec.author ? ` by ${spec.author}` : ''}.` },
    ];
    return { data: await generateDocx({ title: spec.title, subtitle: spec.audience, author: spec.author, pageNumbers: true, blocks }, dataUrlResolver), format: 'docx', warnings };
  }
  if (spec.template === 'briefing_deck') {
    const findings = (spec.summary ?? '').split(/(?<=[.!?])\s+/).filter(Boolean).slice(0, 6);
    const slides: SlideSpec[] = [
      { layout: 'title', title: spec.title, subtitle: spec.audience ?? rep.source.label },
      { layout: 'bullets', title: 'Key findings', bullets: findings.length ? findings : ['See the results slides.'], notes: warnings.join(' ') || undefined },
      ...tables.slice(0, 12).map((t): SlideSpec => ({ layout: 'table', title: t.caption, table: { header: t.columns.slice(0, 6).map((c) => `${c.label}${c.unit ? ` (${c.unit})` : ''}`), rows: t.rows.slice(0, 10).map((r) => t.columns.slice(0, 6).map((c) => fmt(r[c.key], c.key))) }, notes: t.note })),
      { layout: 'bullets', title: 'Method and limitations', bullets: [...rep.methodology.slice(0, 3), ...rep.limitations.slice(0, 3)].map((x) => x.slice(0, 200)) },
      { layout: 'bullets', title: 'Data and source', bullets: [dataLine, ...filters.slice(0, 3), `Computed by ${engine}.`] },
    ];
    return { data: await generatePptx({ title: spec.title, author: spec.author, slides }, dataUrlResolver), format: 'pptx', warnings };
  }
  const sheets: SheetSpec[] = tables.map((t, i) => sheetOf(`${i + 1} ${t.caption}`.slice(0, 31), t));
  sheets.push({ name: 'Method', columns: [{ header: 'Item', width: 18 }, { header: 'Detail', width: 100 }], rows: [['Data', dataLine], ...filters.map((f) => ['Filter', f]), ...rep.methodology.map((m) => ['Method', m]), ...rep.assumptions.map((a) => ['Assumption', a]), ...rep.limitations.map((l) => ['Limitation', l]), ['Engine', engine]] });
  return { data: await generateXlsx({ title: spec.title, author: spec.author, sheets }), format: 'xlsx', warnings };
}

/** Opens a generated file to prove it is what its extension says (never a renamed text file). */
export async function verifyFile(format: string, data: Buffer): Promise<string | null> {
  const parts: Record<string, string> = { xlsx: 'xl/workbook.xml', docx: 'word/document.xml', pptx: 'ppt/presentation.xml' };
  if (parts[format]) {
    if (data.subarray(0, 2).toString('latin1') !== 'PK') return `${format} is not a ZIP package`;
    try {
      const zip = await JSZip.loadAsync(data);
      if (!zip.file('[Content_Types].xml') || !zip.file(parts[format])) return `${format} is missing ${parts[format]}`;
    } catch { return `${format} package cannot be opened`; }
    return null;
  }
  if (format === 'pdf') {
    if (data.subarray(0, 5).toString('latin1') !== '%PDF-') return 'not a PDF';
    const parser = new PDFParse({ data: new Uint8Array(data) });
    try { const r = await parser.getText(); return r.total >= 1 ? null : 'PDF has no pages'; } catch { return 'PDF cannot be parsed'; } finally { await parser.destroy().catch(() => {}); }
  }
  if (format === 'svg') return /^\s*(<\?xml[^>]*>\s*)?<svg\b/.test(data.toString('utf8', 0, 300)) && !/<script\b/i.test(data.toString('utf8')) ? null : 'not a safe SVG';
  if (format === 'json') { try { JSON.parse(data.toString('utf8')); return null; } catch { return 'invalid JSON'; } }
  if (format === 'png') return data.subarray(1, 4).toString('latin1') === 'PNG' ? null : 'not a PNG';
  return null;
}
