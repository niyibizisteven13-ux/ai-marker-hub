import { Plus, Trash2 } from 'lucide-react';

/**
 * The lecturer's tests for a program: the language, and for each test an input, the expected output, the points
 * and whether it is hidden (a hidden test shows students nothing but pass or fail). Used when setting a task and
 * when changing its tests later.
 */

export interface CodeTest { name: string; input: string; expected: string; points: number; hidden: boolean }
export interface CodeTestsConfig { language: 'python' | 'javascript' | 'c' | 'cpp' | 'java'; compare: 'exact' | 'whitespace' | 'numeric'; timeSeconds: number; showStudents: 'none' | 'summary' | 'full'; tests: CodeTest[] }

export const BLANK_TEST: CodeTest = { name: '', input: '', expected: '', points: 1, hidden: false };
export const BLANK_CONFIG: CodeTestsConfig = { language: 'python', compare: 'whitespace', timeSeconds: 5, showStudents: 'summary', tests: [{ ...BLANK_TEST, name: 'Test 1' }] };

const LANGS: Array<[CodeTestsConfig['language'], string, string]> = [['python', 'Python', 'main.py'], ['javascript', 'JavaScript (Node)', 'main.js'], ['c', 'C', 'main.c'], ['cpp', 'C++', 'main.cpp'], ['java', 'Java', 'Main.java']];
const field = 'w-full rounded-lg border border-white/[0.1] bg-[var(--ws-sunken)] px-2.5 py-2 text-[13px] text-[#F2EFE9] placeholder:text-neutral-500 focus:border-[var(--brand)]/60 focus:outline-none';

export default function CodeTestsEditor({ value, onChange }: { value: CodeTestsConfig; onChange: (v: CodeTestsConfig) => void }) {
  const set = (patch: Partial<CodeTestsConfig>) => onChange({ ...value, ...patch });
  const setTest = (i: number, patch: Partial<CodeTest>) => set({ tests: value.tests.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
  const main = LANGS.find((l) => l[0] === value.language)![2];
  const total = value.tests.reduce((n, t) => n + (Number(t.points) || 0), 0);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="block"><span className="mb-1 block text-[12px] text-neutral-300">Language</span>
          <select value={value.language} onChange={(e) => set({ language: e.target.value as CodeTestsConfig['language'] })} className={field}>{LANGS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <label className="block"><span className="mb-1 block text-[12px] text-neutral-300">Output must match</span>
          <select value={value.compare} onChange={(e) => set({ compare: e.target.value as CodeTestsConfig['compare'] })} className={field}>
            <option value="whitespace">Ignore extra spaces</option><option value="exact">Exactly, line by line</option><option value="numeric">Numbers (small tolerance)</option></select></label>
        <label className="block"><span className="mb-1 block text-[12px] text-neutral-300">Seconds per test</span>
          <input type="number" min={1} max={30} value={value.timeSeconds} onChange={(e) => set({ timeSeconds: Number(e.target.value) })} className={field} /></label>
        <label className="block"><span className="mb-1 block text-[12px] text-neutral-300">Students see</span>
          <select value={value.showStudents} onChange={(e) => set({ showStudents: e.target.value as CodeTestsConfig['showStudents'] })} className={field}>
            <option value="summary">How many tests passed</option><option value="full">Each test (hidden ones only pass or fail)</option><option value="none">Nothing</option></select></label>
      </div>
      <p className="text-[12px] leading-relaxed text-neutral-400">Students name their main file <span className="font-mono text-neutral-200">{main}</span> (or send one source file, or a folder that contains it). The program reads the input from the keyboard (standard input) and prints its answer. Total: <b className="text-neutral-200">{total}</b> points.</p>
      <ul className="space-y-2.5">
        {value.tests.map((t, i) => (
          <li key={i} className="rounded-xl border border-white/[0.1] bg-white/[0.02] p-3">
            <div className="flex flex-wrap items-center gap-2">
              <input aria-label={`Name of test ${i + 1}`} value={t.name} onChange={(e) => setTest(i, { name: e.target.value })} maxLength={60} placeholder={`Test ${i + 1}`} className={`${field} min-w-0 flex-1`} />
              <label className="flex items-center gap-1.5 text-[12px] text-neutral-300">Points <input type="number" min={0} max={100} value={t.points} onChange={(e) => setTest(i, { points: Number(e.target.value) })} className={`${field} w-16`} /></label>
              <label className="flex items-center gap-1.5 text-[12px] text-neutral-300"><input type="checkbox" checked={t.hidden} onChange={(e) => setTest(i, { hidden: e.target.checked })} className="h-4 w-4 accent-[var(--brand)]" />Hidden</label>
              <button type="button" aria-label={`Remove test ${i + 1}`} disabled={value.tests.length === 1} onClick={() => set({ tests: value.tests.filter((_, j) => j !== i) })} className="rounded-lg p-1.5 text-neutral-400 hover:bg-white/10 hover:text-rose-300 disabled:opacity-30"><Trash2 size={15} /></button>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label className="block"><span className="mb-1 block text-[11.5px] text-neutral-400">Input (what the program reads)</span>
                <textarea aria-label={`Input of test ${i + 1}`} rows={3} value={t.input} onChange={(e) => setTest(i, { input: e.target.value })} className={`${field} resize-y font-mono text-[12px]`} /></label>
              <label className="block"><span className="mb-1 block text-[11.5px] text-neutral-400">Expected output</span>
                <textarea aria-label={`Expected output of test ${i + 1}`} rows={3} value={t.expected} onChange={(e) => setTest(i, { expected: e.target.value })} className={`${field} resize-y font-mono text-[12px]`} /></label>
            </div>
          </li>
        ))}
      </ul>
      <button type="button" disabled={value.tests.length >= 50} onClick={() => set({ tests: [...value.tests, { ...BLANK_TEST, name: `Test ${value.tests.length + 1}` }] })} className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.14] px-3 py-1.5 text-[12.5px] font-medium text-neutral-200 hover:bg-white/[0.06]"><Plus size={14} />Add a test</button>
    </div>
  );
}
