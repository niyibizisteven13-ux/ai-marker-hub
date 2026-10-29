import sharp from 'sharp';
import { LineCapStyle, PDFArray, PDFDict, PDFDocument, PDFName, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { DocumentResult } from '../documents/pipeline.js';
import { loadPages } from '../documents/pages.js';
import { viewedSize, viewedToPdf, type PdfBox } from './pdfGeometry.js';
import { computeLayout, GAP, LABEL_CHAR, NOTE_CHAR, SYMBOL, type MarkSymbol } from './layout.js';
import type { CandidateSummary } from './results.js';
import type { MarkingScheme } from './scheme.js';
import type { CandidateResult } from './types.js';
import { effectiveMarks, openFlags } from './results.js';

/**
 * Marked copy of a candidate's script. The original file is never modified: its pages are copied into a
 * new PDF, marks are drawn in the margin next to each answer where the geometry is reliable, and summary
 * pages are appended. Answers that cannot be located reliably are reported on the summary page only.
 */

const GREEN = rgb(0.09, 0.55, 0.24), RED = rgb(0.84, 0.11, 0.09), AMBER = rgb(0.85, 0.5, 0.0), ORANGE = rgb(0.93, 0.42, 0.0), INK = rgb(0.12, 0.12, 0.14), GREY = rgb(0.45, 0.45, 0.5);

/** Standard PDF fonts only cover WinAnsi; replace other characters with readable ASCII. */
const TRANSLIT: Record<string, string> = { '×': 'x', '÷': '/', '−': '-', '–': '-', '—': '-', '≤': '<=', '≥': '>=', '≠': '!=', '≈': '~', '→': '->', '√': 'sqrt', '∞': 'inf', 'π': 'pi', 'θ': 'theta', 'λ': 'lambda', 'α': 'alpha', 'β': 'beta', 'Δ': 'Delta', '∫': 'int', '…': '...', '‘': "'", '’': "'", '“': '"', '”': '"', '•': '-' };
export function pdfSafe(s: string): string {
  return [...s.normalize('NFC')].map((ch) => {
    if (TRANSLIT[ch] !== undefined) return TRANSLIT[ch];
    const c = ch.codePointAt(0)!;
    if (c === 10 || (c >= 32 && c < 127) || (c >= 160 && c <= 255)) return ch;
    return c < 32 ? ' ' : '?';
  }).join('');
}

function wrap(text: string, font: PDFFont, size: number, width: number, maxLines = 50): string[] {
  const out: string[] = [];
  for (const para of pdfSafe(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) { line = next; continue; }
      if (line) out.push(line);
      line = word;
      while (font.widthOfTextAtSize(line, size) > width && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > width) cut--;
        out.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    if (line) out.push(line);
    if (out.length >= maxLines) break;
  }
  return out.slice(0, maxLines);
}

/** Removes script/launch actions from copied pages so the marked file cannot run embedded code. */
function stripActiveContent(page: PDFPage) {
  const annots = page.node.lookup(PDFName.of('Annots'));
  if (!(annots instanceof PDFArray)) return;
  for (let i = 0; i < annots.size(); i++) {
    const a = annots.lookup(i);
    if (!(a instanceof PDFDict)) continue;
    a.delete(PDFName.of('AA'));
    const act = a.lookup(PDFName.of('A'));
    if (act instanceof PDFDict) {
      const s = act.lookup(PDFName.of('S'));
      if (s instanceof PDFName && ['/JavaScript', '/Launch', '/SubmitForm', '/ImportData', '/ResetForm'].includes(s.asString())) a.delete(PDFName.of('A'));
    }
  }
  page.node.delete(PDFName.of('AA'));
}

async function imagesToPdf(images: Buffer[]): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  for (const img of images) {
    const png = await sharp(img, { limitInputPixels: 80_000_000 }).rotate().flatten({ background: '#ffffff' }).jpeg({ quality: 88 }).toBuffer();
    const meta = await sharp(png).metadata();
    const emb = await doc.embedJpg(png);
    const scale = 72 / 150;
    const w = (meta.width ?? 1000) * scale, h = (meta.height ?? 1400) * scale;
    doc.addPage([w, h]).drawImage(emb, { x: 0, y: 0, width: w, height: h });
  }
  return doc;
}

