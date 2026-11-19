import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { characterErrorRate, wordErrorRate } from './metrics.js';

/**
 * Measuring how well handwriting is read, and what each part of the pipeline is worth.
 *
 * Real pages are the only true test, but one clean page can be turned into the conditions a phone really produces (a sheet on a desk with a
 * shadow, a tilt, blur, poor light). Reading the clean page, the degraded page as it is, and the degraded page after cleanup shows how much
 * each condition costs and how much of that the cleanup wins back. Everything here is pure or takes the reader as an argument, so it is tested
 * without a model.
 */

export const CONDITIONS = ['clean', 'desk_shadow', 'dim', 'blurred', 'low_res', 'tilted'] as const;
export type Condition = typeof CONDITIONS[number];

const svgShade = (w: number, h: number, stops: Array<[number, number]>) => Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="0">${stops.map(([o, a]) => `<stop offset="${o}" stop-color="#000" stop-opacity="${a}"/>`).join('')}</linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`);

/** Turns a page image into what a phone camera would have produced under one condition. Deterministic. */
export async function degrade(image: Buffer, condition: Condition): Promise<Buffer> {
  if (condition === 'clean') return image;
  const meta = await sharp(image).metadata();
  const w = meta.width ?? 1000, h = meta.height ?? 1400;
  switch (condition) {
    case 'desk_shadow': {
      // The sheet tilted 3° on a dark desk, a shadow falling across its left side, then JPEG like a phone.
      const tilted = await sharp(image).rotate(3, { background: '#f4f2ea' }).png().toBuffer();
      const tm = await sharp(tilted).metadata();
      const tw = tm.width ?? w, th = tm.height ?? h;
      const shaded = await sharp(tilted).composite([{ input: svgShade(tw, th, [[0, 0.55], [0.5, 0.1], [1, 0]]) }]).png().toBuffer();
      const margin = Math.round(Math.max(tw, th) * 0.18);
      return sharp({ create: { width: tw + margin * 2, height: th + margin * 2, channels: 3, background: '#2b2118' } })
        .composite([{ input: shaded, left: margin, top: margin }]).jpeg({ quality: 80 }).toBuffer();
    }
    case 'dim':
      return sharp(image).modulate({ brightness: 0.55 }).linear(0.7, 0).jpeg({ quality: 80 }).toBuffer();
    case 'blurred':
      return sharp(image).blur(Math.max(1.5, w / 600)).jpeg({ quality: 85 }).toBuffer();
    case 'low_res':
      return sharp(image).resize({ width: Math.max(300, Math.round(w * 0.4)) }).jpeg({ quality: 70 }).toBuffer();
    case 'tilted':
      return sharp(image).rotate(6, { background: '#ffffff' }).flatten({ background: '#ffffff' }).jpeg({ quality: 85 }).toBuffer();
  }
}

export interface EvalCase { name: string; image: Buffer; truth: string; tags: string[]; language?: string }
/** Reads one page image and returns the text. `cleanup: false` must skip the photo cleanup steps, to measure what they are worth. */
export type Reader = (image: Buffer, mode: { cleanup: boolean }) => Promise<string>;

export interface EvalRow {
  name: string; condition: Condition; cleanup: boolean; tags: string[]; language: string;
  /** Edits (substitutions + deletions + insertions) and reference size, so groups can be pooled exactly. */
  charEdits: number; charRef: number; wordEdits: number; wordRef: number;
  cer: number | null; wer: number | null; error?: string;
}

const edits = (e: { substitutions: number; deletions: number; insertions: number }) => e.substitutions + e.deletions + e.insertions;

export async function runCases(cases: EvalCase[], reader: Reader, opts: { conditions?: Condition[]; modes?: boolean[] } = {}): Promise<EvalRow[]> {
  const conditions = opts.conditions ?? ['clean'];
  const modes = opts.modes ?? [true];
  const rows: EvalRow[] = [];
  for (const c of cases) {
    for (const condition of conditions) {
      const image = await degrade(c.image, condition);
      for (const cleanup of modes) {
        // A clean page has nothing to clean up: one reading is enough.
        if (condition === 'clean' && !cleanup && modes.includes(true)) continue;
        const base = { name: c.name, condition, cleanup, tags: c.tags, language: c.language ?? 'unspecified' };
        try {
          const text = await reader(image, { cleanup });
          const cer = characterErrorRate(c.truth, text), wer = wordErrorRate(c.truth, text);
          rows.push({ ...base, charEdits: edits(cer), charRef: cer.reference, wordEdits: edits(wer), wordRef: wer.reference, cer: cer.rate, wer: wer.rate });
        } catch (e: any) {
          // A page that could not be read counts as everything wrong, never as a pass.
          const cer = characterErrorRate(c.truth, ''), wer = wordErrorRate(c.truth, '');
          rows.push({ ...base, charEdits: edits(cer), charRef: cer.reference, wordEdits: edits(wer), wordRef: wer.reference, cer: cer.rate, wer: wer.rate, error: String(e?.message ?? e).slice(0, 160) });
        }
      }
    }
  }
  return rows;
}

export interface Group { key: string; pages: number; cer: number | null; wer: number | null; failed: number }
/** Pools rows by a key (exact weighted error rates: total edits over total reference length, not an average of averages). */
export function summarize(rows: EvalRow[], by: (r: EvalRow) => string | string[]): Group[] {
  const acc = new Map<string, { n: number; ce: number; cr: number; we: number; wr: number; failed: number }>();
  for (const r of rows) {
    for (const key of [by(r)].flat()) {
      const a = acc.get(key) ?? { n: 0, ce: 0, cr: 0, we: 0, wr: 0, failed: 0 };
      a.n++; a.ce += r.charEdits; a.cr += r.charRef; a.we += r.wordEdits; a.wr += r.wordRef; if (r.error) a.failed++;
      acc.set(key, a);
    }
  }
  return [...acc.entries()].map(([key, a]) => ({ key, pages: a.n, cer: a.cr ? a.ce / a.cr : null, wer: a.wr ? a.we / a.wr : null, failed: a.failed })).sort((x, y) => x.key.localeCompare(y.key));
}

export interface Gain { condition: Condition; asIs: number | null; cleaned: number | null; /** asIs − cleaned: positive means the cleanup helped. */ gain: number | null }
/** What the cleanup wins back for each condition, in character error rate (percentage points as a fraction). */
export function cleanupGain(rows: EvalRow[]): Gain[] {
  const out: Gain[] = [];
  for (const condition of CONDITIONS) {
    const here = rows.filter((r) => r.condition === condition);
    if (!here.length) continue;
    const rate = (list: EvalRow[]) => { const s = summarize(list, () => 'x')[0]; return s ? s.cer : null; };
    const cleaned = rate(here.filter((r) => r.cleanup)), asIs = condition === 'clean' ? cleaned : rate(here.filter((r) => !r.cleanup));
    out.push({ condition, asIs, cleaned, gain: asIs !== null && cleaned !== null ? asIs - cleaned : null });
  }
  return out;
}

const pct = (v: number | null) => (v === null ? 'n/a' : `${(v * 100).toFixed(1)}%`);
const pp = (v: number | null) => (v === null ? 'n/a' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)} pts`);

