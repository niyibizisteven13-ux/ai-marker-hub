import { z } from 'zod';

/**
 * Rubric parsing and validation. The instructor's rubric is never changed: inconsistencies are reported
 * as errors (assessment refused) or warnings (assessment allowed), never silently corrected.
 */

const level = z.object({
  label: z.string().trim().min(1).max(80),
  minMarks: z.number().min(0),
  maxMarks: z.number().min(0),
  descriptor: z.string().trim().max(2000).default(''),
}).strict();

const criterion = z.object({
  id: z.string().trim().regex(/^[A-Za-z0-9_.-]{1,40}$/).optional(),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).default(''),
  maxMarks: z.number().positive().max(1000),
  /** Optional weight in percent of the total. When given, it must agree with maxMarks / totalMarks. */
  weight: z.number().positive().max(100).optional(),
  levels: z.array(level).max(10).optional(),
}).strict();

export const rubricSchema = z.object({
  title: z.string().trim().max(200).optional(),
  totalMarks: z.number().positive().max(10000),
  allowHalfMarks: z.boolean().default(true),
  criteria: z.array(criterion).min(1).max(40),
}).strict();

export type RubricInput = z.input<typeof rubricSchema>;
export type Rubric = Omit<z.output<typeof rubricSchema>, 'criteria'> & { criteria: Array<z.output<typeof criterion> & { id: string }> };

export interface RubricValidation {
  rubric: Rubric | null;
  errors: string[];
  warnings: string[];
}

const EPS = 1e-9;

export function validateRubric(input: unknown): RubricValidation {
  const parsed = rubricSchema.safeParse(input);
  if (!parsed.success) {
    return { rubric: null, errors: parsed.error.issues.map((i) => `${i.path.join('.') || 'rubric'}: ${i.message}`), warnings: [] };
  }
  const r = parsed.data;
  const errors: string[] = [];
  const warnings: string[] = [];
  const ids = new Set<string>();
  const criteria = r.criteria.map((c, i) => {
    const id = c.id ?? `C${i + 1}`;
    if (ids.has(id)) errors.push(`Criterion id "${id}" is used more than once.`);
    ids.add(id);
    return { ...c, id };
  });
  const names = criteria.map((c) => c.name.toLowerCase());
  names.forEach((n, i) => { if (names.indexOf(n) !== i) warnings.push(`Two criteria are both named "${criteria[i].name}".`); });

  const sum = criteria.reduce((a, c) => a + c.maxMarks, 0);
  if (Math.abs(sum - r.totalMarks) > EPS) {
    errors.push(`Criterion maximum marks add up to ${sum}, but the total available marks is ${r.totalMarks}. Fix the rubric; it will not be adjusted automatically.`);
  }
  const weighted = criteria.filter((c) => c.weight !== undefined);
  if (weighted.length && weighted.length !== criteria.length) errors.push('Either every criterion has a weight or none does.');
  if (weighted.length === criteria.length) {
    const wsum = criteria.reduce((a, c) => a + (c.weight ?? 0), 0);
    if (Math.abs(wsum - 100) > 1e-6) errors.push(`Criterion weights add up to ${wsum}%, not 100%.`);
    for (const c of criteria) {
      const expected = (c.weight! / 100) * r.totalMarks;
      if (Math.abs(expected - c.maxMarks) > 1e-6) errors.push(`"${c.name}": weight ${c.weight}% of ${r.totalMarks} is ${expected} marks, but its maximum is ${c.maxMarks}.`);
    }
  }
  for (const c of criteria) {
    if (!r.allowHalfMarks && !Number.isInteger(c.maxMarks)) errors.push(`"${c.name}": maximum ${c.maxMarks} is not a whole number but half marks are not allowed.`);
    if (!c.description && !c.levels?.length) warnings.push(`"${c.name}" has no description or performance levels; marking it will rely on the criterion name alone and is less reliable.`);
    if (c.levels?.length) {
      const ls = [...c.levels].sort((a, b) => a.minMarks - b.minMarks);
      for (const l of ls) {
        if (l.minMarks > l.maxMarks) errors.push(`"${c.name}" level "${l.label}": minimum ${l.minMarks} is above maximum ${l.maxMarks}.`);
        if (l.maxMarks > c.maxMarks + EPS) errors.push(`"${c.name}" level "${l.label}": maximum ${l.maxMarks} exceeds the criterion maximum ${c.maxMarks}.`);
      }
      for (let i = 1; i < ls.length; i++) {
        if (ls[i].minMarks <= ls[i - 1].maxMarks - EPS) warnings.push(`"${c.name}": levels "${ls[i - 1].label}" and "${ls[i].label}" overlap.`);
      }
      if (Math.abs(ls[ls.length - 1].maxMarks - c.maxMarks) > EPS) warnings.push(`"${c.name}": no level reaches the full ${c.maxMarks} marks.`);
      if (ls[0].minMarks > EPS) warnings.push(`"${c.name}": no level covers 0 marks.`);
    }
  }
  return { rubric: errors.length ? null : { ...r, criteria }, errors, warnings };
}

