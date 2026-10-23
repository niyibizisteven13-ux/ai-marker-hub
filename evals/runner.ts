import Ajv from 'ajv';
import mammoth from 'mammoth';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { generateDocx } from '../server/services/ai/files/generators/docx.js';
import type { DocumentSpec } from '../server/services/ai/files/generators/spec.js';
import { validateEvidenceCitations } from '../server/services/GroundedAnswerService.js';
import { getDocumentExtractionIssue } from '../server/services/ExtractionQualityService.js';
import { rankKnowledgeChunks } from '../server/services/KnowledgeRetrievalService.js';

const capabilityIds = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'] as const;
const taskSchema = z.object({
  id: z.string().min(1),
  capability: z.enum(capabilityIds),
  split: z.enum(['dev', 'test']),
  language: z.enum(['EN', 'FR', 'RW']),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  evaluator: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('retrieval'),
      query: z.string().min(1),
      chunks: z.array(z.object({ id: z.string().min(1), text: z.string() })).min(1),
      relevantChunkIds: z.array(z.string().min(1)).min(1),
      topK: z.number().int().positive(),
      minimumRecall: z.number().min(0).max(1).default(1),
    }),
    z.object({
      kind: z.literal('retrieval-no-match'),
      query: z.string().min(1),
      chunks: z.array(z.object({ id: z.string().min(1), text: z.string() })).min(1),
      topK: z.number().int().positive(),
    }),
    z.object({
      kind: z.literal('citations'),
      answer: z.string(),
      retrievedChunkIds: z.array(z.string()),
      expectValid: z.boolean(),
    }),
    z.object({
      kind: z.literal('extraction'),
      text: z.string(),
      warnings: z.array(z.string()),
      expectIssuePresent: z.boolean(),
    }),
    z.object({
      kind: z.literal('json-schema'),
      response: z.string(),
      schema: z.record(z.string(), z.unknown()),
      expectValid: z.boolean(),
    }),
    z.object({
      kind: z.literal('docx'),
      document: z.unknown(),
      requiredText: z.array(z.string().min(1)).min(1),
      forbiddenText: z.array(z.string()).default([]),
    }),
  ]),
}).strict();

export type EvaluationTask = z.infer<typeof taskSchema>;
export type EvalSplit = 'dev' | 'test';

export interface EvaluationObservation {
  passed: boolean;
  details: Record<string, unknown>;
  graderLatencyMs: number;
}

