/**
 * Dataset quality gates, de-duplication, leakage-safe splits and export.
 * Pure functions (no database access) so they are easy to test and to reuse from
 * admin routes, import scripts and the training export.
 *
 * Everything here is a HEURISTIC safety net. It catches common mistakes; it does
 * not replace native-speaker review. Tune the thresholds on your own data.
 */
import { createHash } from 'node:crypto';
import { detectLanguage } from './prompts/kinyarwandaStyle.js';

export type ExampleType = 'qa' | 'instruction' | 'rewrite' | 'preference' | 'transcript' | 'vision';
export type Origin = 'human_written' | 'human_corrected' | 'document_extracted' | 'harvested_db' | 'ai_synthetic';
export type ExampleStatus = 'pending' | 'approved' | 'rejected';
export type Split = 'train' | 'validation' | 'test';

export interface DatasetExample {
  id: string;
  type: ExampleType;
  instruction: string;
  input?: string;
  output: string;
  /** Only for type 'preference': the answer that was judged worse. */
  rejectedOutput?: string;
  language?: 'rw' | 'fr' | 'en' | 'mixed';
  domain?: string;
  region?: string;
  origin: Origin;
  status?: ExampleStatus;
  /** Source document / recording ids. The first one is used to keep related examples in the same split. */
  sourceIds?: string[];
  /** People who verified this example. AI-synthetic examples need at least one. */
  reviewerIds?: string[];
  /** True only if the data owner gave documented consent for personal data in this example. */
  consent?: boolean;
  /** True only after a human has reviewed this example for personal data. */
  piiReviewed?: boolean;
}

export interface Issue {
  code: string;
  severity: 'blocker' | 'warning';
  message: string;
}

/* ───────────── Text helpers ───────────── */

function fold(value: string): string {
  return value.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
}

