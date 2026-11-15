import { DEFAULT_LIMITS, CodeRunnerError, type CodeRunner, type Language, type RunResult } from './types.js';
import { isLanguage, LANGUAGES } from './languages.js';

/**
 * A lecturer's tests for a program: each test gives the program an input and says what it should print. The
 * program is marked by how many tests it passes (with points per test). Hidden tests count but do not show the
 * expected output, so a student cannot just print the answers.
 */

export interface CodeTest { name: string; input: string; expected: string; points: number; hidden: boolean }
export type Compare = 'exact' | 'whitespace' | 'numeric';
export interface CodeTestConfig {
  language: Language;
  compare: Compare;
  tests: CodeTest[];
  /** Time per test in seconds (1 to 30). */
  timeSeconds: number;
  /** What students see after handing in: nothing, how many tests passed, or each visible test's result. */
  showStudents: 'none' | 'summary' | 'full';
}
export const MAX_TESTS = 50;
const cleanText = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').slice(0, max) : '');

/** Keeps only sane values from what the lecturer sent. Returns null when there is no usable test. */
export function normalizeCodeTests(input: unknown): CodeTestConfig | null {
  let o: any = input;
  if (typeof o === 'string') { try { o = JSON.parse(o); } catch { return null; } }
  if (!o || typeof o !== 'object' || !isLanguage(o.language)) return null;
  const tests: CodeTest[] = (Array.isArray(o.tests) ? o.tests : []).slice(0, MAX_TESTS).map((t: any, i: number) => ({
    name: cleanText(t?.name, 60).trim() || `Test ${i + 1}`,
    input: cleanText(t?.input, 20_000), expected: cleanText(t?.expected, 20_000),
    points: typeof t?.points === 'number' && Number.isFinite(t.points) ? Math.max(0, Math.min(100, Math.round(t.points * 100) / 100)) : 1,
    hidden: t?.hidden === true,
  })).filter((t: CodeTest) => t.expected.trim() !== '' || t.input.trim() !== '');
  if (!tests.length) return null;
  const secs = Number(o.timeSeconds);
  return {
    language: o.language, tests,
    compare: o.compare === 'exact' || o.compare === 'numeric' ? o.compare : 'whitespace',
    timeSeconds: Number.isFinite(secs) ? Math.max(1, Math.min(30, Math.round(secs))) : 5,
    showStudents: o.showStudents === 'none' || o.showStudents === 'full' ? o.showStudents : 'summary',
  };
}

const num = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
/** Do the program's output and the expected output match, in the way the lecturer chose? */
export function outputsMatch(got: string, expected: string, mode: Compare): boolean {
  const lines = (s: string) => s.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\s+$/, ''));
  const trimEnd = (a: string[]) => { while (a.length && a[a.length - 1] === '') a.pop(); return a; };
  if (mode === 'exact') return trimEnd(lines(got)).join('\n') === trimEnd(lines(expected)).join('\n');
  const a = got.trim().split(/\s+/).filter(Boolean), b = expected.trim().split(/\s+/).filter(Boolean);
  if (a.length !== b.length) return false;
  return a.every((x, i) => {
    if (x === b[i]) return true;
    if (mode === 'numeric' && num.test(x) && num.test(b[i])) { const p = Number(x), q = Number(b[i]); return Math.abs(p - q) <= 1e-6 * Math.max(1, Math.abs(q)); }
    return false;
  });
}

export interface CodeTestResult { name: string; passed: boolean; hidden: boolean; points: number; earned: number; ms: number; reason?: 'wrong' | 'timeout' | 'error' | 'memory' | 'output' | 'compile'; got?: string; expected?: string; input?: string; stderr?: string }
export interface CodeResult {
  ranAt: string; runner: string; language: Language; main?: string;
  compileError?: string; error?: string;
  tests: CodeTestResult[]; earned: number; max: number; passed: number; total: number;
}

const tail = (s: string, n: number) => (s.length > n ? `…${s.slice(-n)}` : s).trim();
const MEMORY = /MemoryError|Cannot allocate|bad_alloc|OutOfMemoryError|heap out of memory|Killed/i;

/** Runs every test on one hand-in. Never throws: a problem becomes `error` or `compileError` in the result. */
export async function gradeCode(runner: CodeRunner, config: CodeTestConfig, files: Array<{ path: string; data: Buffer }>): Promise<CodeResult> {
  const base = { ranAt: new Date().toISOString(), runner: runner.name, language: config.language };
  const max = config.tests.reduce((n, t) => n + t.points, 0);
  const failAll = (extra: Partial<CodeResult>, reason: CodeTestResult['reason']): CodeResult => ({
    ...base, ...extra, max, earned: 0, passed: 0, total: config.tests.length,
    tests: config.tests.map((t) => ({ name: t.name, passed: false, hidden: t.hidden, points: t.points, earned: 0, ms: 0, reason })),
  });
  let session;
  try { session = await runner.open(config.language, files); } catch (e) {
    return failAll({ error: e instanceof CodeRunnerError || e instanceof Error ? e.message.slice(0, 300) : 'The program could not be run.' }, 'error');
  }
  try {
    const failed = await session.compile();
    if (failed) return failAll({ compileError: tail(failed.stderr || failed.stdout || (failed.timedOut ? 'Compiling took too long.' : 'It did not compile.'), 2000) }, 'compile');
    const out: CodeTestResult[] = [];
    for (const t of config.tests) {
      const r: RunResult = await session.run(t.input, { ...DEFAULT_LIMITS, timeMs: config.timeSeconds * 1000 });
      const ok = !r.timedOut && !r.outputCut && r.exitCode === 0 && outputsMatch(r.stdout, t.expected, config.compare);
      const reason: CodeTestResult['reason'] | undefined = ok ? undefined : r.timedOut ? 'timeout' : r.outputCut ? 'output' : MEMORY.test(r.stderr) ? 'memory' : r.exitCode !== 0 ? 'error' : 'wrong';
      out.push({
        name: t.name, passed: ok, hidden: t.hidden, points: t.points, earned: ok ? t.points : 0, ms: r.durationMs, ...(reason ? { reason } : {}),
        // What the lecturer sees; hidden tests keep their expected output back from students (see redactForStudent).
        got: tail(r.stdout, 500), expected: t.expected.slice(0, 500), input: t.input.slice(0, 300), ...(r.stderr ? { stderr: tail(r.stderr, 500) } : {}),
      });
    }
    return { ...base, tests: out, max, earned: Math.round(out.reduce((n, t) => n + t.earned, 0) * 100) / 100, passed: out.filter((t) => t.passed).length, total: out.length };
  } finally { await session.close().catch(() => undefined); }
}

/** What a student may see of their result. */
export function redactForStudent(r: CodeResult, mode: CodeTestConfig['showStudents']) {
  if (mode === 'none') return null;
  const base = { passed: r.passed, total: r.total, earned: r.earned, max: r.max, ...(r.compileError ? { compileError: r.compileError } : {}), ...(r.error ? { error: r.error } : {}) };
  if (mode === 'summary') return base;
  return { ...base, tests: r.tests.map((t) => ({ name: t.name, passed: t.passed, hidden: t.hidden, reason: t.reason, ...(t.hidden ? {} : { expected: t.expected, got: t.got, input: t.input }) })) };
}

export const languageLabel = (l: Language) => LANGUAGES[l].label;
