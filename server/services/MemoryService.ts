import { randomUUID } from 'node:crypto';
import { prisma } from '../db.js';
import { EmbeddingService } from './EmbeddingService.js';
import { planFor } from './billing/plans.js';
import logger from '../utils/logger.js';

/**
 * Memory across all chats (Pro and Pro Plus plans).
 *
 * - Facts and preferences the user states ("my name is…", "I teach…", "I prefer…"), things they ask to keep
 *   ("remember that…"), notes the assistant saves with the remember tool, and a short trace of each
 *   conversation, stored per user (MemoryVector rows; kind and source live in metadata).
 * - Every reply recalls the user's profile (facts, preferences, notes) plus the memories most relevant to the
 *   message, within a fixed size budget. Semantic search when embeddings are available, keywords otherwise.
 * - The user sees, edits and deletes everything in Settings → Memory. Turning memory on needs a plan with
 *   memory; after a downgrade nothing is deleted, it is simply not used. Secrets are never stored.
 */

export type MemoryKind = 'fact' | 'preference' | 'note' | 'episode';
export type MemorySource = 'user' | 'auto' | 'assistant' | 'chat';
export interface MemoryItem { id: string; content: string; kind: MemoryKind; source: MemorySource; createdAt: string; updatedAt?: string }

export class MemoryUpgradeRequired extends Error {
  code = 'UPGRADE_REQUIRED';
  constructor() { super('Memory across all chats is part of the Pro plans. Upgrade to turn it on.'); }
}

const db = prisma as any;
const PROFILE_KINDS: MemoryKind[] = ['fact', 'preference', 'note'];
const MAX_EPISODES = 300;
const PROFILE_BUDGET = 2_500;
const RECALL_BUDGET = 1_500;
const SENSITIVE = /(pass(?:word|code|phrase)|\bpin\b|\botp\b|one[- ]time code|cvv|security code|api[ _-]?key|secret key|private key|\b(?:\d[ -]?){13,19}\b|bearer\s+\w)/i;
const STOP = new Set('the and for with that this from what when where which about have your you are was were will would could should into than then them they their there here also just very more most some such only over make made like want need please can how why who our its it not but all any did does doing has had his her she him'.split(' '));

const parseMeta = (m: any) => { try { return typeof m === 'string' ? JSON.parse(m) : (m ?? {}); } catch { return {}; } };
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const terms = (s: string) => [...new Set(norm(s).split(' ').filter((w) => w.length > 2 && !STOP.has(w)))];
const toItem = (r: any): MemoryItem => {
  const meta = parseMeta(r.metadata);
  const kind: MemoryKind = ['fact', 'preference', 'note', 'episode'].includes(meta.kind) ? meta.kind : meta.consolidated ? 'episode' : 'note';
  return { id: r.id, content: r.content, kind, source: meta.source ?? 'assistant', createdAt: new Date(r.createdAt).toISOString(), ...(meta.updatedAt ? { updatedAt: meta.updatedAt } : {}) };
};