/** Lowercase, accent-free, punctuation-free, whitespace-collapsed form used for duplicate detection. */
export function normalizeForDedupe(value: string): string {
  return fold(value).replace(/[^\p{L}\p{N}\s]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/* ───────────── Personal data (heuristic) ───────────── */

const PII_PATTERNS: { kind: string; label: string; regex: RegExp }[] = [
  { kind: 'email', label: '[EMAIL]', regex: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi },
  // Rwandan mobile numbers: +250 7XX XXX XXX or 07XX XXX XXX (separators optional).
  { kind: 'phone', label: '[PHONE]', regex: /(?:\+?250[\s-]?|\b0)7[2-9](?:[\s-]?\d){7}\b/g },
  // 16-digit national ID, contiguous or in the printed 1 YYYY 8 NNNNNNN 1 NN grouping.
  { kind: 'national_id', label: '[NATIONAL_ID]', regex: /\b\d{16}\b|\b\d\s\d{4}\s\d\s\d{7}\s\d\s\d{2}\b/g },
];

/** Returns the KINDS of personal data found (never the values themselves). */
export function findPii(text: string): string[] {
  const kinds: string[] = [];
  for (const { kind, regex } of PII_PATTERNS) {
    regex.lastIndex = 0;
    if (regex.test(text)) kinds.push(kind);
  }
  return kinds;
}

export function redactPii(text: string): string {
  let result = text;
  for (const { label, regex } of PII_PATTERNS) result = result.replace(regex, label);
  return result;
}

/* ───────────── Validation ───────────── */

export interface ValidationOptions {
  maxChars?: number;          // default 8000 per field
  minInstructionChars?: number; // default 3
  warnShortOutputChars?: number; // default 10
}

const BOILERPLATE = [/as an ai (language )?model/i, /lorem ipsum/i];
const PLACEHOLDERS = [/\[(insert|todo|placeholder)[^\]]*\]/i, /\b(TODO|TBD)\b/];

export function validateExample(ex: DatasetExample, options: ValidationOptions = {}): Issue[] {
  const maxChars = options.maxChars ?? 8000;
  const minInstruction = options.minInstructionChars ?? 3;
  const warnShort = options.warnShortOutputChars ?? 10;
  const issues: Issue[] = [];
  const add = (code: string, severity: Issue['severity'], message: string) => issues.push({ code, severity, message });

  const instruction = (ex.instruction ?? '').trim();
  const output = (ex.output ?? '').trim();
  const input = (ex.input ?? '').trim();

  if (ex.consent !== true) add('missing_consent', 'blocker', 'Documented data-owner consent is required before export.');
  if (ex.piiReviewed !== true) add('pii_not_reviewed', 'blocker', 'A human PII review is required before export.');

  if (instruction.length < minInstruction) add('empty_instruction', 'blocker', 'Instruction is empty or too short.');
  if (!output) add('empty_output', 'blocker', 'Output is empty.');
  if (instruction.length > maxChars || output.length > maxChars || input.length > maxChars) {
    add('too_long', 'blocker', `A field is longer than ${maxChars} characters.`);
  }
  if (ex.type === 'preference') {
    if (!ex.rejectedOutput?.trim()) add('missing_rejected', 'blocker', 'Preference example needs the rejected answer.');
    else if (normalizeForDedupe(ex.rejectedOutput) === normalizeForDedupe(output)) {
      add('identical_pair', 'blocker', 'Rejected and chosen answers are identical.');
    }
  }
  if (output && output.length < warnShort) add('very_short_output', 'warning', 'Output is very short; confirm it is a complete answer.');
  if (output && normalizeForDedupe(output) === normalizeForDedupe(instruction)) {
    add('output_repeats_instruction', 'blocker', 'Output just repeats the instruction.');
  }

  const combined = `${instruction}\n${input}\n${output}\n${ex.rejectedOutput ?? ''}`;
  if (PLACEHOLDERS.some((pattern) => pattern.test(combined))) add('placeholder_text', 'blocker', 'Contains placeholder text such as [insert ...] or TODO.');
  if (BOILERPLATE.some((pattern) => pattern.test(output))) add('ai_boilerplate', 'warning', 'Output contains generic AI boilerplate.');

  const pii = findPii(combined);
  if (pii.length > 0) {
    if (ex.consent) add('pii_present', 'warning', `Possible personal data (${pii.join(', ')}); consent is recorded.`);
    else add('pii_without_consent', 'blocker', `Possible personal data (${pii.join(', ')}) without recorded consent. Redact it or record consent.`);
  }

  if (ex.origin === 'ai_synthetic' && !(ex.reviewerIds && ex.reviewerIds.length > 0)) {
    add('synthetic_unreviewed', 'blocker', 'AI-generated example has no human reviewer.');
  }

  const tokenCount = output.split(/\s+/).filter(Boolean).length;
  if (tokenCount >= 8 && ex.language) {
    const detected = detectLanguage(output);
    const mismatch =
      (ex.language === 'rw' && detected !== 'rw') ||
      (ex.language === 'fr' && detected !== 'fr') ||
      (ex.language === 'en' && detected !== 'other');
    if (mismatch) add('language_mismatch', 'warning', `Declared language "${ex.language}" but the text looks like "${detected}". Check it.`);
  }
  return issues;
}

/* ───────────── De-duplication ───────────── */

const ORIGIN_PRIORITY: Record<Origin, number> = {
  human_corrected: 0,
  human_written: 1,
  document_extracted: 2,
  harvested_db: 3,
  ai_synthetic: 4,
};

function shingles(text: string): Set<string> {
  const words = normalizeForDedupe(text).split(' ').filter(Boolean);
  const set = new Set<string>();
  for (let i = 0; i + 3 <= words.length; i++) set.add(words.slice(i, i + 3).join(' '));
  return set;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const item of a) if (b.has(item)) shared++;
  return shared / (a.size + b.size - shared);
}

export interface DuplicateReport { id: string; duplicateOf: string; kind: 'exact' | 'near' }

