import { randomInt } from 'node:crypto';
import { prisma } from '../../db.js';
import { checkUsage, recordUsage } from '../billing/usage.js';
import { brier, calibrationNote, generateQuestion, gradeObjective, gradeOpen, newId, topicKeyOf, updateSkill, type GeneratedQuestion } from './adaptive.js';
import type { ProviderAdapter } from '../ai/providers/types.js';

/**
 * Adaptive practice and classes, backed by LearnerSkill, PracticeItem, Classroom and ClassMember.
 * The client never sees an item's answer, hints it has not asked for, or the misconception map before answering.
 * Teachers see class results only in aggregate: per topic, no names, and nothing for groups under K_ANON learners.
 */

const db = prisma as any;
export const K_ANON = 5;

export type AiTarget = { adapter: ProviderAdapter; model: string; fallbackModel?: string | null };

export class LearnError extends Error {
  constructor(public code: 'NOT_FOUND' | 'INVALID' | 'LIMIT' | 'FORBIDDEN' | 'DONE', message: string, public extra?: Record<string, unknown>) { super(message); }
}

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** What the learner may see about an item. */
function publicItem(it: any) {
  const hints = arr<string>(it.hints);
  const base = { id: it.id, topic: it.topicKey, level: it.level, kind: it.kind, question: it.question, choices: it.kind === 'mcq' ? arr<string>(it.choices) : [], foundation: !!it.foundation, hintsShown: hints.slice(0, it.hintsUsed), hintsLeft: Math.max(0, hints.length - it.hintsUsed) };
  if (!it.answeredAt) return base;
  return { ...base, answered: true, response: it.response, confidence: it.confidence, score: it.score, feedback: it.feedback, answer: it.answer, explanation: it.explanation, misconception: it.misconception };
}

function publicSkill(s: any) {
  const calibration = s.ratedCount > 0 ? s.brierSum / s.ratedCount : null;
  return { topic: s.topic, topicKey: s.topicKey, mastery: Math.round(s.mastery * 100) / 100, level: s.level, attempts: s.attempts, accuracy: s.attempts ? Math.round((s.correct / s.attempts) * 100) / 100 : null, streak: s.streak, calibration: calibration === null ? null : Math.round(calibration * 1000) / 1000, lastSeenAt: s.lastSeenAt };
}

async function skillFor(userId: string, topic: string) {
  const topicKey = topicKeyOf(topic);
  if (!topicKey) throw new LearnError('INVALID', 'Choose a topic to practise.');
  const found = await db.learnerSkill.findFirst({ where: { userId, topicKey } });
  if (found) return found;
  const now = new Date();
  return db.learnerSkill.create({ data: { id: newId(), userId, topicKey, topic: topic.trim().slice(0, 120), mastery: 0.3, level: 2, attempts: 0, correct: 0, streak: 0, misses: 0, brierSum: 0, ratedCount: 0, lastSeenAt: now, createdAt: now, updatedAt: now } });
}

async function gate(userId: string) {
  const g = await checkUsage(userId, { kind: 'chat' });
  if (!g.allowed) throw new LearnError('LIMIT', g.message ?? 'Usage limit reached.', { code: g.code, upgrade: g.upgrade, resetsAt: g.resetsAt });
}

export async function listSkills(userId: string) {
  const rows = await db.learnerSkill.findMany({ where: { userId }, orderBy: { lastSeenAt: 'desc' }, take: 100 });
  return rows.map(publicSkill);
}

/** The next question: an unanswered one for this topic if there is one, else a new one at the learner's level. */
export async function nextItem(ai: () => AiTarget, userId: string, input: { topic: string; language?: string }) {
  const skill = await skillFor(userId, input.topic);
  const open = await db.practiceItem.findFirst({ where: { userId, topicKey: skill.topicKey, answeredAt: null }, orderBy: { createdAt: 'desc' } });
  if (open) return { item: publicItem(open), skill: publicSkill(skill) };
  await gate(userId);
  const recent = await db.practiceItem.findMany({ where: { userId, topicKey: skill.topicKey }, orderBy: { createdAt: 'desc' }, take: 8 });
  const foundation = skill.misses >= 2 && skill.level === 1;
  const t = ai();
  const { question: q, usage } = await generateQuestion(t, { topic: skill.topic, level: skill.level, foundation, recent: recent.map((r: any) => r.question), language: input.language });
  void recordUsage(userId, { kind: 'chat', model: t.model, inputTokens: usage?.input, outputTokens: usage?.output });
  const choices = q.kind === 'mcq' ? shuffle(q.choices) : [];
  const item = await db.practiceItem.create({ data: {
    id: newId(), userId, topicKey: skill.topicKey, level: skill.level, kind: q.kind, question: q.question.slice(0, 2000), choices, answer: q.answer.slice(0, 500),
    acceptable: q.acceptable.slice(0, 8), explanation: q.explanation.slice(0, 1500), hints: q.hints.slice(0, 3), misconceptions: q.misconceptions.slice(0, 6),
    foundation, hintsUsed: 0, response: null, confidence: null, score: null, misconception: null, feedback: null, answeredAt: null, createdAt: new Date(),
  } });
  return { item: publicItem(item), skill: publicSkill(skill) };
}