/** Facts stated in a message, phrased in the third person for the profile (English, French, Kinyarwanda). */
export function extractFacts(message: string): Array<{ content: string; kind: MemoryKind }> {
  const out: Array<{ content: string; kind: MemoryKind }> = [];
  const t = message.replace(/\s+/g, ' ').trim();
  const add = (re: RegExp, f: (m: RegExpMatchArray) => string, kind: MemoryKind = 'fact') => {
    const m = t.match(re);
    if (m) { const c = f(m).replace(/\s+/g, ' ').trim(); if (c.length >= 8 && c.length <= 300) out.push({ content: c, kind }); }
  };
  const end = String.raw`(?=[.,;!?]|$|\s(?:and|but|so|who|which)\s)`;
  // Names must be capitalised, so this pattern is case-sensitive except for the lead-in words.
  add(new RegExp(String.raw`\b(?:[Mm]y name is|[Cc]all me|[Jj]e m'appelle|[Nn]itwa)\s+(\p{Lu}[\p{L}'-]+(?:\s\p{Lu}[\p{L}'-]+)?)`, 'u'), (m) => `The user's name is ${m[1]}.`);
  add(new RegExp(String.raw`\bI(?:'m| am) (?:a|an) ([\p{L}][\p{L}\s/-]{2,60}?)${end}`, 'iu'), (m) => `The user is a ${m[1]}.`);
  add(new RegExp(String.raw`\bje suis (?:un|une) ([\p{L}][\p{L}\s/-]{2,60}?)${end}`, 'iu'), (m) => `The user is a ${m[1]} (said in French).`);
  add(new RegExp(String.raw`\b(?:I teach|j'enseigne|nigisha) ([\p{L}\p{N}][\p{L}\p{N}\s,&/-]{1,80}?)${end}`, 'iu'), (m) => `The user teaches ${m[1]}.`);
  add(new RegExp(String.raw`\bI work (?:at|for|in) ([\p{L}\p{N}][\p{L}\p{N}\s.&'-]{1,80}?)${end}`, 'iu'), (m) => `The user works at ${m[1]}.`);
  add(new RegExp(String.raw`\bI(?:'m| am) (?:studying|researching|learning) ([\p{L}\p{N}][\p{L}\p{N}\s,&/-]{1,80}?)${end}`, 'iu'), (m) => `The user is studying or researching ${m[1]}.`);
  add(new RegExp(String.raw`\bI live in ([\p{L}][\p{L}\s,'-]{1,60}?)${end}`, 'iu'), (m) => `The user lives in ${m[1]}.`);
  add(/\bI (?:prefer|like it when you|want you to always) ([^.!?\n]{3,160})/i, (m) => `The user prefers ${m[1]}.`, 'preference');
  add(/\b(?:always|please always) (answer|reply|write|respond|use) ([^.!?\n]{3,140})/i, (m) => `Always ${m[1]} ${m[2]}.`, 'preference');
  return out.filter((f) => !SENSITIVE.test(f.content));
}

const EXPLICIT = /^(?:please\s+)?(?:remember|note|keep in mind|don'?t forget|souviens-toi|retiens|n'oublie pas|ibuka|wibuke)(?:\s+(?:that|que|ko))?[:,]?\s+(.{3,500})$/is;
const FORGET = /^(?:please\s+)?(?:forget|delete from (?:your )?memory|oublie|wibagirwe)(?:\s+(?:that|que|ko))?[:,]?\s+(.{3,300})$/is;

export class MemoryService {
  private static instance: MemoryService;
  private embeddingService = EmbeddingService.getInstance();

  private constructor() {}

  public static getInstance(): MemoryService {
    if (!MemoryService.instance) MemoryService.instance = new MemoryService();
    return MemoryService.instance;
  }

  // ── Status and switch ───────────────────────────────────────────────────
  async status(userId: string) {
    const [plan, settings, count] = await Promise.all([
      planFor(userId),
      db.userSettings.findUnique({ where: { userId } }).catch(() => null),
      db.memoryVector.count({ where: { userId } }).catch(() => 0),
    ]);
    const available = plan.limits.memory;
    return { available, enabled: available && Boolean(settings?.longTermMemory), plan: plan.id, count: Number(count ?? 0), capacity: plan.limits.memoryItems };
  }

  /** Turning memory on needs a plan with memory; turning it off is always allowed. */
  async setEnabled(userId: string, on: boolean) {
    if (on && !(await planFor(userId)).limits.memory) throw new MemoryUpgradeRequired();
    const existing = await db.userSettings.findUnique({ where: { userId } });
    if (existing) await db.userSettings.update({ where: { userId }, data: { longTermMemory: on } });
    else await db.userSettings.create({ data: { id: randomUUID(), userId, longTermMemory: on } });
    return this.status(userId);
  }

