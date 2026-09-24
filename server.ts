import 'dotenv/config';
import express from 'express';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { PrismaClient } from '@prisma/client';

import { AiService } from './server/services/AiService.js';
import { QueueService } from './server/services/QueueService.js';
import { GradingService } from './server/services/GradingService.js';
import { FormOrchestrator } from './server/services/FormOrchestrator.js';
import { AnalyticsWorker } from './server/services/AnalyticsWorker.js';
import { ContextAwareService } from './server/services/ContextAwareService.js';
import { PaywallService } from './server/services/PaywallService.js';
import { ReconciliationService } from './server/services/ReconciliationService.js';
// ASSUMPTION: MemoryService lives alongside the other services below and
// exports a singleton via .getInstance(), matching every other service in
// this file. The original code called MemoryService.getInstance() inside
// the research_memory tool without importing it anywhere — that's the bug
// I'm fixing here. If the real path or export shape differs, this import
// is the one line to correct.
import { MemoryService } from './server/services/MemoryService.js';
import { HighVolumeBatchService } from './server/services/HighVolumeBatchService.js';
import { upload } from './server/middleware/upload.js';
import { ingestDocument } from './server/services/DocumentIngestionService.js';
import { classifyIntent } from './server/services/intentRouter.js';
import { generalTools } from './server/services/generalTools.js';
import logger from './server/utils/logger.js';

import { validate, examSchema, markScriptSchema, batchGradeSchema } from './server/middleware/validation.js';

import fileRoutes from './routes/files.ts';
import { requireAuth, writeAuditLog } from './production/auth.js';
import { generalLimiter, gradingLimiter } from './production/rateLimiter.js';
import authRoutes from './server/routes/authRoutes.ts';
import userRoutes from './server/routes/userRoutes.ts';
import agentRoutes from './server/routes/agentRoutes.ts';
import paymentRoutes from './server/routes/paymentRoutes.ts';
import formRoutes from './server/routes/formRoutes.ts';
import adminRoutes from './server/routes/adminRoutes.ts';
import ollamaRoutes from './server/routes/ollamaRoutes.ts';
import telegramBotRoutes from './server/routes/telegramBotRoutes.ts';
import { TelegramBotService } from './server/services/TelegramBotService.ts';
import { buildFallbackChatReply } from './src/utils/aiFallback.ts';
import { BWENGE_SYSTEM_PROMPT, buildBwengeGradingPrompt } from './src/services/geminiService.ts';
import { generateBatchExcelReport, generateBatchExcelReportFromGradedResults } from './src/services/excelExporter.ts';
import { uploadBufferToCloud } from './src/services/cloudStorage.ts';
import { extractTextFromUpload } from './src/services/documentService.ts';
import { PDFParse } from 'pdf-parse';
import fs from 'fs/promises';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const prisma = new PrismaClient();

const aiService = AiService.getInstance();
const queueService = QueueService.getInstance();
const gradingService = GradingService.getInstance();
const formOrchestrator = FormOrchestrator.getInstance();
const analyticsWorker = AnalyticsWorker.getInstance();
const contextAwareService = ContextAwareService.getInstance();
const paywallService = PaywallService.getInstance();
const memoryService = MemoryService.getInstance();

/**
 * Consistent error-response shape for every route below: full detail in
 * development, a generic message in production. Every route previously
 * rolled its own `res.status(500).json({ error: error.message })`, which
 * leaked raw internal error text (DB errors, provider error bodies) to
 * clients regardless of environment. This is the one place that decides
 * what a caller is allowed to see.
 */
function respondError(res: express.Response, err: any, fallbackMessage = 'Internal server error', status?: number) {
  const httpStatus = status || err?.status || 500;
  logger.error(fallbackMessage, { message: err?.message, stack: err?.stack });
  res.status(httpStatus).json({
    error: process.env.NODE_ENV === 'production' ? fallbackMessage : (err?.message || fallbackMessage),
  });
}

/**
 * Visual Helper: crops a base64 image using percentage-based coordinates.
 * Claude provides x, y, width, height as percentages (0-100).
 */
async function cropImage(base64: string, coords: { x: number; y: number; width: number; height: number }): Promise<string> {
  const buffer = Buffer.from(base64, 'base64');
  const image = sharp(buffer);
  const metadata = await image.metadata();

  if (!metadata.width || !metadata.height) throw new Error('Could not read image metadata');

  const left = Math.round((coords.x / 100) * metadata.width);
  const top = Math.round((coords.y / 100) * metadata.height);
  const width = Math.round((coords.width / 100) * metadata.width);
  const height = Math.round((coords.height / 100) * metadata.height);

  const croppedBuffer = await image
    .extract({ left, top, width, height })
    .toBuffer();

  return croppedBuffer.toString('base64');
}

/**
 * Minimal magic-byte sniff so a client-supplied `attachmentMimeType` can't
 * mislabel a payload before it's handed to a vision model. Covers the
 * attachment types this endpoint actually accepts; anything unrecognized
 * falls back to the claimed type rather than being guessed at further.
 */
function detectRealMimeType(buffer: Buffer): string | null {
  if (buffer.length >= 4 && buffer.slice(0, 4).toString('ascii') === '%PDF') return 'application/pdf';
  if (buffer.length >= 8 && buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.slice(0, 6).toString('ascii'))) return 'image/gif';
  if (buffer.length >= 12 && buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

// In-memory cache for hydrated context (5 minutes TTL).
// NOTE: this only works correctly on a single instance. If this app ever
// runs more than one Render instance/dyno, requests can round-robin across
// processes with different caches — move this to Redis before scaling out.
const contextCache = new Map<string, { context: string; expires: number }>();

// Without a periodic sweep, a key that's set once and never requested
// again (a one-off activeFormId, say) stays in memory forever — the
// "check expiry on read" pattern only evicts a key if something reads it
// again after it's already stale. This bounds memory on a long-running
// process. unref() so the interval itself doesn't block process shutdown.
const CONTEXT_CACHE_SWEEP_MS = 5 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of contextCache.entries()) {
    if (value.expires <= now) contextCache.delete(key);
  }
}, CONTEXT_CACHE_SWEEP_MS).unref();

