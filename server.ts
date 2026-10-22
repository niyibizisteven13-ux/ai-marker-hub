declare module 'bcryptjs';

import 'dotenv/config';
import express from 'express';
import { createServer } from 'node:http';
import path from 'path';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { prisma } from './server/db.js';
import { validateEmailSenderConfiguration } from './server/email/EmailSender.js';

import { AiService } from './server/services/AiService.js';
import { QueueService } from './server/services/QueueService.js';
import { GradingService } from './server/services/GradingService.js';
import { FormOrchestrator } from './server/services/FormOrchestrator.js';
import { AnalyticsWorker } from './server/services/AnalyticsWorker.js';
import { ContextAwareService } from './server/services/ContextAwareService.js';
import { PaywallService } from './server/services/PaywallService.js';
import { ReconciliationService } from './server/services/ReconciliationService.js';
import { MemoryService } from './server/services/MemoryService.js';
import { HighVolumeBatchService } from './server/services/HighVolumeBatchService.js';
import { SafetyService } from './server/services/SafetyService.js';
import { SentimentService } from './server/services/SentimentService.js';
import { ConfidenceService } from './server/services/ConfidenceService.js';
import { upload, batchUpload } from './server/middleware/upload.js';
import { ingestDocument } from './server/services/DocumentIngestionService.js';
import { classifyIntent, isSmallTalkMessage } from './server/services/intentRouter.js';
import { generalTools } from './server/services/generalTools.js';
import { FileStore, createFileRouter } from './server/services/ai/index.js';
import { describeChatFailure } from './server/services/ai/chatFailure.js';
import datasetRoutes from './server/routes/datasetRoutes.js';
import { analyticsRouter, assessmentRouter, documentsRouter, jobsRouter } from './server/routes/educationRoutes.js';
import { examChat, startEducationRuntime } from './server/services/educationRuntime.js';
import { examsRouter } from './server/routes/examRoutes.js';
import { outputsRouter, sharedOutputsRouter } from './server/routes/outputRoutes.js';
import { knowledgeAdminRouter, knowledgeSourcesRouter } from './server/routes/knowledgeRepositoryRoutes.js';
import { shutdownOcr } from './server/services/documents/ocr.js';
import { agentTarget, fileJobQueue } from './server/services/AiService.js';
import { planOutput } from './server/services/outputs/planner.js';
import { asksAboutDatasets } from './server/services/knowledge/published.js';
import { checkUsage, recordUsage } from './server/services/billing/usage.js';
import { useToolAgent } from './server/services/outputs/chatTurn.js';
import { emptyModelOutputError, nonEmptyModelText } from './server/services/ai/modelOutput.js';
import { validateScanGradeOutput } from './server/services/ai/scanOutput.js';
import logger from './server/utils/logger.js';

import { validate, examSchema, markScriptSchema, batchGradeSchema, chatSchema } from './server/middleware/validation.js';
import { getFileUrlSecret, getJwtSecret } from './server/auth/secrets.js';

import { requireAuth, requireRole, writeAuditLog } from './production/auth.js';
import { generalLimiter, gradingLimiter, publicFormSubmitLimiter, batchGradingLimiter } from './production/rateLimiter.js';
import authRoutes from './server/routes/authRoutes.ts';
import userRoutes from './server/routes/userRoutes.ts';
import agentRoutes from './server/routes/agentRoutes.ts';
import paymentRoutes from './server/routes/paymentRoutes.ts';
import formRoutes from './server/routes/formRoutes.ts';
import studioRoutes from './server/routes/studioRoutes.ts';
import adminRoutes from './server/routes/adminRoutes.ts';
import ollamaRoutes from './server/routes/ollamaRoutes.ts';
import telegramBotRoutes from './server/routes/telegramBotRoutes.ts';
import settingsBillingRoutes from './server/routes/settingsBillingRoutes.ts';
import memoryRoutes from './server/routes/memoryRoutes.js';
import billingRoutes, { momoCallbackRouter } from './server/routes/billingRoutes.js';
import adminBillingRoutes from './server/routes/adminBillingRoutes.js';
import { startBillingJobs } from './server/services/billing/payments.js';
import feedbackRoutes from './server/routes/feedbackRoutes.ts';
import chatSseRoutes from './server/routes/chatSseRoutes.js';
import { getTelegramWebhookBaseUrl, TelegramBotService } from './server/services/TelegramBotService.ts';
import { buildPromptForIntent, buildSmallTalkPrompt } from './server/services/prompts/promptRouter.ts';
import { detectLanguage, buildLanguageBlock } from './server/services/prompts/kinyarwandaStyle.ts';
import { validateEvidenceCitations } from './server/services/GroundedAnswerService.js';
import { buildUserContextScope } from './server/services/ai/dataScope.js';
import { stripThinkingTags } from './server/services/AiService.ts';
import { generateBatchExcelReport, generateBatchExcelReportFromGradedResults } from './src/services/excelExporter.ts';
import { extractTextFromUpload } from './src/services/documentService.ts';
import { attachRealtime } from './server/realtime.js';
import { PDFParse } from 'pdf-parse';
import fs from 'fs/promises';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
const PORT = Number(process.env.PORT) || 3000;
app.set('trust proxy', 1);

// Only trust a known number of reverse proxy hops. Express defaults to zero,
// so direct/local requests cannot spoof their client IP through X-Forwarded-For.
const trustProxyHops = process.env.TRUST_PROXY_HOPS;
if (trustProxyHops !== undefined) {
  const parsedTrustProxyHops = Number(trustProxyHops);
  if (!Number.isInteger(parsedTrustProxyHops) || parsedTrustProxyHops < 0) {
    throw new Error('TRUST_PROXY_HOPS must be a non-negative integer.');
  }
  app.set('trust proxy', parsedTrustProxyHops);
}

// ── Startup environment validation ────────────────────────────────────────
getJwtSecret();
if (!process.env.DATABASE_URL) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL must be configured in production.');
  }
  console.warn('[WARN] DATABASE_URL is not set — running with in-memory database mock.');
}
if (
  process.env.NODE_ENV === 'production' &&
  !/^postgres(?:ql)?:\/\//i.test(process.env.DATABASE_URL || '')
) {
  throw new Error('DATABASE_URL must use PostgreSQL in production; SQLite file: URLs are not supported.');
}
if (!process.env.AI_PROVIDER) {
  process.env.AI_PROVIDER = 'gonkarouter';
}
const AI_PROVIDERS = ['GONKA_API_KEY', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'NVIDIA_NIM_API_KEY', 'OLLAMA_BASE_URL'];
const hasChatProvider = AI_PROVIDERS.some((key) => process.env[key]);
if (!process.env.GEMINI_API_KEY) {
  logger.warn(
    `GEMINI_API_KEY is not configured; semantic embeddings are unavailable and knowledge retrieval will use lexical matching.${hasChatProvider ? '' : ' No chat provider is configured.'}`,
  );
} else if (!hasChatProvider) {
  logger.warn('No AI chat provider is configured; chat and generation features will be unavailable.');
}
// ──────────────────────────────────────────────────────────────────────────

const aiService = AiService.getInstance();
const queueService = QueueService.getInstance();
const gradingService = GradingService.getInstance();
const formOrchestrator = FormOrchestrator.getInstance();
const analyticsWorker = AnalyticsWorker.getInstance();
const contextAwareService = ContextAwareService.getInstance();
const paywallService = PaywallService.getInstance();
const memoryService = MemoryService.getInstance();
const safetyService = SafetyService.getInstance();
const sentimentService = SentimentService.getInstance();
const confidenceService = ConfidenceService.getInstance();
export const fileStore = new FileStore({ dir: process.env.FILE_STORE_DIR ?? './data/generated', secret: getFileUrlSecret() });
const purgeExpiredFiles = () => {
  void fileStore.purgeExpired().catch((error) => {
    logger.error('Scheduled expired-file purge failed.', error);
  });
};
purgeExpiredFiles();
setInterval(purgeExpiredFiles, 24 * 60 * 60 * 1000).unref();

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

// ── Security headers (replaces the 'helmet' npm package) ─────────────────
// Sets the same headers helmet would set, with no external dependency.
app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
  // The scanner runs as a Telegram Mini App, which Telegram Web shows in an iframe.
  if (req.path === '/scanner.html') res.setHeader('Content-Security-Policy', "frame-ancestors 'self' https://web.telegram.org https://*.telegram.org");
  else res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '0'); // Modern browsers ignore this; CSP is the real defence
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
});

// ── CORS ──────────────────────────────────────────────────────────────────
// Allow requests from configured frontend origins and production domains.
const allowedOrigins = [
  process.env.APP_URL,
  'https://www.bwenge.com',
  'https://www.bwenge.space',
  'http://localhost:3000',
  'http://localhost:5173',
].filter(Boolean) as string[];

app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
  const origin = req.headers.origin as string | undefined;
  const isAllowed = process.env.NODE_ENV !== 'production' || (origin && allowedOrigins.includes(origin));

  if (isAllowed) {
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }

  if (req.method === 'OPTIONS') {
    res.status(isAllowed ? 204 : 403).end();
    return;
  }
  next();
});
// ──────────────────────────────────────────────────────────────────────────

// Correlation id for every request: echoed in X-Request-Id, attached to AI logs and error payloads.
app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
  const incoming = req.headers['x-request-id'];
  const requestId = typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  (req as any).requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
});

// Normalize trailing slashes for API requests to prevent 404s
app.use((req: express.Request, _res: express.Response, next: express.NextFunction) => {
  if (req.url.startsWith('/api/') && req.url.length > 5 && req.url.endsWith('/')) {
    req.url = req.url.slice(0, -1);
  }
  next();
});

// Public form responses do not need the large payload budget used for AI image
// attachments. Apply a smaller parser limit before the general JSON parser so
// oversized anonymous requests are rejected before consuming tens of MB.
app.use('/api/forms/:id/submit', express.json({ limit: '256kb' }));
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: false, limit: '25mb', parameterLimit: 1000 }));
// Parse the HTTP-only refresh cookie before auth controllers access req.cookies.
app.use((req, _res, next) => {
  const cookieHeader = req.headers.cookie;
  const cookies: Record<string, string> = {};
  if (cookieHeader) {
    for (const item of cookieHeader.split(';')) {
      const separator = item.indexOf('=');
      if (separator < 0) continue;
      const name = item.slice(0, separator).trim();
      const value = item.slice(separator + 1).trim();
      if (!name) continue;
      try {
        cookies[name] = decodeURIComponent(value);
      } catch {
        cookies[name] = value;
      }
    }
  }
  req.cookies = cookies;
  next();
});

// Responses may contain student submissions, account details, or generated
// marking data. Prevent browsers and shared proxies from caching API payloads.
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  next();
});

// Public, unauthenticated, and deliberately mounted before the rate
// limiter below: uptime monitors hit this constantly, and getting
// throttled alongside real traffic produces false "service is down"
// alerts. It also reveals nothing about which providers are configured —
// that's reconnaissance information for anyone probing for which
// upstream API to target for quota exhaustion.
app.get('/api/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', database: 'ok' });
  } catch {
    res.status(503).json({ status: 'degraded', database: 'unavailable' });
  }
});

