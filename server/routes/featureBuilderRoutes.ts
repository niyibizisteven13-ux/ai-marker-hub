import { randomBytes } from 'node:crypto';
import { publicReleaseKey, publicReleaseSchema } from '../services/featurePublicRelease.js';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { SharedRateLimitStore } from '../services/cache/redis.js';
import { checkFeatureBrowser, renderFeatureScreenshot, screenshotsConfigured } from '../services/featureScreenshot.js';
import { z } from 'zod';
import { isChatAppProject } from '../../shared/chatAppBuilder.js';
import { prisma } from '../db.js';
import { AgentRuntime } from '../services/ai/AgentRuntime.js';
import { bwengeAgent, fileStore, userAgentTarget } from '../services/AiService.js';
import { checkUsage, recordUsage } from '../services/billing/usage.js';
import { compileFeaturePreview, featureBuilderTools, starterFiles, starterNames } from '../services/featureBuilder.js';

import { nextRevision, projectFilesSchema, revisionMetadata, revisionStateSchema, snapshot, type RevisionState } from '../services/featureRevisions.js';
import type { Starter } from '../services/featureBuilder.js';
import type { Prisma } from '@prisma/client';

const router = Router();
const kindSchema = z.enum(starterNames);
const requestSchema = z.object({
  prompt: z.string().trim().min(1).max(4_000),
  revision: z.number().int().nonnegative().optional(),
  mode: z.enum(['quick', 'standard']).optional(),
}).strict();
const active = new Set<string>();
const toolLabels: Record<string, string> = {
  read_project_file: 'Reading source',
  write_project_file: 'Writing source',
  check_project_build: 'Checking build',
  check_project_browser: 'Running browser checks',
  inspect_project_screenshot: 'Capturing draft screenshot',
};

function projectKey(userId: string, kind: string, project: unknown) {
  if (project === undefined) return `feature-builder:${userId}:${kind}`;
  if (kind === 'custom' && isChatAppProject(project)) return `feature-builder:${userId}:chat:${project}`;
  return null;
}

function loadState(value: unknown, kind: Starter): RevisionState {
  if (value !== undefined) return revisionStateSchema.parse(value);
  return { revision: 0, files: starterFiles(kind), summary: '', history: [], notes: '' };
}

async function saveState(key: string, userId: string, previous: Prisma.JsonValue | undefined, value: RevisionState, db: Pick<typeof prisma, 'appSetting'> = prisma) {
  if (previous !== undefined) {
    const written = await db.appSetting.updateMany({
      where: { key, value: { equals: previous as Prisma.InputJsonValue } },
      data: { value, updatedBy: userId },
    });
    return written.count === 1;
  }
  try {
    await db.appSetting.create({ data: { key, value, updatedBy: userId } });
    return true;
  } catch (error) {
    if ((error as { code?: string })?.code === 'P2002') return false;
    throw error;
  }
}

async function projectResponse(state: RevisionState) {
  return { ...snapshot(state), ...revisionMetadata(state), preview: await compileFeaturePreview(state.files) };
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
    const state = loadState(row?.value, kind.data);
    res.json(await projectResponse(state));
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
    const state = loadState(row?.value, kind.data);
    const selected = [state, ...state.history, state.published].find(item => item?.revision === input.data.revision);
    if (!selected) return res.status(404).json({ error: 'This revision is no longer available.' });
    const png = await renderFeatureScreenshot(await compileFeaturePreview(selected.files), input.data.viewport);
    res.type('png').send(png);
  } catch { res.status(502).json({ error: 'The preview could not be captured.' }); }
});