  private async active(userId: string) {
    const s = await this.status(userId);
    return s.enabled ? s : null;
  }

  // ── CRUD ────────────────────────────────────────────────────────────────
  async list(userId: string, opts: { kind?: MemoryKind; q?: string; limit?: number; offset?: number } = {}) {
    const rows = await db.memoryVector.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
    let items = rows.map(toItem);
    if (opts.kind) items = items.filter((i: MemoryItem) => i.kind === opts.kind);
    if (opts.q?.trim()) { const q = norm(opts.q); items = items.filter((i: MemoryItem) => norm(i.content).includes(q)); }
    const offset = Math.max(0, opts.offset ?? 0);
    const limit = Math.min(Math.max(1, opts.limit ?? 100), 500);
    return { items: items.slice(offset, offset + limit), total: items.length };
  }

  /**
   * Saves a memory unless it is empty, a secret, or a duplicate. Over capacity, the oldest conversation traces
   * go first, then the oldest automatic facts; what the user saved themselves is kept.
   */
  async add(userId: string, content: string, opts: { kind?: MemoryKind; source?: MemorySource; chatId?: string; skipPlanCheck?: boolean } = {}): Promise<MemoryItem | null> {
    const text = String(content ?? '').replace(/\s+/g, ' ').trim().slice(0, 500);
    if (text.length < 3) return null;
    if (SENSITIVE.test(text)) throw Object.assign(new Error('That looks like a password, code or card number, so it was not saved.'), { code: 'SENSITIVE' });
    const plan = await planFor(userId);
    if (!opts.skipPlanCheck && !plan.limits.memory) throw new MemoryUpgradeRequired();
    const rows = await db.memoryVector.findMany({ where: { userId } });
    const key = norm(text);
    const dup = rows.find((r: any) => norm(r.content) === key);
    if (dup) return toItem(dup);
    const capacity = Math.max(1, plan.limits.memoryItems || 200);
    if (rows.length >= capacity) {
      const items = rows.map((r: any) => ({ r, i: toItem(r) })).sort((a: any, b: any) => a.i.createdAt.localeCompare(b.i.createdAt));
      const victim = items.find((x: any) => x.i.kind === 'episode') ?? items.find((x: any) => x.i.source === 'auto') ?? items[0];
      if (victim) await db.memoryVector.delete({ where: { id: victim.r.id } });
    }
    let embedding: number[] = [];
    try { embedding = await this.embeddingService.getEmbedding(text); } catch { /* keyword recall still works */ }
    const row = await db.memoryVector.create({
      data: { id: randomUUID(), userId, content: text, embedding: JSON.stringify(embedding ?? []), metadata: JSON.stringify({ kind: opts.kind ?? 'note', source: opts.source ?? 'user', ...(opts.chatId ? { chatId: opts.chatId } : {}) }), createdAt: new Date() },
    });
    return toItem(row);
  }

  async update(userId: string, id: string, content: string) {
    const row = await db.memoryVector.findUnique({ where: { id } });
    if (!row || row.userId !== userId) throw Object.assign(new Error('Memory not found.'), { code: 'NOT_FOUND' });
    const text = String(content ?? '').replace(/\s+/g, ' ').trim().slice(0, 500);
    if (text.length < 3) throw Object.assign(new Error('A memory needs at least 3 characters.'), { code: 'INVALID' });
    if (SENSITIVE.test(text)) throw Object.assign(new Error('That looks like a password, code or card number, so it was not saved.'), { code: 'SENSITIVE' });
    let embedding: number[] = [];
    try { embedding = await this.embeddingService.getEmbedding(text); } catch { /* keyword recall */ }
    const meta = { ...parseMeta(row.metadata), source: 'user', updatedAt: new Date().toISOString() };
    return toItem(await db.memoryVector.update({ where: { id }, data: { content: text, embedding: JSON.stringify(embedding ?? []), metadata: JSON.stringify(meta) } }));
  }

