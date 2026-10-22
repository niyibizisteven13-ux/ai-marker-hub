import type { ProviderAdapter } from '../ai/providers/types.js';
import { generateStructured } from '../ai/llm/structuredJson.js';
import type { ReportInput } from './htmlReport.js';

/**
 * Optional model-written interpretation for a report. The model sees only the calculated findings;
 * every number in its text must already appear in those findings. If it introduces any other figure,
 * the interpretation is discarded and the report keeps its deterministic text.
 */

const NUM = /-?\d[\d,]*(?:\.\d+)?/g;

/** Normalises numeric tokens: "1,234.50" -> "1234.5", "−3" -> "-3". */
function normNum(tok: string): string {
  const n = Number(tok.replace(/,/g, ''));
  return Number.isFinite(n) ? String(n) : tok;
}

export function numbersIn(text: string): string[] {
  return (text.replace(/[−–]/g, '-').match(NUM) ?? []).map(normNum);
}

/** Returns numbers in `candidate` that are not present in `facts`. Small counting words like 1–3 are allowed. */
export function unsupportedNumbers(candidate: string, facts: string): string[] {
  const allowed = new Set(numbersIn(facts));
  for (const n of ['0', '1', '2', '3', '5', '95', '100']) allowed.add(n);
  return [...new Set(numbersIn(candidate).filter((n) => !allowed.has(n) && !allowed.has(n.replace(/^-/, ''))))];
}

export interface Interpretation { summary: string; conclusion: string; recommendations: string[] }

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['summary', 'conclusion', 'recommendations'],
  properties: { summary: { type: 'string' }, conclusion: { type: 'string' }, recommendations: { type: 'array', items: { type: 'string' } } },
};

export function factsFromReport(report: ReportInput): string {
  return [
    ...report.summary, ...(report.datasetDescription ?? []),
    ...report.sections.flatMap((s) => [...(s.paragraphs ?? []), ...(s.bullets ?? [])]),
  ].map((p) => `- ${p.text}`).join('\n') + `\nLimitations:\n${(report.limitations ?? []).map((l) => `- ${l}`).join('\n')}`;
}

export async function interpretReport(adapter: ProviderAdapter, model: string, report: ReportInput, opts: { researchQuestion?: string; language?: string; signal?: AbortSignal; fallbackModel?: string | null } = {}): Promise<{ interpretation: Interpretation | null; rejected: string[] }> {
  const facts = factsFromReport(report);
  const { data } = await generateStructured<Interpretation>(adapter, {
    model,
    system: 'You write the interpretation section of a statistics report for students and teachers. Use only the calculated findings provided. Do not introduce any number that is not in the findings, do not claim causation from correlation, and state uncertainty where the limitations call for it. Plain, clear language.',
    prompt: `${opts.researchQuestion ? `Research question: ${opts.researchQuestion}\n` : ''}${opts.language ? `Write in ${opts.language}.\n` : ''}Calculated findings:\n${facts}\n\nWrite: a 2–4 sentence summary, a short conclusion that answers the research question only as far as the findings allow, and up to 4 carefully qualified recommendations.`,
    schema: SCHEMA, maxTokens: 4000, signal: opts.signal, fallbackModel: opts.fallbackModel,
  });
  const all = [data.summary, data.conclusion, ...data.recommendations].join('\n');
  const rejected = unsupportedNumbers(all, facts);
  return rejected.length ? { interpretation: null, rejected } : { interpretation: { ...data, recommendations: data.recommendations.slice(0, 4) }, rejected };
}