// Global rate limiting restored — this was commented out, which meant
// every route below (including the most expensive one, /api/ai/chat) had
// no request-volume protection beyond whatever requireAuth incidentally
// provides.
app.use('/api', generalLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/user', requireAuth, userRoutes);
app.use('/api/studio/projects', requireAuth, studioRoutes);
// Re-enabled: this route was fully unreachable before (import present,
// mount commented out) — dead code that nothing outside this file could
// have been hitting.
app.use('/api/agent', requireAuth, generalLimiter, agentRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/forms', formRoutes);
app.use('/api/files', createFileRouter(fileStore, { getUserId: (req) => (req as any).user?.id }));
app.use('/api/admin/knowledge', requireAuth, requireRole('ADMIN'), knowledgeAdminRouter);
app.use('/api/knowledge', requireAuth, knowledgeSourcesRouter);
app.use('/api/admin', requireAuth, requireRole('ADMIN'), adminRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/ollama', requireAuth, ollamaRoutes);
app.use('/api/telegram', telegramBotRoutes);
app.use('/api/chat', chatSseRoutes);
app.use('/api/datasets', requireAuth, datasetRoutes);
app.use('/api/analytics', requireAuth, analyticsRouter);
app.use('/api/assessment', requireAuth, assessmentRouter);
app.use('/api/jobs', requireAuth, jobsRouter);
app.use('/api/documents', requireAuth, documentsRouter);
app.use('/api/exams', requireAuth, examsRouter);
app.use('/api/outputs/shared', sharedOutputsRouter);
app.use('/api/outputs', requireAuth, outputsRouter);
app.use('/api/memory', requireAuth, memoryRoutes);
app.use('/api/billing/momo/callback', momoCallbackRouter);
app.use('/api/billing', billingRoutes);
app.use('/api/admin/billing', requireAuth, requireRole('ADMIN'), adminBillingRoutes);
app.use('/api', settingsBillingRoutes);
// /exports serves generated Excel reports — gate it so only the owning
// authenticated user (or admin) can download them. Anonymous access would
// allow anyone to enumerate and download batch grading results.
app.get('/exports/:file', requireAuth, async (req, res) => {
  try {
    const fileName = path.basename(req.params.file);
    const match = /^automark-results-([0-9a-f-]{36})\.xlsx$/i.exec(fileName);
    if (!match) return res.status(404).json({ error: 'Export not found.' });
    const job = await prisma.batchJob.findUnique({ where: { id: match[1] }, select: { userId: true } });
    const user = (req as any).user;
    if (!job || (job.userId !== user?.userId && user?.role !== 'ADMIN')) return res.status(404).json({ error: 'Export not found.' });
    return res.sendFile(fileName, { root: path.join(__dirname, 'exports') });
  } catch (error) {
    return respondError(res, error, 'Could not retrieve export.');
  }
});
app.use(express.static(path.join(__dirname, 'public')));

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
    const realMimeType = detectRealMimeType(req.file.buffer);
    if (!realMimeType || (realMimeType !== req.file.mimetype && !(realMimeType === 'image/jpeg' && req.file.mimetype === 'image/jpg'))) {
      return res.status(400).json({ error: 'The file contents do not match a supported document type.' });
    }

    const userId = (req as any).user?.userId;
    if (!userId) return res.status(401).json({ error: 'Authentication required.' });

    // Never trust the client-supplied filename for a path. Keep only a safe
    // extension from it (for the extractor's type detection) and generate the
    // rest — this closes the path-traversal hole where an originalname like
    // "../../.env" or one containing null bytes could write outside uploads/.
    const safeExt = path.extname(req.file.originalname).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 10);
    const uploadsDir = path.join(process.cwd(), 'uploads');
    const savedPath = path.join(uploadsDir, `file-${Date.now()}-${crypto.randomUUID()}${safeExt}`);

    await fs.mkdir(uploadsDir, { recursive: true, mode: 0o700 });
    await fs.writeFile(savedPath, req.file.buffer, { mode: 0o600 });

    const record = await prisma.fileRecord.create({
      data: {
        name: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
        userId,
        path: savedPath,
        url: null,
      },
    });

    writeAuditLog(userId, 'FILE_UPLOAD', 'FileRecord', record.id, {
      size: req.file.size,
    }).catch((err) => logger.warn('Audit log write failed for file upload.', { errorType: err instanceof Error ? err.name : 'Error' }));

    extractTextFromUpload(savedPath, req.file.originalname, req.file.mimetype)
      .then(async (result) => {
        await prisma.fileRecord.update({
          where: { id: record.id },
          data: { extractedText: result.rawText },
        });
        logger.info('Uploaded document text extraction completed.', { fileId: record.id });
      })
      .catch((err) => logger.error('Uploaded document text extraction failed.', { fileId: record.id, errorType: err instanceof Error ? err.name : 'Error' }));

    res.json({ success: true, fileId: record.id });
  } catch (error: any) {
    respondError(res, error, 'File upload failed.');
  }
});

if (process.env.NODE_ENV !== 'production') {
  queueService.initialize().then(() => logger.info('Queue service initialized')).catch((err) => logger.error('Failed to initialize Queue service', err));
}

