import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { SharedRateLimitStore } from '../services/cache/redis.js';
import { renderFeatureScreenshot, screenshotsConfigured } from '../services/featureScreenshot.js';
import { z } from 'zod';
import { isChatAppProject } from '../../shared/chatAppBuilder.js';
import { prisma } from '../db.js';
import { AgentRuntime } from '../services/ai/AgentRuntime.js';
import { bwengeAgent, fileStore, userAgentTarget } from '../services/AiService.js';
import { checkUsage, recordUsage } from '../services/billing/usage.js';
import { compileFeaturePreview, featureBuilderTools, starterFiles, starterNames } from '../services/featureBuilder.js';

const router = Router();
const kindSchema = z.enum(starterNames);
const requestSchema = z.object({
  prompt: z.string().trim().min(1).max(4_000),
  revision: z.number().int().nonnegative().optional(),
}).strict();
const storedSchema = z.object({
  revision: z.number().int().positive(),
  files: z.object({ 'App.jsx': z.string().max(24_000), 'styles.css': z.string().max(24_000) }),
  summary: z.string().max(4_000),
});
const active = new Set<string>();

function projectKey(userId: string, kind: string, project: unknown) {
  if (project === undefined) return `feature-builder:${userId}:${kind}`;
  if (kind === 'custom' && isChatAppProject(project)) return `feature-builder:${userId}:chat:${project}`;
  return null;
}

router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

router.get('/:kind', async (req, res, next) => {
  const kind = kindSchema.safeParse(req.params.kind);
  if (!kind.success) return res.sendStatus(404);
  const userId = (req as any).user?.userId;
  if (!userId) return res.sendStatus(401);
  const key = projectKey(userId, kind.data, req.query.project);
  if (!key) return res.status(400).json({ error: 'Invalid app project.' });
  try {
    const row = await prisma.appSetting.findUnique({ where: { key } });
    const state = row ? storedSchema.parse(row.value) : { revision: 0, files: starterFiles(kind.data), summary: '' };
    res.json({ ...state, preview: await compileFeaturePreview(state.files) });
  } catch (error) { next(error); }
});

const screenshotLimit = rateLimit({
  windowMs: 60_000, limit: 3, standardHeaders: true, legacyHeaders: false,
  store: new SharedRateLimitStore('feature-screenshot'),
  keyGenerator: req => String((req as any).user?.userId ?? 'unauthenticated'),
  message: { error: 'Wait a minute before taking another screenshot.' },
});
router.post('/:kind/screenshot', screenshotLimit, async (req, res) => {
  const kind = kindSchema.safeParse(req.params.kind);
  const input = z.object({ viewport: z.enum(['phone', 'desktop']), revision: z.number().int().nonnegative() }).strict().safeParse(req.body);
  const userId = (req as any).user?.userId;
  if (!userId) return res.sendStatus(401);
  if (!kind.success || !input.success) return res.status(400).json({ error: 'Choose a valid project and viewport.' });
  const key = projectKey(userId, kind.data, req.query.project);
  if (!key) return res.status(400).json({ error: 'Invalid app project.' });
  if (!screenshotsConfigured()) return res.status(503).json({ error: 'The screenshot environment is not configured.' });
  try {
    const row = await prisma.appSetting.findUnique({ where: { key } });
    const state = row ? storedSchema.parse(row.value) : { revision: 0, files: starterFiles(kind.data) };
    if (state.revision !== input.data.revision) return res.status(409).json({ error: 'Reload the project before capturing the new revision.' });
    const png = await renderFeatureScreenshot(await compileFeaturePreview(state.files), input.data.viewport);
    res.type('png').send(png);
  } catch { res.status(502).json({ error: 'The preview could not be captured.' }); }
});