function shuffle<T>(a: T[]): T[] {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) { const j = randomInt(i + 1); [r[i], r[j]] = [r[j], r[i]]; }
  return r;
}

async function ownItem(userId: string, id: string) {
  const it = await db.practiceItem.findFirst({ where: { id, userId } });
  if (!it) throw new LearnError('NOT_FOUND', 'Question not found.');
  return it;
}

export async function revealHint(userId: string, id: string) {
  const it = await ownItem(userId, id);
  if (it.answeredAt) throw new LearnError('DONE', 'This question is already answered.');
  const hints = arr<string>(it.hints);
  if (it.hintsUsed >= hints.length) return { item: publicItem(it) };
  const updated = await db.practiceItem.update({ where: { id }, data: { hintsUsed: it.hintsUsed + 1 } });
  return { item: publicItem(updated) };
}

export async function answerItem(ai: () => AiTarget, userId: string, id: string, input: { response: string; confidence?: number | null }) {
  const it = await ownItem(userId, id);
  if (it.answeredAt) throw new LearnError('DONE', 'This question is already answered.');
  const response = input.response.trim().slice(0, 2000);
  if (!response) throw new LearnError('INVALID', 'Write an answer first.');
  const confidence = input.confidence && input.confidence >= 1 && input.confidence <= 5 ? Math.round(input.confidence) : null;
  const item = { kind: it.kind, answer: it.answer, acceptable: arr<string>(it.acceptable), choices: arr<string>(it.choices) };

  let score: number, feedback: string, misconception: string | null = null;
  const objective = gradeObjective(item, response);
  if (objective) {
    score = objective.score;
    const r = response.trim().toLowerCase();
    const chosen = it.kind === 'mcq' && /^[a-h]$/.test(r) ? item.choices[r.charCodeAt(0) - 97] ?? response : response;
    misconception = score < 1 ? arr<{ answer: string; tag: string }>(it.misconceptions).find((m) => m.answer.trim().toLowerCase() === chosen.trim().toLowerCase())?.tag ?? null : null;
    feedback = score >= 1 ? 'Correct.' : misconception ? `Not quite: this answer usually comes from "${misconception}".` : 'Not quite.';
  } else {
    await gate(userId);
    const t = ai();
    const g = await gradeOpen(t, { question: it.question, answer: it.answer, acceptable: item.acceptable }, response);
    void recordUsage(userId, { kind: 'chat', model: t.model, inputTokens: g.usage?.input, outputTokens: g.usage?.output });
    ({ score, feedback, misconception } = g);
  }

  const skill = await db.learnerSkill.findFirst({ where: { userId, topicKey: it.topicKey } }) ?? await skillFor(userId, it.topicKey);
  const next = updateSkill(skill, score, it.hintsUsed);
  const now = new Date();
  const updatedSkill = await db.learnerSkill.update({ where: { id: skill.id }, data: {
    mastery: next.mastery, level: next.level, streak: next.streak, misses: next.misses, attempts: next.attempts,
    correct: skill.correct + score, brierSum: skill.brierSum + (confidence ? brier(confidence, score) : 0), ratedCount: skill.ratedCount + (confidence ? 1 : 0), lastSeenAt: now,
  } });
  const answered = await db.practiceItem.update({ where: { id }, data: { response, confidence, score, misconception, feedback: feedback.slice(0, 600), answeredAt: now } });
  const levelChange = next.level > skill.level ? 'up' : next.level < skill.level ? 'down' : null;
  return {
    item: publicItem(answered), skill: publicSkill(updatedSkill), delta: Math.round(next.delta * 100) / 100,
    calibration: calibrationNote(confidence, score),
    levelChange, message: levelChange === 'up' ? `Level ${next.level}: questions get harder now.` : levelChange === 'down' ? (next.foundation ? 'Let us strengthen the foundations first.' : `Back to level ${next.level} to consolidate.`) : null,
  };
}

// ── Classes ──────────────────────────────────────────────────────────────────
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 6 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('');

export async function createClass(ownerId: string, name: string) {
  const clean = name.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 80);
  if (!clean) throw new LearnError('INVALID', 'Give the class a name.');
  for (let i = 0; i < 5; i++) {
    const code = newCode();
    if (await db.classroom.findFirst({ where: { code } })) continue;
    const now = new Date();
    return db.classroom.create({ data: { id: newId(), ownerId, name: clean, code, archived: false, createdAt: now, updatedAt: now } });
  }
  throw new LearnError('INVALID', 'Could not create a class code; try again.');
}

