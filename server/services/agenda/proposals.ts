import { randomUUID } from 'node:crypto';
import { appSettingKV, type KV } from './store.js';

/**
 * A plan the assistant shows before it acts. The user says yes (or taps "Do it" in Telegram) and the steps run one after the other;
 * the first one that fails stops the rest. A step can carry its own reverse, so "undo" brings things back. Nothing in a plan runs
 * without that yes, and a plan that is not approved within two days is dropped.
 */
export const PROPOSABLE = new Set([
  'publish_form', 'set_test_rules', 'create_form', 'edit_form',
  'create_assignment', 'task_settings', 'mark_task', 'release_task_results',
  'create_class', 'add_class_students', 'link_class_work', 'create_practice_class',
  'release_exam_results', 'change_exam_mark',
  'live_room_settings', 'live_room_student', 'live_room_code', 'launch_test', 'room_assistant',
  'export_task_results', 'export_class_gradebook', 'remember',
]);
export const MAX_STEPS = 8;
export const TTL_MS = 48 * 3_600_000;

export interface PlanStep { tool: string; input: Record<string, unknown>; label: string; undo?: { tool: string; input: Record<string, unknown>; label?: string } }
export interface StepResult { label: string; ok: boolean; text: string; skipped?: boolean }
export interface Proposal {
  id: string; userId: string; title: string; steps: PlanStep[]; createdAt: string; expiresAt: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled' | 'undone';
  results?: StepResult[]; ranAt?: string; undoResults?: StepResult[];
}
export type Exec = (tool: string, input: Record<string, unknown>) => Promise<{ ok: boolean; text: string }>;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Checks what the model proposed: only known action tools, a small number of steps, every step explained in words. */
export function validateSteps(raw: unknown, known: (tool: string) => boolean = () => true): { ok: true; steps: PlanStep[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: 'A plan needs at least one step.' };
  if (raw.length > MAX_STEPS) return { ok: false, error: `A plan can have at most ${MAX_STEPS} steps. Split it in two.` };
  const steps: PlanStep[] = [];
  for (const [i, r] of raw.entries()) {
    if (!isObj(r)) return { ok: false, error: `Step ${i + 1} is not valid.` };
    const tool = String(r.tool ?? '');
    if (!PROPOSABLE.has(tool)) return { ok: false, error: `Step ${i + 1}: "${tool}" cannot be part of a plan. Plans may contain: ${[...PROPOSABLE].join(', ')}.` };
    if (!known(tool)) return { ok: false, error: `Step ${i + 1}: "${tool}" is not available.` };
    const label = String(r.label ?? '').trim();
    if (!label) return { ok: false, error: `Step ${i + 1} needs a label that says in plain words what it does.` };
    const step: PlanStep = { tool, input: isObj(r.input) ? r.input : {}, label: label.slice(0, 140) };
    if (r.undo !== undefined) {
      if (!isObj(r.undo) || !PROPOSABLE.has(String(r.undo.tool ?? '')) || !known(String(r.undo.tool))) return { ok: false, error: `Step ${i + 1}: the undo must be another plan tool with its input.` };
      step.undo = { tool: String(r.undo.tool), input: isObj(r.undo.input) ? r.undo.input : {}, ...(r.undo.label ? { label: String(r.undo.label).slice(0, 140) } : {}) };
    }
    steps.push(step);
  }
  return { ok: true, steps };
}

const key = (userId: string, id: string) => `proposal:${userId}:${id}`;
export function proposalStore(kv: KV = appSettingKV()) {
  return {
    async create(userId: string, title: string, steps: PlanStep[], now: Date = new Date()): Promise<Proposal> {
      const p: Proposal = { id: randomUUID(), userId, title: title.slice(0, 120), steps, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + TTL_MS).toISOString(), status: 'pending' };
      await kv.put(key(userId, p.id), p, userId); return p;
    },
    async get(userId: string, id: string): Promise<Proposal | null> { const v = await kv.get(key(userId, id)); return v && typeof v === 'object' ? (v as Proposal) : null; },
    async save(p: Proposal) { await kv.put(key(p.userId, p.id), p, p.userId); },
    /** The user's plans that are still waiting, newest first. */
    async pending(userId: string, since?: Date, now: Date = new Date()): Promise<Proposal[]> {
      return (await kv.list(`proposal:${userId}:`, 50)).map((r) => r.value as Proposal)
        .filter((p) => p?.status === 'pending' && Date.parse(p.expiresAt) > now.getTime() && (!since || Date.parse(p.createdAt) >= since.getTime()))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
  };
}
export type ProposalStore = ReturnType<typeof proposalStore>;

const words = (steps: PlanStep[]) => steps.map((s, i) => `${i + 1}. ${s.label}`).join('\n');
export const planText = (p: Pick<Proposal, 'title' | 'steps'>) => `${p.title}\n${words(p.steps)}`;

