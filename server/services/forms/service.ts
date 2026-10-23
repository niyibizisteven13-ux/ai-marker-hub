import { randomUUID } from 'node:crypto';
import { prisma } from '../../db.js';
import { buildDataset, type Dataset } from './analysis.js';
import { normalizeFields, readSchema } from './model.js';
import { checkDefinition } from './validation.js';
import { ensureVersion } from './versions.js';

/** Owner-side form operations for the chat tools and routes. Every call checks ownership. */
const db = prisma as any;

export class FormError extends Error {
  constructor(message: string, public code: 'NOT_FOUND' | 'INVALID' = 'INVALID') { super(message); }
}

const appUrl = () => (process.env.APP_BASE_URL || '').replace(/\/$/, '');
export const formLinks = (id: string) => ({ fill: `${appUrl()}/forms/${id}`, edit: `${appUrl()}/forms/${id}/edit`, results: `${appUrl()}/forms/${id}/edit?tab=results` });

export async function ownForm(userId: string, formId: string) {
  const f = await db.applicationForm.findFirst({ where: { id: formId, userId } });
  if (!f) throw new FormError('Form not found (or it belongs to someone else).', 'NOT_FOUND');
  return { row: f, schema: readSchema(f.schema) };
}

export async function listForms(userId: string) {
  const forms = await db.applicationForm.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' }, take: 50 });
  return Promise.all(forms.map(async (f: any) => {
    const s = readSchema(f.schema);
    return { id: f.id, title: f.title, questions: normalizeFields(s).length, open: s.acceptingResponses !== false, responses: await db.formSubmission.count({ where: { formId: f.id } }), updatedAt: f.updatedAt };
  }));
}

export async function createForm(userId: string, schema: any) {
  const now = new Date();
  const row = await db.applicationForm.create({ data: { id: randomUUID(), userId, title: String(schema.title || 'Untitled form').slice(0, 200), schema: JSON.stringify(schema), rubric: null, selectionSettings: null, createdAt: now, updatedAt: now } });
  return row.id as string;
}

export async function saveForm(userId: string, formId: string, schema: any) {
  await ownForm(userId, formId);
  await db.applicationForm.update({ where: { id: formId }, data: { title: String(schema.title || 'Untitled form').slice(0, 200), schema: JSON.stringify(schema), updatedAt: new Date() } });
}

/** Opens or closes a form for responses. Opening requires a structurally valid form and records its version. */
export async function setOpen(userId: string, formId: string, open: boolean) {
  const { schema } = await ownForm(userId, formId);
  if (open) {
    const c = checkDefinition(schema);
    if (c.errors.length) throw new FormError(`The form cannot be published yet:\n${c.errors.map((e) => `- ${e}`).join('\n')}`);
  }
  await saveForm(userId, formId, { ...schema, acceptingResponses: open });
  return open ? ensureVersion(formId, schema) : null;
}

export async function formDataset(userId: string, formId: string): Promise<{ title: string; ds: Dataset }> {
  const { row, schema } = await ownForm(userId, formId);
  const subs = await db.formSubmission.findMany({ where: { formId }, orderBy: { createdAt: 'asc' } });
  return { title: row.title, ds: buildDataset(schema, subs) };
}