app.use(express.json({ limit: '20mb' }));

// Public, unauthenticated, and deliberately mounted before the rate
// limiter below: uptime monitors hit this constantly, and getting
// throttled alongside real traffic produces false "service is down"
// alerts. It also reveals nothing about which providers are configured —
// that's reconnaissance information for anyone probing for which
// upstream API to target for quota exhaustion.
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Global rate limiting restored — this was commented out, which meant
// every route below (including the most expensive one, /api/ai/chat) had
// no request-volume protection beyond whatever requireAuth incidentally
// provides.
app.use('/api', generalLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/user', requireAuth, userRoutes);
// Re-enabled: this route was fully unreachable before (import present,
// mount commented out) — dead code that nothing outside this file could
// have been hitting.
app.use('/api/agent', requireAuth, generalLimiter, agentRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/forms', formRoutes);
app.use('/api/admin', requireAuth, adminRoutes);
app.use('/api/ollama', requireAuth, ollamaRoutes);
app.use('/api/telegram', telegramBotRoutes);
app.use('/exports', express.static(path.join(__dirname, 'exports')));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api/files', fileRoutes);

// Authenticated, detailed provider status for internal/admin debugging.
// Behind requireAuth and the standard rate limit, since it's not a
// monitoring hot-path the way /api/health is.
app.get('/api/health/providers', requireAuth, async (req, res) => {
  const hasOllama = await aiService.providerAvailable('ollama').catch(() => false);
  res.json({
    status: 'ok',
    providers: {
      gemini: !!process.env.GEMINI_API_KEY,
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      nvidianim: !!process.env.NVIDIA_NIM_API_KEY,
      ollama: hasOllama,
    },
    env: process.env.NODE_ENV,
  });
});

// Instant Upload & Extraction API
app.post('/api/files/upload', requireAuth, upload.single('file'), async (req, res) => {
  let tempPath: string | undefined;
  try {
    if (!req.file) throw new Error('No file uploaded.');

    const userId = (req as any).user?.userId || 'local-dev';

    // Never trust the client-supplied filename for a path. Keep only a safe
    // extension from it (for the extractor's type detection) and generate the
    // rest — this closes the path-traversal hole where an originalname like
    // "../../.env" or one containing null bytes could write outside uploads/.
    const safeExt = path.extname(req.file.originalname).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 10);
    const uploadsDir = path.join(process.cwd(), 'uploads');
    tempPath = path.join(uploadsDir, `temp-${Date.now()}-${crypto.randomUUID()}${safeExt}`);

    await fs.mkdir(uploadsDir, { recursive: true });
    await fs.writeFile(tempPath, req.file.buffer);

    const record = await prisma.fileRecord.create({
      data: {
        name: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
        userId,
        path: tempPath,
      },
    });

    writeAuditLog(userId, 'FILE_UPLOAD', 'FileRecord', record.id, {
      name: req.file.originalname,
      size: req.file.size,
    }).catch((err) => logger.warn('Audit log write failed for file upload', err));

    extractTextFromUpload(tempPath, req.file.originalname, req.file.mimetype)
      .then(async (result) => {
        await prisma.fileRecord.update({
          where: { id: record.id },
          data: { extractedText: result.rawText },
        });
        logger.info(`Extracted text from ${req.file?.originalname}`);
      })
      .catch((err) => logger.error(`Extraction failed for ${record.id}`, err))
      .finally(() => {
        if (tempPath) {
          fs.unlink(tempPath).catch((err) => logger.warn(`Failed to clean up temp file ${tempPath}`, err));
        }
      });

    res.json({ success: true, fileId: record.id });
  } catch (error: any) {
    respondError(res, error, 'File upload failed.');
  }
});

queueService
  .initialize()
  .then(() => {
    logger.info('Queue service initialized');
  })
  .catch((err) => {
    logger.error('Failed to initialize Queue service', err);
  });

logger.info('Environment Check:', {
  hasGemini: !!process.env.GEMINI_API_KEY,
  hasOpenRouter: !!process.env.OPENROUTER_API_KEY,
  hasOllama: !!process.env.OLLAMA_BASE_URL,
  provider: process.env.AI_PROVIDER,
});

// Helper: pricing lookup backing the lookup_pricing tool, using the 1.2x margin
// tiers already established for these services (see pricing master plan).
async function getPriceForService(service: 'grading' | 'scoring', quantity?: number) {
  if (service === 'grading') {
    const tiers = [
      { max: 50, usd: 0.2 },
      { max: 100, usd: 0.41 },
      { max: 300, usd: 1.1 },
      { max: 500, usd: 1.84 },
    ];
    const qty = quantity || 50;
    const tier = tiers.find((t) => qty <= t.max) || tiers[tiers.length - 1];
    return { service, quantity: qty, priceUsd: tier.usd, currency: 'USD' };
  }

  return { service, quantity: quantity || 1, priceUsd: 0, currency: 'USD', note: 'Free during launch phase' };
}

// Helper: safely extract concatenated text from any AiService result shape
function extractTextContent(result: any): string {
  const content = Array.isArray(result) ? result[result.length - 1]?.content : result?.content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((c: any) => c.type === 'text')
    .map((c: any) => c.text)
    .join('\n');
}

// Safe arithmetic evaluator for the `calculate` tool. Replaces eval().
// The old code filtered input with a regex before calling eval(), but
// eval() is the wrong primitive regardless — a character-class regex is
// not a security boundary against a full JS interpreter. This is a small
// recursive-descent parser that only ever understands +, -, *, /, (), and
// numbers; it cannot execute arbitrary code no matter what string reaches it.
function safeEvaluate(expression: string): number {
  const tokens = expression.match(/\d+(\.\d+)?|[+\-*/()]/g);
  if (!tokens || tokens.join('') !== expression.replace(/\s+/g, '')) {
    throw new Error('Expression contains unsupported characters.');
  }

  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parseExpr(): number {
    let value = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const op = next();
      const rhs = parseTerm();
      value = op === '+' ? value + rhs : value - rhs;
    }
    return value;
  }

  function parseTerm(): number {
    let value = parseFactor();
    while (peek() === '*' || peek() === '/') {
      const op = next();
      const rhs = parseFactor();
      if (op === '/' && rhs === 0) throw new Error('Division by zero.');
      value = op === '*' ? value * rhs : value / rhs;
    }
    return value;
  }

  function parseFactor(): number {
    if (peek() === '(') {
      next();
      const value = parseExpr();
      if (next() !== ')') throw new Error('Mismatched parentheses.');
      return value;
    }
    if (peek() === '-') {
      next();
      return -parseFactor();
    }
    const token = next();
    const value = Number(token);
    if (token === undefined || Number.isNaN(value)) throw new Error('Malformed expression.');
    return value;
  }

  const result = parseExpr();
  if (pos !== tokens.length) throw new Error('Malformed expression.');
  return result;
}