export async function joinClass(userId: string, code: string) {
  const cls = await db.classroom.findFirst({ where: { code: code.trim().toUpperCase(), archived: false } });
  if (!cls) throw new LearnError('NOT_FOUND', 'No class has that code.');
  if (cls.ownerId === userId) throw new LearnError('INVALID', 'You teach this class.');
  const existing = await db.classMember.findFirst({ where: { classId: cls.id, userId } });
  if (!existing) await db.classMember.create({ data: { id: newId(), classId: cls.id, userId, joinedAt: new Date() } });
  return { id: cls.id, name: cls.name };
}

export async function leaveClass(userId: string, classId: string) {
  await db.classMember.deleteMany({ where: { classId, userId } });
}

export async function myClasses(userId: string) {
  const owned = await db.classroom.findMany({ where: { ownerId: userId, archived: false }, orderBy: { createdAt: 'desc' } });
  const ownedOut = await Promise.all(owned.map(async (c: any) => ({ id: c.id, name: c.name, code: c.code, students: await db.classMember.count({ where: { classId: c.id } }), role: 'teacher' as const })));
  const memberships = await db.classMember.findMany({ where: { userId } });
  const joined = (await Promise.all(memberships.map((m: any) => db.classroom.findFirst({ where: { id: m.classId, archived: false } })))).filter(Boolean).map((c: any) => ({ id: c.id, name: c.name, role: 'student' as const }));
  return { teaching: ownedOut, joined };
}

export async function archiveClass(ownerId: string, classId: string) {
  const cls = await db.classroom.findFirst({ where: { id: classId, ownerId } });
  if (!cls) throw new LearnError('NOT_FOUND', 'Class not found.');
  await db.classroom.update({ where: { id: classId }, data: { archived: true } });
}

/**
 * Anonymised class dashboard: per topic, how many learners practised, attempts, accuracy, mastery bands and the most
 * common misconceptions. Topics practised by fewer than K_ANON learners are counted but not broken down, and no
 * names or user ids are returned, so a teacher cannot single out a student.
 */
export async function classDashboard(ownerId: string, classId: string, now = Date.now()) {
  const cls = await db.classroom.findFirst({ where: { id: classId, ownerId } });
  if (!cls) throw new LearnError('NOT_FOUND', 'Class not found.');
  const members: string[] = (await db.classMember.findMany({ where: { classId } })).map((m: any) => m.userId);
  const base = { class: { id: cls.id, name: cls.name, code: cls.code }, students: members.length, k: K_ANON };
  if (members.length === 0) return { ...base, active7d: null, topics: [], hidden: 0, note: 'Share the class code so students can join.' };

  const skills = await db.learnerSkill.findMany({ where: { userId: { in: members } } });
  const since = new Date(now - 7 * 86_400_000);
  const recentItems = await db.practiceItem.findMany({ where: { userId: { in: members }, answeredAt: { gte: since } } });
  const active = new Set(recentItems.map((i: any) => i.userId)).size;

  const byTopic = new Map<string, any[]>();
  for (const s of skills) { const l = byTopic.get(s.topicKey) ?? []; l.push(s); byTopic.set(s.topicKey, l); }
  const topics: any[] = [];
  let hidden = 0;
  for (const [topicKey, rows] of byTopic) {
    const learners = new Set(rows.map((r) => r.userId)).size;
    if (learners < K_ANON) { hidden++; continue; }
    const attempts = rows.reduce((a, r) => a + r.attempts, 0);
    const correct = rows.reduce((a, r) => a + r.correct, 0);
    const bands = { struggling: 0, developing: 0, secure: 0 };
    for (const r of rows) bands[r.mastery < 0.4 ? 'struggling' : r.mastery < 0.7 ? 'developing' : 'secure']++;
    const items = await db.practiceItem.findMany({ where: { userId: { in: members }, topicKey, misconception: { not: null } } });
    const tags = new Map<string, Set<string>>();
    for (const i of items) if (i.misconception) { const s = tags.get(i.misconception) ?? new Set(); s.add(i.userId); tags.set(i.misconception, s); }
    // A misconception is listed only when enough distinct learners share it, for the same reason.
    const misconceptions = [...tags].filter(([, users]) => users.size >= Math.min(3, K_ANON)).map(([tag, users]) => ({ tag, learners: users.size })).sort((a, b) => b.learners - a.learners).slice(0, 5);
    topics.push({
      topic: rows[0].topic, learners, attempts, accuracy: attempts ? Math.round((correct / attempts) * 100) / 100 : null,
      meanMastery: Math.round((rows.reduce((a, r) => a + r.mastery, 0) / rows.length) * 100) / 100,
      meanLevel: Math.round((rows.reduce((a, r) => a + r.level, 0) / rows.length) * 10) / 10, bands, misconceptions,
    });
  }
  topics.sort((a, b) => a.meanMastery - b.meanMastery);
  return { ...base, active7d: members.length >= K_ANON ? active : null, topics, hidden, note: hidden ? `${hidden} topic(s) practised by fewer than ${K_ANON} students are not shown, to keep results anonymous.` : null };
}

export type { GeneratedQuestion };