/** Runs the plan after the user said yes. The first failure stops it; what was done is reported either way. */
export async function runProposal(store: ProposalStore, userId: string, id: string, exec: Exec, opts: { now?: Date; audit?: (action: string, details: unknown) => Promise<void> } = {}): Promise<{ ok: boolean; text: string; proposal?: Proposal }> {
  const now = opts.now ?? new Date();
  const p = await store.get(userId, id);
  if (!p) return { ok: false, text: 'That plan was not found (it may belong to someone else or have been dropped).' };
  if (p.status === 'running') return { ok: false, text: 'That plan is already running.', proposal: p };
  if (p.status === 'done') return { ok: false, text: 'That plan has already been done.', proposal: p };
  if (p.status === 'cancelled' || p.status === 'undone') return { ok: false, text: `That plan was ${p.status}.`, proposal: p };
  if (p.status === 'pending' && Date.parse(p.expiresAt) <= now.getTime()) return { ok: false, text: 'That plan has expired (plans wait two days). Ask for it again.', proposal: p };
  p.status = 'running'; await store.save(p);                      // a second tap on "Do it" finds it running
  const results: StepResult[] = [];
  let failed = false;
  for (const s of p.steps) {
    if (failed) { results.push({ label: s.label, ok: false, text: 'Not done: an earlier step failed.', skipped: true }); continue; }
    let r: { ok: boolean; text: string };
    try { r = await exec(s.tool, s.input); } catch (e) { r = { ok: false, text: String((e as Error)?.message ?? e).slice(0, 300) }; }
    results.push({ label: s.label, ok: r.ok, text: r.text.slice(0, 500) });
    if (!r.ok) failed = true;
  }
  p.results = results; p.ranAt = now.toISOString(); p.status = failed ? 'failed' : 'done';
  await store.save(p);
  await opts.audit?.('PROPOSAL_RUN', { id: p.id, title: p.title, steps: p.steps.map((s) => s.tool), ok: !failed });
  const lines = results.map((r) => `${r.skipped ? '–' : r.ok ? '✓' : '✗'} ${r.label}${r.ok ? '' : `: ${r.text}`}`).join('\n');
  const canUndo = p.steps.some((s, i) => s.undo && results[i]?.ok);
  return { ok: !failed, proposal: p, text: `${failed ? 'Stopped: a step did not work.' : 'Done.'}\n${lines}${canUndo ? '\nYou can undo this.' : ''}` };
}

/** Puts things back the way they were, for the steps that carry their own reverse (last step first). */
export async function undoProposal(store: ProposalStore, userId: string, id: string, exec: Exec, opts: { audit?: (action: string, details: unknown) => Promise<void> } = {}): Promise<{ ok: boolean; text: string }> {
  const p = await store.get(userId, id);
  if (!p) return { ok: false, text: 'That plan was not found.' };
  if (p.status !== 'done' && p.status !== 'failed') return { ok: false, text: p.status === 'undone' ? 'That plan was already undone.' : 'Only a plan that was done can be undone.' };
  const todo = p.steps.map((s, i) => ({ s, r: p.results?.[i] })).filter((x) => x.s.undo && x.r?.ok).reverse();
  if (!todo.length) return { ok: false, text: 'None of the steps that were done can be undone: they cannot be reversed (showing results to students, for example, cannot be taken back).' };
  const out: StepResult[] = [];
  for (const { s } of todo) {
    let r: { ok: boolean; text: string };
    try { r = await exec(s.undo!.tool, s.undo!.input); } catch (e) { r = { ok: false, text: String((e as Error)?.message ?? e).slice(0, 300) }; }
    out.push({ label: s.undo!.label ?? `Undo: ${s.label}`, ok: r.ok, text: r.text.slice(0, 500) });
  }
  p.undoResults = out; p.status = out.every((r) => r.ok) ? 'undone' : p.status;
  await store.save(p);
  await opts.audit?.('PROPOSAL_UNDO', { id: p.id, title: p.title, ok: out.every((r) => r.ok) });
  const left = p.steps.length - todo.length;
  return { ok: out.every((r) => r.ok), text: `${out.every((r) => r.ok) ? 'Undone.' : 'Some steps could not be undone.'}\n${out.map((r) => `${r.ok ? '✓' : '✗'} ${r.label}${r.ok ? '' : `: ${r.text}`}`).join('\n')}${left ? `\n${left} step${left === 1 ? '' : 's'} cannot be reversed and stay as they are.` : ''}` };
}

export async function cancelProposal(store: ProposalStore, userId: string, id: string): Promise<{ ok: boolean; text: string }> {
  const p = await store.get(userId, id);
  if (!p) return { ok: false, text: 'That plan was not found.' };
  if (p.status !== 'pending') return { ok: false, text: `That plan is already ${p.status}.` };
  p.status = 'cancelled'; await store.save(p);
  return { ok: true, text: 'Cancelled. Nothing was changed.' };
}