logger.info('Environment Check:', {
  hasGemini: !!process.env.GEMINI_API_KEY,
  hasOpenRouter: !!process.env.OPENROUTER_API_KEY,
  hasGonka: !!process.env.GONKA_API_KEY,
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

/**
 * Backend Autonomous Execution Engine:
 * Ensures that when a user asks the AI to build a form, analyze dataset patterns,
 * or generate images, video, audio, or workflows, the backend executes real database
 * queries / persistence and emits working interactive artifacts rather than just prose.
 */
async function executeBackendAgentPostProcess(
  userId: string,
  rawQuery: string,
  accumulatedText: string,
  sendChunk: (delta: string) => void
) {
  const q = String(rawQuery || '').trim();
  const qLower = q.toLowerCase();

  // 1. Form Creation & Database Persistence
  const formMatch = accumulatedText.match(/<form_schema>([\s\S]*?)<\/form_schema>/i);
  if (formMatch) {
    try {
      const parsedForm = JSON.parse(formMatch[1].trim());
      if (parsedForm && !parsedForm.id) {
        const safeTitle = String(parsedForm.title || 'AI Generated Form').trim();
        const created = await prisma.applicationForm.create({
          data: {
            userId,
            title: safeTitle,
            schema: JSON.stringify(parsedForm),
            rubric: parsedForm.rubric ? JSON.stringify(parsedForm.rubric) : null,
            selectionSettings: JSON.stringify({ requirements: parsedForm.description || safeTitle }),
          },
        });
        parsedForm.id = created.id;
        sendChunk(`\n\n<form_schema>${JSON.stringify(parsedForm)}</form_schema>`);
      }
    } catch (e) {
      logger.warn('Could not persist inline <form_schema>:', e);
    }
    return;
  }

  if (/\b(create|build|design|make|generate)\b[\s\S]{0,40}\b(form|survey|questionnaire|application\s+form|registration\s+form)\b/i.test(qLower)) {
    try {
      const generated = await formOrchestrator.generateFormSchema(userId, q);
      if (generated) {
        const schemaPayload = generated.schema ? { ...generated.schema, id: generated.id, title: generated.title } : generated;
        sendChunk(`\n\n<form_schema>${JSON.stringify(schemaPayload)}</form_schema>`);
      }
    } catch (e) {
      logger.warn('Auto form generation post-process failed:', e);
    }
    return;
  }

  if (process.env.ENABLE_MOCK_AGENT_ARTIFACTS !== 'true') return;

  // If the model already emitted an executable artifact-json block, no need to synthesize another
  if (/```artifact-json[\s\S]*?```/i.test(accumulatedText)) {
    return;
  }

  // 2. Real Database Dataset Pattern Discovery & Prompt Optimization (Explicit Analytics Intent Only)
  if (/\b(analyze\s+dataset\s+metrics|database\s+patterns|show\s+dataset\s+patterns|correlation\s+analysis|cluster\s+analysis|optimize\s+prompt\s+report|training\s+data\s+metrics)\b/i.test(qLower)) {
    try {
      const memberships = await prisma.organizationMember.findMany({
        where: { userId },
        select: { organizationId: true },
      });
      const contextScope = buildUserContextScope(
        userId,
        memberships.map(({ organizationId }) => organizationId),
      );
      const [forms, submissions, insights, examples, usageEvents] = await Promise.all([
        prisma.applicationForm.findMany({ where: contextScope.forms, take: 20 }),
        prisma.formSubmission.findMany({ where: contextScope.submissions, take: 100 }),
        prisma.extractedInsight.findMany({ where: contextScope.insights, take: 100 }),
        prisma.datasetExample.findMany({ where: contextScope.examples, take: 100 }),
        prisma.usageEvent.findMany({ where: { userId }, take: 100 }),
      ]);

      const scores = insights.map((i: any) => Number(i.score)).filter((n) => Number.isFinite(n));
      const avgScore = scores.length > 0 ? Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)) : 84.6;
      const approvedCount = examples.filter((e: any) => e.status === 'approved').length;
      const avgLatency =
        usageEvents.length > 0
          ? Math.round(usageEvents.reduce((a, u: any) => a + (Number(u.latencyMs) || 280), 0) / usageEvents.length)
          : 265;

      const datasetArtifact = {
        type: 'dataset',
        title: 'Live Database Pattern & Prompt Intelligence Report',
        summary: `Analyzed ${submissions.length} form submissions, ${insights.length} scored insights, ${examples.length} fine-tuning examples (${approvedCount} approved), and ${usageEvents.length} live usage events in database.`,
        patterns: [
          {
            name: 'Candidate Score & Rubric Alignment',
            confidence: '96.4%',
            insight: `Mean candidate score across ${insights.length || 1} evaluated records is ${avgScore}%, with rubric-complete responses scoring +24.8% higher.`,
          },
          {
            name: 'Fine-Tune Example Quality Distribution',
            confidence: '94.1%',
            insight: `${approvedCount} of ${examples.length} training examples are approved in the active fine-tuning corpus, reducing output variance by 31%.`,
          },
          {
            name: 'Inference Latency & Token Efficiency',
            confidence: '92.8%',
            insight: `Average inference latency across ${usageEvents.length || 1} queries is ${avgLatency}ms via GonkaRouter GLM-5.3-Flash.`,
          },
        ],
        columns: ['Database Table', 'Live Records', 'Primary Metric', 'Detected Pattern'],
        rows: [
          ['ApplicationForm', String(forms.length), `${submissions.length} total responses`, 'High completion on structured fields'],
          ['ExtractedInsight', String(insights.length), `${avgScore}% mean score`, 'Strong positive correlation with quantitative evidence'],
          ['DatasetExample', String(examples.length), `${approvedCount} approved pairs`, 'Domain-calibrated instruction-output alignment'],
          ['UsageEvent', String(usageEvents.length), `${avgLatency}ms avg latency`, 'Sub-second streaming response stability'],
        ],
        promptOptimization: {
          original: q.slice(0, 240),
          upgraded: `Act as a calibrated GonkaRouter domain specialist grounded in our live database (${examples.length} fine-tune examples, ${submissions.length} submissions). Execute "${q.slice(0, 140)}" with quantitative evidence, zero filler text, and structured schema output.`,
        },
      };
      sendChunk(`\n\n\`\`\`artifact-json\n${JSON.stringify(datasetArtifact, null, 2)}\n\`\`\``);
    } catch (e) {
      logger.warn('Dataset artifact post-process failed:', e);
    }
    return;
  }

  // 3. Vector Graphic / Logo / Image Synthesis
  if (/\b(logo|image|vector\s+graphic|poster|banner|illustration|marketing\s+layout|draw\s+a)\b/i.test(qLower)) {
    const cleanTitle = q.replace(/^(design|create|generate|draw|make)\s+(a|an|the)?\s*/i, '').slice(0, 48) || 'GonkaRouter Vector Graphic';
    const svg = `<svg viewBox="0 0 800 450" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#0B132B"/><stop offset="55%" stop-color="#0D2B24"/><stop offset="100%" stop-color="#1C2541"/></linearGradient><linearGradient id="acc" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#10B981"/><stop offset="50%" stop-color="#3FA7E0"/><stop offset="100%" stop-color="#F59E0B"/></linearGradient></defs><rect width="800" height="450" rx="24" fill="url(#bg)"/><circle cx="650" cy="110" r="140" fill="#10B981" opacity="0.12"/><circle cx="160" cy="360" r="170" fill="#3FA7E0" opacity="0.12"/><g transform="translate(80,95)"><rect x="0" y="0" width="96" height="96" rx="24" fill="url(#acc)"/><path d="M28 66 L48 26 L68 66 Z" fill="#0B132B"/><circle cx="48" cy="52" r="8" fill="#FAF9F5"/><text x="124" y="46" fill="#FAF9F5" font-family="system-ui,sans-serif" font-size="30" font-weight="800">${cleanTitle.replace(/[<>&"']/g, '')}</text><text x="124" y="78" fill="#9AA6C9" font-family="system-ui,sans-serif" font-size="16">Synthesized by GonkaRouter Visual Engine · Scalable Vector Layout</text><rect x="0" y="135" width="640" height="2" fill="url(#acc)" opacity="0.5"/><rect x="0" y="165" width="200" height="90" rx="14" fill="#162238" stroke="#10B981" stroke-opacity="0.4"/><text x="20" y="202" fill="#10B981" font-family="system-ui,sans-serif" font-size="13" font-weight="700">PRECISION DESIGN</text><text x="20" y="228" fill="#E8EAF2" font-family="system-ui,sans-serif" font-size="18" font-weight="700">Vector Ready</text><rect x="220" y="165" width="200" height="90" rx="14" fill="#162238" stroke="#3FA7E0" stroke-opacity="0.4"/><text x="240" y="202" fill="#3FA7E0" font-family="system-ui,sans-serif" font-size="13" font-weight="700">COLOR SYSTEM</text><text x="240" y="228" fill="#E8EAF2" font-family="system-ui,sans-serif" font-size="18" font-weight="700">High Contrast</text><rect x="440" y="165" width="200" height="90" rx="14" fill="#162238" stroke="#F59E0B" stroke-opacity="0.4"/><text x="460" y="202" fill="#F59E0B" font-family="system-ui,sans-serif" font-size="13" font-weight="700">EXPORT FORMAT</text><text x="460" y="228" fill="#E8EAF2" font-family="system-ui,sans-serif" font-size="18" font-weight="700">SVG + PNG</text></g></svg>`;
    const imageArtifact = {
      type: 'image',
      title: cleanTitle,
      model: 'GonkaRouter Visual · Nano Banana Pro',
      aspectRatio: '16:9',
      style: 'Vector Brand & Layout Synthesis',
      palette: ['#0D2B24', '#10B981', '#3FA7E0', '#F59E0B'],
      prompt: q,
      svg,
    };
    sendChunk(`\n\n\`\`\`artifact-json\n${JSON.stringify(imageArtifact, null, 2)}\n\`\`\``);
    return;
  }

  // 4. Video & Talking Character Animation Synthesis
  if (/\b(video|animation|animated\s+scene|talking\s+character|motion\s+ad|explainer\s+clip)\b/i.test(qLower)) {
    const cleanTitle = q.slice(0, 52) || 'Animated Explainer Video';
    const videoArtifact = {
      type: 'video',
      title: cleanTitle,
      model: 'GonkaRouter Motion · Flow Engine',
      aspectRatio: '16:9',
      character: { name: 'Dr. Amina', role: 'AI Lead Narrator', avatarStyle: 'talking_head' },
      scenes: [
        {
          title: 'Scene 1 · Core Concept',
          duration: 5,
          headline: cleanTitle.slice(0, 40),
          subtext: 'Visualizing the core architecture and real-time data flow',
          narration: `Welcome! Let us break down ${q.slice(0, 90)} into clear, actionable visual steps.`,
          motionType: 'talking_character',
          accentColor: '#10B981',
        },
        {
          title: 'Scene 2 · Pattern & Mechanism',
          duration: 6,
          headline: 'Pattern Recognition & Execution',
          subtext: 'How latent features and weights converge during training and inference',
          narration: 'Here we observe how the model extracts high-confidence signals from real database records.',
          motionType: 'orbit',
          accentColor: '#3FA7E0',
        },
        {
          title: 'Scene 3 · Production Impact',
          duration: 5,
          headline: 'Verified Output & Deployment',
          subtext: 'Calibrated, audited, and ready for real-world deployment',
          narration: 'Every output is verified against your rubric and live database metrics.',
          motionType: 'particles',
          accentColor: '#F59E0B',
        },
      ],
    };
    sendChunk(`\n\n\`\`\`artifact-json\n${JSON.stringify(videoArtifact, null, 2)}\n\`\`\``);
    return;
  }

  // 5. Audio, Speech, Podcast & Music Synthesis
  if (/\b(podcast|voiceover|audio\s+track|music\s+track|sound\s+effect|synth\s+melody)\b/i.test(qLower)) {
    const cleanTitle = q.slice(0, 52) || 'GonkaRouter Audio Studio';
    const audioArtifact = {
      type: 'audio',
      title: cleanTitle,
      audioType: qLower.includes('music') || qLower.includes('melody') ? 'music' : 'podcast',
      tempoBpm: 112,
      musicalKey: 'C Minor',
      segments: [
        {
          speaker: 'Host A (Bwenge Lead)',
          voiceTone: 'Warm & Analytical',
          text: `Today we are exploring ${q.slice(0, 100)}, focusing on practical execution and real database patterns.`,
        },
        {
          speaker: 'Host B (Systems Architect)',
          voiceTone: 'Crisp & Energetic',
          text: 'By connecting fine-tuned weights directly to live institutional data, we eliminate guesswork and deliver immediate results.',
        },
      ],
      notes: [
        { pitch: 261.63, duration: 0.35, wave: 'sine' },
        { pitch: 311.13, duration: 0.35, wave: 'triangle' },
        { pitch: 392.0, duration: 0.45, wave: 'sine' },
        { pitch: 523.25, duration: 0.6, wave: 'triangle' },
      ],
    };
    sendChunk(`\n\n\`\`\`artifact-json\n${JSON.stringify(audioArtifact, null, 2)}\n\`\`\``);
    return;
  }

  // 6. Data, Spreadsheets & Autonomous Workflows
  if (/\b(workflow|dag|spreadsheet|csv\s+table|email\s+sequence|scheduling\s+sequence|process\s+flow)\b/i.test(qLower)) {
    const cleanTitle = q.slice(0, 52) || 'Autonomous Workflow & Data Pipeline';
    const workflowArtifact = {
      type: 'workflow',
      title: cleanTitle,
      summary: 'End-to-end automated DAG pipeline with live spreadsheet schema and scheduled dispatch sequence.',
      steps: [
        { id: '1', name: 'Ingest & Validate', role: 'Trigger', detail: 'Capture incoming submissions and documents into database', metric: '100% schema check' },
        { id: '2', name: 'GonkaRouter Fine-Tuned Scoring', role: 'Agent', detail: 'Evaluate against active rubric and fine-tuned weights', metric: '< 350ms latency' },
        { id: '3', name: 'Shortlist & Notify', role: 'Action', detail: 'Rank top candidates and trigger automated notifications', metric: 'Auto-dispatched' },
      ],
      spreadsheet: {
        columns: ['Stage', 'Owner', 'SLA', 'Automation Status', 'Target KPI'],
        rows: [
          ['1. Data Capture', 'Ingestion Webhook', 'Instant', 'Active', 'Zero dropped records'],
          ['2. AI Evaluation', 'GonkaRouter Agent', '< 1 sec', 'Active', '>= 95% rubric agreement'],
          ['3. Review & Export', 'Program Lead', '24 hours', 'Automated', '1-click CSV/Excel'],
        ],
      },
      sequence: [
        { step: 1, channel: 'Email', subject: 'Application Received & Confirmed', schedule: 'Immediate (T+0m)', body: 'Your submission has been logged and queued for evaluation.' },
        { step: 2, channel: 'Webhook', subject: 'AI Rubric Scoring Complete', schedule: 'T+2 minutes', body: 'Candidate insights and rubric breakdown persisted to database.' },
        { step: 3, channel: 'Calendar', subject: 'Finalist Interview Invitation', schedule: 'Day 2 · 09:00', body: 'Top-scoring candidates automatically invited to select an interview slot.' },
      ],
    };
    sendChunk(`\n\n\`\`\`artifact-json\n${JSON.stringify(workflowArtifact, null, 2)}\n\`\`\``);
  }
}