/** Copies the source pages into a fresh document (no catalog-level actions survive). */
async function sourcePages(original: Buffer, fileName: string, maxPages: number): Promise<{ doc: PDFDocument; rebuilt: boolean }> {
  const isPdf = original.subarray(0, 5).toString('latin1') === '%PDF-';
  if (isPdf) {
    try {
      const src = await PDFDocument.load(original, { updateMetadata: false });
      const doc = await PDFDocument.create();
      const pages = await doc.copyPages(src, src.getPageIndices().slice(0, maxPages));
      for (const p of pages) { stripActiveContent(p); doc.addPage(p); }
      return { doc, rebuilt: false };
    } catch {
      // Encrypted or malformed: rebuild from rendered page images.
    }
  }
  const { pages } = await loadPages(original, fileName, { maxPages });
  return { doc: await imagesToPdf(pages.map((p) => p.image)), rebuilt: true };
}

function drawSymbol(page: PDFPage, kind: MarkSymbol | 'review', x: number, y: number, size: number, rot: number) {
  // Draws in a local, upright frame at (x, y) = bottom-left, rotated with the page so the mark reads correctly.
  const a = (rot * Math.PI) / 180;
  const P = (u: number, v: number) => ({ x: x + u * Math.cos(a) - v * Math.sin(a), y: y + u * Math.sin(a) + v * Math.cos(a) });
  const line = (u1: number, v1: number, u2: number, v2: number, color = RED) => page.drawLine({ start: P(u1, v1), end: P(u2, v2), thickness: Math.max(1.4, size / 8), color, lineCap: LineCapStyle.Round });
  const s = size;
  if (kind === 'tick' || kind === 'half') {
    line(0, s * 0.45, s * 0.35, s * 0.08);
    line(s * 0.35, s * 0.08, s, s * 0.95);
    // Part credit for a step: a short bar across the tick's long stroke.
    if (kind === 'half') line(s * 0.45, s * 0.62, s * 0.92, s * 0.38);
  } else if (kind === 'cross') {
    line(s * 0.08, s * 0.08, s * 0.92, s * 0.92);
    line(s * 0.08, s * 0.92, s * 0.92, s * 0.08);
  } else {
    const c = P(s / 2, s / 2);
    page.drawCircle({ x: c.x, y: c.y, size: s / 2, borderColor: ORANGE, borderWidth: 1.2 });
  }
}

export interface AnnotateInput {
  original: Buffer;
  fileName: string;
  doc: DocumentResult;
  result: CandidateResult;
  summary: CandidateSummary;
  scheme: MarkingScheme;
  meta: { examTitle: string; examId: string; runId: string; resultRevision: number; generatedAt: string };
  maxPages?: number;
  /** Released by the teacher: no draft label and no review "?" marks. */
  released?: boolean;
  /** Red corrections under wrong answers (the teacher's preference; default on). */
  corrections?: boolean;
}

export interface AnnotateOutput { pdf: Buffer; placed: number; summaryOnly: string[]; rebuilt: boolean; /** Pages of the script itself (before the summary pages). */ sourcePages: number }

