import { prisma } from '../../db.js';

/**
 * Datasets published to Bwenge AI. A knowledge repository is private to its owner (and organisation) until an
 * admin turns on "Bwenge AI: all users" (settings.assistant === true); then every signed-in user's assistant
 * can search, browse, read and analyse it. Files and folders switched off for AI stay out either way.
 */

const db = prisma as any;

export const isPublished = (repo: any): boolean => Boolean(repo?.settings && typeof repo.settings === 'object' && repo.settings.assistant === true);

/** Knowledge bases holding published datasets: each repository's own base plus any folder/file overrides. */
export async function publishedKnowledgeBaseIds(): Promise<string[]> {
  const repos = (await db.knowledgeRepository.findMany({ select: { id: true, knowledgeBaseId: true, settings: true } })).filter(isPublished);
  if (!repos.length) return [];
  const repoIds = repos.map((r: any) => r.id);
  const ids = new Set<string>(repos.map((r: any) => r.knowledgeBaseId).filter(Boolean));
  const [dirs, files] = await Promise.all([
    db.repositoryDirectory.findMany({ where: { repositoryId: { in: repoIds }, knowledgeBaseId: { not: null } }, select: { knowledgeBaseId: true } }),
    db.repositoryFile.findMany({ where: { repositoryId: { in: repoIds }, knowledgeBaseId: { not: null } }, select: { knowledgeBaseId: true } }),
  ]);
  for (const r of [...dirs, ...files]) if (r.knowledgeBaseId) ids.add(r.knowledgeBaseId);
  return [...ids];
}

// Words that signal a question about data, reports or files (English, Kinyarwanda, French).
const DATA_WORDS = /\b(data|dataset|datasets|database|statistics?|stats|survey|census|report|reports|table|spreadsheet|records?|figures?|indicators?|how many|number of|average|mean|median|percentage|percent|rate|trend|compare|comparison|total|ranking|district|province|sector|curriculum|syllabus|according to|in the (?:file|folder|document)|imibare|ibarura|ubushakashatsi|raporo|amakuru|integanyanyigisho|akarere|intara|données|statistiques?|rapport|enquête|recensement|tableau|moyenne|pourcentage)\b/i;

let namesCache: { at: number; names: string[] } | null = null;

/** Names of published datasets and their top-level folders (cached for a minute). */
async function publishedNames(): Promise<string[]> {
  if (namesCache && Date.now() - namesCache.at < 60_000) return namesCache.names;
  const repos = (await db.knowledgeRepository.findMany({ select: { id: true, name: true, settings: true } })).filter(isPublished);
  const folders = repos.length ? await db.repositoryDirectory.findMany({ where: { repositoryId: { in: repos.map((r: any) => r.id) }, parentId: null }, select: { name: true } }) : [];
  const names = [...new Set([...repos.map((r: any) => r.name), ...folders.map((f: any) => f.name)].map((n: string) => n.trim().toLowerCase()).filter((n: string) => n.length >= 4))];
  namesCache = { at: Date.now(), names };
  return names;
}

/** Test hook. */
export function resetPublishedCache() { namesCache = null; }

/**
 * True when published datasets exist and the message looks like a question they could answer, so the turn
 * runs on the tool-enabled agent (search, browse, read and analyse the datasets) instead of plain chat.
 */
export async function asksAboutDatasets(message: string): Promise<boolean> {
  const text = message.trim();
  if (!text) return false;
  const names = await publishedNames().catch(() => [] as string[]);
  if (!names.length) return false;
  const lower = text.toLowerCase();
  return DATA_WORDS.test(text) || names.some((n) => lower.includes(n));
}