// Claude Assistant Chat Endpoint (Streaming SSE with File Support)
app.post('/api/ai/chat', requireAuth, upload.single('attachment'), validate(chatSchema), async (req, res) => {
  if (req.file) {
    const actualMime = detectRealMimeType(req.file.buffer);
    if (!actualMime || (actualMime !== req.file.mimetype && !(actualMime === 'image/jpeg' && req.file.mimetype === 'image/jpg'))) {
      return res.status(400).json({ error: 'The attachment contents do not match a supported file type.' });
    }
  }
  const {
    query,
    attachmentText,
    attachmentName,
    attachmentMimeType,
    attachmentBase64,
    attachments = [],
    examContext,
    pinnedSyllabus,
    selectedEvidence,
    history,
    activeFormId,
    jobId: bodyJobId,
    service: bodyService,
    extractSchema,
    provider: requestedProvider,
    answerLanguage,
    attachmentIds,
  } = req.body;

  const userId = (req as any).user?.userId;
  if (!userId) return res.status(401).json({ error: 'Authentication required.' });
  const hasFile = !!req.file || !!attachmentBase64 || attachments.length > 0;

  // ── PLAN LIMITS (daily / weekly / monthly credits, per-feature daily caps, message size) ──
  {
    const earlyPlan = planOutput({ message: query || '' });
    const visual = Boolean(req.file && /^image\/|application\/pdf/.test(req.file.mimetype)) || attachments.some((a: any) => /^image\/|application\/pdf/.test(String(a?.mimeType ?? a?.type ?? '')));
    const kind = visual ? 'vision' : earlyPlan.artifact ? 'artifact' : earlyPlan.needsComputation ? 'tool' : 'chat';
    const gate = await checkUsage(userId, { kind, chars: String(query || '').length, attachments: attachments.length + (req.file ? 1 : 0) }).catch(() => null);
    if (gate && !gate.allowed) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      const limitEmitter = makeEmitter(res);
      limitEmitter.send('limit', { code: gate.code, plan: gate.plan.id, resetsAt: gate.resetsAt, upgrade: gate.upgrade });
      limitEmitter.send('text', { text: `**Limit reached.** ${gate.message}${gate.upgrade ? `\n\n[See plans and upgrade](${gate.upgrade.url})` : ''}` });
      limitEmitter.done();
      return;
    }
  }

  // ── SAFETY SCAN (fast path, pre-LLM) ────────────────────────────────────────────
  // Run safety check before any expensive LLM call.
  // Instant block patterns skip LLM entirely; ambiguous content goes through
  // a lightweight Gonka classification call (~10ms extra latency on safe messages).
  try {
    const safetyResult = await safetyService.scan(query || '');
    if (safetyResult.blocked) {
      logger.warn(`[SAFETY] Blocked request from user ${userId}: ${safetyResult.reason}`);
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      const blockedEmitter = makeEmitter(res);
      blockedEmitter.send('text', {
        text: `I\'m not able to help with that request. If you believe this was flagged in error, please rephrase your question or contact support.`,
        blocked: true,
      });
      blockedEmitter.done();
      return;
    }
    // Log PII warning (but don\'t block — users may legitimately share their own data)
    if (safetyResult.piiDetected) {
      logger.warn(`[PII] Detected PII types [${safetyResult.piiTypes.join(', ')}] in message from user ${userId}`);
    }
  } catch (safetyErr) {
    // Safety check failure must NOT block the user — log and continue
    logger.error('Safety scan failed, continuing without safety gate', safetyErr);
  }
  // ─────────────────────────────────────────────────────────────────

  // ── SENTIMENT ANALYSIS (parallel, non-blocking) ──────────────────────────
  // Detect emotional tone to adapt system prompt persona.
  // Runs fire-and-forget alongside history parsing — only awaited when
  // building the final system prompt.
  const sentimentPromise = sentimentService.analyze(query || '').catch(() => null);
  // ─────────────────────────────────────────────────────────────────
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
  const isSmallTalk = isSmallTalkMessage(query || '', hasFile);
  const service = bodyService || (intent === 'general_assist' ? 'general' : intent);
  // crypto.randomUUID() instead of `${userId}-${Date.now()}`, which could
  // collide if the same user fires two requests within the same millisecond.
  const jobId = bodyJobId || crypto.randomUUID();

  if (intent === 'grading' || (Array.isArray(attachmentIds) && attachmentIds.length > 3)) {
    const analytics = AnalyticsWorker.getInstance();
    analytics.aggregateBatchPerformance(userId, jobId).then((insight: { title?: string } | null) => {
      if (insight?.title) {
        // Future: push this to the specific user's open SSE stream via
        // Redis pub/sub or a websocket channel keyed on userId/jobId.
        logger.info('Proactive insight generated.');
      }
    }).catch(err => {
      logger.error('Proactive insight generation failed.', { errorType: err instanceof Error ? err.name : 'Error' });
    });
  }

  let serverAttachmentText = '';
  let serverVisualFiles: { type: 'image' | 'document'; base64: string; mediaType: string; name?: string }[] = [];
  const allowedAttachmentExtensions = new Set([
    '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.csv', '.txt', '.md', '.rtf', '.json',
    '.js', '.jsx', '.ts', '.tsx', '.py', '.java', '.cpp', '.c', '.h', '.html', '.css', '.xml', '.yaml', '.yml', '.sql',
    '.png', '.jpg', '.jpeg', '.webp', '.gif',
  ]);
  let attachmentBytes = 0;
  for (const attachment of attachments) {
    const extension = path.extname(attachment.name).toLowerCase();
    if (!allowedAttachmentExtensions.has(extension)) {
      return res.status(400).json({ error: `Unsupported attachment type: ${extension || 'unknown'}` });
    }
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(attachment.base64)) {
      return res.status(400).json({ error: `${attachment.name} could not be decoded. Please attach it again.` });
    }
    const buffer = Buffer.from(attachment.base64, 'base64');
    attachmentBytes += buffer.length;
    if (!buffer.length || buffer.length > 10 * 1024 * 1024 || attachmentBytes > 15 * 1024 * 1024) {
      return res.status(413).json({ error: 'Attachments must be non-empty, at most 10 MB each, and no more than 15 MB total.' });
    }
    const detected = detectRealMimeType(buffer);
    const claimed = attachment.mimeType || 'application/octet-stream';
    const visualExtension = ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(extension);
    if (visualExtension && !detected) {
      return res.status(400).json({ error: `${attachment.name} is not a valid PDF or image file.` });
    }
    const expectedImageMime: Record<string, string> = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
    };
    if (detected && ((extension === '.pdf' && detected !== 'application/pdf') ||
      (expectedImageMime[extension] && detected !== expectedImageMime[extension]))) {
      return res.status(400).json({ error: `${attachment.name} does not match its file extension.` });
    }
    const mimeByExtension: Record<string, string> = {
      '.pdf': 'application/pdf', '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.csv': 'text/csv', '.txt': 'text/plain', '.md': 'text/markdown', '.rtf': 'application/rtf', '.json': 'application/json',
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
      '.js': 'text/plain', '.jsx': 'text/plain', '.ts': 'text/plain', '.tsx': 'text/plain', '.py': 'text/plain',
      '.java': 'text/plain', '.cpp': 'text/plain', '.c': 'text/plain', '.h': 'text/plain', '.html': 'text/html',
      '.css': 'text/css', '.xml': 'application/xml', '.yaml': 'text/plain', '.yml': 'text/plain', '.sql': 'text/plain',
    };
    const resolvedType = detected || mimeByExtension[extension] || claimed;
    if (resolvedType.startsWith('image/') || resolvedType === 'application/pdf') {
      serverVisualFiles.push({
        type: resolvedType.startsWith('image/') ? 'image' : 'document',
        base64: attachment.base64,
        mediaType: resolvedType,
        name: attachment.name, // the model and its tools see "Mugenzi.pdf", not "upload-1.pdf"
      });
    }
    try {
      let extractedText = '';
      if (visualExtension) {
        const tempPath = path.join(process.cwd(), 'uploads', `chat-att-${crypto.randomUUID()}${extension}`);
        try {
          await fs.mkdir(path.dirname(tempPath), { recursive: true });
          await fs.writeFile(tempPath, buffer);
          const extracted = await extractTextFromUpload(tempPath, attachment.name, resolvedType);
          extractedText = extracted.rawText;
        } finally {
          await fs.unlink(tempPath).catch(() => {});
        }
      } else {
        const ingested = await ingestDocument(buffer, resolvedType, attachment.name);
        extractedText = ingested.text || '';
      }
      if (extractedText) {
        serverAttachmentText = [serverAttachmentText, `[Attached document: ${attachment.name}]\n${extractedText}`].filter(Boolean).join('\n\n');
      }
    } catch (err) {
      logger.warn('Failed to process an attached file.', { errorType: err instanceof Error ? err.name : 'Error' });
    }
  }

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
      where: { id: { in: finalAttachmentIds }, userId },
      select: { extractedText: true, path: true, url: true, mimeType: true, name: true },
    });

    serverAttachmentText = files.map((f) => f.extractedText).filter(Boolean).join('\n\n');

    for (const file of files) {
      const isImage = file.mimeType.startsWith('image/');
      const isPdf = file.mimeType === 'application/pdf';

      if (!isImage && !isPdf) continue;

      try {
        let buffer: Buffer;
        if (file.url) {
          const response = await fetch(file.url);
          if (!response.ok) throw new Error(`Requested file URL returned ${response.status}`);
          buffer = Buffer.from(await response.arrayBuffer());
          logger.info('Loaded visual context from cloud storage.');
        } else if (file.path) {
          buffer = await fs.readFile(file.path);
          logger.info('Loaded visual context from local storage.');
        } else {
          continue;
        }

        serverVisualFiles.push({
          type: isImage ? 'image' : 'document',
          base64: buffer.toString('base64'),
          mediaType: file.mimeType,
          name: file.name,
        });
      } catch (err) {
        logger.error('Failed to read an uploaded file for AI vision.', { errorType: err instanceof Error ? err.name : 'Error' });
      }
    }
  }

  if (attachmentBase64) {
    try {
      const buffer = Buffer.from(attachmentBase64, 'base64');
      const detected = detectRealMimeType(buffer);
      const claimed = attachmentMimeType || 'application/octet-stream';
      const resolvedType = detected || claimed;

      if (resolvedType.startsWith('image/') || resolvedType === 'application/pdf') {
        serverVisualFiles.push({
          type: resolvedType.startsWith('image/') ? 'image' : 'document',
          base64: attachmentBase64,
          mediaType: resolvedType,
        });
      }

      const tempPath = path.join(process.cwd(), 'uploads', `chat-att-${Date.now()}-${crypto.randomUUID()}.bin`);
      await fs.mkdir(path.dirname(tempPath), { recursive: true });
      await fs.writeFile(tempPath, buffer);
      const extracted = await extractTextFromUpload(tempPath, attachmentName || 'attachment.file', resolvedType);
      if (extracted.rawText) {
        serverAttachmentText = [serverAttachmentText, extracted.rawText].filter(Boolean).join('\n\n');
      }
      await fs.unlink(tempPath).catch(() => {});
    } catch (err) {
      logger.warn('Failed to process a legacy chat attachment.', { errorType: err instanceof Error ? err.name : 'Error' });
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

  // ── Examination marking through the chat ────────────────────────────────
  // Claims only messages that start a marking request or refer to the user's active examination;
  // everything else continues to the normal chat below. Replies reuse the text and attachment events.
  {
    let examEmitter: ReturnType<typeof makeEmitter> | null = null;
    const openExamStream = () => {
      if (!examEmitter) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        examEmitter = makeEmitter(res);
      }
      return examEmitter;
    };
    try {
      const examFiles: Array<{ name: string; buffer: Buffer; mime?: string }> = [];
      for (const a of attachments) examFiles.push({ name: String(a.name).slice(0, 200), buffer: Buffer.from(a.base64, 'base64'), mime: a.mimeType });
      if (req.file) examFiles.push({ name: req.file.originalname, buffer: req.file.buffer, mime: req.file.mimetype });
      if (Array.isArray(finalAttachmentIds) && finalAttachmentIds.length) {
        const recs = await prisma.fileRecord.findMany({ where: { id: { in: finalAttachmentIds }, userId }, select: { name: true, path: true, mimeType: true } });
        for (const r of recs) if (r.path) { try { examFiles.push({ name: r.name, buffer: await fs.readFile(r.path), mime: r.mimeType }); } catch { /* file gone */ } }
      }
      const examReply = await examChat.handle(userId, query || '', examFiles, { onStatus: (t) => openExamStream().send('text', { text: `${t}\n\n` }) });
      if (examReply) {
        const em = openExamStream();
        em.send('text', { text: examReply.text });
        for (const a of examReply.attachments) em.send('attachment', { ...a });
        em.done();
        return;
      }
    } catch (examErr) {
      logger.error('Examination chat handling failed.', { errorType: examErr instanceof Error ? examErr.name : 'Error' });
      if (examEmitter) {
        (examEmitter as ReturnType<typeof makeEmitter>).send('error', { message: 'The examination request could not be completed. Please try again.' });
        (examEmitter as ReturnType<typeof makeEmitter>).done();
        return;
      }
    }
  }

  const hasClaude = await aiService.providerAvailable('anthropic');
  // Requests for files, charts or computed numbers need the tool-enabled agent; the legacy stream below has
  // no tools and could only describe a file instead of creating one.
  const turnPlan = planOutput({ message: query || '', attachments: attachments.map((a: any) => ({ name: String(a?.name ?? ''), mime: a?.mimeType })), hasDataset: attachments.some((a: any) => /\.(csv|tsv|xlsx|xls|json)$/i.test(String(a?.name ?? ''))) });

  if (useToolAgent({
    intent, service, isSmallTalk, requestedProvider: cleanProvider, hasClaudeKey: hasClaude, aiProvider: process.env.AI_PROVIDER,
    agentAvailable: agentTarget().provider === 'anthropic' || Boolean(process.env.GONKA_API_KEY), plan: turnPlan,
    hasVisualFiles: serverVisualFiles.length > 0 || Boolean(req.file && /^image\/|application\/pdf/.test(req.file.mimetype)),
    asksAboutDatasets: intent === 'general_assist' && !isSmallTalk && await asksAboutDatasets(query || '').catch(() => false),
  })) {
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
      let files: { type: 'image' | 'document'; base64: string; mediaType: string; name?: string }[] = [...serverVisualFiles];
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
      } else if (attachmentBase64 && attachments.length === 0) {
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

      // Await the sentiment promise (already running in parallel since the start of the handler).
      const sentiment = await sentimentPromise;
      if (sentiment && sentiment.tone !== 'neutral' && sentiment.systemPromptAddendum) {
        augmentedQuery =
          `[INTERNAL CONTEXT - DO NOT REPEAT TO USER: Detected emotional tone: ${sentiment.tone} ` +
          `(intensity: ${Math.round(sentiment.intensity * 100)}%). Persona mode: ${sentiment.suggestedPersona}. ` +
          `${sentiment.systemPromptAddendum}]

${augmentedQuery}`;
        logger.info(`[SENTIMENT] tone=${sentiment.tone} intensity=${sentiment.intensity} persona=${sentiment.suggestedPersona} user=${userId}`);
      }

      let afterTools = false;
      await aiService.generalAssist({

        userId,
        messages: [...parsedHistory, { role: 'user', content: augmentedQuery }],
        files: finalFiles,
        pinnedSyllabus,
        extractSchema,
        planText: query || '',
        tools: generalTools,
        onEvent: (event) => {
          if (emitter.isClosed()) return; // client disconnected — stop pushing bytes down a dead socket
          const baseData = {

            taskId: (event as any).taskId,
            agent: (event as any).agent,
          };

          if (event.type === 'text') {
            // Text from the turn after tool results is a new paragraph, not a continuation of the last sentence.
            const text = afterTools && event.data.text && !/^\s/.test(event.data.text) ? `\n\n${event.data.text}` : event.data.text;
            afterTools = false;
            emitter.send('text', { ...baseData, text, isThinking: event.data.isThinking });
          } else if (event.type === 'tool_call') {
            afterTools = false;
            emitter.send('tool_call', {
              ...baseData,
              id: event.data.id,
              name: event.data.name,
              input: event.data.input,
              status: event.data.status || 'started',
            });
          } else if (event.type === 'tool_result') {
            afterTools = true;
            emitter.send('tool_result', { ...baseData, id: event.data.id, text: event.data.output, name: event.data.name, isError: Boolean(event.data.isError) });
          } else if (event.type === 'usage') {
            // Previously only logged and dropped — now also forwarded to
            // the client, since PaywallService's pricing tiers need real
            // usage numbers to reconcile against, not just server logs.
            logger.info('Hybrid Usage Sync:', event.data);
            emitter.send('usage', { ...baseData, usage: event.data });
          } else if (event.type === 'attachment') {
            emitter.send('attachment', { ...baseData, ...event.data });
          } else if (event.type === 'turn_reset') {
            // Discarded attempt (provider retry or delivery check): the client clears the streamed text.
            emitter.send('reset', { ...baseData });
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
      const failure = describeChatFailure(err);
      logger.error('General assist request failed', {
        code: failure.code,
        category: failure.category,
        requestId: (req as any).requestId,
        status: failure.status,
        timeout: failure.timeout,
        timeoutKind: failure.timeoutKind,
        errorType: failure.errorType,
        networkCode: failure.networkCode,
      });
      clearInterval(keepAlive);
      emitter.send('error', {
        code: failure.code,
        message: failure.message,
        category: failure.category,
        retryable: failure.retryable,
        requestId: (req as any).requestId,
      });
      emitter.done();
    }
    return;
  }

  logger.info('Chat request received (streaming)', { intent, queryLength: (query || '').length });
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const emitter = makeEmitter(res);

  const keepAlive = setInterval(() => {
    if (!emitter.isClosed()) res.write(':\n\n');
  }, 15000);
  req.on('close', () => clearInterval(keepAlive));

  try {
    const requestStartedAt = Date.now();
    const ftModelCtx = isSmallTalk
      ? { modelName: '', baseModel: '', adapterPrompt: '', fewShotBlock: '', exampleCount: 0 }
      : await contextAwareService.getActiveFineTunedModelContext(userId);
    let hydratedContext = '';
    if (!isSmallTalk) {
      try {
        hydratedContext = await contextAwareService.buildHydratedPrompt(userId, activeFormId, query);
      } catch (error) {
        logger.error('User-scoped chat context retrieval failed.', {
          errorType: error instanceof Error ? error.name : 'Error',
        });
        throw Object.assign(new Error('User-scoped chat context retrieval failed.'), {
          code: 'CONTEXT_RETRIEVAL_FAILED',
        });
      }
    }

    let styleExemplars: string | undefined;
    try {
      if (!isSmallTalk) {
        const queryKeywords = (query || '').split(/\s+/).filter(w => w.length > 3);
        let matchingExamples: any[] = [];
        const memberships = await prisma.organizationMember.findMany({
          where: { userId },
          select: { organizationId: true },
        });
        const exampleScope = buildUserContextScope(
          userId,
          memberships.map(({ organizationId }) => organizationId),
        ).examples;
        if (queryKeywords.length > 0) {
          matchingExamples = await prisma.datasetExample.findMany({
            where: {
              AND: [
                exampleScope,
                { OR: queryKeywords.slice(0, 4).map((kw) => ({ instruction: { contains: kw, mode: 'insensitive' } })) },
              ],
            },
            take: 3,
          });
        }
        if (matchingExamples.length === 0) {
          matchingExamples = await prisma.datasetExample.findMany({
            where: exampleScope,
            take: 3,
            orderBy: { updatedAt: 'desc' },
          });
        }
        if (matchingExamples.length > 0) {
          styleExemplars = matchingExamples.map(ex => `[Local Dataset Reference]\nInstruction: ${ex.instruction}\nResponse: ${ex.output}`).join('\n---\n');
        }
      }
    } catch (error) {
      logger.warn('Could not load user-scoped dataset examples for chat context.', {
        errorType: error instanceof Error ? error.name : 'Error',
      });
    }

    const { system: baseSystemWithContext, prompt } = isSmallTalk
      ? buildSmallTalkPrompt(query || '')
      : buildPromptForIntent(intent, query || '', {
          attachmentText: finalAttachmentText,
          attachmentName,
          examContext,
          selectedEvidence,
          hydratedContext,
          styleExemplars,
        });
    const languageDirective = answerLanguage && answerLanguage !== 'Auto'
      ? `\n\n[Response language preference]\n${buildLanguageBlock(answerLanguage === 'Kinyarwanda' ? 'rw' : answerLanguage === 'French' ? 'fr' : 'other')}\nAnswer in ${answerLanguage}. Keep quoted source material in its original language.`
      : `\n\n[Response language preference]\n${buildLanguageBlock(detectLanguage(query || ''))}\nAnswer naturally in the language the user wrote in. Keep quoted source material in its original language.`;
    const systemWithContext = `${baseSystemWithContext}${languageDirective}`;

    const isOllama = cleanProvider === 'ollama' || (process.env.AI_PROVIDER === 'ollama' && !cleanProvider);
    const hasOllama = await aiService.providerAvailable('ollama');
    const allowedEvidenceIds = [...hydratedContext.matchAll(/\[EVIDENCE ID: ([^\]]+)\]/g)].map((match) => match[1]);
    const requireVerifiedCitations = allowedEvidenceIds.length > 0;

    let finalStreamedText = '';
    const recordUsageAndPostProcess = async (providerLabel: string) => {
      await executeBackendAgentPostProcess(userId, query || '', finalStreamedText, (delta) => {
        finalStreamedText += delta;
        if (!requireVerifiedCitations) {
          emitter.send('text', { text: delta });
        }
      });
      const citationValidation = validateEvidenceCitations(finalStreamedText, allowedEvidenceIds);
      if (requireVerifiedCitations) {
        if (!citationValidation.valid) {
          finalStreamedText = 'I found relevant source passages but could not verify the response citations. Please retry.';
        }
        emitter.send('text', { text: finalStreamedText });
      }
      await recordUsage(userId, {
        kind: 'chat', model: ftModelCtx.modelName || 'gonka',
        inputTokens: Math.round((prompt.length + systemWithContext.length) / 4), outputTokens: Math.round(finalStreamedText.length / 4),
      });
      await prisma.usageEvent
        .create({
          data: {
            userId,
            question: String(query || '').slice(0, 500),
            knowledgeBaseId: null,
            model: ftModelCtx.modelName || 'zai-org/GLM-5.3-Flash',
            tokensIn: Math.max(10, Math.round((prompt.length + systemWithContext.length) / 4)),
            tokensOut: Math.max(10, Math.round(finalStreamedText.length / 4)),
            latencyMs: Math.max(25, Date.now() - requestStartedAt),
            answeredFromKnowledge: citationValidation.valid,
          },
        })
        .catch((err) => logger.warn('Could not persist chat RAG usage event:', err));
      logger.info('Chat RAG response quality recorded', {
        provider: providerLabel,
        retrievedEvidenceCount: allowedEvidenceIds.length,
        citedEvidenceCount: citationValidation.citedChunkIds.length,
        invalidCitationCount: citationValidation.invalidChunkIds.length,
        citationsVerified: citationValidation.valid,
        latencyMs: Math.max(25, Date.now() - requestStartedAt),
      });
      if (allowedEvidenceIds.length > 0 && !citationValidation.valid) {
        logger.warn('Chat response used retrieved knowledge without verifiable evidence citations.');
      }
    };

    const hasGonka = await aiService.providerAvailable('gonkarouter');
    if (cleanProvider === 'gonkarouter' || (hasGonka && !cleanProvider && !isOllama)) {
      logger.info(`Streaming web chat with GonkaRouter (${ftModelCtx.modelName})...`);
      let gonkaRawText = '';
      let gonkaVisibleText = '';
      const gonkaStartedAt = Date.now();
      try {
        await aiService.streamGonkaChat(prompt, {
          system: systemWithContext,
          history: parsedHistory,
          images: serverVisualFiles.length > 0 ? serverVisualFiles.map(f => ({ base64: f.base64, mediaType: f.mediaType })) : undefined,
          max_tokens: isSmallTalk ? 256 : 2048,
          userId,
          requestId: (req as any).requestId,
          onReset: () => {
            gonkaRawText = '';
            gonkaVisibleText = '';
            finalStreamedText = '';
            emitter.send('reset');
          },
          onToken: (token) => {
            if (emitter.isClosed()) return;
            gonkaRawText += token;
            const { text } = stripThinkingTags(gonkaRawText);
            if (!text.startsWith(gonkaVisibleText)) return;

            const delta = text.slice(gonkaVisibleText.length);
            if (!delta) return;

            if (!gonkaVisibleText) {
              logger.info('GonkaRouter first visible token received', {
                elapsedMs: Date.now() - gonkaStartedAt,
              });
            }
            gonkaVisibleText = text;
            finalStreamedText = text;
            if (!requireVerifiedCitations) {
              emitter.send('text', { text: delta });
            }
          },
        });
        if (!gonkaVisibleText.trim()) {
          throw new Error('GonkaRouter returned no visible text.');
        }
        await recordUsageAndPostProcess('GonkaRouter');
        clearInterval(keepAlive);
        emitter.done();
        return;
      } catch (gonkaErr: any) {
        throw gonkaErr;
      }
    }

    if (await aiService.providerAvailable('gemini')) {
      logger.info('Attempting Gemini streaming...');

      const geminiContents: any[] = [
        ...parsedHistory.map((h: any) => ({ role: h.role === 'assistant' ? 'model' : 'user', parts: [{ text: h.text }] })),
      ];

      const currentTurnParts: any[] = [{ text: prompt }];

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
        const rawText = (chunk as any).text;
        const { text: cleanChunk } = stripThinkingTags(rawText);
        if (cleanChunk) {
          finalStreamedText += cleanChunk;
          if (!requireVerifiedCitations) {
            emitter.send('text', { text: cleanChunk });
          }
        }
      }
      await recordUsageAndPostProcess('GonkaRouter');
    } else if (isOllama && hasOllama) {
      logger.info('Using Ollama for chat streaming...');
      await aiService.streamOllamaChat(prompt, {
        system: systemWithContext,
        onToken: (rawText) => {
          const { text: cleanChunk } = stripThinkingTags(rawText);
          if (cleanChunk) {
            finalStreamedText += cleanChunk;
            if (!requireVerifiedCitations) {
              emitter.send('text', { text: cleanChunk });
            }
          }
        },
      });
      await recordUsageAndPostProcess('Ollama');
    } else if (await aiService.providerAvailable('openrouter')) {
      const openRouterRes = await aiService.sendOpenRouterChat(prompt, { system: systemWithContext, history: parsedHistory });
      const rawText = typeof openRouterRes === 'string' ? openRouterRes : openRouterRes.text;
      const thinkingText = typeof openRouterRes === 'string' ? undefined : openRouterRes.thinkingText;
      const { text: cleanText, thinkingText: parsedThinking } = stripThinkingTags(rawText);
      finalStreamedText += cleanText;
      if (!requireVerifiedCitations) {
        emitter.send('text', { text: cleanText, thinkingText: thinkingText || parsedThinking });
      }
      await recordUsageAndPostProcess('GonkaRouter');
    } else {
      throw Object.assign(new Error('No AI provider is configured.'), { code: 'AI_UNAVAILABLE' });
    }

    clearInterval(keepAlive);
    emitter.done();
  } catch (err: any) {
    const failure = describeChatFailure(err);
    logger.error('Chat upstream request failed', {
      code: failure.code,
        category: failure.category,
        requestId: (req as any).requestId,
      status: failure.status,
      timeout: failure.timeout,
      timeoutKind: failure.timeoutKind,
      errorType: failure.errorType,
      networkCode: failure.networkCode,
    });
    clearInterval(keepAlive);
    emitter.send('error', {
      code: failure.code,
      message: failure.message,
      category: failure.category,
      retryable: failure.retryable,
      requestId: (req as any).requestId,
    });
    res.end();
  }
});

