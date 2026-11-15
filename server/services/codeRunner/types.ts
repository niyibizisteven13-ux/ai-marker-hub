/**
 * Running a student's program against a lecturer's tests. A runner opens a session for one hand-in (the files are
 * put in a private folder, compiled once if the language needs it), runs the program once per test with that
 * test's input, and closes the session (everything is deleted). Runners differ only in how strongly they isolate
 * the program: Docker (recommended, on your own server), a development-only local runner, or none.
 */

export type Language = 'python' | 'javascript' | 'c' | 'cpp' | 'java';

export interface RunLimits {
  /** Wall-clock time for one run, in milliseconds. */
  timeMs: number;
  /** Memory for one run, in megabytes. */
  memoryMb: number;
  /** Most output kept (more is cut and the run is stopped), in bytes. */
  outputBytes: number;
}
export const DEFAULT_LIMITS: RunLimits = { timeMs: 5000, memoryMb: 256, outputBytes: 64 * 1024 };

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  outputCut: boolean;
  /** Killed for using too much memory (best effort: the program usually fails with a memory error). */
  durationMs: number;
}

export interface CodeSession {
  /** Compiles the program. Returns null when the language needs no compiling or it worked; otherwise the failed result. */
  compile(): Promise<RunResult | null>;
  run(stdin: string, limits: RunLimits): Promise<RunResult>;
  close(): Promise<void>;
}

export interface CodeRunner {
  readonly name: 'docker' | 'local-unsafe';
  open(language: Language, files: Array<{ path: string; data: Buffer }>): Promise<CodeSession>;
}

export class CodeRunnerError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
