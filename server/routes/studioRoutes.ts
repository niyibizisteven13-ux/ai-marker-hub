import { Router } from 'express';
import { prisma } from '../db.js';

const router = Router();
const MAX_PROJECT_BYTES = 8 * 1024 * 1024;
const MAX_WORKSPACE_BYTES = 8 * 1024 * 1024;

function currentUserId(req: any): string | null {
  return typeof req.user?.userId === 'string' ? req.user.userId : null;
}

function parseProject(project: any) {
  return { ...project, examPaper: JSON.parse(project.examPaper), scripts: JSON.parse(project.scripts) };
}

router.get('/', async (req, res) => {
  const userId = currentUserId(req);
  if (!userId) return res.status(401).json({ error: 'Authentication required.' });
  try {
    const projects = await prisma.studioProject.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' } });
    res.json({ projects: projects.map(parseProject) });
  } catch (error) {
    console.error('Failed to list studio projects:', error);
    res.status(500).json({ error: 'Failed to load studio projects.' });
  }
});

router.post('/', async (req, res) => {
  const userId = currentUserId(req);
  if (!userId) return res.status(401).json({ error: 'Authentication required.' });
  const { id, title, examPaper, scripts } = req.body ?? {};
  if (typeof title !== 'string' || !title.trim() || !examPaper || typeof examPaper !== 'object' || !Array.isArray(scripts)) {
    return res.status(400).json({ error: 'A project title, exam paper, and scripts array are required.' });
  }
  if (scripts.length > 1000) return res.status(413).json({ error: 'A project can contain at most 1,000 scripts.' });
  const examPaperJson = JSON.stringify(examPaper);
  const scriptsJson = JSON.stringify(scripts);
  if (Buffer.byteLength(examPaperJson) + Buffer.byteLength(scriptsJson) > MAX_PROJECT_BYTES) {
    return res.status(413).json({ error: 'Project data exceeds the 8 MB limit.' });
  }
  try {
    const data = { title: title.trim().slice(0, 200), examPaper: examPaperJson, scripts: scriptsJson };
    const project = typeof id === 'string'
      ? await prisma.studioProject.updateMany({ where: { id, userId }, data }).then(async (result) => result.count ? prisma.studioProject.findFirst({ where: { id, userId } }) : null)
      : await prisma.studioProject.create({ data: { ...data, userId } });
    if (!project) return res.status(404).json({ error: 'Studio project not found.' });
    res.json({ project: parseProject(project) });
  } catch (error) {
    console.error('Failed to save studio project:', error);
    res.status(500).json({ error: 'Failed to save studio project.' });
  }
});

router.delete('/:id', async (req, res) => {
  const userId = currentUserId(req);
  if (!userId) return res.status(401).json({ error: 'Authentication required.' });
  try {
    const deleted = await prisma.studioProject.deleteMany({ where: { id: req.params.id, userId } });
    if (!deleted.count) return res.status(404).json({ error: 'Studio project not found.' });
    res.status(204).end();
  } catch (error) {
    console.error('Failed to delete studio project:', error);
    res.status(500).json({ error: 'Failed to delete studio project.' });
  }
});

router.get('/workspace', async (req, res) => {
  const userId = currentUserId(req);
  if (!userId) return res.status(401).json({ error: 'Authentication required.' });
  try {
    const [workspace, project] = await Promise.all([
      prisma.workspaceState.findUnique({ where: { userId } }),
      prisma.studioProject.findFirst({ where: { userId }, orderBy: { updatedAt: 'desc' } }),
    ]);
    const savedData = workspace ? JSON.parse(workspace.data) : null;
    if (!savedData && project) {
      res.json({ workspace: { examPaper: JSON.parse(project.examPaper), studentScripts: JSON.parse(project.scripts) }, updatedAt: project.updatedAt });
      return;
    }
    if (savedData && !savedData.examPaper && project) {
      savedData.examPaper = JSON.parse(project.examPaper);
      savedData.studentScripts = JSON.parse(project.scripts);
    }
    res.json({ workspace: savedData, updatedAt: workspace?.updatedAt ?? project?.updatedAt ?? null });
  } catch (error) {
    console.error('Failed to load workspace history:', error);
    res.status(500).json({ error: 'Failed to load workspace history.' });
  }
});

router.get('/:id', async (req, res) => {
  const userId = currentUserId(req);
  if (!userId) return res.status(401).json({ error: 'Authentication required.' });
  try {
    const project = await prisma.studioProject.findFirst({ where: { id: req.params.id, userId } });
    if (!project) return res.status(404).json({ error: 'Studio project not found.' });
    res.json({ project: parseProject(project) });
  } catch (error) {
    console.error('Failed to load studio project:', error);
    res.status(500).json({ error: 'Failed to load studio project.' });
  }
});

router.put('/workspace', async (req, res) => {
  const userId = currentUserId(req);
  if (!userId) return res.status(401).json({ error: 'Authentication required.' });
  const state = req.body?.workspace;
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return res.status(400).json({ error: 'Workspace data must be an object.' });
  }
  const data = JSON.stringify(state);
  if (Buffer.byteLength(data) > MAX_WORKSPACE_BYTES) {
    return res.status(413).json({ error: 'Workspace data exceeds the 8 MB limit.' });
  }
  try {
    const workspace = await prisma.workspaceState.upsert({
      where: { userId },
      create: { userId, data },
      update: { data },
      select: { updatedAt: true },
    });
    res.json({ success: true, updatedAt: workspace.updatedAt });
  } catch (error) {
    console.error('Failed to save workspace history:', error);
    res.status(500).json({ error: 'Failed to save workspace history.' });
  }
});

export default router;
