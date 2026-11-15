import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { LANGUAGES, pickMain } from './languages.js';
import { CodeRunnerError, type CodeRunner, type CodeSession, type Language, type RunLimits, type RunResult } from './types.js';

/**
 * DEVELOPMENT ONLY. Runs the program on this machine in a private folder with no network (a new network
 * namespace), a memory and CPU limit, a time limit and an output cap. It does NOT hide the rest of the machine:
 * a hostile program could read other files. Never use it for real students: use the Docker runner.
 */
const safeRel = (p: string) => {
  const n = path.posix.normalize(p.replace(/\\/g, '/'));
  if (!n || n.startsWith('/') || n.startsWith('..') || n.includes('/../') || n.split('/').some((s) => s.startsWith('.'))) return null;
  return n;
};

function exec(cwd: string, script: string, stdin: string, limits: RunLimits, language: Language): Promise<RunResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    const kb = limits.memoryMb * 1024;
    // Node and the JVM reserve a lot of address space: they are limited by their own heap option instead.
    const mem = LANGUAGES[language].ownMemoryLimit ? '' : `ulimit -v ${kb};`;
    const cpu = `ulimit -t ${Math.ceil(limits.timeMs / 1000) + 1}; ulimit -f 65536;`;
    const child = spawn('unshare', ['-rn', '--', 'bash', '-c', `${mem} ${cpu} ${script}`], {
      cwd, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: cwd, LANG: 'C.UTF-8', TMPDIR: cwd }, detached: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '', cut = false, timedOut = false, done = false;
    const kill = () => { try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* already gone */ } };
    const timer = setTimeout(() => { timedOut = true; kill(); }, limits.timeMs);
    const take = (which: 'out' | 'err') => (d: Buffer) => {
      const room = limits.outputBytes - stdout.length - stderr.length;
      if (room <= 0) { if (!cut) { cut = true; kill(); } return; }
      const s = d.subarray(0, room).toString('utf8');
      if (which === 'out') stdout += s; else stderr += s;
      if (d.length > room && !cut) { cut = true; kill(); }
    };
    child.stdout.on('data', take('out')); child.stderr.on('data', take('err'));
    child.stdin.on('error', () => undefined);
    child.stdin.end(stdin);
    const finish = (code: number | null) => { if (done) return; done = true; clearTimeout(timer); kill(); resolve({ stdout, stderr, exitCode: code, timedOut, outputCut: cut, durationMs: Date.now() - started }); };
    child.on('close', finish); child.on('error', (e) => { stderr += String(e.message); finish(null); });
  });
}

export const localUnsafeRunner: CodeRunner = {
  name: 'local-unsafe',
  async open(language, files): Promise<CodeSession> {
    const spec = LANGUAGES[language];
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'code-run-'));
    const written: string[] = [];
    for (const f of files) {
      const rel = safeRel(f.path);
      if (!rel) continue;
      await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
      await fs.writeFile(path.join(dir, rel), f.data);
      written.push(rel);
    }
    const main = pickMain(language, written);
    if (!main) { await fs.rm(dir, { recursive: true, force: true }); throw new CodeRunnerError('NO_MAIN', `No ${spec.label} main file found. Name it ${spec.mains[0]}.`); }
    return {
      async compile() {
        if (!spec.compile) return null;
        const r = await exec(dir, spec.compile, '', { timeMs: 30_000, memoryMb: 1024, outputBytes: 32 * 1024 }, language);
        return r.exitCode === 0 && !r.timedOut ? null : r;
      },
      run: (stdin, limits) => exec(dir, spec.run(main, limits.memoryMb), stdin, limits, language),
      close: () => fs.rm(dir, { recursive: true, force: true }),
    };
  },
};
