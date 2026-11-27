import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { AgentRuntime } from '../services/ai/AgentRuntime.js';
import { bwengeAgent, fileStore, userAgentTarget } from '../services/AiService.js';
import { checkUsage, recordUsage } from '../services/billing/usage.js';
import { compileFeaturePreview, featureBuilderTools, starterFiles, starterNames } from '../services/featureBuilder.js';

const router = Router();
const kindSchema = z.enum(starterNames);
const requestSchema = z.object({
  prompt: z.string().trim().min(1).max(4_000),
  revision: z.number().int().nonnegative(),
}).strict();
const storedSchema = z.object({
  revision: z.number().int().positive(),
  files: z.object({ 'App.jsx': z.string().max(24_000), 'styles.css': z.string().max(24_000) }),
  summary: z.string().max(4_000),
});
const active = new Set<string>();

router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

router.get('/:kind', async (req, res, next) => {
  const kind = kindSchema.safeParse(req.params.kind);
  if (!kind.success) return res.sendStatus(404);
  const userId = (req as any).user?.userId;
  if (!userId) return res.sendStatus(401);
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: `feature-builder:${userId}:${kind.data}` } });
    const state = row ? storedSchema.parse(row.value) : { revision: 0, files: starterFiles(kind.data), summary: '' };
    res.json({ ...state, preview: await compileFeaturePreview(state.files) });
  } catch (error) { next(error); }
});

router.post('/:kind', async (req, res, next) => {
  const kind = kindSchema.safeParse(req.params.kind);
  const input = requestSchema.safeParse(req.body);
  if (!kind.success) return res.sendStatus(404);
  if (!input.success) return res.status(400).json({ error: 'Enter a feature request of up to 4,000 characters.' });
  const userId = (req as any).user?.userId;
  if (!userId) return res.sendStatus(401);
  const key = `feature-builder:${userId}:${kind.data}`;
  if (active.has(userId)) return res.status(409).json({ error: 'Your current build is still running.' });
  active.add(userId);
  const abort = new AbortController();
  res.once('close', () => abort.abort());
  try {
    const row = await prisma.appSetting.findUnique({ where: { key } });
    const state = row ? storedSchema.parse(row.value) : { revision: 0, files: starterFiles(kind.data) };
    const conflict = () => res.status(409).json({ error: 'This project changed in another tab. Reload it and try again.' });
    if (state.revision !== input.data.revision) return conflict();
    const gate = await checkUsage(userId, { kind: 'chat', chars: input.data.prompt.length });
    if (!gate.allowed) return res.status(402).json({ error: gate.message });
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
    });
    await recordUsage(userId, { kind: 'chat', model: target.model, inputTokens: result.usage.input_tokens, outputTokens: result.usage.output_tokens });
    if (abort.signal.aborted) return;
    const changed = (Object.keys(files) as Array<keyof typeof files>).filter(name => files[name] !== state.files[name]);
    const summary = result.text.slice(0, 4_000);
    let preview: string;
    try { preview = await compileFeaturePreview(files); }
    catch { return res.status(422).json({ error: 'The generated code did not compile. Your last working version is still available.' }); }
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
    res.json({ revision, files, preview, summary, changed });
  } catch (error) { if (!abort.signal.aborted) next(error); }
  finally { active.delete(userId); }
});

export default router;