export interface TaskEvaluation {
  id: string;
  capability: EvaluationTask['capability'];
  language: EvaluationTask['language'];
  difficulty: EvaluationTask['difficulty'];
  passed: boolean;
  unstable: boolean;
  runs: EvaluationObservation[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((cell: unknown) => typeof cell === 'string');
}

function parseDocumentSpec(value: unknown): DocumentSpec {
  if (!isRecord(value) || typeof value.title !== 'string' || !value.title.trim() || !Array.isArray(value.blocks)) {
    throw new Error('DOCX task needs a non-empty title and blocks array.');
  }

  const blocks: DocumentSpec['blocks'] = value.blocks.map((block: unknown) => {
    if (!isRecord(block)) throw new Error('DOCX task contains an invalid block.');
    if (block.type === 'heading') {
      const level = block.level;
      if ((level !== 1 && level !== 2 && level !== 3 && level !== 4) || typeof block.text !== 'string') {
        throw new Error('DOCX heading blocks need a level from 1 to 4 and text.');
      }
      return { type: 'heading', level, text: block.text };
    }
    if (block.type === 'paragraph' && typeof block.text === 'string') {
      return { type: 'paragraph', text: block.text };
    }
    if (block.type === 'table') {
      if (!Array.isArray(block.rows)) throw new Error('DOCX table blocks need rows.');
      const rows = block.rows.filter(isStringArray);
      if (rows.length !== block.rows.length) throw new Error('DOCX table rows must contain only strings.');
      let header: string[] | undefined;
      if (block.header !== undefined) {
        if (!isStringArray(block.header)) throw new Error('DOCX table headers must contain only strings.');
        header = block.header;
      }
      return {
        type: 'table',
        rows,
        ...(header === undefined ? {} : { header }),
      };
    }
    throw new Error('DOCX task block type must be heading, paragraph, or table.');
  });

  return {
    title: value.title,
    blocks,
    ...(typeof value.subtitle === 'string' ? { subtitle: value.subtitle } : {}),
    ...(typeof value.author === 'string' ? { author: value.author } : {}),
    ...(typeof value.language === 'string' ? { language: value.language } : {}),
  };
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultTaskPath = path.join(repoRoot, 'evals', 'tasks', 'core.json');
const reportDirectory = path.join(repoRoot, 'evals', 'reports');

export async function evaluateTask(task: EvaluationTask): Promise<EvaluationObservation> {
  const start = performance.now();
  let passed: boolean;
  let details: Record<string, unknown>;

  switch (task.evaluator.kind) {
    case 'retrieval': {
      const ranked = rankKnowledgeChunks(task.evaluator.chunks, task.evaluator.query, {
        limit: task.evaluator.topK,
      });
      const retrieved = ranked.map(({ chunk }) => chunk.id);
      const found = task.evaluator.relevantChunkIds.filter((id) => retrieved.includes(id));
      const recall = found.length / task.evaluator.relevantChunkIds.length;
      passed = recall >= task.evaluator.minimumRecall;
      details = { retrievedChunkIds: retrieved, recallAtK: recall, minimumRecall: task.evaluator.minimumRecall };
      break;
    }
    case 'retrieval-no-match': {
      const retrieved = rankKnowledgeChunks(task.evaluator.chunks, task.evaluator.query, {
        limit: task.evaluator.topK,
      }).map(({ chunk }) => chunk.id);
      passed = retrieved.length === 0;
      details = { retrievedChunkIds: retrieved, expectedRetrievedChunkIds: [] };
      break;
    }
    case 'citations': {
      const validation = validateEvidenceCitations(task.evaluator.answer, task.evaluator.retrievedChunkIds);
      passed = validation.valid === task.evaluator.expectValid;
      details = { ...validation, expectedValid: task.evaluator.expectValid };
      break;
    }
    case 'extraction': {
      const issue = getDocumentExtractionIssue(task.evaluator.text, task.evaluator.warnings);
      const issuePresent = issue !== null;
      passed = issuePresent === task.evaluator.expectIssuePresent;
      details = { issuePresent, issue };
      break;
    }
    case 'json-schema': {
      let valid = false;
      let validationErrors: string[] = [];
      const ajv = new Ajv({ allErrors: true });
      const validate = ajv.compile(task.evaluator.schema);
      try {
        const parsed: unknown = JSON.parse(task.evaluator.response);
        valid = validate(parsed);
        validationErrors = (validate.errors ?? []).map((error) => `${error.instancePath || '/'} ${error.message || 'is invalid'}`);
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        validationErrors = [error.message];
      }
      passed = valid === task.evaluator.expectValid;
      details = { valid, expectedValid: task.evaluator.expectValid, validationErrors };
      break;
    }
    case 'docx': {
      const spec = parseDocumentSpec(task.evaluator.document);
      const buffer = await generateDocx(spec, async () => null);
      const extracted = await mammoth.extractRawText({ buffer });
      const text = extracted.value;
      const missingText = task.evaluator.requiredText.filter((value) => !text.includes(value));
      const foundForbiddenText = task.evaluator.forbiddenText.filter((value) => text.includes(value));
      passed = missingText.length === 0 && foundForbiddenText.length === 0;
      details = {
        fileBytes: buffer.byteLength,
        requiredTextFound: task.evaluator.requiredText.length - missingText.length,
        missingText,
        foundForbiddenText,
      };
      break;
    }
  }

  return { passed, details, graderLatencyMs: performance.now() - start };
}

export function wilsonInterval(successes: number, total: number): [number, number] | null {
  if (total === 0) return null;
  const zScore = 1.959963984540054;
  const proportion = successes / total;
  const denominator = 1 + (zScore * zScore) / total;
  const center = (proportion + (zScore * zScore) / (2 * total)) / denominator;
  const margin =
    (zScore * Math.sqrt((proportion * (1 - proportion)) / total + (zScore * zScore) / (4 * total * total))) /
    denominator;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(p * sorted.length) - 1] ?? sorted[sorted.length - 1];
}

async function loadTasks(taskPath: string): Promise<EvaluationTask[]> {
  const raw: unknown = JSON.parse(await readFile(taskPath, 'utf8'));
  const parsed = z.array(taskSchema).safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid evaluation tasks in ${taskPath}: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`);
  }
  const ids = new Set<string>();
  for (const task of parsed.data) {
    if (ids.has(task.id)) throw new Error(`Duplicate evaluation task id "${task.id}".`);
    ids.add(task.id);
  }
  return parsed.data;
}

export async function runEvaluation(options: {
  taskPath?: string;
  capability?: EvaluationTask['capability'];
  split: EvalSplit;
  report?: boolean;
}): Promise<{
  tasks: TaskEvaluation[];
  metrics: {
    caseCount: number;
    passCount: number;
    successRate: number;
    confidenceInterval95: [number, number] | null;
    instabilityRate: number | null;
    graderLatencyP50Ms: number | null;
    graderLatencyP95Ms: number | null;
  };
  reportPaths: string[];
}> {
  const tasks = (await loadTasks(options.taskPath ?? defaultTaskPath)).filter(
    (task) => task.split === options.split && (!options.capability || task.capability === options.capability),
  );
  if (tasks.length === 0) {
    throw new Error(`No evaluation tasks found for split=${options.split}${options.capability ? ` capability=${options.capability}` : ''}.`);
  }

  const results: TaskEvaluation[] = await Promise.all(tasks.map(async (task) => {
    const runs = await Promise.all(Array.from({ length: 3 }, () => evaluateTask(task)));
    const passedRuns = runs.filter((run) => run.passed).length;
    return {
      id: task.id,
      capability: task.capability,
      language: task.language,
      difficulty: task.difficulty,
      passed: passedRuns >= 2,
      unstable: passedRuns > 0 && passedRuns < runs.length,
      runs,
    };
  }));
  const passCount = results.filter((result) => result.passed).length;
  const graderLatencies = results.flatMap((result) => result.runs.map((run) => run.graderLatencyMs));
  const metrics = {
    caseCount: results.length,
    passCount,
    successRate: passCount / results.length,
    confidenceInterval95: wilsonInterval(passCount, results.length),
    instabilityRate: results.filter((result) => result.unstable).length / results.length,
    graderLatencyP50Ms: percentile(graderLatencies, 0.5),
    graderLatencyP95Ms: percentile(graderLatencies, 0.95),
  };

  const reportPaths: string[] = [];
  if (options.report !== false) {
    await mkdir(reportDirectory, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    const suffix = `${options.capability ?? 'all'}-${options.split}`;
    const base = path.join(reportDirectory, `${date}-${suffix}`);
    const report = {
      generatedAt: new Date().toISOString(),
      evaluationMode: 'offline deterministic component evaluation',
      split: options.split,
      capability: options.capability ?? 'all',
      metrics,
      costUsd: null,
      tokensIn: null,
      tokensOut: null,
      modelLatencyMs: null,
      notMeasured: 'No model or provider requests are made by this evaluator.',
      tasks: results,
    };
    const jsonPath = `${base}.json`;
    const markdownPath = `${base}.md`;
    await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    await writeFile(markdownPath, renderMarkdownReport(report), 'utf8');
    reportPaths.push(markdownPath, jsonPath);
  }

  return { tasks: results, metrics, reportPaths };
}

function renderMarkdownReport(report: {
  generatedAt: string;
  evaluationMode: string;
  split: EvalSplit;
  capability: string;
  metrics: Awaited<ReturnType<typeof runEvaluation>>['metrics'];
  costUsd: null;
  tokensIn: null;
  tokensOut: null;
  modelLatencyMs: null;
  notMeasured: string;
  tasks: TaskEvaluation[];
}): string {
  const ci = report.metrics.confidenceInterval95;
  const pct = (value: number | null) => value === null ? 'NOT MEASURED' : `${(value * 100).toFixed(1)}%`;
  const lines = [
    `# Offline evaluation: ${report.capability} (${report.split})`,
    '',
    `- Generated: ${report.generatedAt}`,
    `- Mode: ${report.evaluationMode}`,
    `- Cases: ${report.metrics.caseCount}`,
    `- Success (majority of 3 deterministic runs): ${pct(report.metrics.successRate)}`,
    `- 95% Wilson interval across cases: ${ci ? `${pct(ci[0])}–${pct(ci[1])}` : 'NOT MEASURED'}`,
    `- Instability: ${pct(report.metrics.instabilityRate)}`,
    `- Grader latency p50/p95: ${report.metrics.graderLatencyP50Ms?.toFixed(3)}ms / ${report.metrics.graderLatencyP95Ms?.toFixed(3)}ms`,
    `- Model latency, tokens, and cost: NOT MEASURED. ${report.notMeasured}`,
    '',
    '| Task | Capability | Language | Difficulty | Pass |',
    '|---|---|---|---|---|',
    ...report.tasks.map((task) => `| ${task.id} | ${task.capability} | ${task.language} | ${task.difficulty} | ${task.passed ? 'yes' : 'no'} |`),
    '',
    'This report measures deterministic component behavior only. It is not an end-to-end model, deployment, or user-success benchmark.',
    '',
  ];
  return lines.join('\n');
}

function parseArgs(args: string[]): { capability?: EvaluationTask['capability']; split: EvalSplit; report: boolean } {
  let capability: EvaluationTask['capability'] | undefined;
  let split: EvalSplit | undefined;
  let all = false;
  let report = true;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--capability') {
      const value = args[++index];
      if (!capabilityIds.includes(value as (typeof capabilityIds)[number])) throw new Error(`Unknown capability "${value}".`);
      capability = value as EvaluationTask['capability'];
    } else if (arg === '--split') {
      const value = args[++index];
      if (value !== 'dev' && value !== 'test') throw new Error('--split must be dev or test.');
      split = value;
    } else if (arg === '--all') {
      all = true;
    } else if (arg === '--no-report') {
      report = false;
    } else {
      throw new Error(`Unknown argument "${arg}".`);
    }
  }
  if (!split) throw new Error('Specify --split dev or --split test.');
  if (!capability && !all) throw new Error('Specify --capability <A-L> or --all.');
  return { capability, split, report };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = await runEvaluation(options);
    console.log(JSON.stringify({ metrics: result.metrics, reportPaths: result.reportPaths }, null, 2));
    if (result.metrics.passCount !== result.metrics.caseCount) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