router.post('/:kind/check-release', screenshotLimit, async (req, res, next) => {
  const kind = kindSchema.safeParse(req.params.kind);
  const viewport = z.enum(['phone', 'desktop']).safeParse(req.body?.viewport);
  const userId = (req as any).user?.userId;
  if (!userId) return res.sendStatus(401);
  if (!kind.success || !viewport.success) return res.sendStatus(400);
  const key = projectKey(userId, kind.data, req.query.project);
  if (!key) return res.sendStatus(400);
  if (!screenshotsConfigured()) return res.status(503).json({ error: 'The browser check environment is not configured.' });
  try {
    const row = await prisma.appSetting.findUnique({ where: { key } });
    const release = loadState(row?.value, kind.data).publicRelease;
    if (!release) return res.status(404).json({ error: 'Publish an app before checking its release.' });
    const artifact = await prisma.appSetting.findUnique({ where: { key: publicReleaseKey(release.id) } });
    const parsed = publicReleaseSchema.safeParse(artifact?.value);
    if (!parsed.success || parsed.data.revision !== release.source.revision) {
      return res.status(409).json({ error: 'The release changed. Try the check again.' });
    }
    try {
      const report = await checkFeatureBrowser(parsed.data.html, viewport.data);
      res.json({ revision: release.source.revision, viewport: viewport.data, ...report });
    } catch { res.status(502).json({ error: 'The release browser check could not finish.' }); }
  } catch (error) { next(error); }
});

const revisionNumber = z.number().int().nonnegative();
const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('edit'), revision: revisionNumber, files: projectFilesSchema }).strict(),
  z.object({ action: z.literal('restore'), revision: revisionNumber, target: revisionNumber }).strict(),
  z.object({ action: z.literal('release'), revision: revisionNumber, target: revisionNumber.optional() }).strict(),
  z.object({ action: z.literal('publish'), revision: revisionNumber, target: revisionNumber }).strict(),
  z.object({ action: z.literal('unpublish'), revision: revisionNumber }).strict(),
  z.object({ action: z.literal('notes'), revision: revisionNumber, notes: z.string().trim().max(2_000) }).strict(),
]);

router.get('/:kind/revision/:revision', async (req, res, next) => {
  const kind = kindSchema.safeParse(req.params.kind);
  const userId = (req as any).user?.userId;
  if (!userId) return res.sendStatus(401);
  if (!kind.success) return res.sendStatus(404);
  const key = projectKey(userId, kind.data, req.query.project);
  if (!key) return res.sendStatus(400);
  try {
    const row = await prisma.appSetting.findUnique({ where: { key } });
    const state = loadState(row?.value, kind.data);
    const selected = req.params.revision === 'release'
      ? state.published
      : [state, ...state.history].find(item => String(item.revision) === req.params.revision);
    if (!selected) return res.sendStatus(404);
    res.json({ revision: selected.revision, preview: await compileFeaturePreview(selected.files) });
  } catch (error) { next(error); }
});