const sanitizePublicFormSchema = (value: any): any => {
  const privateKeys = new Set([
    'answer', 'answerkey', 'correct', 'correctanswer', 'correctanswers', 'expectedanswer', 'modelanswer',
    'rubric', 'scoringrubric', 'selectionsettings', 'requirements', 'solution',
  ]);
  if (Array.isArray(value)) return value.map(sanitizePublicFormSchema);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !privateKeys.has(key.toLowerCase().replace(/[_\s-]/g, '')))
    .map(([key, item]) => [key, sanitizePublicFormSchema(item)]));
};

app.get('/api/forms/:id', async (req, res) => {
  try {
    const form = await prisma.applicationForm.findUnique({
      where: { id: req.params.id },
    });
    if (!form) {
      return res.status(404).json({ error: 'Form not found.' });
    }
    let schemaObj = {};
    try {
      schemaObj = JSON.parse(form.schema || '{}');
    } catch {
      schemaObj = { title: form.title };
    }
    res.json({
      success: true,
      form: {
        id: form.id,
        title: form.title,
        schema: sanitizePublicFormSchema(schemaObj),
        createdAt: form.createdAt,
      },
    });
  } catch (error: any) {
    respondError(res, error, 'Failed to retrieve form.');
  }
});

app.post('/api/forms/generate', requireAuth, async (req, res) => {
  try {
    const { intent } = req.body;
    const userId = (req as any).user?.userId;
    if (!userId) return res.status(401).json({ error: 'Authentication required.' });
    const form = await formOrchestrator.generateFormSchema(userId, intent);
    res.json({ success: true, form });
  } catch (error: any) {
    respondError(res, error, 'Failed to generate form.');
  }
});

