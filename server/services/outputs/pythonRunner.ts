import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * Runs the deterministic Python analysis engine (python_service/analysis/engine.py) in a separate process:
 * clean environment (no secrets), temporary working directory, time limit with SIGKILL, bounded output,
 * bounded concurrency, and — where the host permits unprivileged user namespaces — no network namespace
 * (`unshare -rn`). The engine itself also sets memory/CPU/file limits and disables sockets, and it only
 * executes whitelisted operations from JSON (no code from users or the model is ever run).
 */

export interface PythonRunResult { ok: true; output: any; isolation: Isolation; ms: number }
export interface Isolation { process: 'subprocess'; networkNamespace: boolean; resourceLimits: true; engine: string }

export class PythonUnavailableError extends Error {}
export class PythonRunError extends Error {
  constructor(public code: 'TIMEOUT' | 'OUTPUT_TOO_LARGE' | 'CRASHED' | 'BAD_OUTPUT', message: string) {
    super(message);
  }
}

const env = (k: string, d: number) => (Number(process.env[k]) > 0 ? Number(process.env[k]) : d);
const PY = () => process.env.ANALYSIS_PYTHON || 'python3';
export const ENGINE_PATH = () => process.env.ANALYSIS_ENGINE_PATH || path.resolve(process.cwd(), 'python_service', 'analysis', 'engine.py');

let probe: { available: boolean; reason?: string; netns: boolean; versions?: string } | null = null;

/** Checks once whether python3 with numpy/pandas and network isolation are available. */
export function pythonStatus(force = false) {
  if (probe && !force) return probe;
  const r = spawnSync(PY(), ['-I', '-c', 'import numpy, pandas, sys; print(sys.version.split()[0], numpy.__version__, pandas.__version__)'], { encoding: 'utf8', timeout: 30_000, env: cleanEnv(os.tmpdir()) });
  const ok = r.status === 0;
  const ns = process.env.ANALYSIS_NETWORK_NAMESPACE === 'off' ? false : spawnSync('unshare', ['-rn', 'true'], { timeout: 5000 }).status === 0;
  probe = ok ? { available: true, netns: ns, versions: r.stdout.trim() } : { available: false, netns: ns, reason: r.error ? `${PY()} not found` : 'numpy and pandas are not installed for python3' };
  if (probe.available && !probe.netns && process.env.ANALYSIS_REQUIRE_NETWORK_NAMESPACE === 'true') probe = { available: false, netns: false, reason: 'network namespaces are required (ANALYSIS_REQUIRE_NETWORK_NAMESPACE=true) but not permitted on this host' };
  return probe;
}

function cleanEnv(home: string): NodeJS.ProcessEnv {
  // Only what Python needs: no API keys, tokens or database URLs reach the subprocess.
  return {
    PATH: '/usr/local/bin:/usr/bin:/bin', HOME: home, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', PYTHONHASHSEED: '0', PYTHONDONTWRITEBYTECODE: '1',
    OMP_NUM_THREADS: '1', OPENBLAS_NUM_THREADS: '1', MKL_NUM_THREADS: '1', NUMEXPR_MAX_THREADS: '1',
    ANALYSIS_MEM_MB: String(env('ANALYSIS_MEM_MB', 1024)), ANALYSIS_CPU_SECONDS: String(env('ANALYSIS_CPU_SECONDS', 60)),
  };
}

let running = 0;
const waiting: Array<() => void> = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  const max = env('ANALYSIS_MAX_CONCURRENCY', 2);
  if (running >= max) await new Promise<void>((r) => waiting.push(r));
  running++;
  try { return await fn(); } finally { running--; waiting.shift()?.(); }
}

export async function runPythonEngine(request: unknown, opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<PythonRunResult> {
  const st = pythonStatus();
  if (!st.available) throw new PythonUnavailableError(st.reason ?? 'Python analysis is not available.');
  const input = JSON.stringify(request);
  if (Buffer.byteLength(input) > env('ANALYSIS_MAX_INPUT_BYTES', 64 * 1024 * 1024)) throw new PythonRunError('BAD_OUTPUT', 'The dataset is too large to analyse in one request.');
  return slot(async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'bwenge-analysis-'));
    const started = Date.now();
    try {
      const args = ['-I', ENGINE_PATH()];
      const [cmd, argv] = st.netns ? ['unshare', ['-rn', PY(), ...args]] : [PY(), args];
      const child = spawn(cmd, argv, { cwd: dir, env: cleanEnv(dir), stdio: ['pipe', 'pipe', 'pipe'] });
      const max = env('ANALYSIS_MAX_OUTPUT_BYTES', 32 * 1024 * 1024);
      const chunks: Buffer[] = [];
      let size = 0;
      let failure: PythonRunError | null = null;
      const kill = (e: PythonRunError) => { failure ??= e; child.kill('SIGKILL'); };
      const timer = setTimeout(() => kill(new PythonRunError('TIMEOUT', 'The analysis took too long and was stopped.')), opts.timeoutMs ?? env('ANALYSIS_TIMEOUT_MS', 90_000));
      opts.signal?.addEventListener('abort', () => kill(new PythonRunError('TIMEOUT', 'The analysis was cancelled.')), { once: true });
      child.stdout.on('data', (c: Buffer) => { size += c.length; if (size > max) kill(new PythonRunError('OUTPUT_TOO_LARGE', 'The analysis produced too much output.')); else chunks.push(c); });
      child.stderr.on('data', () => {}); // never surfaced: may contain internal paths
      child.stdin.on('error', () => {});
      child.stdin.end(input);
      const code: number | null = await new Promise((res) => child.on('close', (c) => res(c)));
      clearTimeout(timer);
      if (failure) throw failure;
      if (code !== 0) throw new PythonRunError('CRASHED', 'The analysis process stopped unexpectedly (resource limit or crash).');
      let output: any;
      try { output = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new PythonRunError('BAD_OUTPUT', 'The analysis returned invalid output.'); }
      return { ok: true as const, output, isolation: { process: 'subprocess' as const, networkNamespace: st.netns, resourceLimits: true as const, engine: st.versions ?? '' }, ms: Date.now() - started };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}
