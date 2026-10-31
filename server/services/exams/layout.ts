import type { DocumentResult } from '../documents/pipeline.js';
import { preDeskewSize, processedToViewed } from './pdfGeometry.js';
import type { CandidateResult, MarkConfidence, PenStyle, QuestionResult } from './types.js';
import { effectiveMarks, openFlags } from './results.js';

/**
 * Where the red marks go on a candidate's own pages. Shared by the marked PDF and the teacher's review
 * screen, so what the teacher sees and nudges is what gets printed.
 *
 * Coordinates are fractions of the page as displayed (0–1, top-left origin), the same space for the scan
 * image and the PDF page. Rules:
 *  - each question's ticks/crosses (one per marking step) and "awarded/max" sit in the right margin, level
 *    with the last line of the answer, clear of the writing; marks on one page never overlap;
 *  - a short red correction goes just under a wrong answer, only where that space is empty;
 *  - pen marks on the working itself, as a teacher would: the marker's choice per step (underline or highlight a
 *    mistake, circle a value, box a correct answer, a few words beside it), else an underline under lost marks;
 *  - the teacher's own pen marks (ticks, crosses, circles, boxes, highlights, underlines, notes) are drawn as placed;
 *  - the total is circled at the top of page 1, in the first spot that does not cover writing;
 *  - a teacher's adjustment (position or hiding) always wins over the automatic placement.
 */

export type MarkSymbol = 'tick' | 'cross' | 'half';

export interface LayoutItem {
  /**
   * "<questionId>:mark", "<questionId>:criterion:<id>", "<questionId>:correction", "<questionId>:pen:<criterion>:<element>",
   * "<questionId>:note:<criterion>", "pen:<id>" (the teacher's own) or "total".
   */
  id: string;
  /** Pen shapes use fx/fy as the top-left corner and w/h as their size; an underline's fy is the line itself. */
  kind: 'mark' | 'correction' | 'total' | 'note' | 'stamp' | PenStyle;
  /** True for the teacher's own pen marks (removable rather than hidden). */
  own?: boolean;
  questionId?: string;
  number?: string;
  page: number;
  /** Left edge (marks, corrections) or centre (total), and vertical centre, as fractions of the page. */
  fx: number;
  fy: number;
  /** Size as fractions of page width / height. */
  w: number;
  h: number;
  /** False when the answer could not be located safely; the item then appears on the summary page only. */
  placed: boolean;
  auto: boolean;
  hidden: boolean;
  symbols?: MarkSymbol[];
  label?: string;
  text?: string;
  /** Open review flags: drawn as an orange "?" in drafts and highlighted in the review screen. */
  flagged?: boolean;
  confidence?: MarkConfidence | null;
}

export interface LayoutPage { page: number; aspect: number; reliable: boolean }
export interface CandidateLayout { pages: LayoutPage[]; items: LayoutItem[] }

/** Sizes as fractions of page width. */
export const SYMBOL = 0.024;
export const GAP = 0.006;
export const LABEL_CHAR = 0.0125;
export const NOTE_CHAR = 0.0115;
const RIGHT_LIMIT = 0.985;