router.post('/:kind/revisions', async (req, res, next) => {
  const kind = kindSchema.safeParse(req.params.kind);
  const input = actionSchema.safeParse(req.body);
  const userId = (req as any).user?.userId;
  if (!userId) return res.sendStatus(401);
  if (!kind.success || !input.success) return res.status(400).json({ error: 'Invalid revision action.' });
  const key = projectKey(userId, kind.data, req.query.project);
  if (!key) return res.sendStatus(400);
  if (active.has(userId)) return res.status(409).json({ error: 'Your build is still running.' });
  const action = input.data;
  const conflict = () => res.status(409).json({ error: 'The project changed. Reload it and try again.' });
  try {
    const row = await prisma.appSetting.findUnique({ where: { key } });
    const state = loadState(row?.value, kind.data);
    if (state.revision !== action.revision) return conflict();
    let value = state;
    let publicArtifact: z.infer<typeof publicReleaseSchema> | undefined;
    switch (action.action) {
      case 'edit':
        value = nextRevision(state, action.files, 'Edited source in the workspace.');
        break;
      case 'restore': {
        const target = state.history.find(item => item.revision === action.target) ??
          (state.published?.revision === action.target ? state.published : undefined);
        if (!target) return res.status(404).json({ error: 'This revision is no longer available.' });
        value = nextRevision(state, target.files, `Restored revision ${target.revision}.`);
        break;
      }
      case 'release': {
        const target = action.target === undefined ? state : state.history.find(item => item.revision === action.target);
        if (!target) return res.status(404).json({ error: 'This revision is no longer available.' });
        value = { ...state, published: snapshot(target) };
        break;
      }
      case 'publish': {
        const target = [state, ...state.history, state.published, state.publicRelease?.previous].find(item => item?.revision === action.target);
        if (!target?.revision) return res.status(404).json({ error: 'Choose a saved revision to publish.' });
        if (state.publicRelease?.source.revision === target.revision) return res.json(await projectResponse(state));
        const artifact = await compileFeaturePreview(target.files).catch(() => undefined);
        const validated = publicReleaseSchema.safeParse({ revision: target.revision, html: artifact });
        if (!validated.success) return res.status(422).json({ error: 'That revision could not be compiled for publishing.' });
        publicArtifact = validated.data;
        value = {
          ...state,
          publicRelease: {
            id: state.publicRelease?.id ?? randomBytes(16).toString('hex'),
            source: snapshot(target),
            ...(state.publicRelease ? { previous: state.publicRelease.source } : {}),
          },
        };
        break;
      }
      case 'unpublish': {
        const { publicRelease: _release, ...unpublished } = state;
        value = unpublished;
        break;
      }
      case 'notes':
        value = { ...state, notes: action.notes };
        break;
    }
    let result;
    try {
      result = await projectResponse(value);
      if (action.action === 'release' && value.published?.revision !== value.revision) {
        await compileFeaturePreview(value.published!.files);
      }
    }
    catch { return res.status(422).json({ error: 'Compilation failed. Check your React and CSS source.' }); }
    if (action.action === 'publish' || action.action === 'unpublish') {
      const saved = await prisma.$transaction(async db => {
        if (!await saveState(key, userId, row?.value, value, db)) return false;
        if (action.action === 'publish' && value.publicRelease && publicArtifact) {
          const artifactKey = publicReleaseKey(value.publicRelease.id);
          await db.appSetting.upsert({
            where: { key: artifactKey }, create: { key: artifactKey, value: publicArtifact, updatedBy: userId },
            update: { value: publicArtifact, updatedBy: userId },
          });
        } else if (state.publicRelease) {
          await db.appSetting.deleteMany({ where: { key: publicReleaseKey(state.publicRelease.id) } });
        }
        return true;
      });
      if (!saved) return conflict();
    } else if (!await saveState(key, userId, row?.value, value)) return conflict();
    res.json(result);
  } catch (error) { next(error); }
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
    const state = loadState(row?.value, kind.data);
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
      maxTurns: input.data.mode === 'quick' ? 4 : 8,
      maxTokens: input.data.mode === 'quick' ? Math.min(2_400, target.maxOutputTokens ?? 2_400) : target.maxOutputTokens,
      system: `Build functioning React features for this ${kind.data} prototype. Read the existing files before changing them. Edit App.jsx and styles.css with the tools. Export an App component by default. Import only React. Use responsive CSS, accessible controls, and sample data for workflows that need a backend. Use the build check and fix errors before summarizing the work. When browser tools are available, check visible changes in the browser and inspect a screenshot if requested. This project has no live platform or customer data. Make real code changes when requested.`,
      messages: [{ role: 'user', content: state.notes
        ? `Saved project preferences:\n${state.notes}\n\nCurrent task:\n${input.data.prompt}`
        : input.data.prompt }],
      ctx: { userId, files: fileStore, services: bwengeAgent.services, signal: abort.signal },
      onEvent: event => {
        if (event.type === 'tool_call') {
          const label = toolLabels[event.data.name] || 'Working on project';
          const input = event.data.input as { path?: unknown } | undefined;
          const detail = typeof input?.path === 'string' ? input.path.slice(0, 80) : undefined;
          emit({ type: 'progress', id: event.data.id, label, state: 'running', detail });
        } else if (event.type === 'tool_result') {
          const label = toolLabels[event.data.name] || 'Working on project';
          const showResult = ['check_project_build', 'check_project_browser'].includes(event.data.name);
          emit({ type: 'progress', id: event.data.id, label, state: event.data.isError ? 'error' : 'done',
            detail: showResult ? event.data.output.slice(0, 220) : undefined });
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
    const value = changed.length ? nextRevision(state, files, summary) : state;
    if (changed.length && !await saveState(key, userId, row?.value, value)) return conflict();
    const usage = { inputTokens: result.usage.input_tokens, outputTokens: result.usage.output_tokens };
    const details = { revision: value.revision, summary, changed, usage };
    const data = fromChat ? details : { ...revisionMetadata(value), ...details, files, preview };
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
