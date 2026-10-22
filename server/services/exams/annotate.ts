import sharp from 'sharp';
import { PDFArray, PDFDict, PDFDocument, PDFName, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { DocumentResult } from '../documents/pipeline.js';
import { loadPages } from '../documents/pages.js';
import { regionPointToPdf, viewedSize, type PdfBox } from './pdfGeometry.js';
import type { CandidateSummary } from './results.js';
import type { MarkingScheme } from './scheme.js';
import type { CandidateResult } from './types.js';
import { effectiveMarks, openFlags } from './results.js';

/**
 * Marked copy of a candidate's script. The original file is never modified: its pages are copied into a
 * new PDF, marks are drawn in the margin next to each answer where the geometry is reliable, and summary
 * pages are appended. Answers that cannot be located reliably are reported on the summary page only.
 */

const GREEN = rgb(0.09, 0.55, 0.24), RED = rgb(0.8, 0.12, 0.12), AMBER = rgb(0.85, 0.5, 0.0), ORANGE = rgb(0.93, 0.42, 0.0), INK = rgb(0.12, 0.12, 0.14), GREY = rgb(0.45, 0.45, 0.5);

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

function drawSymbol(page: PDFPage, kind: 'full' | 'partial' | 'zero' | 'review', x: number, y: number, size: number, rot: number) {
  // Draws in a local, upright frame at (x, y) rotated with the page so the mark reads correctly.
  const a = (rot * Math.PI) / 180;
  const P = (u: number, v: number) => ({ x: x + u * Math.cos(a) - v * Math.sin(a), y: y + u * Math.sin(a) + v * Math.cos(a) });
  const line = (u1: number, v1: number, u2: number, v2: number, color: ReturnType<typeof rgb>) => page.drawLine({ start: P(u1, v1), end: P(u2, v2), thickness: 1.8, color });
  const s = size;
  if (kind === 'full' || kind === 'partial') {
    const color = kind === 'full' ? GREEN : AMBER;
    line(0, s * 0.45, s * 0.35, s * 0.1, color);
    line(s * 0.35, s * 0.1, s, s * 0.9, color);
    // Partial credit: a tick with a short bar across its long stroke (distinct from a red cross).
    if (kind === 'partial') line(s * 0.48, s * 0.5, s * 0.9, s * 0.5, color);
  } else if (kind === 'zero') {
    line(0, 0, s, s, RED);
    line(0, s, s, 0, RED);
  } else {
    const c = P(s / 2, s / 2);
    page.drawCircle({ x: c.x, y: c.y, size: s / 2, borderColor: ORANGE, borderWidth: 1.4 });
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
}

export interface AnnotateOutput { pdf: Buffer; placed: number; summaryOnly: string[]; rebuilt: boolean }

export async function annotateScript(input: AnnotateInput): Promise<AnnotateOutput> {
  const { doc: out, rebuilt } = await sourcePages(input.original, input.fileName, input.maxPages ?? 50);
  const font = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  const pages = out.getPages();
  const docPages = new Map(input.doc.pages.map((p) => [p.page, p]));
  const summaryOnly: string[] = [];
  let placed = 0;
  // Vertical bands already used by marks, per page and side (in 0–1000 page units), so marks never overlap.
  const used = new Map<string, Array<[number, number]>>();

  for (const q of input.result.questions) {
    const marks = effectiveMarks(q);
    const ids = q.ai?.evidenceElementIds.length ? q.ai.evidenceElementIds : q.mappedElementIds;
    // Locate the answer: the first page with reliably placed, uncrossed evidence.
    let target: { page: number; x0: number; y0: number; x1: number; y1: number } | null = null;
    for (const p of input.doc.pages) {
      const els = p.elements.filter((e) => ids.includes(e.id) && !e.crossedOut && e.checks.region === 'ok' && p.source === 'recognition');
      if (!els.length) continue;
      target = { page: p.page, x0: Math.min(...els.map((e) => e.region.x0)), y0: Math.min(...els.map((e) => e.region.y0)), x1: Math.max(...els.map((e) => e.region.x1)), y1: Math.max(...els.map((e) => e.region.y1)) };
      break;
    }
    const page = target ? pages[target.page - 1] : undefined;
    const dp = target ? docPages.get(target.page) : undefined;
    if (!target || !page || !dp || marks === null) { summaryOnly.push(q.number); continue; }
    const side = target.x1 <= 880 ? 'right' : target.x0 >= 120 ? 'left' : null;
    if (!side) { summaryOnly.push(q.number); continue; }

    const crop = page.getCropBox();
    const box: PdfBox = { x: crop.x, y: crop.y, width: crop.width, height: crop.height };
    const rot = page.getRotation().angle;
    const g = { width: dp.width, height: dp.height, deskewDegrees: dp.deskewDegrees };
    const vs = viewedSize(box, rot);
    const size = Math.max(10, Math.min(16, vs.width / 40));
    const unit = 1000 / vs.height;
    const markH = size * 1.3 * unit;
    const noteText = q.ai?.lostMarks && marks < q.maxMarks ? q.ai.lostMarks : '';
    const bands = used.get(`${target.page}:${side}`) ?? [];
    const free = (top: number, h: number) => bands.every(([a, b]) => top + h <= a || top >= b);
    let anchorY = Math.min(target.y0 + 30, (target.y0 + target.y1) / 2);
    // Move below any earlier mark on the same side; give up the margin note before moving far from the answer.
    while (!free(anchorY - markH * 0.8, markH) && anchorY < target.y1 + 3 * markH) anchorY += markH * 0.5;
    const noteH = (3 * 8 + 4) * unit;
    const noteFits = !!noteText && free(anchorY + markH * 0.2, noteH);
    bands.push([anchorY - markH * 0.8, anchorY + markH * 0.2 + (noteFits ? noteH : 0)]);
    used.set(`${target.page}:${side}`, bands);
    const anchorX = side === 'right' ? Math.min(target.x1 + 18, 1000 - (size * 7.5 * 1000) / vs.width) : Math.max(8, target.x0 - (size * 6 * 1000) / vs.width);
    const at = regionPointToPdf(anchorX, anchorY, g, box, rot);
    const kind = marks >= q.maxMarks ? 'full' : marks <= 0 ? 'zero' : 'partial';
    drawSymbol(page, kind, at.x, at.y, size, rot);
    const a = (rot * Math.PI) / 180;
    const off = (u: number, v: number) => ({ x: at.x + u * Math.cos(a) - v * Math.sin(a), y: at.y + u * Math.sin(a) + v * Math.cos(a) });
    const label = pdfSafe(`${marks}/${q.maxMarks}`);
    const color = kind === 'full' ? GREEN : kind === 'zero' ? RED : AMBER;
    page.drawText(label, { ...off(size * 1.2, size * 0.15), size: size * 0.85, font: bold, color, rotate: degrees(rot) });
    if (openFlags(q).length) {
      const rx = size * 1.3 + bold.widthOfTextAtSize(label, size * 0.85);
      drawSymbol(page, 'review', off(rx, 0).x, off(rx, 0).y, size * 0.8, rot);
      page.drawText('?', { ...off(rx + size * 0.27, size * 0.18), size: size * 0.6, font: bold, color: ORANGE, rotate: degrees(rot) });
    }
    // A short note only where the margin has room; the full explanation is on the summary page.
    const marginPts = side === 'right' ? ((1000 - target.x1 - 18) / 1000) * vs.width : ((target.x0 - 8) / 1000) * vs.width;
    const note = noteFits ? noteText : '';
    if (note && marginPts >= 70) {
      const lines = wrap(note, font, 6.5, Math.min(marginPts - 6, 160), 3);
      lines.forEach((l, i) => page.drawText(l, { ...off(0, -size * 0.6 - 8 * (i + 1)), size: 6.5, font, color: GREY, rotate: degrees(rot) }));
    }
    placed++;
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
  const statusLine = s.status === 'user_confirmed' ? 'Confirmed by the user' : s.status === 'user_corrected' ? 'Includes user corrections; other marks are AI-proposed' : s.status === 'needs_review' ? 'PROVISIONAL - items need review' : 'PROVISIONAL - AI-proposed, not examiner-certified';
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
    const fb = [rq?.override ? `Examiner override: ${rq.override.reason}` : '', rq?.ai?.feedback ?? '', rq?.ai?.lostMarks ? `Lost marks: ${rq.ai.lostMarks}` : '', ...q.flags.map((f) => `Check: ${f.detail}`)].filter(Boolean).join('\n');
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
  for (const l of wrap('AI-assisted marking against the official scheme. Marks are proposals until a teacher confirms them; questions marked "Check" need attention. Original pages are unchanged apart from the margin marks.', font, 7.5, W - 2 * M, 4)) { text(l, M, 7.5, font, GREY); y -= 9; }

  out.setTitle(pdfSafe(`Marked script ${s.candidateId} - ${input.meta.examTitle}`));
  out.setSubject(pdfSafe(`exam ${input.meta.examId}; run ${input.meta.runId}; revision ${input.meta.resultRevision}`));
  out.setKeywords([`candidate:${pdfSafe(s.candidateId)}`, `exam:${input.meta.examId}`, `run:${input.meta.runId}`, `revision:${input.meta.resultRevision}`]);
  out.setProducer('Bwenge.AI');
  out.setCreator('Bwenge.AI examination marking');
  out.setCreationDate(new Date(input.meta.generatedAt));
  return { pdf: Buffer.from(await out.save()), placed, summaryOnly, rebuilt };
}