// Helper: build the right prompt/system-instruction per intent
function buildPromptForIntent(
  intent: string,
  query: string,
  opts: {
    attachmentText?: string;
    attachmentName?: string;
    examContext?: any;
    selectedEvidence?: any;
    hydratedContext: string;
  }
) {
  switch (intent) {
    case 'grading':
      return {
        system: `${BWENGE_SYSTEM_PROMPT}\n\n${opts.hydratedContext}`,
        prompt: buildBwengeGradingPrompt(query, opts.attachmentText, opts.attachmentName, opts.examContext, opts.selectedEvidence),
      };
    case 'farming_advice':
      return {
        system: `You are an agricultural advisor for Rwandan farmers. Give practical, actionable advice
          for common crops (maize, beans, cassava, coffee, tea, potatoes, bananas). Keep answers short
          and specific. If symptoms suggest a serious disease/pest outbreak, recommend contacting a
          local agronomist or RAB extension officer.`,
        prompt: query,
      };
    case 'selection_scoring':
      return {
        system: `You are an application/selection scoring assistant. Score submissions against the
          provided rubric and explain your reasoning per criterion.`,
        prompt: query,
      };
    default: {
      const fullPrompt = opts.attachmentText
        ? `ATTACHED DOCUMENT CONTENT:\n${opts.attachmentText}\n\nUSER QUERY:\n${query}`
        : query;
      return {
        system: `You are Bwenge, a helpful assistant.\n\n${opts.hydratedContext}`,
        prompt: fullPrompt,
      };
    }
  }
}

// Unified SSE event writer. Every provider path below funnels through this
// so the client always receives the same event shape — {type, ...} — no
// matter which upstream model actually answered. `type` used to be implicit
// or missing for some providers (Gemini/Ollama/OpenRouter just sent bare
// {text, provider}); now every event explicitly declares its type.
function makeEmitter(res: express.Response) {
  let closed = false;
  res.on('close', () => {
    closed = true;
  });

  const send = (type: string, data: Record<string, any> = {}) => {
    if (closed) return;
    try {
      res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
    } catch (err) {
      logger.warn('SSE write failed (client likely disconnected)', err);
    }
  };

  const done = () => {
    if (closed) return;
    res.write('data: [DONE]\n\n');
    res.end();
  };

  const isClosed = () => closed;

  return { send, done, isClosed };
}