router.post('/:kind', async (req, res, next) => {
  const kind = kindSchema.safeParse(req.params.kind);
  const input = requestSchema.safeParse(req.body);
  if (!kind.success) return res.sendStatus(404);
  if (!input.success) return res.status(400).json({ error: 'Enter a feature request of up to 4,000 characters.' });
  const userId = (req as any).user?.userId;
  if (!userId) return res.sendStatus(401);
  const key = projectKey(userId, kind.data, req.query.project);
  if (!key) return res.status(400).json({ error: 'Invalid app project.' });
  const fromChat = req.query.project !== undefined && input.data.revision === undefined;
  if (input.data.revision === undefined && !fromChat) return res.status(400).json({ error: 'Project revision is required.' });
  if (active.has(userId)) return res.status(409).json({ error: 'Your current build is still running.' });
  active.add(userId);
  const abort = new AbortController();
  res.once('close', () => abort.abort());
  let streaming = false;
  let stage = { id: 'prepare', label: 'Loading saved project' };
  const emit = (event: Record<string, unknown>) => {
    if (streaming && !res.destroyed && !res.writableEnded) res.write(JSON.stringify(event) + '\n');
  };
  const progress = (id: string, label: string, state: 'running' | 'done' | 'error', detail?: string) => {
    if (state === 'running') stage = { id, label };
    emit({ type: 'progress', id, label, state, detail });
  };
  const failure = (status: number, message: string) => {
    if (!streaming) return res.status(status).json({ error: message });
    progress(stage.id, stage.label, 'error');
    emit({ type: 'error', message });
    return res.end();
  };
  try {
    const row = await prisma.appSetting.findUnique({ where: { key } });
    const state = row ? storedSchema.parse(row.value) : { revision: 0, files: starterFiles(kind.data) };
    const conflict = () => failure(409, 'This project changed in another tab. Reload it and try again.');
    if (!fromChat && state.revision !== input.data.revision) return conflict();
    const gate = await checkUsage(userId, { kind: 'chat', chars: input.data.prompt.length });
    if (!gate.allowed) return res.status(402).json({ error: gate.message });
    if (req.get('Accept') === 'application/x-ndjson') {
      res.type('application/x-ndjson').set('X-Accel-Buffering', 'no');
      res.flushHeaders();
      streaming = true;
      progress('prepare', 'Loading saved project', 'done');
      progress('agent', 'Planning and editing code', 'running');
    }
    const target = await userAgentTarget(userId, input.data.prompt);
    const files = { ...state.files };
    const runtime = new AgentRuntime(target.adapter, featureBuilderTools(files), { maxParallelTools: 1 });
    const result = await runtime.run({
      model: target.model,
      fallbackModel: target.fallbackModel,
      maxTurns: 8,
      maxTokens: target.maxOutputTokens,
      system: `Build functioning React features for this ${kind.data} prototype. Read the existing files before changing them. Edit App.jsx and styles.css with the tools. Export an App component by default. Import only React. Use responsive CSS, accessible controls, and sample data for workflows that need a backend. Use the build check and fix errors before summarizing the work. This project has no live platform or customer data. Make real code changes when requested.`,
      messages: [{ role: 'user', content: input.data.prompt }],
      ctx: { userId, files: fileStore, services: bwengeAgent.services, signal: abort.signal },
      onEvent: event => {
        if (event.type === 'tool_call') {
          const label = { read_project_file: 'Reading source', write_project_file: 'Writing source', check_project_build: 'Checking build' }[event.data.name as 'read_project_file' | 'write_project_file' | 'check_project_build'] || 'Working on project';
          const input = event.data.input as { path?: unknown } | undefined;
          const detail = typeof input?.path === 'string' ? input.path.slice(0, 80) : undefined;
          emit({ type: 'progress', id: event.data.id, label, state: 'running', detail });
        } else if (event.type === 'tool_result') {
          const label = { read_project_file: 'Reading source', write_project_file: 'Writing source', check_project_build: 'Checking build' }[event.data.name as 'read_project_file' | 'write_project_file' | 'check_project_build'] || 'Working on project';
          emit({ type: 'progress', id: event.data.id, label, state: event.data.isError ? 'error' : 'done' });
        }
      },
    });
    await recordUsage(userId, { kind: 'chat', model: target.model, inputTokens: result.usage.input_tokens, outputTokens: result.usage.output_tokens });
    if (abort.signal.aborted) return;
    const changed = (Object.keys(files) as Array<keyof typeof files>).filter(name => files[name] !== state.files[name]);
    const summary = result.text.slice(0, 4_000);
    progress('agent', 'Planning and editing code', 'done');
    progress('compile', 'Compiling preview', 'running');
    let preview: string;
    try { preview = await compileFeaturePreview(files); }
    catch { return failure(422, 'The generated code did not compile. Your last working version is still available.'); }
    progress('compile', 'Compiling preview', 'done');
    progress('save', 'Saving working revision', 'running');
    const revision = state.revision + Number(changed.length > 0);
    if (changed.length) {
      const value = { revision, files, summary };
      if (row) {
        const updated = await prisma.appSetting.updateMany({
          where: { key, value: { path: ['revision'], equals: state.revision } }, data: { value, updatedBy: userId },
        });
        if (updated.count !== 1) return conflict();
      } else {
        try { await prisma.appSetting.create({ data: { key, value, updatedBy: userId } }); }
        catch (error) { if ((error as { code?: string })?.code === 'P2002') return conflict(); throw error; }
      }
    }
    const data = fromChat ? { revision, summary, changed } : { revision, files, preview, summary, changed };
    if (!streaming) return res.json(data);
    progress('save', 'Saving working revision', 'done');
    emit({ type: 'result', data });
    res.end();
  } catch (error) {
    if (!abort.signal.aborted) {
      if (streaming) return failure(500, 'The app build could not finish.');
      next(error);
    }
  }
  finally { active.delete(userId); }
});

export default router;
