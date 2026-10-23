import { createHash, randomUUID } from 'node:crypto';
import { prisma } from '../../db.js';
import { normalizeFields, readSchema } from './model.js';

/**
 * Form versions. The questions a respondent answered are recorded as an immutable snapshot; when the owner
 * changes the questions after responses arrived, new responses get a new version and old ones keep theirs,
 * so analyses never mix answers to different wordings by accident.
 */
const db = prisma as any;

/** Hash of what changes the meaning of answers: questions, types, options, rules and validation. */
export function definitionHash(schema: unknown): string {
  const f = normalizeFields(schema).map(({ section, ...x }) => x);
  return createHash('sha256').update(JSON.stringify(f)).digest('hex').slice(0, 32);
}

/** The current version number of a form, recording a new snapshot if the questions changed. */
export async function ensureVersion(formId: string, schema: unknown): Promise<number> {
  const hash = definitionHash(schema);
  const latest = await db.formVersion.findFirst({ where: { formId }, orderBy: { version: 'desc' } }).catch(() => null);
  if (latest && latest.hash === hash) return latest.version;
  const version = (latest?.version ?? 0) + 1;
  const def = readSchema(schema);
  delete def.rubric; delete def.selectionSettings;
  await db.formVersion.create({ data: { id: randomUUID(), formId, version, hash, definition: def, createdAt: new Date() } });
  return version;
}

export async function listVersions(formId: string): Promise<Array<{ version: number; createdAt: Date; questions: number }>> {
  const rows = await db.formVersion.findMany({ where: { formId }, orderBy: { version: 'asc' } }).catch(() => []);
  return rows.map((r: any) => ({ version: r.version, createdAt: r.createdAt, questions: normalizeFields(r.definition).length }));
}