// Claude Assistant Chat Endpoint (Streaming SSE with File Support)
app.post('/api/ai/chat', requireAuth, upload.single('attachment'), async (req, res) => {
  const {
    query,
    attachmentText,
    attachmentName,
    attachmentMimeType,
    attachmentBase64,
    examContext,
    pinnedSyllabus,
    selectedEvidence,
    history,
    activeFormId,
    jobId: bodyJobId,
    service: bodyService,
    extractSchema,
    provider: requestedProvider,
    attachmentIds,
  } = req.body;

  const userId = (req as any).user?.userId || 'local-dev';
  const hasFile = !!req.file || !!attachmentBase64;

  let parsedHistory: any[] = [];
  try {
    if (Array.isArray(history)) {
      parsedHistory = history;
    } else if (typeof history === 'string' && history.trim() !== '' && history !== 'undefined' && history !== 'null') {
      const raw = JSON.parse(history);
      parsedHistory = Array.isArray(raw) ? raw : [];
    }
  } catch (e) {
    logger.warn('History parse failed - falling back to empty array', { error: (e as Error).message });
    parsedHistory = [];
  }

  parsedHistory = parsedHistory.filter((h) => h && typeof h === 'object' && h.role && h.text);

  const cleanProvider = requestedProvider === 'undefined' || requestedProvider === 'null' || !requestedProvider ? null : requestedProvider;

  const intent = await classifyIntent(query || '', hasFile);
  const service = bodyService || (intent === 'general_assist' ? 'general' : intent);
  // crypto.randomUUID() instead of `${userId}-${Date.now()}`, which could
  // collide if the same user fires two requests within the same millisecond.
  const jobId = bodyJobId || crypto.randomUUID();

  if (intent === 'grading' || (Array.isArray(attachmentIds) && attachmentIds.length > 3)) {
    const analytics = AnalyticsWorker.getInstance();
    analytics.aggregateBatchPerformance(userId, jobId).then((insight) => {
      if (insight) {
        // Future: push this to the specific user's open SSE stream via
        // Redis pub/sub or a websocket channel keyed on userId/jobId.
        logger.info(`Proactive Insight Generated for ${userId}: ${insight.title}`);
      }
    }).catch(err => {
      logger.error(`Proactive Insight generation failed for ${userId}:`, err);
    });
  }

  let serverAttachmentText = '';
  let serverVisualFiles: { type: 'image' | 'document'; base64: string; mediaType: string }[] = [];
  let finalAttachmentIds = attachmentIds;

  if (typeof attachmentIds === 'string' && attachmentIds.startsWith('[')) {
    try {
      finalAttachmentIds = JSON.parse(attachmentIds);
    } catch (e) {
      logger.warn('Failed to parse attachmentIds JSON', { attachmentIds });
    }
  }

  if (Array.isArray(finalAttachmentIds) && finalAttachmentIds.length > 0) {
    const files = await prisma.fileRecord.findMany({
      where: { id: { in: finalAttachmentIds } },
      select: { extractedText: true, path: true, mimeType: true },
    });

    serverAttachmentText = files.map((f) => f.extractedText).filter(Boolean).join('\n\n');

    for (const file of files) {
      if (!file.path) continue;
      const isImage = file.mimeType.startsWith('image/');
      const isPdf = file.mimeType === 'application/pdf';

      if (isImage || isPdf) {
        try {
          const buffer = await fs.readFile(file.path);
          serverVisualFiles.push({
            type: isImage ? 'image' : 'document',
            base64: buffer.toString('base64'),
            mediaType: file.mimeType,
          });
          logger.info(`Loaded visual context from disk: ${file.path}`);
        } catch (err) {
          logger.error(`Failed to read file from disk for AI vision: ${file.path}`, err);
        }
      }
    }
  }

  const finalAttachmentText = [attachmentText, serverAttachmentText].filter(Boolean).join('\n\n');

  logger.info('Chat Request Info:', {
    intent,
    service,
    requestedProvider: cleanProvider,
    hasServerText: !!serverAttachmentText,
    serverVisualCount: serverVisualFiles.length,
  });

  if (service !== 'general') {
    const access = await paywallService.checkAccess(userId, service as any, jobId);
    if (!access.allowed) {
      const upgradeLink = `/upgrade?jobId=${jobId}&service=${service}`;
      const gatedMsg = paywallService.buildUpgradeMessage(service, upgradeLink, access.message);

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      const gatedEmitter = makeEmitter(res);
      gatedEmitter.send('text', { text: gatedMsg, gated: true });
      gatedEmitter.done();
      return;
    }
  }

  const hasClaude = await aiService.providerAvailable('anthropic');

  if (intent === 'general_assist' && service === 'general' && !cleanProvider && hasClaude) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const emitter = makeEmitter(res);

    // SSE keep-alive: without this, a long tool call (e.g. delegate_task's
    // nested sub-agent turn) can go long enough with zero bytes written
    // that a reverse proxy (including Render's) times out the connection
    // as idle.
    const keepAlive = setInterval(() => {
      if (!emitter.isClosed()) res.write(':\n\n');
    }, 15000);
    req.on('close', () => clearInterval(keepAlive));

    try {
      let files: { type: 'image' | 'document'; base64: string; mediaType: string }[] = [...serverVisualFiles];
      let augmentedQuery = query || '';

      if (req.file) {
        const ingested = await ingestDocument(req.file.buffer, req.file.mimetype, req.file.originalname);
        if (ingested.mode === 'native_file') {
          files.push({ type: ingested.type!, base64: ingested.base64!, mediaType: ingested.mediaType! });
        } else {
          augmentedQuery = `[Content extracted from: ${ingested.sourceFileName}]${
            ingested.warning ? `\n[Note: ${ingested.warning}]` : ''
          }\n\n${ingested.text}\n\n---\n\nUser's request: ${query}`;
        }
      } else if (attachmentBase64) {
        // Don't trust a client-supplied MIME type unchecked — sniff the
        // actual bytes and prefer that when it disagrees with what the
        // client claimed, so a mislabeled payload can't sail through to
        // the vision model under a false type.
        const buffer = Buffer.from(attachmentBase64, 'base64');
        const detected = detectRealMimeType(buffer);
        const claimed = attachmentMimeType || 'application/pdf';
        if (detected && detected !== claimed) {
          logger.warn('Attachment MIME mismatch — claimed vs detected bytes', { claimed, detected });
        }
        const resolvedType = detected || claimed;
        files.push({
          type: (resolvedType.startsWith('image/') ? 'image' : 'document') as 'image' | 'document',
          base64: attachmentBase64,
          mediaType: resolvedType,
        });
      }

      const finalFiles = files.length > 0 ? files : undefined;

      if (serverAttachmentText) {
        augmentedQuery = `CONTEXT FROM PRE-UPLOADED DOCUMENTS:\n${serverAttachmentText}\n\n---\n\n${augmentedQuery}`;
      }

      await aiService.generalAssist({
        userId,
        messages: [...parsedHistory, { role: 'user', content: augmentedQuery }],
        files: finalFiles,
        pinnedSyllabus,
        extractSchema,
        tools: generalTools,
        onEvent: (event) => {
          if (emitter.isClosed()) return; // client disconnected — stop pushing bytes down a dead socket
          const baseData = {
            provider: event.data?.model?.includes('llama') ? 'NVIDIA' : event.data?.provider || 'Claude-Sonnet',
            taskId: (event as any).taskId,
            agent: (event as any).agent,
          };

          if (event.type === 'text') {
            emitter.send('text', { ...baseData, text: event.data.text, isThinking: event.data.isThinking });
          } else if (event.type === 'tool_call') {
            emitter.send('tool_call', {
              ...baseData,
              name: event.data.name,
              input: event.data.input,
              status: event.data.status || 'started',
            });
          } else if (event.type === 'tool_result') {
            emitter.send('tool_result', { ...baseData, text: event.data.output, name: event.data.name });
          } else if (event.type === 'usage') {
            // Previously only logged and dropped — now also forwarded to
            // the client, since PaywallService's pricing tiers need real
            // usage numbers to reconcile against, not just server logs.
            logger.info('Hybrid Usage Sync:', event.data);
            emitter.send('usage', { ...baseData, usage: event.data });
          }
        },
        executeTool: async (name, input) => {
          switch (name) {
            case 'build_form':
              return `<form_schema>${JSON.stringify(input)}</form_schema>`;

            case 'delegate_task': {
              emitter.send('text', {
                text: `\n> 🕵️ **Sub-Agent (${input.agent_type})**: ${input.instructions}\n`,
                isThinking: true,
              });

              const subResult = await aiService.sendClaudeChat(
                `You are a specialized sub-agent (${input.agent_type}).\nCONTEXT: ${input.context_data || 'None'}\nTASK: ${input.instructions}`,
                { system: `Perform the task precisely and return only the results.` }
              );
              return `SUB-AGENT RESULT: ${subResult.text}`;
            }

            case 'generate_visual_annotation': {
              emitter.send('tool_result', {
                name: 'generate_visual_annotation',
                text: `Suggested annotation at [${input.x}, ${input.y}]: ${input.label}`,
              });
              return `<visual_annotation>${JSON.stringify(input)}</visual_annotation>`;
            }

            case 'research_memory': {
              return await memoryService.searchMemory(userId, input.query);
            }

            case 'cross_reference_visuals': {
              const focusDesc = input.focus_area;
              // Use ALL visual files available in this request (pre-uploaded + new)
              const visualFiles = files || [];
              const visualFile = visualFiles[0];

              if (!visualFile || (visualFile.type !== 'image' && visualFile.type !== 'document')) {
                return `Vision Engine could not localize "${focusDesc}": No visual attachment (image or PDF) found in current session context.`;
              }

              emitter.send('text', {
                text: `\n> 👁️ **Vision Engine**: Re-scanning visual context for: "${focusDesc}"...\n`,
                isThinking: true,
              });

              let imageToAnalyze = visualFile.base64;
              let analysisQuestion = `Analyze this image and describe the details for: "${focusDesc}". Report what you see exactly (handwriting, marks, specific text).`;

              if (input.coordinates) {
                try {
                  imageToAnalyze = await cropImage(visualFile.base64, input.coordinates);
                  analysisQuestion = `This is a cropped high-zoom view of the area: "${focusDesc}". Describe every detail you see in this specific region. If it is handwriting, transcribe it. If it is a mark or score, report it.`;
                  logger.info(`Vision Engine: Cropped image for ${focusDesc}`, input.coordinates);
                } catch (err: any) {
                  logger.warn(`Crop failed for ${focusDesc}, falling back to full image`, err.message);
                }
              }

              const result = await aiService.analyzeImage({
                base64: imageToAnalyze,
                mediaType: visualFile.mediaType,
                question: analysisQuestion,
              });

              return `Vision Engine localized focus on: "${focusDesc}". RESULT: ${result}`;
            }

            case 'extract_structured_data': {
              const extracted = await aiService.generalAssist({
                userId,
                messages: [{ role: 'user', content: input.source_text }],
                extractSchema: input.schema_description,
              });
              return JSON.stringify(extracted);
            }

            case 'translate_text': {
              const translated = await aiService.sendClaudeChat(
                `Translate the following text into ${input.target_language}, preserving tone and meaning:\n\n${input.text}`,
                { system: 'You are a precise translator. Respond with only the translated text, no explanation.' }
              );
              return translated.text;
            }

            case 'calculate': {
              try {
                const value = safeEvaluate(String(input.expression));
                return String(value);
              } catch (e: any) {
                return `Error evaluating expression: ${e.message}`;
              }
            }

            case 'lookup_pricing': {
              const price = await getPriceForService(input.service as any, input.quantity);
              return JSON.stringify(price);
            }

            case 'cross_curriculum_check': {
              return `Alignment confirmed. Rubric for ${input.source_subject} meets 85% of ${input.target_subject} overlap standards. Recommendation: Add a 'Data Verification' step.`;
            }

            case 'generate_multimodal_lesson': {
              return `Lesson script generated for ${input.media_type}: "Hello students, today we are looking at ${input.topic}..." [Script truncated]`;
            }

            case 'generate_browser_extension': {
              try {
                const { extension_name, blocked_domains } = input;

                if (typeof extension_name !== 'string' || !extension_name.trim()) {
                  return 'ERROR: extension_name is required.';
                }
                if (
                  !Array.isArray(blocked_domains) ||
                  blocked_domains.length === 0 ||
                  blocked_domains.length > 100 ||
                  !blocked_domains.every((d: any) => typeof d === 'string' && d.length > 0 && d.length < 253)
                ) {
                  return 'ERROR: blocked_domains must be a non-empty array of up to 100 domain strings.';
                }

                const sanitizedName = extension_name.replace(/[^a-z0-9_-]/gi, '_');
                const extensionDir = path.join(process.cwd(), 'exports', 'extensions', sanitizedName);

                await fs.mkdir(extensionDir, { recursive: true });

                const manifest = {
                  manifest_version: 3,
                  name: extension_name,
                  version: "1.0",
                  description: `Administrative extension to block access to: ${blocked_domains.join(', ')}`,
                  permissions: ["declarativeNetRequest"],
                  declarative_net_request: {
                    rule_resources: [{ id: "rules", enabled: true, path: "rules.json" }]
                  }
                };

                const rules = blocked_domains.map((domain: string, index: number) => ({
                  id: index + 1,
                  priority: 1,
                  action: { type: "block" },
                  condition: {
                    urlFilter: domain.startsWith('||') ? domain : `||${domain}^`,
                    resourceTypes: ["main_frame", "sub_frame", "stylesheet", "script", "image", "object", "xmlhttprequest", "ping", "media"]
                  }
                }));

                await fs.writeFile(path.join(extensionDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
                await fs.writeFile(path.join(extensionDir, 'rules.json'), JSON.stringify(rules, null, 2));

                const relativePath = path.join('exports', 'extensions', sanitizedName);
                return `SUCCESS: Browser extension "${extension_name}" generated successfully.\nFiles created in: ${relativePath}\nBlocked domains: ${blocked_domains.join(', ')}\n\nTo load this extension:\n1. Open chrome://extensions/\n2. Enable "Developer mode"\n3. Click "Load unpacked" and select the folder: ${extensionDir}`;
              } catch (err: any) {
                logger.error('Failed to generate extension', err);
                return `ERROR: Failed to generate browser extension: ${err.message}`;
              }
            }

            default:
              return `Unknown tool: ${name}`;
          }
        },
      });

      clearInterval(keepAlive);
      emitter.done();
    } catch (err: any) {
      logger.error('General assist error', err);
      clearInterval(keepAlive);
      emitter.send('error', { error: process.env.NODE_ENV === 'production' ? 'Internal error' : err.message });
      emitter.done();
    }
    return;
  }

  logger.info('Chat request received (streaming)', { intent, queryPreview: (query || '').slice(0, 80) });
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const emitter = makeEmitter(res);

  const keepAlive = setInterval(() => {
    if (!emitter.isClosed()) res.write(':\n\n');
  }, 15000);
  req.on('close', () => clearInterval(keepAlive));

  try {
    const cacheKey = `${userId}-${activeFormId || 'no-form'}`;
    const cached = contextCache.get(cacheKey);
    let hydratedContext = '';

    if (cached && cached.expires > Date.now()) {
      hydratedContext = cached.context;
    } else {
      hydratedContext = await contextAwareService.buildHydratedPrompt(userId, activeFormId).catch((err) => {
        logger.error('Context hydration failed:', err);
        return 'Context unavailable due to system error.';
      });
      contextCache.set(cacheKey, { context: hydratedContext, expires: Date.now() + 5 * 60 * 1000 });
    }

    const { system: systemWithContext, prompt } = buildPromptForIntent(intent, query || '', {
      attachmentText: finalAttachmentText,
      attachmentName,
      examContext,
      selectedEvidence,
      hydratedContext,
    });

    const isOllama = cleanProvider === 'ollama' || (process.env.AI_PROVIDER === 'ollama' && !cleanProvider);
    const isNvidiaNim = cleanProvider === 'nvidianim' || (process.env.AI_PROVIDER === 'nvidianim' && !cleanProvider);
    const hasOllama = await aiService.providerAvailable('ollama');
    const hasNvidiaNim = await aiService.providerAvailable('nvidianim');

    if (isNvidiaNim && hasNvidiaNim) {
      logger.info('Using NVIDIA NIM for chat...');
      if (intent === 'general_assist') {
        await aiService.runNvidiaAgentLoop({
          prompt,
          system: systemWithContext,
          history: parsedHistory,
          tools: generalTools,
          executeTool: async (name, input) => {
            if (name === 'build_form') return `<form_schema>${JSON.stringify(input)}</form_schema>`;
            return `Tool ${name} executed.`;
          },
          onEvent: (event) => {
            if (emitter.isClosed()) return;
            const baseData = { provider: 'NVIDIA' };
            if (event.type === 'text') emitter.send('text', { ...baseData, text: event.data.text });
            else if (event.type === 'tool_call')
              emitter.send('tool_call', { ...baseData, name: event.data.name, input: event.data.input, status: 'started' });
            else if (event.type === 'tool_result') emitter.send('tool_result', { ...baseData, text: event.data.output, name: event.data.name });
          },
        });
      } else {
        await aiService.streamNvidiaNimChat(prompt, {
          system: systemWithContext,
          history: parsedHistory,
          onToken: (text) => emitter.send('text', { text, provider: 'NVIDIA' }),
          tools: undefined,
        });
      }
    } else if (await aiService.providerAvailable('gemini')) {
      logger.info('Attempting Gemini streaming...');

      const geminiContents: any[] = [
        ...parsedHistory.map((h: any) => ({ role: h.role === 'assistant' ? 'model' : 'user', parts: [{ text: h.text }] })),
      ];

      const currentTurnParts: any[] = [{ text: prompt }];

      // Gemini Vision: Add image/document parts to the current turn
      if (serverVisualFiles.length > 0) {
        for (const file of serverVisualFiles) {
          currentTurnParts.unshift({
            inlineData: {
              data: file.base64,
              mimeType: file.mediaType,
            },
          });
        }
      }

      geminiContents.push({ role: 'user', parts: currentTurnParts });

      const stream = await aiService.streamGeminiContent({
        contents: geminiContents,
        config: { systemInstruction: systemWithContext, temperature: 0.2 },
      });
      for await (const chunk of stream) {
        if (emitter.isClosed()) break;
        const text = (chunk as any).text;
        emitter.send('text', { text, provider: 'Gemini' });
      }
    } else if (isOllama && hasOllama) {
      logger.info('Using Ollama for chat streaming...');
      await aiService.streamOllamaChat(prompt, {
        system: systemWithContext,
        onToken: (text) => emitter.send('text', { text, provider: 'Ollama' }),
      });
    } else if (await aiService.providerAvailable('openrouter')) {
      // NOTE: this path still isn't real token streaming — sendOpenRouterChat
      // returns one complete string, sent as a single SSE event. Left as-is
      // structurally (fixing that needs an OpenRouter streaming call this
      // file doesn't have access to), but it now goes through the same
      // typed `text` event as every other provider instead of a bespoke shape.
      const answer = await aiService.sendOpenRouterChat(prompt, { system: systemWithContext, history: parsedHistory });
      emitter.send('text', { text: answer, provider: 'Claude' });
    } else {
      // Previously this just threw "No AI provider available," which the
      // catch block below turns into a bare error event and nothing else.
      // buildFallbackChatReply was imported for exactly this situation and
      // never used — wiring it in means the user gets a graceful degraded
      // reply instead of a dead end when every provider is down.
      const fallback = buildFallbackChatReply(query || '');
      emitter.send('text', { text: fallback, provider: 'fallback' });
      emitter.send('done', {});
      clearInterval(keepAlive);
      emitter.done();
      return;
    }

    clearInterval(keepAlive);
    emitter.done();
  } catch (err: any) {
    logger.error('Streaming error:', { message: err.message, stack: err.stack });
    clearInterval(keepAlive);
    emitter.send('error', { error: process.env.NODE_ENV === 'production' ? 'Internal Streaming Error' : (err.message || 'Internal Streaming Error') });
    res.end();
  }
});

app.post('/api/forms/generate', requireAuth, async (req, res) => {
  try {
    const { intent } = req.body;
    const userId = (req as any).user?.userId || 'anonymous';
    const form = await formOrchestrator.generateFormSchema(userId, intent);
    res.json({ success: true, form });
  } catch (error: any) {
    respondError(res, error, 'Failed to generate form.');
  }
});

app.post('/api/forms/:id/submit', async (req, res) => {
  try {
    // Basic shape guard: an unbounded number of top-level fields is either
    // abuse or a malformed client — the global 20mb body limit alone
    // doesn't catch a payload with, say, 50,000 tiny fields.
    const fieldCount = req.body && typeof req.body === 'object' ? Object.keys(req.body).length : 0;
    if (fieldCount === 0 || fieldCount > 200) {
      return res.status(400).json({ error: 'Invalid submission payload.' });
    }

    // TODO: validate req.body against this form's actual field/rubric
    // schema (via formOrchestrator) before persisting, once that lookup is
    // available here — right now any shape is accepted and trusted
    // through to the scoring/analytics dashboard downstream.
    const submission = await prisma.formSubmission.create({
      data: { formId: req.params.id, data: JSON.stringify(req.body) },
    });
    analyticsWorker.extractInsights(submission.id);
    res.json({ success: true, submissionId: submission.id });
  } catch (error: any) {
    // A bad/nonexistent formId surfaces as a Prisma foreign-key violation
    // (P2003) — that's a client error (404), not a 500.
    if (error?.code === 'P2003') {
      return res.status(404).json({ error: 'Form not found.' });
    }
    respondError(res, error, 'Failed to submit form.');
  }
});

app.get('/api/forms/:id/analyze', requireAuth, async (req, res) => {
  try {
    // TODO: this confirms the caller is authenticated, not that they own
    // this form. Add an ownership check (form.userId === req.user.userId)
    // once that lookup is available here — as written, any authenticated
    // user who can guess/enumerate a form id can pull another
    // institution's analytics.
    const analysis = await analyticsWorker.runDeepAnalysis(req.params.id);
    res.json({ success: true, analysis });
  } catch (error: any) {
    respondError(res, error, 'Failed to analyze form.');
  }
});

// --- Academic Engine Endpoints (Restored & Unified) ---

app.post('/api/generate-exam', requireAuth, gradingLimiter, validate(examSchema), async (req, res) => {
  try {
    const { subject, topic, gradeLevel, difficulty, questionTypes, totalMarks, durationMinutes, additionalInstructions } = req.body;

    const prompt = `Generate a high-quality exam paper and matching marking rubric based on the following specs:
Subject: ${subject}
Topic: ${topic}
Grade/Year Level: ${gradeLevel || 'Secondary / High School'}
Difficulty Level: ${difficulty || 'Intermediate'}
Requested Question Types: ${(questionTypes || ['short_answer', 'essay', 'calculation']).join(', ')}
Total Marks Target: ${totalMarks || 30}
Duration Target: ${durationMinutes || 45} minutes
Additional Instructions: ${additionalInstructions || 'Ensure clear cognitive levels and unambiguous mark allocations.'}

Return JSON with:
- title: string
- subject: string
- topic: string
- gradeLevel: string
- totalMarks: number
- durationMinutes: number
- questions: array of { id, number, questionText, maxMarks, questionType, modelAnswer, options }
- rubrics: array of { questionId, questionNumber, maxMarks, criteria: array of { id, criterion, marksAvailable, description } }`;

    const systemInstruction = `You are Marker AI's Exam Prep engine.
RULES:
1. The sum of maxMarks across all questions MUST EXACTLY EQUAL totalMarks requested.
2. Sum of criteria marksAvailable MUST EXACTLY EQUAL that question's maxMarks.`;

    const result = await aiService.generateContent({
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: 'application/json'
      }
    });

    const generatedJson = aiService.parseModelJson(result.text || '{}');
    generatedJson.id = 'exam-' + Date.now();
    generatedJson.createdAt = new Date().toISOString();

    res.json({ success: true, examPaper: generatedJson });
  } catch (error: any) {
    respondError(res, error, 'Failed to generate exam paper.');
  }
});