/**
 * Parses a plain-text rubric. Recognised lines (marks may be "10 marks", "10 pts", "/10" or "10"):
 *   Criterion name (10 marks): description
 *   Criterion name - 10 marks - description
 *     - Level label (8-10): descriptor        (indented or bulleted under a criterion)
 *   Total: 30 marks
 * Lines that cannot be parsed are returned, never guessed.
 */
export function parseTextRubric(text: string): { input: RubricInput | null; unparsed: string[]; errors: string[] } {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const criteria: NonNullable<RubricInput['criteria']> = [];
  const unparsed: string[] = [];
  let total: number | null = null;
  let title: string | undefined;
  const marks = String.raw`(\d+(?:\.\d+)?)\s*(?:marks?|pts?|points?)?`;
  const crit1 = new RegExp(String.raw`^\s*(?:\d+[.)]\s*)?([^():\-|]{2,200}?)\s*\(\s*(?:\/\s*)?${marks}\s*\)\s*[:\-–]?\s*(.*)$`, 'i');
  const crit2 = new RegExp(String.raw`^\s*(?:\d+[.)]\s*)?([^:\-|]{2,200}?)\s*[-–|:]\s*${marks}\s*(?:[-–|:]\s*(.*))?$`, 'i');
  const lvl = /^\s*(?:[-*•]|\s{2,})\s*([^():]{1,80}?)\s*\(\s*(\d+(?:\.\d+)?)\s*(?:[-–to]+\s*(\d+(?:\.\d+)?))?\s*(?:marks?|pts?)?\s*\)\s*[:\-–]?\s*(.*)$/i;
  const tot = /^\s*total\s*(?:marks)?\s*[:=-]?\s*(\d+(?:\.\d+)?)/i;
  for (const raw of lines) {
    const line = raw.replace(/﻿/g, '');
    if (!line.trim()) continue;
    let m: RegExpExecArray | null;
    if ((m = tot.exec(line))) { total = Number(m[1]); continue; }
    if ((m = lvl.exec(line)) && criteria.length) {
      const c = criteria[criteria.length - 1];
      const lo = Number(m[2]);
      const hi = m[3] !== undefined ? Number(m[3]) : lo;
      (c.levels ??= []).push({ label: m[1].trim(), minMarks: Math.min(lo, hi), maxMarks: Math.max(lo, hi), descriptor: m[4]?.trim() ?? '' });
      continue;
    }
    if ((m = crit1.exec(line)) || (m = crit2.exec(line))) {
      criteria.push({ name: m[1].trim(), maxMarks: Number(m[2]), description: (m[3] ?? '').trim() });
      continue;
    }
    if (!criteria.length && !title && line.trim().length <= 200) { title = line.trim(); continue; }
    if (criteria.length && /^\s{2,}\S/.test(raw) && !criteria[criteria.length - 1].levels?.length) {
      const c = criteria[criteria.length - 1];
      c.description = `${c.description ? `${c.description} ` : ''}${line.trim()}`;
      continue;
    }
    unparsed.push(line.trim());
  }
  const errors: string[] = [];
  if (!criteria.length) errors.push('No criteria with marks were found. Use lines like "Analysis (10 marks): description".');
  if (total === null && criteria.length) errors.push('No "Total: N marks" line was found. State the total explicitly so it can be checked against the criteria.');
  return { input: criteria.length && total !== null ? { title, totalMarks: total, criteria } : null, unparsed, errors };
}