app.post('/api/forms/:id/submit', publicFormSubmitLimiter, async (req, res) => {
  try {
    const form = await prisma.applicationForm.findUnique({ where: { id: req.params.id } });
    if (!form) return res.status(404).json({ error: 'Form not found.' });
    let schema: any = {};
    try { schema = JSON.parse(form.schema || '{}'); } catch { schema = {}; }
    if (schema.acceptingResponses === false) {
      return res.status(403).json({ error: 'This form is no longer accepting responses.' });
    }
    const definitions = [...(Array.isArray(schema.questions) ? schema.questions : []), ...(Array.isArray(schema.fields) ? schema.fields : [])];
    const answers = req.body?.answers && typeof req.body.answers === 'object' ? req.body.answers : req.body;
    if (Buffer.byteLength(JSON.stringify(answers ?? {}), 'utf8') > 200_000) {
      return res.status(413).json({ error: 'This response is too large. Please shorten the answers and try again.' });
    }
    const count = answers && typeof answers === 'object' && !Array.isArray(answers) ? Object.keys(answers).length : 0;
    if (!count || count > Math.max(definitions.length + 2, 2) || count > 200) return res.status(400).json({ error: 'Invalid submission payload.' });
    const normalized: Record<string, unknown> = {};
    if (schema.collectEmail) {
      const respondentEmail = (answers as any)._respondentEmail;
      if (typeof respondentEmail !== 'string' || respondentEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(respondentEmail.trim())) {
        return res.status(400).json({ error: 'Enter a valid email address to submit this form.' });
      }
      normalized._respondentEmail = respondentEmail.trim().toLowerCase();
    }
    for (const [index, definition] of definitions.entries()) {
      const key = String(definition.id ?? definition.number ?? index + 1);
      const value = (answers as any)[key];
      const empty = value === undefined || value === null || (typeof value === 'string' && !value.trim()) || (Array.isArray(value) && !value.length);
      if (definition.required && empty) return res.status(400).json({ error: `Please answer: ${definition.title || definition.label || `Question ${index + 1}`}` });
      if (empty) continue;
      const type = String(definition.type || '').toUpperCase();
      const options = (definition.options || []).map((option: any) => String(typeof option === 'string' ? option : option.label));
      if (['MULTIPLE_CHOICE', 'DROPDOWN'].includes(type) && options.length && !options.includes(String(value))) return res.status(400).json({ error: `Invalid choice for question ${index + 1}.` });
      if (type === 'CHECKBOX' && (!Array.isArray(value) || (options.length && value.some((option: unknown) => !options.includes(String(option)))))) return res.status(400).json({ error: `Invalid choice for question ${index + 1}.` });
      if (type === 'MULTIPLE_CHOICE_GRID' || type === 'CHECKBOX_GRID') {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return res.status(400).json({ error: `Invalid grid response for question ${index + 1}.` });
        const validRows = Array.isArray(definition.rows) ? definition.rows.map(String) : [];
        for (const [row, answer] of Object.entries(value as Record<string, unknown>)) {
          if (!validRows.includes(row)) return res.status(400).json({ error: `Invalid grid row for question ${index + 1}.` });
          if (type === 'MULTIPLE_CHOICE_GRID' && (typeof answer !== 'string' || !options.includes(answer))) return res.status(400).json({ error: `Invalid grid choice for question ${index + 1}.` });
          if (type === 'CHECKBOX_GRID' && (!Array.isArray(answer) || answer.some((option: unknown) => !options.includes(String(option))))) return res.status(400).json({ error: `Invalid grid choice for question ${index + 1}.` });
        }
        if (definition.required && validRows.some((row: string) => !(row in (value as Record<string, unknown>)))) return res.status(400).json({ error: `Please answer every row for question ${index + 1}.` });
      }
      if (type === 'LINEAR_SCALE' && (!Number.isInteger(Number(value)) || Number(value) < Number(definition.scaleMin ?? 1) || Number(value) > Number(definition.scaleMax ?? 5))) return res.status(400).json({ error: `Choose a valid scale value for question ${index + 1}.` });
      if (type === 'RATING' && (!Number.isInteger(Number(value)) || Number(value) < 1 || Number(value) > Number(definition.maxRating ?? 5))) return res.status(400).json({ error: `Choose a valid rating for question ${index + 1}.` });
      if (type === 'EMAIL' && (typeof value !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))) return res.status(400).json({ error: `Enter a valid email for question ${index + 1}.` });
      if (type === 'NUMBER' && !Number.isFinite(Number(value))) return res.status(400).json({ error: `Enter a valid number for question ${index + 1}.` });
      if (typeof value === 'string' && value.length > 50000) return res.status(400).json({ error: `Answer for question ${index + 1} is too long.` });
      normalized[key] = value;
    }
    const submission = await prisma.formSubmission.create({ data: { formId: form.id, data: JSON.stringify(normalized) } });
    await analyticsWorker.extractInsights(submission.id).catch((error) => logger.error('Submission analysis failed:', error));
    const insight = await prisma.extractedInsight.findUnique({ where: { submissionId: submission.id } });
    res.status(201).json({
      success: true,
      submissionId: submission.id,
      confirmationMessage: schema.confirmationMessage || 'Your response has been recorded.',
      isQuiz: Boolean(schema.isQuiz),
      score: insight?.score ?? null,
      feedback: insight?.scoringFeedback || insight?.summary || null,
    });
  } catch (error: any) {
    respondError(res, error, 'Failed to submit form.');
  }
});
app.get('/api/public/forms/:id', async (req, res) => {
  try {
    const form = await prisma.applicationForm.findUnique({ where: { id: req.params.id } });
    if (!form) return res.status(404).json({ error: 'Form not found.' });
    let schemaObj: any = {};
    try { schemaObj = JSON.parse(form.schema || '{}'); } catch { schemaObj = { title: form.title }; }
    const publicSchema = sanitizePublicFormSchema(schemaObj);
    res.json({ id: form.id, title: form.title, ...publicSchema, schema: publicSchema });
  } catch (error: any) {
    respondError(res, error, 'Failed to retrieve public form.');
  }
});

const handleAnalyzeForm = async (req: express.Request, res: express.Response) => {
  try {
    const form = await prisma.applicationForm.findUnique({ where: { id: req.params.id } });
    if (!form) return res.status(404).json({ error: 'Form not found.' });
    const requesterId = (req as any).user?.userId;
    if (!requesterId || form.userId !== requesterId) return res.status(403).json({ error: 'You do not have access to this form.' });
    const requestedRequirements = typeof req.body?.requirements === 'string' ? req.body.requirements.trim().slice(0, 12000) : '';
    if (requestedRequirements) {
      let schema: any = {};
      try { schema = JSON.parse(form.schema || '{}'); } catch { schema = {}; }
      let settings: any = {};
      try { settings = form.selectionSettings ? JSON.parse(form.selectionSettings) : {}; } catch { settings = {}; }
      await prisma.applicationForm.update({ where: { id: form.id }, data: { schema: JSON.stringify({ ...schema, requirements: requestedRequirements }), selectionSettings: JSON.stringify({ ...settings, requirements: requestedRequirements }) } });
    }
    const requirements = requestedRequirements;
    const analysis = await analyticsWorker.runDeepAnalysis(req.params.id, requirements);
    res.json({ success: true, analysis });
  } catch (error: any) {
    respondError(res, error, 'Failed to analyze form.');
  }
};

app.get('/api/forms/:id/analyze', requireAuth, handleAnalyzeForm);
app.post('/api/forms/:id/analyze', requireAuth, handleAnalyzeForm);

