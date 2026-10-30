import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../db.js';
import { OwnedRecordStore } from '../storage/ownedRecordStore.js';
import { AssignmentError, createAssignmentService, type AssignmentFiles, type AssignmentRecord, type AssignmentService } from './service.js';

/**
 * Files are stored like chat uploads (a FileRecord pointing at the file), so prepared scripts attach to a chat
 * unchanged. They live under data/, the folder every server shares, because a student's hand-in and the teacher's
 * preview may be served by different servers.
 */
export const uploadFiles: AssignmentFiles = {
  async save(userId, name, mime, data) {
    const dir = path.resolve(process.env.ASSIGNMENT_FILES_DIR ?? './data/assignment-files');
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const ext = (/\.[a-z0-9]{1,5}$/i.exec(name)?.[0] ?? '').toLowerCase();
    const file = path.join(dir, `assignment-${Date.now()}-${randomUUID()}${ext}`);
    await fs.writeFile(file, data, { mode: 0o600 });
    const rec = await (prisma as any).fileRecord.create({ data: { name: name.slice(0, 255), mimeType: mime, size: data.length, userId, path: file, url: null } });
    return { id: rec.id, name: rec.name, mime, size: data.length };
  },
  async read(userId, id) {
    const rec = await (prisma as any).fileRecord.findFirst({ where: { id, userId } });
    if (!rec?.path) throw new AssignmentError('NOT_FOUND', 'File not found.', 404);
    return { data: await fs.readFile(rec.path), name: rec.name, mime: rec.mimeType };
  },
};

let service: AssignmentService | null = null;
export function assignmentService(): AssignmentService {
  service ??= createAssignmentService({
    store: new OwnedRecordStore<AssignmentRecord>(process.env.ASSIGNMENTS_DIR ?? './data/assignments', 365 * 24 * 60 * 60 * 1000),
    files: uploadFiles,
    tokenDir: process.env.ASSIGNMENT_TOKENS_DIR ?? './data/assignment-links',
    baseUrl: () => process.env.APP_BASE_URL || process.env.APP_URL || '',
  });
  return service;
}
/** Tests swap the service (temporary folders, in-memory files). */
export function setAssignmentService(s: AssignmentService | null) { service = s; }