app.post('/api/mark-script', requireAuth, gradingLimiter, validate(markScriptSchema), async (req, res) => {
  try {
    const { examPaper, studentScript } = req.body;
    const userId = (req as any).user?.userId || 'anonymous';

    const result = await gradingService.evaluateStudentScriptWithAI(examPaper, studentScript, `batch-${userId}`);
    res.json({ success: true, ...result });
  } catch (error: any) {
    respondError(res, error, 'Failed to mark student script.');
  }
});

app.post('/api/generate-rubric', requireAuth, gradingLimiter, async (req, res) => {
  try {
    const { questionText, maxMarks, modelAnswer } = req.body;

    const prompt = `Create a granular marking rubric for this exam question:
Question: "${questionText}"
Max Marks: ${maxMarks}
Model Answer: "${modelAnswer || 'N/A'}"
Break down into specific criteria whose total points sum to ${maxMarks}.`;

    const result = await aiService.generateContent({
      contents: prompt,
      config: { responseMimeType: 'application/json' }
    });

    const data = aiService.parseModelJson(result.text || '{}');
    res.json({ success: true, criteria: data.criteria || [] });
  } catch (error: any) {
    respondError(res, error, 'Failed to generate rubric.');
  }
});

app.post('/api/ai/summarize', requireAuth, gradingLimiter, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Text required' });

    const response = await aiService.generateContent({
      contents: `Summarize the following text into 1 concise, high-impact bullet point insight for academic study:\n\n"${text}"`,
    });

    res.json({ success: true, summary: response.text?.trim() || 'Key insight summarized.' });
  } catch (error: any) {
    respondError(res, error, 'Summarization failed.');
  }
});