/**
 * Keeps the highest-trust copy of each duplicate group (human-corrected first,
 * AI-synthetic last). Near-duplicate check is O(n^2) on instructions, which is
 * fine for thousands of examples; use an index (MinHash/LSH) beyond that.
 */
export function dedupe(examples: DatasetExample[], nearThreshold = 0.9): { kept: DatasetExample[]; duplicates: DuplicateReport[] } {
  const ordered = [...examples].sort(
    (a, b) => ORIGIN_PRIORITY[a.origin] - ORIGIN_PRIORITY[b.origin] || a.id.localeCompare(b.id),
  );
  const kept: DatasetExample[] = [];
  const duplicates: DuplicateReport[] = [];
  const exactIndex = new Map<string, string>();
  const keptShingles: { id: string; set: Set<string> }[] = [];

  for (const ex of ordered) {
    const key = sha256(`${ex.type}|${normalizeForDedupe(ex.instruction)}|${normalizeForDedupe(ex.input ?? '')}|${normalizeForDedupe(ex.output)}`);
    const exact = exactIndex.get(key);
    if (exact) { duplicates.push({ id: ex.id, duplicateOf: exact, kind: 'exact' }); continue; }

    const set = shingles(`${ex.instruction} ${ex.input ?? ''}`);
    let near: string | null = null;
    if (set.size > 0) {
      for (const other of keptShingles) {
        if (jaccard(set, other.set) >= nearThreshold) { near = other.id; break; }
      }
    }
    if (near) { duplicates.push({ id: ex.id, duplicateOf: near, kind: 'near' }); continue; }

    exactIndex.set(key, ex.id);
    keptShingles.push({ id: ex.id, set });
    kept.push(ex);
  }
  return { kept, duplicates };
}

/* ───────────── Leakage-safe splits ───────────── */

export interface SplitRatios { train: number; validation: number; test: number }
export const DEFAULT_RATIOS: SplitRatios = { train: 0.8, validation: 0.1, test: 0.1 };

/**
 * Stable split. Examples that come from the SAME source (first sourceId) always
 * land in the same split, so a passage cannot appear in both training and test
 * data. Without this, test scores look better than they really are.
 */
export function assignSplit(ex: DatasetExample, ratios: SplitRatios = DEFAULT_RATIOS): Split {
  const groupKey = ex.sourceIds?.[0] ?? ex.id;
  const point = fnv1a(groupKey) / 0x100000000;
  if (point < ratios.train) return 'train';
  if (point < ratios.train + ratios.validation) return 'validation';
  return 'test';
}

/* ───────────── Statistics & warnings ───────────── */

export interface StatsOptions {
  minTotal?: number;            // default 500
  minTestExamples?: number;     // default 50
  maxSyntheticShare?: number;   // default 0.3
  maxSingleDomainShare?: number; // default 0.7
  minLanguageShare?: number;    // default 0.1 (per declared language)
}

