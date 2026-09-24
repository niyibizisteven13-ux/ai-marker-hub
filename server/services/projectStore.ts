import fs from 'fs/promises';
import path from 'path';

const PROJECTS_ROOT = path.resolve(process.cwd(), 'workspaces');
const conversations = new Map<string, any[]>();

export function projectDir(projectId: string) {
  return path.join(PROJECTS_ROOT, projectId);
}

export async function ensureProject(projectId: string) {
  await fs.mkdir(projectDir(projectId), { recursive: true });
}

export function getMessages(projectId: string) {
  return conversations.get(projectId) ?? [];
}

export function saveMessages(projectId: string, messages: any[]) {
  conversations.set(projectId, messages);
}

export function safePath(projectId: string, relPath: string) {
  const base = projectDir(projectId);
  const resolved = path.resolve(base, relPath);
  if (!resolved.startsWith(base)) throw new Error('Path escapes project dir');
  return resolved;
}