app.post('/api/ai/translate', requireAuth, gradingLimiter, async (req, res) => {
  try {
    const { text, targetLanguage } = req.body;
    if (!text || !targetLanguage) return res.status(400).json({ error: 'Text and targetLanguage required' });

    const response = await aiService.generateContent({
      contents: `Translate the following academic text accurately into ${targetLanguage}:\n\n"${text}"`,
    });

    res.json({ success: true, translation: response.text?.trim() || 'Translation complete.' });
  } catch (error: any) {
    respondError(res, error, 'Translation failed.');
  }
});

// --- Batch Grading & Job Polling API (for Telegram Bot Integration & Background Processing) ---

app.post('/api/batch/grade', requireAuth, gradingLimiter, upload.fields([{ name: 'papers', maxCount: 1 }, { name: 'rubric', maxCount: 1 }]), async (req: express.Request, res: express.Response) => {
  try {
    const userId = (req as any).user?.userId || 'local-dev';
    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    const papersFile = files?.papers?.[0];
    const rubricFile = files?.rubric?.[0];
    const paperType = req.body.paperType || 'mcq';

    if (!papersFile || !rubricFile) {
      return res.status(400).json({ error: 'Both papers PDF and rubric image are required.' });
    }

    const jobId = crypto.randomUUID();

    // Paywall & quota check
    const access = await paywallService.checkAccess(userId, 'grading', jobId);
    if (!access.allowed) {
      return res.status(402).json({ error: access.message || 'Usage quota exceeded. Please upgrade your plan.' });
    }

    const job = await prisma.batchJob.create({
      data: {
        id: jobId,
        userId,
        paperType,
        status: 'PROCESSING',
      },
    });

    // Respond immediately with jobId
    res.json({ jobId });

    // Run async batch grading using HighVolumeBatchService
    (async () => {
      try {
        let detectedCount = 800;
        try {
          const pdfParser = new PDFParse({ data: papersFile.buffer as Uint8Array });
          const parsed = await pdfParser.getText();
          detectedCount = Math.max(1, Math.round((parsed.text || '').length / 800) || 800);
        } catch (err) {
          logger.warn('Could not parse PDF page count, defaulting to 800', err);
        }

        const highVolumeService = HighVolumeBatchService.getInstance();
        const gradedResults = await highVolumeService.processBatch({
          paperType,
          papersBuffer: papersFile.buffer,
          rubricBuffer: rubricFile.buffer,
          rubricMimeType: rubricFile.mimetype || 'image/jpeg',
          estimatedStudentCount: detectedCount,
        });

        const excelBuffer = await generateBatchExcelReportFromGradedResults(
          `AutoMark Batch - ${paperType.toUpperCase()}`,
          gradedResults
        );

        const exportsDir = path.join(process.cwd(), 'exports');
        await fs.mkdir(exportsDir, { recursive: true });
        const excelFileName = `automark-results-${jobId}.xlsx`;
        const excelFilePath = path.join(exportsDir, excelFileName);
        await fs.writeFile(excelFilePath, excelBuffer);

        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const excelUrl = `${baseUrl}/exports/${excelFileName}`;

        const finalCount = gradedResults.length > 0 ? gradedResults.length : detectedCount;

        await prisma.batchJob.update({
          where: { id: jobId },
          data: {
            status: 'DONE',
            detectedCount: finalCount,
            excelUrl,
            summary: JSON.stringify({ totalPapers: finalCount }),
          },
        });

        logger.info(`Batch grading job ${jobId} completed successfully.`);

        // Proactive Telegram completion notification if initiated from Telegram
        const updatedJob = await prisma.batchJob.findUnique({ where: { id: jobId } });
        if (updatedJob?.telegramChatId) {
          const botService = TelegramBotService.getInstance();
          await botService.sendMessage(
            updatedJob.telegramChatId,
            `🎉 **Batch Job Complete!**\n\nTotal Scripts Graded: **${finalCount}**\n📥 Download Excel: ${excelUrl}`
          );
          await botService.sendDocument(
            updatedJob.telegramChatId,
            excelBuffer,
            excelFileName,
            `📊 Batch Results (${finalCount} scripts)`
          );
        }
      } catch (bgErr: any) {
        logger.error(`Batch grading job ${jobId} failed`, bgErr);
        await prisma.batchJob.update({
          where: { id: jobId },
          data: {
            status: 'FAILED',
            errorMessage: bgErr.message || 'Batch grading failed',
          },
        }).catch((e) => logger.error(`Failed to record job failure for ${jobId}`, e));
      }
    })();
  } catch (err: any) {
    respondError(res, err, 'Failed to initiate batch grading.');
  }
});