export function datasetStats(examples: DatasetExample[], options: StatsOptions = {}) {
  const count = <K extends string>(pick: (ex: DatasetExample) => K | undefined) => {
    const map: Record<string, number> = {};
    for (const ex of examples) { const key = pick(ex) ?? 'unspecified'; map[key] = (map[key] ?? 0) + 1; }
    return map;
  };
  const bySplit: Record<Split, number> = { train: 0, validation: 0, test: 0 };
  for (const ex of examples) bySplit[assignSplit(ex)]++;
  const total = examples.length;
  const byLanguage = count((ex) => ex.language);
  const byDomain = count((ex) => ex.domain);
  const byOrigin = count((ex) => ex.origin);

  const warnings: string[] = [];
  const minTotal = options.minTotal ?? 500;
  if (total < minTotal) warnings.push(`Only ${total} examples (suggested minimum ${minTotal}). Fine-tuning on this will not be reliable.`);
  const minTest = options.minTestExamples ?? 50;
  if (total > 0 && bySplit.test < minTest) warnings.push(`Test split has ${bySplit.test} examples (suggested minimum ${minTest}); evaluation will be noisy.`);
  const synthetic = byOrigin['ai_synthetic'] ?? 0;
  if (total > 0 && synthetic / total > (options.maxSyntheticShare ?? 0.3)) {
    warnings.push(`${Math.round((synthetic / total) * 100)}% of examples are AI-synthetic. Add more human-written or human-corrected data.`);
  }
  const maxDomain = options.maxSingleDomainShare ?? 0.7;
  for (const [domain, n] of Object.entries(byDomain)) {
    if (total > 0 && Object.keys(byDomain).length > 1 && n / total > maxDomain) warnings.push(`Domain "${domain}" is ${Math.round((n / total) * 100)}% of the data.`);
  }
  const minLang = options.minLanguageShare ?? 0.1;
  for (const [language, n] of Object.entries(byLanguage)) {
    if (language !== 'unspecified' && total > 0 && n / total < minLang) warnings.push(`Language "${language}" is only ${Math.round((n / total) * 100)}% of the data.`);
  }
  if ((byLanguage['unspecified'] ?? 0) > 0) warnings.push(`${byLanguage['unspecified']} examples have no language set.`);
  return { total, byLanguage, byDomain, byOrigin, byType: count((ex) => ex.type), bySplit, warnings };
}

/* ───────────── Export ───────────── */

export interface ExportOptions {
  version: string;
  /** ISO timestamp supplied by the caller, so exports are reproducible in tests. */
  now: string;
  systemPrompt?: string;
  ratios?: SplitRatios;
  minTrainExamples?: number; // default 200
  validation?: ValidationOptions;
}

export interface ExportResult {
  ok: boolean;
  reason?: string;
  files: { train: string; validation: string; test: string; preference: string };
  manifest: Record<string, unknown>;
  excluded: { id: string; reasons: string[] }[];
}

const lines = (rows: unknown[]) => rows.map((row) => JSON.stringify(row)).join('\n');