interface Box { x0: number; y0: number; x1: number; y1: number }
const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function symbolsFor(q: QuestionResult): MarkSymbol[] {
  const marks = effectiveMarks(q);
  if (marks === null) return [];
  const crit = q.ai?.criterionResults ?? [];
  // Per step when the AI's criterion marks stand; one symbol when the teacher overrode the total.
  if (!q.override && crit.length > 1) return crit.map((c) => (c.awardedMarks >= c.maxMarks ? 'tick' : c.awardedMarks <= 0 ? 'cross' : 'half'));
  return [marks >= q.maxMarks ? 'tick' : marks <= 0 ? 'cross' : 'half'];
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function markWidth(symbols: number, label: string) { return symbols * (SYMBOL + GAP) + SYMBOL * 0.3 + label.length * LABEL_CHAR; }

export function computeLayout(doc: DocumentResult, result: CandidateResult, total: { total: number; maxTotal: number }): CandidateLayout {
  const pages: LayoutPage[] = doc.pages.map((p) => {
    const size = p.source === 'recognition' ? preDeskewSize({ width: p.width, height: p.height, deskewDegrees: p.deskewDegrees }) : { width: p.width, height: p.height };
    return { page: p.page, aspect: size.height / Math.max(1, size.width), reliable: p.source === 'recognition' };
  });
  const aspectOf = new Map(pages.map((p) => [p.page, p.aspect]));

  // Every element's box in displayed-page fractions.
  const boxes = new Map<string, Box & { page: number; usable: boolean }>();
  const pageBoxes = new Map<number, Box[]>();
  for (const p of doc.pages) {
    const g = { width: p.width, height: p.height, deskewDegrees: p.deskewDegrees };
    const list: Box[] = [];
    for (const e of p.elements) {
      const r = e.region;
      const pts = p.source === 'recognition'
        ? [[r.x0, r.y0], [r.x1, r.y0], [r.x0, r.y1], [r.x1, r.y1]].map(([x, y]) => processedToViewed(x, y, g))
        : [{ fx: r.x0 / 1000, fy: r.y0 / 1000 }, { fx: r.x1 / 1000, fy: r.y1 / 1000 }];
      const b = { x0: clamp01(Math.min(...pts.map((q) => q.fx))), y0: clamp01(Math.min(...pts.map((q) => q.fy))), x1: clamp01(Math.max(...pts.map((q) => q.fx))), y1: clamp01(Math.max(...pts.map((q) => q.fy))) };
      const usable = p.source === 'recognition' && e.checks.region === 'ok' && b.x1 > b.x0 && b.y1 > b.y0;
      boxes.set(e.id, { ...b, page: p.page, usable });
      if (usable) list.push(b);
    }
    pageBoxes.set(p.page, list);
  }
  // The page's margin column: just right of the rightmost writing.
  const column = new Map<number, number>();
  for (const [page, list] of pageBoxes) column.set(page, list.length ? Math.max(...list.map((b) => b.x1)) + 0.02 : 0.8);

  const taken = new Map<number, Box[]>();
  const isFree = (page: number, b: Box) => b.y0 >= 0.005 && b.y1 <= 0.995 && b.x1 <= 0.995 && b.x0 >= 0.005
    && !(pageBoxes.get(page) ?? []).some((x) => overlaps(x, b)) && !(taken.get(page) ?? []).some((x) => overlaps(x, b));
  const take = (page: number, b: Box) => taken.set(page, [...(taken.get(page) ?? []), b]);

  const crossed = new Set(doc.pages.flatMap((p) => p.elements.filter((e) => e.crossedOut).map((e) => e.id)));
  const items: LayoutItem[] = [];
  for (const q of result.questions) {
    const marks = effectiveMarks(q);
    const ids = q.ai?.evidenceElementIds.length ? q.ai.evidenceElementIds : q.mappedElementIds;
    const answer = ids.filter((id) => !crossed.has(id)).map((id) => boxes.get(id)).filter((b): b is NonNullable<typeof b> => !!b && b.usable);
    const symbols = symbolsFor(q);
    const label = marks === null ? '' : `${fmt(marks)}/${fmt(q.maxMarks)}`;
    const base = { questionId: q.questionId, number: q.number, flagged: openFlags(q).length > 0, confidence: q.ai?.confidence ?? null };
    const mark: LayoutItem = { ...base, id: `${q.questionId}:mark`, kind: 'mark', page: 1, fx: 0, fy: 0, w: markWidth(symbols.length, label), h: 0, placed: false, auto: true, hidden: false, symbols, label };

    let anchor: { page: number; last: Box; startX: number } | null = null;
    if (marks !== null && answer.length) {
      // The answer ends on its last page, at its lowest line.
      const lastPage = Math.max(...answer.map((b) => b.page));
      const onPage = answer.filter((b) => b.page === lastPage);
      const last = onPage.reduce((a, b) => (b.y1 > a.y1 ? b : a));
      anchor = { page: lastPage, last, startX: Math.min(...onPage.map((b) => b.x0)) };
      const aspect = aspectOf.get(lastPage) ?? 1.414;
      const h = (SYMBOL * 1.25) / aspect;
      const lineCentre = Math.max((last.y0 + last.y1) / 2, last.y1 - 0.0125);
      let x = column.get(lastPage) ?? 0.8;
      if (x + mark.w > RIGHT_LIMIT) {
        // No room after the widest line: use the space right of the writing at this height only.
        const near = (pageBoxes.get(lastPage) ?? []).filter((b) => b.y1 > lineCentre - h && b.y0 < lineCentre + h);
        x = (near.length ? Math.max(...near.map((b) => b.x1)) : last.x1) + 0.015;
      }
      mark.page = lastPage;
      mark.h = h;
      mark.fx = x;
      if (x + mark.w <= RIGHT_LIMIT) {
        for (let k = 0; k < 8; k++) {
          const y = lineCentre + k * h * 0.6;
          const b = { x0: x, y0: y - h / 2, x1: x + mark.w, y1: y + h / 2 };
          if (isFree(lastPage, b)) { mark.fy = y; mark.placed = true; take(lastPage, b); break; }
        }
      }
    }
    items.push(mark);
    // Place criterion symbols against their cited working, using the same geometry in PDFs.
    if (!q.override && marks !== null && (q.ai?.criterionResults.length ?? 0) > 1) {
      const reserved = taken.get(mark.page) ?? [];
      if (mark.placed) taken.set(mark.page, reserved.slice(0, -1));
      const steps: LayoutItem[] = [];
      for (const c of q.ai!.criterionResults) {
        const evidence = (c.evidenceElementIds ?? []).filter(id => !crossed.has(id)).map(id => boxes.get(id)).filter(b => b?.usable);
        const last = evidence.sort((a, b) => b!.page - a!.page || b!.y1 - a!.y1)[0];
        if (!last) break;
        const h = SYMBOL * 1.25 / (aspectOf.get(last.page) ?? 1.414);
        const label = `${fmt(c.awardedMarks)}/${fmt(c.maxMarks)}`;
        const w = markWidth(1, label), x = last.x1 + 0.015, y = (last.y0 + last.y1) / 2;
        const box = { x0: x, x1: x + w, y0: y - h / 2, y1: y + h / 2 };
        if (!isFree(last.page, box) || steps.some(it => it.page === last.page && overlaps(box, { x0: it.fx, x1: it.fx + it.w, y0: it.fy - it.h / 2, y1: it.fy + it.h / 2 }))) break;
        steps.push({ ...base, id: `${q.questionId}:criterion:${c.criterionId}`, kind: 'mark', page: last.page,
          fx: x, fy: y, w, h, placed: true, auto: true, hidden: false, label,
          symbols: [c.awardedMarks >= c.maxMarks ? 'tick' : c.awardedMarks <= 0 ? 'cross' : 'half'] });
      }
      if (steps.length === q.ai!.criterionResults.length) {
        mark.symbols = []; // Keep the question total, without duplicating the step symbols.
        mark.placed = false;
        for (const step of steps) { items.push(step); take(step.page, { x0: step.fx, x1: step.fx + step.w, y0: step.fy - step.h / 2, y1: step.fy + step.h / 2 }); }
        for (let k = 1; k <= 12; k++) {
          const y = mark.fy + k * mark.h;
          const box = { x0: mark.fx, x1: mark.fx + mark.w, y0: y - mark.h / 2, y1: y + mark.h / 2 };
          if (isFree(mark.page, box)) { mark.fy = y; mark.placed = true; take(mark.page, box); break; }
        }
      } else taken.set(mark.page, reserved);
    }

    // Pen marks on the working itself: the marker's choice per step, else an underline under lost marks.
    if (!q.override && marks !== null) {
      for (const c of q.ai?.criterionResults ?? []) {
        const style: PenStyle | null = c.pen ?? (c.awardedMarks < c.maxMarks ? 'underline' : null);
        if (!style && !c.note) continue;
        const lines = (c.evidenceElementIds ?? []).filter((id) => !crossed.has(id)).map((id) => [id, boxes.get(id)] as const).filter(([, b]) => b?.usable).slice(0, style === 'circle' || style === 'box' ? 1 : 3);
        for (const [id, b] of style ? lines : []) {
          const w = Math.max(0.02, b!.x1 - b!.x0), pad = 0.006;
          items.push({ ...base, id: `${q.questionId}:pen:${c.criterionId}:${id}`, kind: style!, page: b!.page, placed: true, auto: true, hidden: false,
            ...(style === 'underline' ? { fx: b!.x0, fy: Math.min(0.995, b!.y1 + 0.003), w, h: 0.004 } : { fx: Math.max(0, b!.x0 - pad), fy: Math.max(0, b!.y0 - pad), w: w + 2 * pad, h: b!.y1 - b!.y0 + 2 * pad }) });
        }
        const at = lines[lines.length - 1]?.[1];
        if (c.note && at) {
          // The note goes beside the working, or just under it, wherever it covers no writing.
          const aspect = aspectOf.get(at.page) ?? 1.414, h = 0.024 / aspect, w = c.note.length * NOTE_CHAR;
          const tries = [{ x: at.x1 + 0.012, y: (at.y0 + at.y1) / 2 }, { x: at.x0, y: at.y1 + h * 0.9 }];
          for (const t of tries) {
            const x = Math.min(t.x, RIGHT_LIMIT - w), b = { x0: x, y0: t.y - h / 2, x1: x + w, y1: t.y + h / 2 };
            if (x >= 0.01 && isFree(at.page, b)) { items.push({ ...base, id: `${q.questionId}:note:${c.criterionId}`, kind: 'note', page: at.page, fx: x, fy: t.y, w, h, placed: true, auto: true, hidden: false, text: c.note }); take(at.page, b); break; }
          }
        }
      }
    }

    const text = marks !== null && marks < q.maxMarks ? q.ai?.correction?.trim() : '';
    if (text) {
      const corr: LayoutItem = { ...base, id: `${q.questionId}:correction`, kind: 'correction', page: anchor?.page ?? 1, fx: 0, fy: 0, w: text.length * NOTE_CHAR, h: 0, placed: false, auto: true, hidden: false, text };
      if (anchor) {
        const aspect = aspectOf.get(anchor.page) ?? 1.414;
        corr.h = 0.028 / aspect;
        const tries = [
          { x: anchor.startX, y: anchor.last.y1 + corr.h * 0.75 },
          ...(mark.placed ? [{ x: mark.fx, y: mark.fy + mark.h / 2 + corr.h / 2 + 0.003 }] : []),
        ];
        for (const t of tries) {
          const x = Math.min(t.x, RIGHT_LIMIT - corr.w);
          const b = { x0: x, y0: t.y - corr.h / 2, x1: x + corr.w, y1: t.y + corr.h / 2 };
          if (x >= 0.01 && isFree(anchor.page, b)) { corr.fx = x; corr.fy = t.y; corr.placed = true; take(anchor.page, b); break; }
        }
      }
      items.push(corr);
    }
  }

  const aspect1 = aspectOf.get(1) ?? 1.414;
  const totalLabel = `${fmt(total.total)}/${fmt(total.maxTotal)}`;
  const tw = Math.max(0.09, totalLabel.length * 0.017 + 0.04);
  const th = 0.05 / aspect1;
  // The first corner of page 1 where the circle covers no writing: top right, top left, top centre, then bottom.
  const spots = [[RIGHT_LIMIT - tw / 2 - 0.01, 0.045], [tw / 2 + 0.03, 0.045], [0.5, 0.035], [RIGHT_LIMIT - tw / 2 - 0.01, 0.955], [tw / 2 + 0.03, 0.955]];
  const spot = spots.find(([x, y]) => isFree(1, { x0: x - tw / 2, x1: x + tw / 2, y0: y - th / 2, y1: y + th / 2 })) ?? spots[0];
  items.push({ id: 'total', kind: 'total', page: 1, fx: spot[0], fy: spot[1], w: tw, h: th, placed: doc.pages.length > 0, auto: true, hidden: false, label: totalLabel });

  // The teacher's own pen marks, drawn where they were placed.
  for (const m of result.pen ?? []) {
    if (!aspectOf.has(m.page)) continue;
    const box = { fx: Math.min(m.x0, m.x1), fy: Math.min(m.y0, m.y1), w: Math.abs(m.x1 - m.x0), h: Math.abs(m.y1 - m.y0) };
    const common = { id: `pen:${m.id}`, page: m.page, placed: true, auto: false, hidden: false, own: true };
    if (m.kind === 'tick' || m.kind === 'cross') items.push({ ...common, kind: 'stamp', fx: m.x0, fy: m.y0, w: SYMBOL, h: SYMBOL / (aspectOf.get(m.page) ?? 1.414), symbols: [m.kind] });
    else if (m.kind === 'note') items.push({ ...common, kind: 'note', fx: m.x0, fy: m.y0, w: (m.text ?? '').length * NOTE_CHAR, h: 0.024 / (aspectOf.get(m.page) ?? 1.414), text: m.text ?? '' });
    else if (m.kind === 'underline') items.push({ ...common, kind: 'underline', fx: box.fx, fy: box.fy + box.h, w: Math.max(0.01, box.w), h: 0.004 });
    else items.push({ ...common, kind: m.kind, ...box });
  }

  // Teacher adjustments win.
  for (const it of items) {
    const o = result.layout?.[it.id];
    if (!o) continue;
    if (o.hidden) { it.hidden = true; it.placed = false; it.auto = false; continue; }
    if (!aspectOf.has(o.page)) continue;
    it.page = o.page;
    it.fx = clamp01(o.fx);
    it.fy = clamp01(o.fy);
    if (!it.h) it.h = (it.kind === 'correction' ? 0.024 : SYMBOL * 1.25) / (aspectOf.get(o.page) ?? 1.414);
    it.placed = it.kind !== 'mark' || it.label !== '';
    it.auto = false;
  }
  return { pages, items };
}