app.get('/api/batch/:jobId', requireAuth, generalLimiter, async (req: express.Request, res: express.Response) => {
  try {
    const userId = (req as any).user?.userId;
    const userRole = (req as any).user?.role;

    const job = await prisma.batchJob.findUnique({
      where: { id: req.params.jobId },
    });

    if (!job) {
      return res.status(404).json({ error: 'Job not found.' });
    }

    if (job.userId !== userId && userRole !== 'ADMIN') {
      return res.status(403).json({ error: 'Unauthorized access to job.' });
    }

    let summary = null;
    if (job.summary) {
      try {
        summary = JSON.parse(job.summary);
      } catch (e) {}
    }

    res.json({
      id: job.id,
      status: job.status.toLowerCase(),
      detectedCount: job.detectedCount,
      excelUrl: job.excelUrl,
      summary,
      message: job.errorMessage,
      createdAt: job.createdAt.getTime(),
    });
  } catch (err: any) {
    respondError(res, err, 'Failed to fetch job status.');
  }
});

// Last-resort error handler. Every route above should catch its own
// errors, but this ensures a bug in a future route (or in middleware that
// runs before a route's own try/catch) still returns a clean JSON error
// instead of leaking a stack trace or an inconsistent shape.
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) return next(err);
  respondError(res, err, 'Internal server error', err?.status);
});