export function buildExport(examples: DatasetExample[], options: ExportOptions): ExportResult {
  const ratios = options.ratios ?? DEFAULT_RATIOS;
  const excluded: { id: string; reasons: string[] }[] = [];
  const warningCounts: Record<string, number> = {};
  const eligible: DatasetExample[] = [];

  for (const ex of examples) {
    if (ex.status !== 'approved') { excluded.push({ id: ex.id, reasons: ['not_approved'] }); continue; }
    const issues = validateExample(ex, options.validation);
    const blockers = issues.filter((issue) => issue.severity === 'blocker');
    for (const issue of issues.filter((i) => i.severity === 'warning')) warningCounts[issue.code] = (warningCounts[issue.code] ?? 0) + 1;
    if (blockers.length > 0) { excluded.push({ id: ex.id, reasons: blockers.map((b) => b.code) }); continue; }
    eligible.push(ex);
  }

  const { kept, duplicates } = dedupe(eligible);
  for (const dup of duplicates) excluded.push({ id: dup.id, reasons: [`duplicate_${dup.kind}_of_${dup.duplicateOf}`] });

  const buckets: Record<Split, DatasetExample[]> = { train: [], validation: [], test: [] };
  for (const ex of kept) buckets[assignSplit(ex, ratios)].push(ex);
  const sortById = (a: DatasetExample, b: DatasetExample) => a.id.localeCompare(b.id);
  for (const key of Object.keys(buckets) as Split[]) buckets[key].sort(sortById);

  const toChat = (ex: DatasetExample) => ({
    messages: [
      ...(options.systemPrompt ? [{ role: 'system', content: options.systemPrompt }] : []),
      { role: 'user', content: ex.input?.trim() ? `${ex.instruction.trim()}\n\n${ex.input.trim()}` : ex.instruction.trim() },
      { role: 'assistant', content: ex.output.trim() },
    ],
    metadata: { id: ex.id, type: ex.type, language: ex.language ?? null, domain: ex.domain ?? null, origin: ex.origin, sources: ex.sourceIds ?? [] },
  });
  const isPreference = (ex: DatasetExample) => ex.type === 'preference';

  const files = {
    train: lines(buckets.train.filter((ex) => !isPreference(ex)).map(toChat)),
    validation: lines(buckets.validation.filter((ex) => !isPreference(ex)).map(toChat)),
    // The test file is for EVALUATION ONLY. Never feed it to a training job.
    test: lines(buckets.test.filter((ex) => !isPreference(ex)).map(toChat)),
    preference: lines(
      kept.filter(isPreference).sort(sortById).map((ex) => ({
        prompt: ex.input?.trim() ? `${ex.instruction.trim()}\n\n${ex.input.trim()}` : ex.instruction.trim(),
        chosen: ex.output.trim(),
        rejected: (ex.rejectedOutput ?? '').trim(),
        metadata: { id: ex.id, language: ex.language ?? null, domain: ex.domain ?? null },
      })),
    ),
  };

  const stats = datasetStats(kept);
  const minTrain = options.minTrainExamples ?? 200;
  const trainCount = buckets.train.filter((ex) => !isPreference(ex)).length;
  const manifest = {
    version: options.version,
    createdAt: options.now,
    ratios,
    splitMethod: 'fnv1a(first sourceId or id), grouped by source to prevent leakage',
    counts: { input: examples.length, exported: kept.length, excluded: excluded.length, train: trainCount, ...stats.bySplit },
    stats,
    excludedByReason: excluded.flatMap((e) => e.reasons).reduce<Record<string, number>>((acc, reason) => {
      const key = reason.startsWith('duplicate_') ? reason.replace(/_of_.*$/, '') : reason;
      acc[key] = (acc[key] ?? 0) + 1; return acc;
    }, {}),
    warningCounts,
    sha256: { train: sha256(files.train), validation: sha256(files.validation), test: sha256(files.test), preference: sha256(files.preference) },
    note: 'The test file must never be used for training.',
  };

  if (trainCount < minTrain) {
    return { ok: false, reason: `Only ${trainCount} training examples after filtering (minimum ${minTrain}).`, files, manifest, excluded };
  }
  return { ok: true, files, manifest, excluded };
}

// Backward compatibility helpers for existing code
export function isExecutionTraceExample(example: {
  instruction?: string | null;
  input?: string | null;
  output?: string | null;
}): boolean {
  return /processed content snippet|verified knowledge source|executed via .{0,80}\d+\s+output tokens|output tokens.{0,80}\d+\s*ms|observed execution metrics|model identifiers/i
    .test(`${example.instruction || ''}\n${example.input || ''}\n${example.output || ''}`);
}

export function isSourceGroundedExample(
  example: { output: string },
  source: string,
): boolean {
  const sourceTerms = new Set(source.toLocaleLowerCase().match(/[a-z]{4,}|\d+(?:[.,]\d+)?%?/g) || []);
  const outputTerms = (example.output.toLocaleLowerCase().match(/[a-z]{4,}|\d+(?:[.,]\d+)?%?/g) || [])
    .filter((term) => !['about', 'after', 'also', 'been', 'being', 'could', 'from', 'have', 'into', 'more', 'most', 'only', 'should', 'that', 'their', 'there', 'these', 'this', 'were', 'what', 'when', 'which', 'with', 'according', 'based', 'document', 'following', 'information', 'provided', 'section', 'source', 'states', 'text'].includes(term));
  const uniqueOutputTerms = [...new Set(outputTerms)];
  if (uniqueOutputTerms.length === 0) return false;
  if (uniqueOutputTerms.some((term) => /^\d/.test(term) && !sourceTerms.has(term))) return false;
  const matchedTerms = uniqueOutputTerms.filter((term) => sourceTerms.has(term)).length;
  return matchedTerms / uniqueOutputTerms.length >= 0.5;
}