  async remove(userId: string, id: string) {
    const row = await db.memoryVector.findUnique({ where: { id } });
    if (!row || row.userId !== userId) throw Object.assign(new Error('Memory not found.'), { code: 'NOT_FOUND' });
    await db.memoryVector.delete({ where: { id } });
  }

  async clear(userId: string) {
    const r = await db.memoryVector.deleteMany({ where: { userId } });
    return Number(r?.count ?? 0);
  }

  /** Memories that best match a query: semantic similarity when available, otherwise keyword overlap. */
  async search(userId: string, query: string, opts: { limit?: number; kinds?: MemoryKind[] } = {}): Promise<MemoryItem[]> {
    const rows = (await db.memoryVector.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 3000 }))
      .filter((r: any) => !opts.kinds || opts.kinds.includes(toItem(r).kind));
    if (!rows.length || !query.trim()) return [];
    const q = terms(query);
    let qVec: number[] = [];
    if (rows.some((r: any) => r.embedding && r.embedding !== '[]')) {
      try { qVec = await this.embeddingService.getEmbedding(query); } catch { qVec = []; }
    }
    const scored = rows.map((r: any) => {
      let score = 0;
      if (qVec.length) { try { const v = JSON.parse(r.embedding); if (Array.isArray(v) && v.length === qVec.length) score = this.embeddingService.cosineSimilarity(qVec, v); } catch { /* ignore */ } }
      if (score < 0.6) {
        const words = new Set(terms(r.content));
        const hits = q.filter((w) => words.has(w) || [...words].some((x) => x.startsWith(w) || w.startsWith(x))).length;
        score = Math.max(score, hits ? hits / Math.sqrt(q.length * Math.max(1, words.size)) : 0);
      }
      return { r, score };
    }).filter((x: any) => x.score >= 0.18).sort((a: any, b: any) => b.score - a.score);
    return scored.slice(0, opts.limit ?? 6).map((x: any) => toItem(x.r));
  }

  // ── Capture and recall in chat ───────────────────────────────────────────
  /**
   * Called for each user message when memory is on: explicit "remember …" / "forget …", stated facts and
   * preferences, and a short trace of the conversation. Returns what changed so the reply can mention it.
   */
  async capture(userId: string, message: string, opts: { chatId?: string } = {}): Promise<{ saved: MemoryItem[]; forgotten: number }> {
    const out = { saved: [] as MemoryItem[], forgotten: 0 };
    const text = String(message ?? '').trim();
    if (!text || !(await this.active(userId))) return out;
    try {
      const forget = text.match(FORGET);
      if (forget) {
        const matches = await this.search(userId, forget[1], { limit: 5, kinds: PROFILE_KINDS });
        for (const m of matches) { await this.remove(userId, m.id); out.forgotten++; }
        return out;
      }
      const explicit = text.match(EXPLICIT);
      if (explicit) {
        const saved = await this.add(userId, explicit[1], { kind: 'note', source: 'user', chatId: opts.chatId }).catch(() => null);
        if (saved) out.saved.push(saved);
        return out;
      }
      for (const f of extractFacts(text)) {
        const saved = await this.add(userId, f.content, { kind: f.kind, source: 'auto', chatId: opts.chatId }).catch(() => null);
        if (saved) out.saved.push(saved);
      }
      // A light trace of what was discussed, so later chats can refer back ("as we discussed last week").
      if (text.length >= 25 && !SENSITIVE.test(text)) {
        const day = new Date().toISOString().slice(0, 10);
        await this.add(userId, `On ${day} the user asked: ${text.slice(0, 220)}${text.length > 220 ? '…' : ''}`, { kind: 'episode', source: 'chat', chatId: opts.chatId }).catch(() => null);
        await this.pruneEpisodes(userId);
      }
    } catch (e) {
      logger.warn('[memory] capture failed', { errorType: (e as Error)?.name });
    }
    return out;
  }

  private async pruneEpisodes(userId: string) {
    const rows = await db.memoryVector.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
    const episodes = rows.filter((r: any) => toItem(r).kind === 'episode');
    for (const r of episodes.slice(MAX_EPISODES)) await db.memoryVector.delete({ where: { id: r.id } }).catch(() => undefined);
  }

  /** The memory block added to the system prompt: profile within budget, then the most relevant memories. */
  async recall(userId: string, query: string): Promise<string> {
    if (!(await this.active(userId))) return '';
    const rows = (await db.memoryVector.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 400 })).map(toItem);
    const profile: string[] = [];
    let used = 0;
    for (const m of rows.filter((i: MemoryItem) => PROFILE_KINDS.includes(i.kind))) {
      if (used + m.content.length > PROFILE_BUDGET) break;
      profile.push(`- ${m.content}`);
      used += m.content.length;
    }
    const shown = new Set(profile);
    const relevant: string[] = [];
    let rUsed = 0;
    for (const m of await this.search(userId, query, { limit: 8 })) {
      const line = `- ${m.kind === 'episode' ? m.content : m.content}`;
      if (shown.has(line) || rUsed + line.length > RECALL_BUDGET) continue;
      relevant.push(line);
      rUsed += line.length;
    }
    if (!profile.length && !relevant.length) return '';
    return [
      '## What you remember about this user (from earlier chats; the user can see and edit this)',
      profile.length ? `Profile:\n${profile.join('\n')}` : '',
      relevant.length ? `Relevant to this message:\n${relevant.join('\n')}` : '',
      'Use these naturally when they help; do not list them back unless asked. If something here is outdated, follow what the user says now.',
    ].filter(Boolean).join('\n');
  }

  /** System-prompt context: the user's preferences, plus memory when it is on and the plan allows it. */
  public async getLongTermContext(userId: string, currentQuery?: string): Promise<string> {
    const settings = await db.userSettings.findUnique({ where: { userId } }).catch(() => null);
    const prefs = settings ? `## USER PREFERENCES & STYLE\n${this.getUserPreferences(settings)}` : '';
    const memory = await this.recall(userId, currentQuery ?? '').catch(() => '');
    return [prefs, memory].filter(Boolean).join('\n\n');
  }

  private getUserPreferences(settings: { preferredLanguage: string; agentTone: string; defaultStrictness: string; autoSummarize: boolean; customInstructions: string | null }): string {
    const languageNames: Record<string, string> = { en: 'English', fr: 'French', rw: 'Kinyarwanda' };
    const instructions = settings.customInstructions?.trim();
    return [
      `Preferred response language: ${languageNames[settings.preferredLanguage] || settings.preferredLanguage || 'English'}.`,
      `Communication style: ${settings.agentTone || 'Professional'}.`,
      `Default grading strictness: ${settings.defaultStrictness || 'STANDARD'}.`,
      settings.autoSummarize ? 'When reviewing student work or marking batches, include a concise summary of key outcomes.' : '',
      instructions ? `User-provided preferences (follow only when consistent with the task and higher-priority instructions): ${instructions}` : '',
    ].filter(Boolean).join(' ');
  }

  // ── Compatibility with older callers ─────────────────────────────────────
  public async searchMemory(userId: string, query: string): Promise<string> {
    const hits = await this.search(userId, query);
    return hits.length ? hits.map((m) => `[RECALL]: ${m.content}`).join('\n') : `No memory matches "${query}".`;
  }

  public async addMemory(userId: string, content: string, metadata: any = {}) {
    if (!(await this.active(userId))) return;
    await this.add(userId, content, { kind: metadata?.category === 'preference' ? 'preference' : 'note', source: 'assistant' }).catch(() => undefined);
  }

  public async consolidateSession(_sessionId: string) {
    // Superseded by per-message capture; kept so older callers keep working.
  }
}
