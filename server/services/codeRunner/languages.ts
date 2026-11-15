import type { Language } from './types.js';

/** How each language is compiled and run, inside the session's folder. */
export interface LanguageSpec {
  label: string;
  /** The extensions of source files (the main file must have one of these). */
  ext: string[];
  /** The names a main file may have, best first. */
  mains: string[];
  /** Shell command to compile every source file, or null. */
  compile: string | null;
  /** Shell command to run the program (stdin is the test's input). */
  run: (main: string, memoryMb: number) => string;
  /** Runtimes that reserve huge address space (Node, the JVM) are limited by their own heap option, not by ulimit -v. */
  ownMemoryLimit?: boolean;
}

const q = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;

export const LANGUAGES: Record<Language, LanguageSpec> = {
  python: { label: 'Python', ext: ['py'], mains: ['main.py', 'app.py', 'solution.py', 'program.py'], compile: null, run: (m) => `python3 -B ${q(m)}` },
  javascript: { label: 'JavaScript (Node)', ext: ['js', 'mjs'], mains: ['main.js', 'index.js', 'app.js', 'solution.js'], compile: null, ownMemoryLimit: true, run: (m, mem) => `node --max-old-space-size=${Math.max(64, Math.floor(mem * 0.75))} ${q(m)}` },
  c: { label: 'C', ext: ['c'], mains: ['main.c', 'solution.c', 'program.c'], compile: 'gcc -O2 -o main_bin $(find . -name "*.c" -not -path "*/.*") -lm', run: () => './main_bin' },
  cpp: { label: 'C++', ext: ['cpp', 'cc', 'cxx'], mains: ['main.cpp', 'main.cc', 'solution.cpp', 'program.cpp'], compile: 'g++ -std=c++17 -O2 -o main_bin $(find . \\( -name "*.cpp" -o -name "*.cc" -o -name "*.cxx" \\) -not -path "*/.*")', run: () => './main_bin' },
  java: { label: 'Java', ext: ['java'], ownMemoryLimit: true, mains: ['Main.java', 'Solution.java', 'Program.java'], compile: 'javac -d out $(find . -name "*.java" -not -path "*/.*")', run: (m, mem) => `java -Xmx${Math.max(64, Math.floor(mem * 0.75))}m -Xss8m -cp out ${q(m.replace(/\.java$/, '').replace(/\//g, '.'))}` },
};

export const isLanguage = (v: unknown): v is Language => typeof v === 'string' && v in LANGUAGES;

/**
 * Picks the main file of a hand-in: a known main name at the top (or in the one wrapping folder), else the only
 * source file. Returns null when it cannot tell (the lecturer is told to ask for a main file).
 */
export function pickMain(language: Language, paths: string[]): string | null {
  const spec = LANGUAGES[language];
  const sources = paths.filter((p) => spec.ext.includes((p.split('.').pop() ?? '').toLowerCase()));
  if (!sources.length) return null;
  const depth = (p: string) => p.split('/').length;
  for (const name of spec.mains) {
    const hit = sources.filter((p) => p.split('/').pop()!.toLowerCase() === name.toLowerCase()).sort((a, b) => depth(a) - depth(b))[0];
    if (hit) return hit;
  }
  return sources.length === 1 ? sources[0] : null;
}