export async function annotateScript(input: AnnotateInput): Promise<AnnotateOutput> {
  const { doc: out, rebuilt } = await sourcePages(input.original, input.fileName, input.maxPages ?? 50);
  const font = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  const italic = await out.embedFont(StandardFonts.HelveticaOblique);
  const pages = out.getPages();
  const layout = computeLayout(input.doc, input.result, input.summary);
  const summaryOnly = layout.items.filter((it) => it.kind === 'mark' && !it.placed && !it.hidden && it.label).map((it) => it.number!);
  let placed = 0;

  for (const it of layout.items) {
    if (!it.placed || it.hidden) continue;
    const page = pages[it.page - 1];
    if (!page) continue;
    const crop = page.getCropBox();
    const box: PdfBox = { x: crop.x, y: crop.y, width: crop.width, height: crop.height };
    const rot = page.getRotation().angle;
    const vs = viewedSize(box, rot);
    const a = (rot * Math.PI) / 180;
    const at = (fx: number, fy: number) => viewedToPdf(Math.min(1, Math.max(0, fx)), Math.min(1, Math.max(0, fy)), box, rot);
    const off = (p: { x: number; y: number }, u: number, v: number) => ({ x: p.x + u * Math.cos(a) - v * Math.sin(a), y: p.y + u * Math.sin(a) + v * Math.cos(a) });

    if (it.kind === 'mark') {
      const size = Math.min(18, Math.max(8, SYMBOL * vs.width));
      // Anchor: left edge, vertical centre → bottom-left of the first symbol.
      const origin = at(it.fx, it.fy + size / vs.height / 2);
      (it.symbols ?? []).forEach((sym, i) => {
        const p = off(origin, i * (SYMBOL + GAP) * vs.width, 0);
        drawSymbol(page, sym, p.x, p.y, size, rot);
      });
      const fs = Math.min(16, Math.max(7.5, (LABEL_CHAR / 0.56) * vs.width));
      const lx = (it.symbols?.length ?? 0) * (SYMBOL + GAP) * vs.width + size * 0.3;
      page.drawText(pdfSafe(it.label ?? ''), { ...off(origin, lx, size * 0.18), size: fs, font: bold, color: RED, rotate: degrees(rot) });
      if (it.flagged && !input.released) {
        const rx = lx + bold.widthOfTextAtSize(pdfSafe(it.label ?? ''), fs) + 4;
        const q = off(origin, rx, size * 0.1);
        drawSymbol(page, 'review', q.x, q.y, size * 0.8, rot);
        page.drawText('?', { ...off(origin, rx + size * 0.25, size * 0.25), size: size * 0.6, font: bold, color: ORANGE, rotate: degrees(rot) });
      }
      placed++;
    } else if (it.kind === 'correction' && input.corrections !== false) {
      const fs = Math.min(14, Math.max(8, (NOTE_CHAR / 0.5) * vs.width));
      const origin = at(it.fx, it.fy + (fs * 0.35) / vs.height);
      page.drawText(pdfSafe(it.text ?? ''), { ...origin, size: fs, font: italic, color: RED, rotate: degrees(rot) });
    } else {
      const label = pdfSafe(it.label ?? '');
      const fs = Math.min(18, Math.max(9, 0.03 * vs.width));
      const c = at(it.fx, it.fy);
      const rx = Math.max((it.w / 2) * vs.width, bold.widthOfTextAtSize(label, fs) / 2 + 8);
      const ry = Math.max((it.h / 2) * vs.height, fs * 0.85);
      page.drawEllipse({ x: c.x, y: c.y, xScale: rx, yScale: ry, borderColor: RED, borderWidth: 1.8, rotate: degrees(rot) });
      page.drawText(label, { ...off(c, -bold.widthOfTextAtSize(label, fs) / 2, -fs * 0.35), size: fs, font: bold, color: RED, rotate: degrees(rot) });
    }
  }

  if (!input.released && pages[0]) {
    const p0 = pages[0];
    const crop = p0.getCropBox();
    const box: PdfBox = { x: crop.x, y: crop.y, width: crop.width, height: crop.height };
    const rot = p0.getRotation().angle;
    p0.drawText('DRAFT - for teacher review, not released', { ...viewedToPdf(0.02, 0.988, box, rot), size: 7, font, color: GREY, rotate: degrees(rot) });
  }

  // Summary pages (appended; source pages are untouched apart from margin marks).
  const W = 595, H = 842, M = 40;
  let page = out.addPage([W, H]);
  let y = H - M;
  const text = (t: string, x: number, size = 9, f: PDFFont = font, color = INK) => page.drawText(pdfSafe(t), { x, y, size, font: f, color });
  const ensure = (need: number) => { if (y - need < M) { page = out.addPage([W, H]); y = H - M; } };
  const s = input.summary;
  text('Bwenge.AI marking summary', M, 15, bold);
  y -= 18;
  const statusLine = input.released ? 'Released by the teacher' : s.status === 'user_confirmed' ? 'Confirmed by the user' : s.status === 'user_corrected' ? 'Includes user corrections; other marks are AI-proposed' : s.status === 'needs_review' ? 'PROVISIONAL - items need review' : 'PROVISIONAL - AI-proposed, not examiner-certified';
  text(statusLine, M, 9.5, bold, s.status === 'needs_review' ? ORANGE : GREY);
  y -= 16;
  for (const [k, v] of [
    ['Examination', input.meta.examTitle], ['Candidate', `${s.candidateId}${s.candidateName ? ` (${s.candidateName})` : ''}`], ['Script', s.fileName],
    ['Total', `${s.total} / ${s.maxTotal} (${s.percent}%)${s.complete ? '' : ' - incomplete: some questions have no mark yet'}`],
    ['Marking run', `${input.meta.runId.slice(0, 8)} · result revision ${input.meta.resultRevision} · generated ${input.meta.generatedAt.slice(0, 16).replace('T', ' ')} UTC`],
  ] as const) { text(`${k}:`, M, 9, bold); text(v, M + 75, 9); y -= 13; }
  y -= 6;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: GREY });
  y -= 14;
  for (const q of s.questions) {
    const rq = input.result.questions.find((x) => x.questionId === q.questionId);
    const fb = [rq?.override ? `Examiner override: ${rq.override.reason}` : '', rq?.ai?.feedback ?? '', rq?.ai?.lostMarks ? `Lost marks: ${rq.ai.lostMarks}` : '', rq?.ai?.correction && input.corrections !== false && (q.marks ?? 0) < q.maxMarks ? `Correction: ${rq.ai.correction}` : '', ...(input.released ? [] : q.flags.map((f) => `Check: ${f.detail}`))].filter(Boolean).join('\n');
    const lines = wrap(fb || (q.marks === null ? 'Not marked yet.' : ''), font, 8, W - 2 * M - 120, 14);
    ensure(16 + lines.length * 10);
    const color = q.outcome === 'full' ? GREEN : q.outcome === 'zero' ? RED : q.outcome === 'partial' ? AMBER : ORANGE;
    text(`Question ${q.number}`, M, 9.5, bold);
    text(q.marks === null ? `- / ${q.maxMarks}` : `${q.marks} / ${q.maxMarks}`, M + 75, 9.5, bold, color);
    text(q.status.replace('_', ' '), W - M - 90, 8, font, GREY);
    y -= 12;
    if (summaryOnly.includes(q.number) && q.marks !== null) { text('Mark not placed on the page (answer location uncertain).', M + 120, 7, font, GREY); y -= 10; }
    for (const l of lines) { ensure(10); text(l, M + 120, 8); y -= 10; }
    y -= 6;
  }
  ensure(30);
  y -= 6;
  for (const l of wrap('AI-assisted marking against the official scheme. Marks are proposals until a teacher confirms them; questions marked "Check" need attention. The original scan is unchanged; this marked copy is a new file.', font, 7.5, W - 2 * M, 4)) { text(l, M, 7.5, font, GREY); y -= 9; }

  out.setTitle(pdfSafe(`Marked script ${s.candidateId} - ${input.meta.examTitle}`));
  out.setSubject(pdfSafe(`exam ${input.meta.examId}; run ${input.meta.runId}; revision ${input.meta.resultRevision}`));
  out.setKeywords([`candidate:${pdfSafe(s.candidateId)}`, `exam:${input.meta.examId}`, `run:${input.meta.runId}`, `revision:${input.meta.resultRevision}`, `total:${s.total}/${s.maxTotal}`]);
  out.setProducer('Bwenge.AI');
  out.setCreator('Bwenge.AI examination marking');
  out.setCreationDate(new Date(input.meta.generatedAt));
  return { pdf: Buffer.from(await out.save()), placed, summaryOnly, rebuilt, sourcePages: pages.length };
}
