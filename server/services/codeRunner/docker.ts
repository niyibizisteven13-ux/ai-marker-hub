import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { LANGUAGES, pickMain } from './languages.js';
import { CodeRunnerError, type CodeRunner, type CodeSession, type Language, type RunLimits, type RunResult } from './types.js';

/**
 * Runs student code in a locked-down Docker container on your own server (nothing is sent to a third party):
 * no network, no new privileges, all capabilities dropped, a read-only root file system, a small memory-limited
 * writable /work, limited processes and CPU, an unprivileged user, and a hard time limit. One container per
 * hand-in lives for the compile and all tests, then is removed. Build the image with docker/code-runner/Dockerfile.
 */
export const RUNNER_IMAGE = () => process.env.CODE_RUNNER_IMAGE || 'bwenge-code-runner:latest';

/** The arguments of `docker run` that create the locked-down container. Exported so tests can check every flag. */
export function dockerRunArgs(name: string, srcDir: string): string[] {
  return [
    'run', '-d', '--name', name, '--rm',
    '--network', 'none',
    '--memory', '1024m', '--memory-swap', '1024m', '--cpus', '1', '--pids-limit', '256',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--read-only', '--tmpfs', '/work:rw,exec,nosuid,size=128m,mode=1777', '--tmpfs', '/tmp:rw,noexec,nosuid,size=32m',
    '--user', '65534:65534', '-w', '/work',
    '-v', `${srcDir}:/src:ro`,
    '--entrypoint', 'sleep', RUNNER_IMAGE(), '3600',
  ];
}

const docker = (args: string[], opts: { stdin?: string; timeoutMs?: number } = {}) => new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
  const child = execFile('docker', args, { timeout: opts.timeoutMs ?? 30_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => resolve({ code: err ? ((err as any).code ?? 1) : 0, stdout: String(stdout), stderr: String(stderr) }));
  if (opts.stdin !== undefined) { child.stdin?.on('error', () => undefined); child.stdin?.end(opts.stdin); }
});

const safeRel = (p: string) => {
  const n = path.posix.normalize(p.replace(/\\/g, '/'));
  return !n || n.startsWith('/') || n.startsWith('..') || n.includes('/../') || n.split('/').some((s) => s.startsWith('.')) ? null : n;
};

export async function dockerAvailable(): Promise<boolean> {
  const r = await docker(['info', '--format', '{{.ServerVersion}}'], { timeoutMs: 8000 });
  return r.code === 0 && !!r.stdout.trim();
}

export const dockerRunner: CodeRunner = {
  name: 'docker',
  async open(language: Language, files): Promise<CodeSession> {
    const spec = LANGUAGES[language];
    const src = await fs.mkdtemp(path.join(os.tmpdir(), 'code-src-'));
    const written: string[] = [];
    for (const f of files) {
      const rel = safeRel(f.path);
      if (!rel) continue;
      await fs.mkdir(path.dirname(path.join(src, rel)), { recursive: true });
      await fs.writeFile(path.join(src, rel), f.data);
      written.push(rel);
    }
    const cleanup = () => fs.rm(src, { recursive: true, force: true });
    const main = pickMain(language, written);
    if (!main) { await cleanup(); throw new CodeRunnerError('NO_MAIN', `No ${spec.label} main file found. Name it ${spec.mains[0]}.`); }
    // Container names are random: a student's file names never reach the docker command line.
    const name = `run-${randomUUID()}`;
    await fs.chmod(src, 0o755);
    const started = await docker(dockerRunArgs(name, src));
    if (started.code !== 0) { await cleanup(); throw new CodeRunnerError('RUNNER_UNAVAILABLE', 'The code runner could not start. Ask the administrator to check Docker and the runner image.'); }
    await docker(['exec', '-u', '65534', name, 'sh', '-c', 'cp -r /src/. /work/']);

    const exec = (script: string, stdin: string, limits: RunLimits, ownLimit: boolean) => new Promise<RunResult>((resolve) => {
      const t0 = Date.now();
      const kb = limits.memoryMb * 1024;
      const shell = `${ownLimit ? '' : `ulimit -v ${kb};`} ulimit -t ${Math.ceil(limits.timeMs / 1000) + 1}; ${script}`;
      const child = spawn('docker', ['exec', '-i', '-u', '65534', name, 'timeout', '--signal=KILL', String(Math.ceil(limits.timeMs / 1000)), 'sh', '-c', shell], { stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '', stderr = '', cut = false, timedOut = false, done = false;
      const timer = setTimeout(() => { timedOut = true; void docker(['exec', name, 'pkill', '-9', '-u', '65534']); child.kill('SIGKILL'); }, limits.timeMs + 1500);
      const take = (which: 'out' | 'err') => (d: Buffer) => {
        const room = limits.outputBytes - stdout.length - stderr.length;
        if (room <= 0) { if (!cut) { cut = true; child.kill('SIGKILL'); } return; }
        const s = d.subarray(0, room).toString('utf8'); if (which === 'out') stdout += s; else stderr += s;
        if (d.length > room && !cut) { cut = true; child.kill('SIGKILL'); }
      };
      child.stdout.on('data', take('out')); child.stderr.on('data', take('err'));
      child.stdin.on('error', () => undefined); child.stdin.end(stdin);
      const finish = (code: number | null) => { if (done) return; done = true; clearTimeout(timer); resolve({ stdout, stderr, exitCode: code, timedOut: timedOut || code === 137, outputCut: cut, durationMs: Date.now() - t0 }); };
      child.on('close', finish); child.on('error', () => finish(null));
    });
    return {
      async compile() {
        if (!spec.compile) return null;
        const r = await exec(spec.compile, '', { timeMs: 30_000, memoryMb: 1024, outputBytes: 32 * 1024 }, true);
        return r.exitCode === 0 && !r.timedOut ? null : r;
      },
      run: (stdin, limits) => exec(spec.run(main, limits.memoryMb), stdin, limits, !!spec.ownMemoryLimit),
      async close() { await docker(['rm', '-f', name]); await cleanup(); },
    };
  },
};