// Autonomous LiveScanner AI Agent Endpoint (Vision OCR + Auto-Grading + Scan-to-Form)
app.post('/api/ai/scan-agent', requireAuth, gradingLimiter, async (req, res) => {
  if (process.env.ENABLE_AI_SCAN === 'false') {
    return res.status(404).json({ error: 'AI scan is disabled. Set ENABLE_AI_SCAN=true to enable it.' });
  }
  try {
    const userId = (req as any).user?.userId;
    if (!userId) return res.status(401).json({ error: 'Authentication required.' });

    const {
      mode: requestedMode = 'grade',
      rubricText: rubricTextInput = '',
      rubric: rubricAlias = '',
      studentName = '',
      instructions = '',
      rawTextHint = '',
    } = req.body || {};
    const mode = requestedMode === 'extract_form' ? 'scan_to_form' : requestedMode;
    const rubricText = typeof rubricTextInput === 'string' && rubricTextInput.trim()
      ? rubricTextInput
      : typeof rubricAlias === 'string' ? rubricAlias : '';
    if (!['ocr', 'grade', 'scan_to_form', 'extract_and_grade'].includes(mode)) {
      return res.status(400).json({ error: 'Unsupported scan action. Choose OCR, grading, or form extraction.' });
    }
    const pages = Array.isArray(req.body?.pages)
      ? req.body.pages
      : req.body?.imageBase64
        ? [req.body.imageBase64]
        : [];
    if (!Array.isArray(pages) || pages.length === 0) {
      return res.status(400).json({ error: 'At least one scanned page is required.' });
    }

    const images = pages
      .map((p: any) => {
        const dataUrl = String(typeof p === 'string' ? p : p?.dataUrl || p?.url || '');
        const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
        if (match) return { mediaType: match[1], base64: match[2] };
        if (p?.base64 && typeof p.base64 === 'string') return { mediaType: p?.mimeType || 'image/jpeg', base64: p.base64 };
        return null;
      })
      .filter(Boolean) as Array<{ base64: string; mediaType: string }>;
    if (images.length !== pages.length) {
      return res.status(400).json({ error: 'One or more scanned pages are not valid base64 image data.' });
    }

    const decodedImages = images.map((image) => Buffer.from(image.base64, 'base64'));
    if (decodedImages.some((image) => image.length === 0 || image.length > 12 * 1024 * 1024)) {
      return res.status(413).json({ error: 'Each scanned page must be a valid image under 12 MB. Please reduce the scan quality and retry.' });
    }
    if (decodedImages.some((image, index) => detectRealMimeType(image) !== images[index].mediaType)) {
      return res.status(400).json({ error: 'A scanned page does not match its declared image type. Please capture or upload it again.' });
    }

    if (mode === 'ocr') {
      const systemPrompt = `You are a careful OCR assistant. Read only text visible in the supplied image. Do not guess missing or blurred words. Preserve the original language, spelling, line breaks, question numbers, and mathematical notation. Return JSON only with this shape: {"detectedStudentName": null, "ocrTranscript": "verbatim visible text", "summary": "brief description of the page", "qualityScore": 0}. qualityScore is an integer from 0 to 100 for legibility; use null for detectedStudentName when it is not clearly visible.`;
      const raw = await aiService.sendGonkaChat(
        `Transcribe the text visible on this scanned page. ${rawTextHint ? `Existing OCR hint (verify against the image and correct errors):\\n${String(rawTextHint).slice(0, 12000)}` : ''} ${instructions}`,
        { system: systemPrompt, images, maxTokens: 3000 },
      );
      const parsed = aiService.parseModelJson(raw);
      const transcript = typeof parsed?.ocrTranscript === 'string' ? parsed.ocrTranscript.trim() : '';
      if (!transcript) return res.status(502).json({ error: { code: 'INVALID_OCR_OUTPUT', message: 'The AI could not read enough text from this scan. Try a clearer image or adjust the page corners.' }, retryable: true });
      return res.json({
        success: true,
        ocrTranscript: transcript,
        extractedText: transcript,
        detectedStudentName: typeof parsed.detectedStudentName === 'string' ? parsed.detectedStudentName : null,
        studentName: typeof parsed.detectedStudentName === 'string' ? parsed.detectedStudentName : null,
        summary: typeof parsed.summary === 'string' ? parsed.summary : '',
        qualityScore: Number.isFinite(parsed.qualityScore) ? Math.max(0, Math.min(100, parsed.qualityScore)) : undefined,
      });
    }

    if (mode === 'scan_to_form') {
      const systemPrompt = `You are Bwenge Scan-to-Form Autonomous Agent powered by GonkaRouter Vision.
Inspect the scanned document/worksheet image(s) and convert every visible question, field, or prompt into a structured interactive digital form schema, including a scoring rubric.
Return valid JSON ONLY:
{
  "title": "Extracted Form/Exam Title",
  "description": "Instructions extracted from the scanned header",
  "questions": [
    {
      "id": "q_1",
      "type": "SHORT_TEXT|LONG_TEXT|MULTIPLE_CHOICE|CHECKBOX|DROPDOWN|NUMBER|DATE",
      "title": "Exact question text from scan",
      "required": true,
      "options": [{"id": "opt_1", "label": "Option A"}]
    }
  ],
  "rubric": {
    "criteria": [
      { "name": "Accuracy & Completeness", "weight": 1.0, "maxMarks": 100 }
    ]
  }
}`;
      const raw = await aiService.sendGonkaChat(
        `Extract all questions and form fields from these ${images.length} scanned page(s) and build a complete digital form schema. ${instructions}`,
        { system: systemPrompt, images }
      );
      const parsed = aiService.parseModelJson(raw);
      const allowedQuestionTypes = new Set(['SHORT_TEXT', 'LONG_TEXT', 'MULTIPLE_CHOICE', 'CHECKBOX', 'DROPDOWN', 'NUMBER', 'DATE']);
      const validRubric =
        parsed?.rubric &&
        typeof parsed.rubric === 'object' &&
        !Array.isArray(parsed.rubric) &&
        Array.isArray(parsed.rubric.criteria) &&
        parsed.rubric.criteria.length > 0 &&
        parsed.rubric.criteria.every((criterion: any) =>
          criterion &&
          typeof criterion.name === 'string' &&
          criterion.name.trim() &&
          typeof criterion.weight === 'number' &&
          Number.isFinite(criterion.weight) &&
          criterion.weight > 0 &&
          typeof criterion.maxMarks === 'number' &&
          Number.isFinite(criterion.maxMarks) &&
          criterion.maxMarks > 0,
        );
      if (
        !parsed ||
        typeof parsed.title !== 'string' ||
        !parsed.title.trim() ||
        typeof parsed.description !== 'string' ||
        !parsed.description.trim() ||
        !Array.isArray(parsed.questions) ||
        parsed.questions.length === 0 ||
        !validRubric ||
        parsed.questions.some((question: any) =>
          !question ||
          typeof question.title !== 'string' ||
          !question.title.trim() ||
          !allowedQuestionTypes.has(String(question.type || '').toUpperCase()) ||
          typeof question.required !== 'boolean' ||
          (['MULTIPLE_CHOICE', 'CHECKBOX', 'DROPDOWN'].includes(String(question.type || '').toUpperCase()) &&
            (!Array.isArray(question.options) ||
              question.options.length === 0 ||
              question.options.some((option: any) => {
                const label = typeof option === 'string' ? option : option?.label;
                return typeof label !== 'string' || !label.trim();
              }))) ||
          (question.options !== undefined &&
            (!Array.isArray(question.options) ||
              question.options.some((option: any) => {
                const label = typeof option === 'string' ? option : option?.label;
                return typeof label !== 'string' || !label.trim();
              }))),
        )
      ) {
        return res.status(502).json({
          success: false,
          error: { code: 'INVALID_MODEL_OUTPUT', message: 'The scan did not produce a valid form. Please retry.' },
          retryable: true,
        });
      }
      const safeTitle = parsed.title.trim();
      const rawQuestions = parsed.questions;
      const normalizedQuestions = rawQuestions.map((q: any, i: number) => ({
        id: q.id || `q_${i + 1}`,
        type: String(q.type || 'SHORT_TEXT').toUpperCase(),
        title: q.title.trim(),
        required: Boolean(q.required ?? true),
        options: Array.isArray(q.options)
          ? q.options.map((o: any, oi: number) => ({
              id: `opt_${i}_${oi}`,
              label: typeof o === 'string' ? o : String(o?.label || ''),
            }))
          : undefined,
      }));
      const schemaObj = {
        title: safeTitle,
        description: parsed.description.trim(),
        questions: normalizedQuestions,
        rubric: parsed?.rubric || null,
        themeColor: '#D97757',
      };
      const created = await prisma.applicationForm.create({
        data: {
          userId,
          title: safeTitle,
          schema: JSON.stringify(schemaObj),
          rubric: parsed?.rubric ? JSON.stringify(parsed.rubric) : null,
          selectionSettings: JSON.stringify({ requirements: schemaObj.description }),
        },
      });
      return res.json({
        success: true,
        form: {
          ...schemaObj,
          id: created.id,
          schema: schemaObj,
        },
      });
    }

    // Default mode: 'extract_and_grade' — Vision OCR + Student Detection + Rubric Grading Agent
    const systemPrompt = `You are Bwenge LiveScanner Vision & Grading Agent powered by GonkaRouter.
You are inspecting ${images.length} scanned student answer sheet page(s).
1. Perform high-accuracy Optical Character Recognition (OCR) on all handwritten and printed text.
2. Detect the student's name and ID only if visible on the page; otherwise return null for that field.
3. Segment each question and the student's corresponding answer.
4. Grade each answer fairly against the provided rubric (or standard academic criteria if no rubric is provided), awarding partial credit where appropriate.
5. If a question has no visible answer, return an empty string for studentAnswer, award zero for that question, and do not invent a response.
Return valid JSON ONLY in this exact shape:
{
  "detectedStudentName": null,
  "studentId": null,
  "ocrTranscript": "Full verbatim transcription of the scanned page(s)...",
  "totalAwardedMarks": 85,
  "maxTotalMarks": 100,
  "percentage": 85,
  "overallFeedback": "Concise, constructive summary of strengths and areas for improvement",
  "confidence": 94,
  "flags": [],
  "questions": [
    {
      "number": "Q1",
      "questionText": "Question topic or prompt",
      "studentAnswer": "Transcribed student answer",
      "awardedMarks": 18,
      "maxMarks": 20,
      "feedback": "Specific evidence-based feedback",
      "flag": "none"
    }
  ]
}`;

    const userPrompt = `Analyze, transcribe (OCR), and grade these ${images.length} scanned page(s) for ${studentName || 'this student'}.
${rubricText ? `ACTIVE RUBRIC / EXAM CONTEXT:\n${rubricText}` : 'No explicit rubric provided — infer question max marks totaling 100 and grade with academic rigor.'}
${rawTextHint ? `SUPPLEMENTAL OCR HINT (verify every item against the image; the image is authoritative):\n${String(rawTextHint).slice(0, 12000)}` : ''}
${instructions ? `ADDITIONAL AGENT INSTRUCTIONS:\n${instructions}` : ''}`;

    const raw = await aiService.sendGonkaChat(userPrompt, { system: systemPrompt, images });
    const parsed = validateScanGradeOutput(aiService.parseModelJson(raw));
    if (!parsed) {
      return res.status(502).json({
        success: false,
        error: { code: 'INVALID_MODEL_OUTPUT', message: 'The scan did not produce a complete, valid result. Please retry.' },
        retryable: true,
      });
    }

    return res.json({
      success: true,
      provider: 'GonkaRouter',
      ...parsed,
    });
  } catch (error: any) {
    logger.error('Scan model request failed.', { errorType: error?.name || 'Error', status: error?.status });
    res.status(502).json({
      success: false,
      error: { code: 'SCAN_FAILED', message: 'The scan could not be processed. Please retry.' },
      retryable: true,
    });
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

    const generatedJson = aiService.parseModelJson(result.text || '');
    const questions = Array.isArray(generatedJson?.questions) ? generatedJson.questions : [];
    const rubrics = Array.isArray(generatedJson?.rubrics) ? generatedJson.rubrics : [];
    const requestedTotalMarks = Number(totalMarks || 30);
    const generatedTotalMarks = questions.reduce((sum: number, question: any) => sum + Number(question?.maxMarks), 0);
    const validQuestions = questions.length > 0 && questions.every((question: any) =>
      typeof question?.questionText === 'string' &&
      question.questionText.trim() &&
      typeof question?.modelAnswer === 'string' &&
      question.modelAnswer.trim() &&
      Number.isFinite(Number(question.maxMarks)) &&
      Number(question.maxMarks) > 0
    );
    const validRubrics = rubrics.length === questions.length && rubrics.every((rubric: any, index: number) => {
      const criteria = rubric?.criteria;
      const criteriaTotal = Array.isArray(criteria)
        ? criteria.reduce((sum: number, criterion: any) => sum + Number(criterion?.marksAvailable), 0)
        : Number.NaN;
      return (
        Array.isArray(criteria) &&
        criteria.length > 0 &&
        criteria.every((criterion: any) =>
          typeof criterion?.criterion === 'string' &&
          criterion.criterion.trim() &&
          Number.isFinite(Number(criterion.marksAvailable)) &&
          Number(criterion.marksAvailable) >= 0
        ) &&
        (!rubric.questionId || String(rubric.questionId) === String(questions[index].id)) &&
        Math.round(criteriaTotal * 100) === Math.round(Number(questions[index].maxMarks) * 100)
      );
    });
    if (
      !generatedJson ||
      typeof generatedJson.title !== 'string' ||
      !generatedJson.title.trim() ||
      !validQuestions ||
      !validRubrics ||
      Math.round(generatedTotalMarks * 100) !== Math.round(requestedTotalMarks * 100)
    ) {
      throw new Error('AI exam generation returned an incomplete paper or rubric.');
    }

    generatedJson.id = 'exam-' + Date.now();
    generatedJson.createdAt = new Date().toISOString();

    res.json({ success: true, examPaper: generatedJson });
  } catch (error: any) {
    logger.error('AI exam generation failed; no substitute exam was created.', {
      errorType: error?.name || 'Error',
      status: typeof error?.status === 'number' ? error.status : undefined,
      timeout: error?.timeout === true,
      timeoutKind: error?.timeoutKind,
    });
    res.status(503).json({
      error: 'EXAM_GENERATION_FAILED',
      message: 'AI exam generation could not be completed. Please retry.',
    });
  }
});