// --- Server Lifecycle ---

async function startServer() {
  const reconService = ReconciliationService.getInstance();
  reconService.initialize().catch((err) => {
    logger.error('Failed to start Reconciliation Service', err);
  });

  // Register Telegram bot commands and webhook URL with Telegram API
  const botService = TelegramBotService.getInstance();
  botService.registerCommands().catch((err) => {
    logger.error('Failed to register Telegram bot commands', err);
  });
  const webhookBaseUrl = process.env.APP_BASE_URL || process.env.RENDER_EXTERNAL_URL;
  if (webhookBaseUrl) {
    botService.setWebhook(webhookBaseUrl).catch((err) => {
      logger.error('Failed to set Telegram webhook URL', err);
    });
  }

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));

    // Unmatched API routes should 404 as JSON, not fall through to the SPA
    // shell — otherwise a mistyped or removed endpoint looks like a 200 to
    // any client that isn't a browser.
    app.use('/api', (req, res) => {
      res.status(404).json({ error: `No such endpoint: ${req.method} ${req.originalUrl}` });
    });

    app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    logger.info(`Marker AI server running on http://0.0.0.0:${PORT}`);
  });

  // Graceful shutdown: a deploy/restart sending SIGTERM (Render, Docker,
  // most orchestrators) should stop accepting new connections and let
  // in-flight requests — including open SSE streams — finish before the
  // process exits, rather than cutting them off mid-response.
  const shutdown = (signal: string) => {
    logger.info(`${signal} received, shutting down gracefully...`);
    server.close(async () => {
      try {
        await prisma.$disconnect();
      } catch (err) {
        logger.warn('Error disconnecting Prisma during shutdown', err);
      } finally {
        process.exit(0);
      }
    });
    // Don't hang forever waiting for slow/stuck connections to drain.
    setTimeout(() => {
      logger.warn('Forced shutdown after timeout');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startServer();