/** A plain-text report a teacher or developer can read: overall, by condition, by tag, by language, and what cleanup is worth. */
export function formatReport(rows: EvalRow[]): string {
  const lines: string[] = [];
  const table = (title: string, groups: Group[]) => {
    if (!groups.length) return;
    lines.push('', title, ...groups.map((g) => `  ${g.key.padEnd(24)} ${String(g.pages).padStart(3)} reading${g.pages === 1 ? ' ' : 's'}  CER ${pct(g.cer).padStart(6)}  WER ${pct(g.wer).padStart(6)}${g.failed ? `  (${g.failed} failed)` : ''}`));
  };
  const cleaned = rows.filter((r) => r.cleanup || r.condition === 'clean');
  table('Overall (with cleanup)', summarize(cleaned, () => 'all pages'));
  table('By condition (with cleanup)', summarize(cleaned, (r) => r.condition));
  table('By kind of writing (tags)', summarize(cleaned, (r) => (r.tags.length ? r.tags : ['untagged'])));
  table('By language', summarize(cleaned, (r) => r.language));
  const gains = cleanupGain(rows).filter((g) => g.condition !== 'clean');
  if (gains.length) lines.push('', 'What the cleanup is worth (character error rate, lower is better)', ...gains.map((g) => `  ${g.condition.padEnd(24)} as is ${pct(g.asIs).padStart(6)}  cleaned ${pct(g.cleaned).padStart(6)}  ${pp(g.gain === null ? null : g.gain)} ${g.gain !== null && g.gain > 0.005 ? 'better' : g.gain !== null && g.gain < -0.005 ? 'WORSE' : 'same'}`));
  const failed = rows.filter((r) => r.error);
  if (failed.length) lines.push('', `${failed.length} reading(s) failed and count as fully wrong: ${[...new Set(failed.map((f) => f.error))].slice(0, 3).join(' | ')}`);
  return lines.join('\n').trim();
}

/**
 * Saves a page and its checked text as a new case in the evaluation folder (name.jpg, name.txt, name.json), so a teacher's correction becomes
 * a test. `truth` is the document text with the teacher's corrections applied (see `documentText(result, corrections)`). Only pages the owner
 * agreed to share, with names removed, belong here. Refuses to overwrite an existing case.
 */
export async function writeEvalCase(dir: string, name: string, image: Buffer, truth: string, meta: { tags?: string[]; language?: string } = {}): Promise<string> {
  const base = name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  if (!base) throw new Error('A case needs a name.');
  if (!truth.trim()) throw new Error('A case needs the correct text.');
  await fs.mkdir(dir, { recursive: true });
  const img = path.join(dir, `${base}.jpg`);
  if (await fs.stat(img).then(() => true, () => false)) throw new Error(`${base} already exists in ${dir}.`);
  await fs.writeFile(img, await sharp(image, { limitInputPixels: 100_000_000 }).rotate().flatten({ background: '#ffffff' }).jpeg({ quality: 92 }).toBuffer());
  await fs.writeFile(path.join(dir, `${base}.txt`), truth.endsWith('\n') ? truth : `${truth}\n`);
  if (meta.tags?.length || meta.language) await fs.writeFile(path.join(dir, `${base}.json`), JSON.stringify({ tags: meta.tags ?? [], language: meta.language }, null, 2));
  return base;
}