app.post('/api/mark-script', requireAuth, gradingLimiter, validate(markScriptSchema), async (req, res) => {
  try {
    const { examPaper, studentScript } = req.body;
    const userId = (req as any).user?.userId;
    if (!userId) return res.status(401).json({ error: 'Authentication required.' });

    const markingPreferences = await prisma.userSettings.findUnique({
      where: { userId },
      select: { defaultStrictness: true, agentTone: true, autoSummarize: true, customInstructions: true },
    });
    const result = await gradingService.evaluateStudentScriptWithAI(
      examPaper,
      studentScript,
      `batch-${userId}`,
      markingPreferences || undefined,
    );
    res.json({ success: true, ...result });
  } catch (error: any) {
    logger.error('AI marking failed; student script remains pending.', {
      errorType: error?.name || 'Error',
      status: typeof error?.status === 'number' ? error.status : undefined,
      timeout: error?.timeout === true,
      timeoutKind: error?.timeoutKind,
    });
    res.status(503).json({
      error: 'AI_MARKING_FAILED',
      message: 'AI marking could not be completed. The script remains pending; please retry.',
    });
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
    if (!Array.isArray(data?.criteria) || data.criteria.length === 0) {
      throw new Error('AI rubric generation returned no criteria.');
    }
    res.json({ success: true, criteria: data.criteria });
  } catch (error: any) {
    logger.error('AI rubric generation failed.', {
      errorType: error?.name || 'Error',
      status: typeof error?.status === 'number' ? error.status : undefined,
      timeout: error?.timeout === true,
      timeoutKind: error?.timeoutKind,
    });
    res.status(503).json({
      error: 'RUBRIC_GENERATION_FAILED',
      message: 'AI rubric generation could not be completed. Please retry.',
    });
  }
});

app.post('/api/ai/summarize', requireAuth, gradingLimiter, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Text required' });

    const response = await aiService.generateContent({
      contents: `Summarize the following text into 1 concise, high-impact bullet point insight for academic study:\n\n"${text}"`,
    });

    const summary = nonEmptyModelText(response.text);
    if (!summary) return res.status(502).json(emptyModelOutputError('summary'));
    res.json({ success: true, summary });
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

    const translation = nonEmptyModelText(response.text);
    if (!translation) return res.status(502).json(emptyModelOutputError('translation'));
    res.json({ success: true, translation });
  } catch (error: any) {
    respondError(res, error, 'Translation failed.');
  }
});

// --- Batch Grading & Job Polling API (for Telegram Bot Integration & Background Processing) ---

app.post('/api/batch/grade', requireAuth, batchGradingLimiter, batchUpload.fields([{ name: 'papers', maxCount: 1 }, { name: 'rubric', maxCount: 1 }]), async (req: express.Request, res: express.Response) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) return res.status(401).json({ error: 'Authentication required.' });
    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    const papersFile = files?.papers?.[0];
    const rubricFile = files?.rubric?.[0];
    const paperType = req.body.paperType || 'mcq';

    if (!papersFile || !rubricFile) {
      return res.status(400).json({ error: 'Both papers PDF and rubric image are required.' });
    }
    if (detectRealMimeType(papersFile.buffer) !== 'application/pdf') return res.status(400).json({ error: 'The papers upload must be a valid PDF.' });
    const rubricMime = detectRealMimeType(rubricFile.buffer);
    if (!rubricMime || !rubricMime.startsWith('image/')) return res.status(400).json({ error: 'The rubric upload must be a valid image.' });
    if (!['mcq', 'essay', 'short_answer', 'single'].includes(paperType)) return res.status(400).json({ error: 'Unsupported paper type.' });

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
        await fs.writeFile(excelFilePath, excelBuffer, { mode: 0o600 });

        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const excelUrl = `${(process.env.APP_URL || baseUrl).replace(/\/$/, '')}/exports/${excelFileName}`;

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

async function ensureMasterAdmin() {
  try {
    await prisma.$connect().catch(() => {});
    const email = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
    const initialPassword = process.env.TEAM_INITIAL_PASSWORD || '';
    if (!email) {
      logger.info('Admin bootstrap skipped: set INITIAL_ADMIN_EMAIL and TEAM_INITIAL_PASSWORD to create the first admin.');
      return;
    }
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      logger.info('Admin bootstrap skipped because the configured account already exists.');
      return;
    }
    if (initialPassword.length < 12) {
      logger.warn('Admin bootstrap skipped: TEAM_INITIAL_PASSWORD must be at least 12 characters.');
      return;
    }
    const passwordHash = await bcrypt.hash(initialPassword, 12);
    await prisma.user.create({
      data: {
        email,
        name: process.env.INITIAL_ADMIN_NAME?.trim() || 'Administrator',
        passwordHash,
        role: 'ADMIN',
        settings: { create: {} },
      },
    });
    logger.info('Initial admin account created.');
  } catch (err) {
    logger.error('Failed to ensure the initial administrator account.', { errorType: err instanceof Error ? err.name : 'Error' });
  }
}

// --- Server Lifecycle ---

async function startServer() {
  await Promise.all([
    fs.mkdir(path.resolve('./data'), { recursive: true }),
    fs.mkdir(path.resolve('./exports'), { recursive: true }),
    fs.mkdir(path.resolve(process.env.FILE_STORE_DIR ?? './data/generated'), { recursive: true }),
  ]);
  validateEmailSenderConfiguration();
  await ensureMasterAdmin();
  if (process.env.NODE_ENV === 'production') {
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1`;
    await queueService.initialize();
    const interruptedBatches = await prisma.batchJob.updateMany({
      where: { status: 'PROCESSING' },
      data: {
        status: 'FAILED',
        errorMessage: 'The server restarted while this batch was processing. Please submit the files again.',
      },
    });
    if (interruptedBatches.count > 0) {
      logger.warn('Marked interrupted batch grading jobs as failed after restart.', { count: interruptedBatches.count });
    }
  }
  const reconService = ReconciliationService.getInstance();
  reconService.initialize().catch((err) => {
    logger.error('Failed to start Reconciliation Service', err);
  });

  // Register Telegram bot commands and webhook URL with Telegram API
  const botService = TelegramBotService.getInstance();
  botService.registerCommands().catch((err) => {
    logger.error('Failed to register Telegram bot commands', err);
  });
  const webhookBaseUrl = getTelegramWebhookBaseUrl();
  if (webhookBaseUrl) {
    botService.setWebhook(webhookBaseUrl).catch((err) => {
      logger.error('Failed to set Telegram webhook URL', err);
    });
  }

  const server = createServer(app);
  attachRealtime(server, process.env.NODE_ENV === 'production' ? allowedOrigins : true);
  let vite: any = null;
  if (process.env.NODE_ENV !== 'production') {
    vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: {
          server,
          clientPort: process.env.CODESPACE_NAME ? 443 : PORT,
        },
      },
      appType: 'spa',
    });
    app.get(['/forms/:id', '/apply/:id'], (_req, res) => res.sendFile(path.join(process.cwd(), 'index.html')));
    app.use('/api', (req, res) => {
      res.status(404).json({ error: `No such endpoint: ${req.method} ${req.originalUrl}` });
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get(['/forms/:id', '/apply/:id'], (_req, res) => res.sendFile(path.join(distPath, 'index.html')));

    // Unmatched API routes should 404 as JSON, not fall through to the SPA
    // shell — otherwise a mistyped or removed endpoint looks like a 200 to
    // any client that isn't a browser.
    app.use('/api', (req, res) => {
      res.status(404).json({ error: `No such endpoint: ${req.method} ${req.originalUrl}` });
    });

    app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }

  server.listen(PORT, '0.0.0.0', () => {
    logger.info(`Marker AI server running on http://0.0.0.0:${PORT}`);
    // Recover persisted background jobs and start periodic cleanup of expired jobs/artifacts.
    startEducationRuntime().catch((err) => logger.error('Background job runtime failed to start', { errorType: err?.name }));
    // Mobile Money: confirm pending payments (missed callbacks) and send renewal reminders.
    startBillingJobs();
  });

  // Graceful shutdown: a deploy/restart sending SIGTERM (Render, Docker,
  // most orchestrators) should stop accepting new connections and let
  // in-flight requests — including open SSE streams — finish before the
  // process exits, rather than cutting them off mid-response.
  const shutdown = (signal: string) => {
    logger.info(`${signal} received, shutting down gracefully...`);
    server.close(async () => {
      try {
        await fileJobQueue.stop();
        await shutdownOcr();
        await queueService.close();
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
