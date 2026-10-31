import { Router } from 'express';
import * as fs from 'node:fs/promises';
import { prisma } from '../db.js';
import { storageSummary } from '../services/billing/storage.js';
import { assignmentService } from '../services/assignments/runtime.js';

/**
 * Storage (sold with the plans): how much the user keeps, their largest files, and deleting the ones they no
 * longer need. Files a task still shows are deleted from the task (removing a hand-in or the task), not here,
 * so a task never points at a missing file.
 */
const db = prisma as any;
const userIdOf = (req: any): string => req.user?.userId ?? req.user?.id;

export function createStorageRouter() {
  const r = Router();

  r.get('/', async (req, res) => {
    try {
      const userId = userIdOf(req);
      const [summary, rows, inTasks] = await Promise.all([
        storageSummary(userId),
        db.fileRecord.findMany({ where: { userId }, orderBy: { size: 'desc' }, take: 100, select: { id: true, name: true, mimeType: true, size: true, createdAt: true } }),
        assignmentService().fileIds(userId).catch(() => new Set<string>()),
      ]);
      res.json({
        ...summary,
        files: rows.map((f: any) => ({ id: f.id, name: f.name, mime: f.mimeType, size: f.size, createdAt: new Date(f.createdAt).toISOString(), inTask: inTasks.has(f.id) })),
        fileCount: summary.files,
      });
    } catch {
      res.status(500).json({ error: 'Could not read your storage.' });
    }
  });

  r.delete('/files/:id', async (req, res) => {
    try {
      const userId = userIdOf(req);
      const rec = await db.fileRecord.findFirst({ where: { id: String(req.params.id), userId } });
      if (!rec) return res.status(404).json({ error: 'File not found.' });
      if ((await assignmentService().fileIds(userId)).has(rec.id)) return res.status(409).json({ error: 'A task still shows this file. Remove the hand-in or the task in Tasks to free it.' });
      await db.fileRecord.delete({ where: { id: rec.id } });
      if (rec.path) await fs.rm(rec.path, { force: true }).catch(() => undefined);
      res.json({ success: true, ...(await storageSummary(userId)) });
    } catch {
      res.status(500).json({ error: 'Could not delete the file.' });
    }
  });

  return r;
}
