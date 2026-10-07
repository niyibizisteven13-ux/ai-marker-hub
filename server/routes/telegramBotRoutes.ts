import { Router, Request, Response } from 'express';
import { prisma } from '../db.js';
import { TelegramBotService } from '../services/TelegramBotService.js';
import { AiService } from '../services/AiService.js';
import { HighVolumeBatchService } from '../services/HighVolumeBatchService.js';
import { FormOrchestrator } from '../services/FormOrchestrator.js';
import { DocumentQualityService } from '../services/DocumentQualityService.js';
import { PaywallService } from '../services/PaywallService.js';
import { MemoryService } from '../services/MemoryService.js';
import { upload } from '../middleware/upload.js';
import { generalTools } from '../services/generalTools.js';
import { generateBatchExcelReportFromGradedResults } from '../../src/services/excelExporter.ts';
import { classifyIntent } from '../services/intentRouter.js';
import { buildPromptForIntent } from '../services/prompts/promptRouter.js';
import { stripThinkingTags } from '../utils/textSanitizers.js';
import logger from '../utils/logger.js';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { PDFParse } from 'pdf-parse';
import fs from 'fs/promises';
import path from 'path';

const router = Router();
const botService = TelegramBotService.getInstance();
const aiService = AiService.getInstance();
const paywallService = PaywallService.getInstance();
const memoryService = MemoryService.getInstance();

// Scan Tokens for /scan signed single-use URLs.
// NOTE: in-memory only — won't survive multi-instance deploys or a
// restart mid-session. Swap for a Prisma table or Redis before scaling out.
const scanTokens = new Map<string, { chatId: string; expires: number }>();

const SCAN_TOKEN_SWEEP_MS = 5 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [token, data] of scanTokens.entries()) {
    if (data.expires <= now) scanTokens.delete(token);
  }
}, SCAN_TOKEN_SWEEP_MS).unref();

// Where locally-uploaded (web-scanner) files land before being picked up
// by checkAndTriggerBatchGrading, alongside Telegram-native uploads.
const SCAN_UPLOADS_DIR = path.join(process.cwd(), 'uploads', 'telegram-scans');

// Lightweight per-chat recent-turn cache for multi-turn conversational
// context. In-memory, same caveats as scanTokens above (not
// multi-instance safe, lost on restart) — if that matters before a
// proper persisted history table is built, this is the piece to swap
// for a Prisma-backed store first, since losing conversational context
// mid-session is more user-visible than losing a scan token.
const MAX_HISTORY_TURNS = 6;
const HISTORY_TTL_MS = 60 * 60 * 1000; // 1 hour of inactivity clears history
const conversationHistory = new Map<string, { turns: Array<{ role: 'user' | 'assistant'; text: string }>; lastUsed: number }>();

async function ensureTelegramUser(chatId: string, session: any) {
  if (session.userId) {
    const linkedUser = await prisma.user.findUnique({ where: { id: session.userId } });
    if (linkedUser) return session;
  }

  const email = `telegram-${chatId}@users.invalid`;
  const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, name: `Telegram ${chatId}`, passwordHash },
    update: {},
  });
  return prisma.telegramSession.update({ where: { chatId }, data: { userId: user.id } });
}

const HISTORY_SWEEP_MS = 15 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [chatId, entry] of conversationHistory.entries()) {
    if (now - entry.lastUsed > HISTORY_TTL_MS) conversationHistory.delete(chatId);
  }
}, HISTORY_SWEEP_MS).unref();

function getHistory(chatId: string): Array<{ role: 'user' | 'assistant'; text: string }> {
  return conversationHistory.get(chatId)?.turns || [];
}

function appendHistory(chatId: string, role: 'user' | 'assistant', text: string) {
  const entry = conversationHistory.get(chatId) || { turns: [], lastUsed: Date.now() };
  entry.turns.push({ role, text });
  if (entry.turns.length > MAX_HISTORY_TURNS) {
    entry.turns = entry.turns.slice(-MAX_HISTORY_TURNS);
  }
  entry.lastUsed = Date.now();
  conversationHistory.set(chatId, entry);
}

/**
 * Secret token middleware verifying incoming Telegram webhooks.
 */
function verifyTelegramSecret(req: Request, res: Response, next: () => void) {
  const secret = process.env.TELEGRAM_BOT_SECRET_TOKEN;
  if (!secret) return next();

  const headerSecret = req.get('X-Telegram-Bot-Api-Secret-Token');
  if (headerSecret !== secret) {
    logger.warn('Telegram Webhook: Invalid or missing secret token header.');
    return res.status(401).json({ error: 'Unauthorized webhook source' });
  }
  next();
}

/**
 * Paywall Access Control Helper.
 *
 * NOTE: 'general_assist' and 'research' are distinct service keys from
 * 'grading' — verify PaywallService.checkAccess recognizes them before
 * deploying (see prior review notes: server.ts's web chat route skips
 * the paywall entirely for its 'general' service — confirm whether the
 * bot's free-form chat should match that instead of a paid bucket here).
 */
async function ensurePaywallAccess(
  chatId: string,
  session: any,
  service: 'grading' | 'selection_scoring' | 'farming_advice' = 'grading'
): Promise<boolean> {
  const userId = session.userId || `telegram-${chatId}`;
  const jobId = crypto.randomUUID();

  const access = await paywallService.checkAccess(userId, service, jobId);
  if (!access.allowed) {
    const baseUrl = process.env.APP_BASE_URL || 'http://localhost:3000';
    const upgradeLink = `${baseUrl}/upgrade?jobId=${jobId}&service=${service}`;
    const upgradeMsg = paywallService.buildUpgradeMessage(service as any, upgradeLink, access.reason);
    await botService.sendMessage(chatId, upgradeMsg);
    return false;
  }
  return true;
}

/**
 * Reads the bytes for a staged file regardless of source — Telegram
 * file_id or a local path from the web scanner.
 */
async function resolveStagedBuffer(
  fileId: string | null | undefined,
  localPath: string | null | undefined
): Promise<{ buffer: Buffer } | null> {
  if (localPath) {
    try {
      const buffer = await fs.readFile(localPath);
      return { buffer };
    } catch (err: any) {
      logger.error(`Failed to read staged local scan file at ${localPath}`, err);
      return null;
    }
  }
  if (fileId) {
    return botService.downloadTelegramFile(fileId);
  }
  return null;
}

async function cleanupLocalScanFile(localPath: string | null | undefined) {
  if (!localPath) return;
  try {
    await fs.unlink(localPath);
  } catch (err: any) {
    logger.warn(`Failed to clean up local scan file ${localPath}`, err.message);
  }
}

/**
 * Safe arithmetic evaluator backing the conversational `calculate` tool.
 *
 * DUPLICATION NOTE: this is the same recursive-descent parser already
 * defined in server.ts for its /api/ai/chat tool executor. Duplicated
 * here rather than imported because server.ts's copy is a local,
 * unexported function. If this bot file and server.ts's tool executor
 * keep growing, extract this (and the tool-dispatch switch generally)
 * into a shared module the same way buildPromptForIntent was — flagged
 * here rather than done silently, since it touches server.ts too.
 */
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

/**
 * Tool executor for conversational bot chat (Gonka path). Deliberately
 * covers only the tools that make sense in a text-only Telegram
 * conversation — build_form, generate_visual_annotation,
 * cross_reference_visuals, and generate_browser_extension from
 * server.ts's fuller tool set either need a UI surface or an attached
 * image this handler doesn't have, and are left unhandled with an
 * explicit message rather than silently pretending to support them.
 */
const telegramActionTools: any[] = [
  { name: 'start_batch_grading', description: 'Start grading the uploaded student papers against the uploaded rubric, or ask for missing files.', input_schema: { type: 'object', properties: {}, required: [] } },
  { name: 'generate_exam', description: 'Create an exam and marking rubric when the user asks for an exam, test, or quiz.', input_schema: { type: 'object', properties: { request: { type: 'string', description: 'Subject, topic, level, marks, and any other requirements.' } }, required: ['request'] } },
  { name: 'create_form', description: 'Create an application, registration, or assessment form.', input_schema: { type: 'object', properties: { purpose: { type: 'string', description: 'What the form is for and who will use it.' } }, required: ['purpose'] } },
  { name: 'research_topic', description: 'Research a topic or answer a request that asks for current or sourced information.', input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'start_photo_grading', description: 'Grade a single handwritten student answer photo.', input_schema: { type: 'object', properties: {}, required: [] } },
  { name: 'open_scanner', description: 'Open the mobile document scanner for scanning exam papers or rubric pages.', input_schema: { type: 'object', properties: {}, required: [] } },
  { name: 'check_job_status', description: 'Show recent batch grading jobs and their progress.', input_schema: { type: 'object', properties: {}, required: [] } },
  { name: 'check_usage', description: 'Show remaining grading usage, plan, or credits.', input_schema: { type: 'object', properties: {}, required: [] } },
  { name: 'discuss_results', description: 'Answer questions about the latest completed grading batch and class performance.', input_schema: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] } },
  { name: 'set_bot_language', description: 'Change the bot response language.', input_schema: { type: 'object', properties: { language: { type: 'string', enum: ['en', 'rw'] } }, required: ['language'] } },
];

async function getTelegramSession(chatId: string) {
  const session = await prisma.telegramSession.findUnique({ where: { chatId } });
  if (!session) throw new Error('Telegram session not found.');
  return session;
}

async function executeBotConversationalTool(chatId: string, userId: string, name: string, input: any): Promise<string> {
  switch (name) {
    case 'start_batch_grading': {
      const session = await prisma.telegramSession.findUnique({ where: { chatId } });
      if (!session) return 'Telegram session not found.';
      const hasPaper = !!(session.stagedPaperFileId || session.stagedPaperLocalPath);
      const hasRubric = !!(session.stagedRubricFileId || session.stagedRubricLocalPath);
      if (hasPaper && hasRubric) {
        await checkAndTriggerBatchGrading(chatId);
        return 'Batch grading started. I will send the result and Excel report here.';
      }
      await handleGradeCommand(chatId, session);
      return 'Asked the user to upload the student papers and rubric.';
    }
    case 'generate_exam':
      await handleBotCommand(chatId, await getTelegramSession(chatId), `/exam ${input.request}`);
      return 'Generated the requested exam using GonkaRouter and sent it in Telegram.';
    case 'create_form':
      await handleBotCommand(chatId, await getTelegramSession(chatId), `/form ${input.purpose}`);
      return 'Created the requested form using GonkaRouter and sent its link in Telegram.';
    case 'research_topic':
      await handleBotCommand(chatId, await getTelegramSession(chatId), `/research ${input.query}`);
      return 'Completed the research request using GonkaRouter tools and sent the report in Telegram.';
    case 'start_photo_grading': {
      const session = await getTelegramSession(chatId);
      await handleBotCommand(chatId, session, '/markphoto');
      return 'Asked the user to send the handwritten answer photo.';
    }
    case 'open_scanner':
      await handleBotCommand(chatId, await getTelegramSession(chatId), '/scan');
      return 'Sent the mobile scanner link in Telegram.';
    case 'check_job_status':
      await handleStatusCommand(chatId, await getTelegramSession(chatId));
      return 'Sent the recent grading job status in Telegram.';
    case 'check_usage':
      await handleQuotaCommand(chatId, await getTelegramSession(chatId));
      return 'Sent the account usage and quota in Telegram.';
    case 'discuss_results': {
      const session = await getTelegramSession(chatId);
      const job = await prisma.batchJob.findFirst({
        where: { telegramChatId: chatId, status: 'DONE' },
        orderBy: { createdAt: 'desc' },
      });
      if (!job) return 'No completed batch is available to discuss yet.';
      const activeSession = await prisma.telegramSession.update({
        where: { chatId }, data: { activeDiscussJobId: job.id },
      });
      await handleDiscussQuery(chatId, activeSession, input.question || 'Summarize the class results.');
      return 'Answered the question using the latest completed grading batch.';
    }
    case 'set_bot_language':
      await handleBotCommand(chatId, await getTelegramSession(chatId), input.language === 'rw' ? '/kinyarwanda' : '/english');
      return `Switched the Telegram assistant language to ${input.language === 'rw' ? 'Kinyarwanda' : 'English'}.`;
    case 'calculate': {
      try {
        return String(safeEvaluate(String(input.expression)));
      } catch (e: any) {
        return `Error evaluating expression: ${e.message}`;
      }
    }
    case 'translate_text': {
      return aiService.sendGonkaChat(
        `Translate the following text into ${input.target_language}, preserving tone and meaning:\n\n${input.text}`,
        { system: 'You are a precise translator. Respond with only the translated text, no explanation.' }
      );
    }
    case 'research_memory': {
      return await memoryService.searchMemory(userId, input.query);
    }
    default:
      return `Tool "${name}" is not available in Telegram chat yet — this works in the full Bwenge web assistant.`;
  }
}

/**
 * Web Scanner Signed Upload Endpoint.
 */
router.post('/scan-upload/:sessionToken', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const tokenData = scanTokens.get(req.params.sessionToken);
    if (!tokenData || tokenData.expires < Date.now()) {
      return res.status(401).json({ error: 'Scan session expired or invalid token.' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    const { chatId } = tokenData;
    const session = await prisma.telegramSession.findUnique({ where: { chatId } });
    if (!session) {
      return res.status(404).json({ error: 'Session not found.' });
    }

    const qualityService = DocumentQualityService.getInstance();
    const qualityCheck = await qualityService.prepareScannedPage(req.file.buffer, req.file.mimetype);

    if (!qualityCheck.ok) {
      return res.status(400).json({ error: qualityCheck.reason || 'Image quality gate rejected file.' });
    }

    await fs.mkdir(SCAN_UPLOADS_DIR, { recursive: true });

    const filename = req.file.originalname || 'web_scan.jpg';
    const isRubric = filename.toLowerCase().includes('rubric') || filename.toLowerCase().includes('key');
    const safeExt = path.extname(filename).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 10) || '.jpg';
    const storedPath = path.join(SCAN_UPLOADS_DIR, `${isRubric ? 'rubric' : 'paper'}-${chatId}-${crypto.randomUUID()}${safeExt}`);

    await fs.writeFile(storedPath, qualityCheck.correctedBuffer || req.file.buffer);

    if (isRubric) {
      await prisma.telegramSession.update({
        where: { chatId },
        data: { stagedRubricLocalPath: storedPath, stagedRubricName: filename, stagedRubricFileId: null },
      });
      await botService.sendMessage(chatId, `📥 **Web Scanner**: Received rubric \`${filename}\`.`);
    } else {
      await prisma.telegramSession.update({
        where: { chatId },
        data: { stagedPaperLocalPath: storedPath, stagedPaperName: filename, stagedPaperFileId: null },
      });
      await botService.sendMessage(chatId, `📥 **Web Scanner**: Received document \`${filename}\`.`);
    }

    checkAndTriggerBatchGrading(chatId).catch((err) => {
      logger.error(`Post-scan-upload grading trigger failed for chat ${chatId}`, err);
    });

    // Single-use token cleanup
    scanTokens.delete(req.params.sessionToken);

    res.json({ success: true, message: 'File processed and staged successfully.' });
  } catch (err: any) {
    logger.error('Web scanner upload failed', err);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Scan upload failed. Please retry.' : err.message });
  }
});

function buildTelegramKeyboard(lang: string = 'en') {
  const gradeLabel = lang === 'rw' ? '✨ Kosora Ibizamini' : '✨ Grade Batch';
  const statusLabel = lang === 'rw' ? '📊 Reba Uko Bihagaze' : '📊 Check Status';
  const examLabel = lang === 'rw' ? '📝 Kora Igizamini' : '📝 Generate Exam';
  const researchLabel = lang === 'rw' ? '🌐 Ubushakashatsi' : '🌐 Deep Research';

  return {
    keyboard: [
      [{ text: gradeLabel }, { text: statusLabel }],
      [{ text: examLabel }, { text: researchLabel }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

/** Map plain-language requests onto the same handlers as slash commands. */
async function handleNaturalLanguageAction(chatId: string, session: any, message: string): Promise<boolean> {
  const text = message.trim();
  const lower = text.toLowerCase();

  if (/(single|one|this)\s+(script|paper|answer)|handwritten.*(photo|picture)|grade.*(photo|picture)|mark.*(photo|picture)|kosor\w*.*(ifoto|urupapuro)/i.test(lower)) {
    await prisma.telegramSession.update({ where: { chatId }, data: { stagedMode: 'markphoto' } });
    await botService.sendMessage(chatId, session.language === 'rw'
      ? 'Ohereza ifoto y’urupapuro rw’umunyeshuri kugira ngo ndusuzume.'
      : 'Send the student’s answer photo and I’ll grade it. You can include rubric instructions in the photo caption.');
    return true;
  }

  if (/(\bgrade\b|\bmark\b|\bscore\b|\bcorrect\b|\bkosor\w*\b).*(\b(batch|papers?|scripts?|exams?|tests?|answers?|rubric|students?|ibizamini|impapuro)\b)|(\b(batch|papers?|scripts?|exams?|tests?|answers?|ibizamini|impapuro)\b).*(\bgrade\b|\bmark\b|\bscore\b|\bcorrect\b|\bkosor\w*\b)/i.test(lower)) {
    const current = await prisma.telegramSession.findUnique({ where: { chatId } });
    const hasPaper = !!(current?.stagedPaperFileId || current?.stagedPaperLocalPath);
    const hasRubric = !!(current?.stagedRubricFileId || current?.stagedRubricLocalPath);
    if (hasPaper && hasRubric) await checkAndTriggerBatchGrading(chatId);
    else await handleGradeCommand(chatId, session);
    return true;
  }

  if (/\b(exam|test|quiz|ikizamini)\b/i.test(lower) && /\b(create|make|generate|write|prepare|need|want|kora|tegura)\b/i.test(lower)) {
    const genericRequest = /^(please\s+)?(create|make|generate|write|prepare|i need|i want|kora|tegura)\s+(an?\s+)?(exam|test|quiz|ikizamini)(\s+please)?[.!?]*$/i.test(text);
    await handleBotCommand(chatId, session, genericRequest ? '/exam' : `/exam ${text}`);
    return true;
  }

  if (/\b(research|investigate|look\s+up|find\s+(the\s+)?latest|deep\s+search|ubushakashatsi|shakashaka)\b/i.test(lower)) {
    await handleBotCommand(chatId, session, `/research ${text}`);
    return true;
  }

  if (/(\b(create|make|build|start|kora|tegura)\b.*\b(form|application|registration|ifomu)\b|\b(form|application|registration|ifomu)\b.*\b(create|make|build|kora|tegura)\b)/i.test(lower)) {
    await handleBotCommand(chatId, session, `/form ${text}`);
    return true;
  }

  if (/\b(scan|open the camera|use my camera|take a scan)\b/i.test(lower)) {
    await handleBotCommand(chatId, session, '/scan');
    return true;
  }

  if (/\b(status|progress|job)\b/i.test(lower) && /\b(check|show|what|how|my|recent|latest)\b/i.test(lower)) {
    await handleStatusCommand(chatId, session);
    return true;
  }

  if (/\b(quota|credits|usage|plan)\b/i.test(lower) && /\b(check|show|what|how|my|remaining|left)\b/i.test(lower)) {
    await handleQuotaCommand(chatId, session);
    return true;
  }

  if (/\b(discuss|analy[sz]e|analysis|performance)\b/i.test(lower) && /\b(class|students?|results?|batch|marks?)\b/i.test(lower)) {
    const latestJob = await prisma.batchJob.findFirst({
      where: { telegramChatId: chatId, status: 'DONE' },
      orderBy: { createdAt: 'desc' },
    });
    if (!latestJob) {
      await botService.sendMessage(chatId, 'There is no completed grading batch to discuss yet. Send papers and a rubric, then ask me to grade them.');
    } else {
      const updated = await prisma.telegramSession.update({
        where: { chatId },
        data: { activeDiscussJobId: latestJob.id },
      });
      await handleDiscussQuery(chatId, updated, text);
    }
    return true;
  }

  if (/\b(done|stop discussing|exit discuss|finish discuss|close discuss|cancel this mode|that’s all|that's all)\b/i.test(lower)) {
    await handleBotCommand(chatId, session, '/done');
    return true;
  }

  if (/\b(speak|reply|answer|switch|change)\b.*\b(kinyarwanda|rwandan)\b/i.test(lower)) {
    await handleBotCommand(chatId, session, '/kinyarwanda');
    return true;
  }

  if (/\b(speak|reply|answer|switch|change)\b.*\b(english|eng)\b/i.test(lower)) {
    await handleBotCommand(chatId, session, '/english');
    return true;
  }

  if (/\b(which|what)\b.*\b(model|provider)\b|\bGonkaRouter\b/i.test(text)) {
    await handleBotCommand(chatId, session, '/model');
    return true;
  }

  return false;
}

router.post('/webhook', verifyTelegramSecret, async (req: Request, res: Response) => {
  res.status(200).json({ ok: true });

  try {
    const update = req.body;
    if (!update || typeof update !== 'object') return;

    if (update.message) {
      const msg = update.message;
      const chatId = String(msg.chat.id);
      const userText = (msg.text || msg.caption || '').trim();

      let session = await prisma.telegramSession.findUnique({ where: { chatId } });
      if (!session) {
        session = await prisma.telegramSession.create({
          data: { chatId, provider: process.env.GONKA_API_KEY ? 'gonkarouter' : 'gemini', language: 'en' },
        });
      }

      session = await ensureTelegramUser(chatId, session);
      const telegramUserId = session.userId;
      try {
        await prisma.usageQuota.upsert({
          where: { userId_service: { userId: telegramUserId, service: 'grading' } },
          create: { userId: telegramUserId, service: 'grading', freeUsed: 0 },
          update: {},
        });
      } catch (e) {
        logger.warn('Failed to initialize Telegram grading quota:', e);
      }

      if (process.env.GONKA_API_KEY && session.provider !== 'gonkarouter') {
        session = await prisma.telegramSession.update({
          where: { chatId },
          data: { provider: 'gonkarouter' },
        });
      }

      if (msg.voice) {
        await handleIncomingVoiceNote(chatId, session, msg.voice.file_id);
        return;
      }

      if (msg.document) {
        await handleIncomingDocument(chatId, session, msg.document);
        return;
      }

      if (msg.photo && Array.isArray(msg.photo) && msg.photo.length > 0) {
        const largestPhoto = msg.photo[msg.photo.length - 1];
        await handleIncomingPhoto(chatId, session, largestPhoto.file_id, msg.caption);
        return;
      }

      if (!userText) {
        await botService.sendMessage(chatId,
          session.language === 'rw'
            ? '🤔 Ntabwo nashoboye gusoma ubu bwoko bw\'ubutumwa. Ohereza inyandiko, ifoto, cyangwa PDF.'
            : "🤔 I can't process that type of message yet. Please send text, a photo, or a PDF/document."
        );
        return;
      }

      if (!userText.startsWith('/') && await handleNaturalLanguageAction(chatId, session, userText)) return;

      if (session.activeDiscussJobId && !userText.startsWith('/')) {
        await handleDiscussQuery(chatId, session, userText);
        return;
      }

      if (session.stagedMode === 'form' && !userText.startsWith('/')) {
        await handleFormCreationStep2(chatId, session, userText);
        return;
      }

      if (userText.startsWith('/')) {
        await handleBotCommand(chatId, session, userText);
      } else if (userText.includes('Grade Batch') || userText.includes('Kosora Ibizamini')) {
        await handleGradeCommand(chatId, session);
      } else if (userText.includes('Check Status') || userText.includes('Reba Uko Bihagaze')) {
        await handleStatusCommand(chatId, session);
      } else if (userText.includes('Generate Exam') || userText.includes('Kora Igizamini')) {
        await botService.sendMessage(chatId, session.language === 'rw'
          ? '📝 Ohereza syntax: `/exam [Isomo] [Igice] [Amanota]` (urugero: `/exam Physics Newton_Laws 30`)'
          : '📝 Use format: `/exam [Subject] [Topic] [Total Marks]` (e.g. `/exam Physics Newton_Laws 30`)');
      } else if (userText.includes('Deep Research') || userText.includes('Ubushakashatsi')) {
        await botService.sendMessage(chatId, session.language === 'rw'
          ? '🌐 Ohereza syntax: `/research [Icyo ushakashaka]`'
          : '🌐 Use format: `/research [Your research query]`');
      } else {
        await handleConversationalQuery(chatId, session, userText);
      }
    }
  } catch (err: any) {
    logger.error('Error handling Telegram Webhook update:', err);
  }
});

async function handleBotCommand(chatId: string, session: any, text: string) {
  try {
    const parts = text.trim().split(/\s+/);
    // Telegram appends @BotName to commands sent in group chats.
    const cmd = parts[0].split('@')[0].toLowerCase();
    const arg = parts.slice(1).join(' ');

    switch (cmd) {
      case '/start':
      case '/help': {
        const lang = session.language;
        const userId = session.userId || `telegram-${chatId}`;
        const quota = await prisma.usageQuota.findUnique({
          where: { userId_service: { userId, service: 'grading' } },
        });
        const freeRemaining = Math.max(0, 20 - (quota?.freeUsed || 0));

        const welcome = lang === 'rw'
          ? `👋 **Muraho neza! Ndi Bwenge AI Assistant Bot.**\n\n` +
            `⚙️ **AI Model**: *${session.provider.toUpperCase()}*\n` +
            `🗣️ **Ururimi**: *Kinyarwanda*\n` +
            `🎁 **Ibizamini by'Asuba**: *${freeRemaining} free credits*\n\n` +
            `📌 **Ibyo nshobora kugufasha**:\n` +
            `- 📸 **/scan** - Fungura mobile web scanner ugemure inyandiko\n` +
            `- 📝 **/form** - Kora ifomu y'ubusabe/isuzuma (yemwe na USSD *182*8*1#)\n` +
            `- 📄 **/exam** - Kora igizamini gipfunyitse n'amanota (rubric)\n` +
            `- 🌐 **/research** - Kora ubushakashatsi bwimbitse\n` +
            `- 📊 **/grade** - Kosora ibizamini kuri batch (PDF/Photo)\n` +
            `- 👁️ **/markphoto** - Kosora ifoto imwe y'urupapuro rw'umunyeshuri\n` +
            `- 🗣️ **/discuss** - Mbaza ibibazo kuri batch yakosowe\n` +
            `- 🤖 **/model** - Reba GonkaRouter model ikoreshwa\n` +
            `- 🇬🇧 **/english** / 🇷🇼 **/kinyarwanda** - Hindura ururimi`
          : `👋 **Welcome to Bwenge AI Assistant Bot!**\n\n` +
            `⚙️ **Active Model**: *${session.provider.toUpperCase()}*\n` +
            `🗣️ **Language**: *English*\n` +
            `🎁 **Free Credits**: *${freeRemaining} remaining*\n\n` +
            `📌 **Key Assistant Capabilities**:\n` +
            `- 📸 **/scan** - Open mobile web scanner for high-resolution uploads\n` +
            `- 📝 **/form** - Create interactive application/assessment forms (Web & USSD *182*8*1#)\n` +
            `- 📄 **/exam** - Generate full exam papers & marking rubrics\n` +
            `- 🌐 **/research** - Perform deep web research on any subject\n` +
            `- 📊 **/grade** - Batch grade student answer scripts against rubric\n` +
            `- 👁️ **/markphoto** - Grade single handwritten student photo\n` +
            `- 🗣️ **/discuss** - Post-grading Q&A & student performance analysis\n` +
            `- 🤖 **/model** - Show the active GonkaRouter model\n` +
            `- 🇷🇼 **/kinyarwanda** / 🇬🇧 **/english** - Toggle bot language`;

        await botService.sendMessage(chatId, welcome, {
          reply_markup: buildTelegramKeyboard(lang),
        });
        break;
      }

      case '/model': {
        const selected = arg.toLowerCase().trim();
        if (!selected) {
          await botService.sendMessage(chatId, `AI Provider: GonkaRouter\nModel: ${process.env.GONKA_MODEL || 'zai-org/GLM-5.3-Flash'}`);
          break;
        }
        if (selected && !['gonka', 'gonkarouter'].includes(selected)) {
          await botService.sendMessage(chatId, 'This bot uses GonkaRouter. Use /model gonkarouter or ask “which model are you using?”.');
          break;
        }
        const providerKeys: Record<string, 'gonkarouter'> = {
          gonka: 'gonkarouter', gonkarouter: 'gonkarouter',
        };
        if (selected in providerKeys) {
          if (!(await aiService.providerAvailable(providerKeys[selected]))) {
            await botService.sendMessage(chatId, `Provider ${selected.toUpperCase()} is not configured on this server.`);
            break;
          }
          await prisma.telegramSession.update({
            where: { chatId },
            data: { provider: providerKeys[selected] },
          });
          await botService.sendMessage(chatId, `🚀 AI Provider switched to **${selected.toUpperCase()}**!`);
        } else {
          await botService.sendMessage(chatId,
            `🤖 **Current Provider**: *${session.provider.toUpperCase()}*\n\n` +
            `To switch providers, run:\n` +
            `- \`/model gonkarouter\` (GonkaRouter Decentralized Gateway — GLM-5.3-Flash, high speed / low cost)\n` +
            `- \`/model gemini\` (Google Gemini 3.8 Flash - Fast)\n` +
            `- \`/model claude\` (Anthropic Claude Sonnet - Deep Reasoning)\n` +
            `- \`/model nvidianim\` (NVIDIA NIM Llama 4 - High Throughput)`
          );
        }
        break;
      }

      case '/kinyarwanda': {
        await prisma.telegramSession.update({ where: { chatId }, data: { language: 'rw' } });
        await botService.sendMessage(chatId,
          '🇷🇼 **Ururimi ruhinduwe mu Kinyarwanda!**\n\nUbu Bwenge AI iragusubiza mu Kinyarwanda mu ibizamini, form, na scanner zose.',
          { reply_markup: buildTelegramKeyboard('rw') }
        );
        break;
      }

      case '/english': {
        await prisma.telegramSession.update({ where: { chatId }, data: { language: 'en' } });
        await botService.sendMessage(chatId,
          '🇬🇧 **Language switched to English!**\n\nAll subsequent AI responses and workspace outputs will be generated in English.',
          { reply_markup: buildTelegramKeyboard('en') }
        );
        break;
      }

      case '/status': {
        await handleStatusCommand(chatId, session);
        break;
      }

      case '/quota': {
        await handleQuotaCommand(chatId, session);
        break;
      }

      case '/grade': {
        const existing = await prisma.telegramSession.findUnique({ where: { chatId } });
        const hasPaper = !!(existing?.stagedPaperFileId || existing?.stagedPaperLocalPath);
        const hasRubric = !!(existing?.stagedRubricFileId || existing?.stagedRubricLocalPath);
        if (hasPaper && hasRubric) {
          await checkAndTriggerBatchGrading(chatId);
        } else {
          await handleGradeCommand(chatId, session);
        }
        break;
      }

      case '/exam': {
        if (!(await ensurePaywallAccess(chatId, session, 'grading'))) return;

        const lang = session.language;
        if (!arg || arg.trim().length === 0) {
          const usageMsg = lang === 'rw'
            ? `⚠️ Nyamuneka andika isomo n'igice. Urugero: \`/exam Physics Newton_Laws 30\``
            : `⚠️ Please specify subject and topic. Example: \`/exam Physics Newton_Laws 30\``;
          await botService.sendMessage(chatId, usageMsg);
          return;
        }

        await botService.sendChatAction(chatId, 'typing');
        await botService.sendMessage(chatId, lang === 'rw'
          ? `📝 Birimo gukora igizamini na rubric kuri: *${arg}*...`
          : `📝 Generating exam paper and marking rubric for: *${arg}*...`);

        try {
          const prompt = `You are a World-Class Assessment Architect. Generate a complete exam paper with a matching rubric for: ${arg}.
Respond strictly in ${lang === 'rw' ? 'Kinyarwanda' : 'English'}. Include:
1. Title, Subject, Duration (minutes), Total Marks.
2. Section A: Questions with assigned marks.
3. Section B: Marking Rubric & Model Answer Key.`;

          const result = await aiService.sendGonkaChat(prompt, {
            system: 'You are a World-Class Assessment Architect. Generate complete, accurate assessment materials.',
          });
          await botService.sendMessage(chatId, `✨ **${lang === 'rw' ? 'Igizamini cyarakozwe' : 'Exam Paper & Rubric Generated'}**:\n\n${result.slice(0, 3800)}`);
        } catch (err: any) {
          await botService.sendMessage(chatId, `❌ Exam generation failed: ${err.message}`);
        }
        break;
      }

      case '/markphoto': {
        await prisma.telegramSession.update({
          where: { chatId },
          data: { stagedMode: 'markphoto' },
        });

        const msg = session.language === 'rw'
          ? `📸 **Single-Script Photo Grading Mode**:\n1. Ohereza rubric cyangwa text y'amanota (optional)\n2. Ohereza ifoto y'urupapuro rw'umunyeshuri`
          : `📸 **Single-Script Photo Grading Mode**:\n1. Optionally send rubric criteria or text key\n2. Upload the photo of the student's handwritten answer sheet`;

        await botService.sendMessage(chatId, msg);
        break;
      }

      case '/discuss': {
        const targetJobId = arg === 'last' || !arg
          ? (await prisma.batchJob.findFirst({
              where: { telegramChatId: chatId, status: 'DONE' },
              orderBy: { createdAt: 'desc' },
            }))?.id
          : arg;

        if (!targetJobId) {
          await botService.sendMessage(chatId, '⚠️ No recent completed batch grading jobs found for this chat to discuss.');
          return;
        }

        await prisma.telegramSession.update({
          where: { chatId },
          data: { activeDiscussJobId: targetJobId },
        });

        const msg = session.language === 'rw'
          ? `🗣️ **Ibiganiro kuri Job \`${targetJobId.slice(0, 8)}\`**:\nUbu ushobora kubaza ibibazo ku banyeshuri mu kizamini. Ohereza /done kugira ngo usoze.`
          : `🗣️ **Discussing Batch Job \`${targetJobId.slice(0, 8)}\`**:\nYou can now ask questions about specific students or overall class performance (e.g. 'Why did student #3 lose marks on Q2?'). Send /done to exit discuss mode.`;

        await botService.sendMessage(chatId, msg);
        break;
      }

      case '/done': {
        await prisma.telegramSession.update({
          where: { chatId },
          data: { activeDiscussJobId: null, stagedMode: null },
        });

        await botService.sendMessage(chatId, session.language === 'rw'
          ? '✅ Ibiganiro birahagaritswe. Ubu wakomeza gukoresha AI nka bisanzwe.'
          : '✅ Discuss session closed. Resuming standard AI assistant chat.');
        break;
      }

      case '/form': {
        if (!(await ensurePaywallAccess(chatId, session, 'selection_scoring'))) return;

        const lang = session.language;
        if (arg && arg.trim().length > 0) {
          await handleFormCreationStep2(chatId, session, arg.trim());
        } else {
          await prisma.telegramSession.update({
            where: { chatId },
            data: { stagedMode: 'form' },
          });
          const promptMsg = lang === 'rw'
            ? `📝 **Bwenge Form Builder**\n\n` +
              `Nyamuneka andika umutwe cyangwa intego y'ifomu y'ubusabe ushaka gukora.\n\n` +
              `*Urugero*: \`Ifomu y'Ubusabe bw'Buruse y'Abanyeshuri 2026\``
            : `📝 **Bwenge Form Builder**\n\n` +
              `Please type the title or purpose of the application/assessment form you want to create.\n\n` +
              `*Example*: \`Scholarship Application Form 2026 for Secondary Schools\``;

          await botService.sendMessage(chatId, promptMsg);
        }
        break;
      }

      case '/scan': {
        const sessionToken = crypto.randomUUID().slice(0, 12);
        scanTokens.set(sessionToken, { chatId, expires: Date.now() + 30 * 60 * 1000 });

        const baseUrl = process.env.APP_BASE_URL || 'http://localhost:3000';
        const scanUrl = `${baseUrl}/scan.html?token=${sessionToken}`;
        const lang = session.language;

        const msg = lang === 'rw'
          ? `📸 **Bwenge Mobile Web Scanner**\n\n` +
            `Fungura web scanner ku telefone yawe kugira ngo ufate amapaji y'ibizamini afite umweru n'icyerekezo cyiza.\n\n` +
            `🔗 **[Fungura Mobile Web Scanner](${scanUrl})**\n\n` +
            `💡 *Uko bikora*:\n` +
            `1. Kanda kuri uyu murongo wa web scanner.\n` +
            `2. Fotora amapaji y'ibizamini cyangwa rubric.\n` +
            `3. Inyandiko zizahita zoherezwa muri iyi chat za Telegram!\n\n` +
            `⏱️ *Uyu murongo uraza kurangira mu minota 30.*`
          : `📸 **Bwenge Mobile Web Scanner**\n\n` +
            `Use our mobile web scanner for enhanced document capture, auto-cropping, and high-volume uploads (>20MB).\n\n` +
            `🔗 **[Open Mobile Web Scanner](${scanUrl})**\n\n` +
            `💡 *How to use*:\n` +
            `1. Tap the link above to open camera capture in browser.\n` +
            `2. Scan student answer sheets or marking rubrics.\n` +
            `3. Scanned pages auto-sync directly into this Telegram chat session!\n\n` +
            `⏱️ *This link expires in 30 minutes.*`;

        await botService.sendMessage(chatId, msg);
        break;
      }

      case '/research': {
        if (!arg) {
          await botService.sendMessage(chatId, '⚠️ Please specify topic to research. Example: `/research Latest developments in AI grading`');
          return;
        }
        await botService.sendChatAction(chatId, 'typing');
        await botService.sendMessage(chatId, `🌐 Initiating Deep Research for: *${arg}*...`);

        try {
          const report = await aiService.runDeepResearch({
            query: arg,
            userId: chatId,
            onEvent: (event) => {
              if (event.type === 'text' && event.data.isThinking) {
                botService.sendChatAction(chatId, 'typing').catch(() => {});
              }
            },
          });
          await botService.sendMessage(chatId, `📑 **Deep Research Report**:\n\n${stripThinkingTags(report as any).slice(0, 3800)}`);
        } catch (err: any) {
          await botService.sendMessage(chatId, `❌ Research failed: ${err.message}`);
        }
        break;
      }

      default: {
        await botService.sendMessage(chatId, `Unknown command \`${cmd}\`. Use /help to view available commands.`);
      }
    }
  } catch (err: any) {
    logger.error(`Error handling bot command "${text}" for chat ${chatId}:`, err);
    const lang = session?.language || 'en';
    const errorMsg = lang === 'rw'
      ? '❌ Habaye ikibazo mu gikorwa wakoze. Ongera ugerageze cyangwa wandike /help.'
      : '❌ Sorry, something went wrong processing this command. Please try again or type /help.';
    await botService.sendMessage(chatId, errorMsg).catch(() => {});
  }
}

async function handleFormCreationStep2(chatId: string, session: any, intentText: string) {
  await prisma.telegramSession.update({
    where: { chatId },
    data: { stagedMode: null },
  });

  const lang = session.language;
  await botService.sendChatAction(chatId, 'typing');
  await botService.sendMessage(chatId, lang === 'rw'
    ? `📝 **Bwenge Form Builder**: Birimo gukora ifomu kuri: *${intentText}*...`
    : `📝 **Bwenge Form Builder**: Generating application form schema for: *${intentText}*...`);

  try {
    const formOrchestrator = FormOrchestrator.getInstance();
    const form = await formOrchestrator.generateFormSchema(session.userId || `telegram-${chatId}`, intentText);

    const baseUrl = process.env.APP_BASE_URL || 'http://localhost:3000';
    const formUrl = `${baseUrl}/forms/${form.id}`;

    const msg = lang === 'rw'
      ? `🎉 **Ifomu Yarakozwe Neza!**\n\n` +
        `📋 **Umutwe**: ${form.title || intentText}\n` +
        `📱 **Kusaba binyuze kuri USSD**: \`*182*8*1#\`\n` +
        `🔗 **Umurongo wa Web**: ${formUrl}\n\n` +
        `💡 Usangize abasaba iyi link cyangwa ikode ya USSD.`
      : `🎉 **Application Form Created!**\n\n` +
        `📋 **Title**: ${form.title || intentText}\n` +
        `📱 **USSD Application Shortcode**: \`*182*8*1#\`\n` +
        `🔗 **Shareable Web Link**: ${formUrl}\n\n` +
        `💡 Share this public web link or USSD code with applicants!`;

    await botService.sendMessage(chatId, msg);
  } catch (err: any) {
    await botService.sendMessage(chatId, `❌ ${lang === 'rw' ? 'Kurema ifomu byanze' : 'Form creation failed'}: ${err.message}`);
  }
}

async function handleDiscussQuery(chatId: string, session: any, queryText: string) {
  const jobId = session.activeDiscussJobId;
  const results = await prisma.batchJobResult.findMany({
    where: { jobId },
    take: 10,
  });

  let contextData: string;
  if (results.length === 0) {
    const job = await prisma.batchJob.findUnique({ where: { id: jobId } });
    contextData = job?.summary
      ? `[NOTE: no per-student question-level breakdown is stored for this job — it was likely a single-photo grading, not a batch. Only summary is available.]\nSUMMARY: ${job.summary}`
      : '[NOTE: no stored details found for this job.]';
  } else {
    contextData = results.map(r =>
      `[STUDENT ${r.studentId || 'Anonymous'}]: Score ${r.totalScore}/${r.maxScore}. Details: ${r.gradedQuestions}`
    ).join('\n');
  }

  const contextPrompt = `DISCUSS SESSION FOR GRADED BATCH JOB ${jobId}:\n${contextData}\n\nUSER FOLLOW-UP QUESTION: ${queryText}`;
  await handleConversationalQuery(chatId, session, contextPrompt);
}

async function handleQuotaCommand(chatId: string, session: any) {
  const userId = session.userId || `telegram-${chatId}`;
  const subscription = await prisma.subscription.findUnique({ where: { userId } });
  const quotas = await prisma.usageQuota.findMany({ where: { userId } });

  const planType = subscription?.planType || 'FREE';
  const gradingQuota = quotas.find(q => q.service === 'grading');

  const msg = session.language === 'rw'
    ? `📊 **Uburyo Bwo Ukoresha & Quota**\n` +
      `- Plan: *${planType}*\n` +
      `- Ibizamini Bikoreshejwe: *${gradingQuota?.freeUsed || 0}*\n` +
      `- Status: *${subscription?.status || 'Active Trial'}*\n\n` +
      `Koresha /status kugira ngo urebe gukosora kuri batch zakoze.`
    : `📊 **Usage Quota & Subscription Plan**\n` +
      `- Plan Tier: *${planType}*\n` +
      `- Free Grading Used: *${gradingQuota?.freeUsed || 0}*\n` +
      `- Account Status: *${subscription?.status || 'Active Trial'}*\n\n` +
      `Use /status to view recent batch grading job history.`;

  await botService.sendMessage(chatId, msg, { reply_markup: buildTelegramKeyboard(session.language) });
}

async function handleIncomingDocument(chatId: string, session: any, doc: any) {
  const fileId = doc.file_id;
  const fileName = doc.file_name || 'document.pdf';
  const lang = session.language;

  await botService.sendMessage(chatId, lang === 'rw'
    ? `📥 Yakiriwe: \`${fileName}\`. Birimo kugenzurwa...`
    : `📥 Received document: \`${fileName}\`. Processing...`);

  if (fileName.toLowerCase().includes('rubric') || fileName.toLowerCase().includes('key')) {
    await prisma.telegramSession.update({
      where: { chatId },
      data: { stagedRubricFileId: fileId, stagedRubricName: fileName, stagedRubricLocalPath: null },
    });
  } else {
    await prisma.telegramSession.update({
      where: { chatId },
      data: { stagedPaperFileId: fileId, stagedPaperName: fileName, stagedPaperLocalPath: null },
    });
  }
  await checkAndTriggerBatchGrading(chatId);
}

async function handleIncomingVoiceNote(chatId: string, session: any, fileId: string) {
  void session;
  void fileId;
  await botService.sendMessage(chatId, 'I can handle typed requests through GonkaRouter, but voice transcription is not available in this bot yet. Please type your request.');
}

async function handleIncomingPhoto(chatId: string, session: any, fileId: string, caption?: string) {
  const isMarkPhoto = session.stagedMode === 'markphoto' ||
    caption?.toLowerCase().startsWith('/markphoto') ||
    caption?.toLowerCase().includes('mark photo') ||
    caption?.toLowerCase().includes('grade photo') ||
    /\b(grade|mark|evaluate|correct|kosora)\b/i.test(caption || '');

  if (isMarkPhoto) {
    if (!(await ensurePaywallAccess(chatId, session, 'grading'))) return;

    await botService.sendChatAction(chatId, 'typing');
    await botService.sendMessage(chatId, '👁️ *Analyzing handwritten student answer page...*');

    const photoFile = await botService.downloadTelegramFile(fileId);
    if (!photoFile) {
      const baseUrl = process.env.APP_BASE_URL || 'http://localhost:3000';
      await botService.sendMessage(chatId, `❌ Failed to download photo from Telegram. Try uploading via Web Scanner: ${baseUrl}/scan.html?chatId=${chatId}`);
      return;
    }

    const qualityService = DocumentQualityService.getInstance();
    const qualityCheck = await qualityService.prepareScannedPage(photoFile.buffer, 'image/jpeg');

    if (!qualityCheck.ok) {
      await botService.sendMessage(chatId,
        `⚠️ **Image Quality Gate Rejected**\n\n` +
        `Reason: ${qualityCheck.reason}\n\n` +
        `💡 Please retake the photo in good lighting, holding the camera steady and parallel to the paper.`
      );
      return;
    }

    const processedBuffer = qualityCheck.correctedBuffer || photoFile.buffer;
    const rubricContext = session.stagedRubricText || caption || '';

    const prompt = `You are an expert Academic Evaluator. Grade this single student's handwritten answer sheet. ${
      rubricContext ? `Rubric/Context: ${rubricContext}.` : ''
    } Provide: 1) Full Student Transcription, 2) Total Score vs Max Score, 3) Per-criterion Score Breakdown, 4) Explicit Confidence Rating (high/medium/low) with any ambiguous text flagged.`;

    try {
      const evaluation = await aiService.analyzeImage({
        base64: processedBuffer.toString('base64'),
        mediaType: 'image/jpeg',
        question: prompt,
      });

      const job = await prisma.batchJob.create({
        data: {
          userId: session.userId || `telegram-${chatId}`,
          telegramChatId: chatId,
          paperType: 'single',
          status: 'DONE',
          detectedCount: 1,
          summary: evaluation.slice(0, 500),
        },
      });

      await prisma.telegramSession.update({
        where: { chatId },
        data: { stagedMode: null },
      });

      await botService.sendMessage(chatId, `🎯 **Single-Script Vision Grading Result (Job \`${job.id.slice(0, 8)}\`)**:\n\n${evaluation}`);
    } catch (err: any) {
      await botService.sendMessage(chatId, `❌ Single-script vision grading failed: ${err.message}`);
    }
    return;
  }

  const lang = session.language;
  await botService.sendMessage(chatId, lang === 'rw' ? '📥 Ifoto ya rubric yakiriwe...' : '📥 Received rubric photo...');

  await prisma.telegramSession.update({
    where: { chatId },
    data: { stagedRubricFileId: fileId, stagedRubricName: 'rubric_photo.jpg', stagedRubricLocalPath: null },
  });

  await checkAndTriggerBatchGrading(chatId);
}

async function checkAndTriggerBatchGrading(chatId: string) {
  const session = await prisma.telegramSession.findUnique({ where: { chatId } });
  if (!session) return;

  const {
    stagedPaperFileId, stagedPaperLocalPath, stagedPaperName,
    stagedRubricFileId, stagedRubricLocalPath, stagedRubricName,
    language,
  } = session;

  const hasPaper = !!(stagedPaperFileId || stagedPaperLocalPath);
  const hasRubric = !!(stagedRubricFileId || stagedRubricLocalPath);

  if (!hasPaper || !hasRubric) {
    const msg = language === 'rw'
      ? `📌 **Status**:\n- Exam Papers: ${hasPaper ? '✅ Loaded' : '❌ Missing (Send PDF)'}\n- Rubric: ${hasRubric ? '✅ Loaded' : '❌ Missing (Send Photo/PDF)'}`
      : `📌 **Status**:\n- Exam Papers: ${hasPaper ? '✅ Loaded' : '❌ Missing (Send PDF)'}\n- Rubric: ${hasRubric ? '✅ Loaded' : '❌ Missing (Send Photo/PDF)'}`;

    await botService.sendMessage(chatId, msg, { reply_markup: buildTelegramKeyboard(language) });
    return;
  }

  if (!(await ensurePaywallAccess(chatId, session, 'grading'))) return;

  const claim = await prisma.telegramSession.updateMany({
    where: {
      chatId,
      AND: [
        { OR: [{ stagedPaperFileId: { not: null } }, { stagedPaperLocalPath: { not: null } }] },
        { OR: [{ stagedRubricFileId: { not: null } }, { stagedRubricLocalPath: { not: null } }] },
      ],
    },
    data: {
      stagedPaperFileId: null,
      stagedPaperLocalPath: null,
      stagedRubricFileId: null,
      stagedRubricLocalPath: null,
    },
  });

  if (claim.count !== 1) {
    logger.info(`Staging claim skipped for chat ${chatId} - already claimed by concurrent process.`);
    return;
  }

  await botService.sendMessage(chatId, language === 'rw'
    ? `✨ Imashini irimo gukora ibizamini mumpapuro no kuri rubric...`
    : `✨ Staged files complete! Downloading documents and initiating batch grading...`);

  const papersFile = await resolveStagedBuffer(stagedPaperFileId, stagedPaperLocalPath);
  const rubricFile = await resolveStagedBuffer(stagedRubricFileId, stagedRubricLocalPath);

  await cleanupLocalScanFile(stagedPaperLocalPath);
  await cleanupLocalScanFile(stagedRubricLocalPath);

  const baseUrl = process.env.APP_BASE_URL || 'http://localhost:3000';

  if (!papersFile || !rubricFile) {
    await botService.sendMessage(chatId,
      `❌ Failed to load staged files (Telegram downloads are capped at 20MB).\n\n` +
      `🔗 Please use our Bwenge Web Scanner for large batch uploads:\n${baseUrl}/scan.html?chatId=${chatId}`
    );
    return;
  }

  const rubricIsPdf = rubricFile.buffer.subarray(0, 5).toString() === '%PDF-';
  const papersIsPdf = papersFile.buffer.subarray(0, 5).toString() === '%PDF-';
  const paperMimeType = papersIsPdf
    ? 'application/pdf'
    : (/\.png$/i.test(stagedPaperName || '') ? 'image/png' : (/\.webp$/i.test(stagedPaperName || '') ? 'image/webp' : 'image/jpeg'));
  let rubricBuffer = rubricFile.buffer;
  const rubricMimeType = rubricIsPdf
    ? 'application/pdf'
    : (/\.png$/i.test(stagedRubricName || '') ? 'image/png' : (/\.webp$/i.test(stagedRubricName || '') ? 'image/webp' : 'image/jpeg'));
  if (!rubricIsPdf) {
    const qualityService = DocumentQualityService.getInstance();
    const rubricCheck = await qualityService.prepareScannedPage(rubricFile.buffer, rubricMimeType);
    if (!rubricCheck.ok) {
      await botService.sendMessage(chatId, `⚠️ **Rubric Image Rejected**: ${rubricCheck.reason}. Please re-upload a clear rubric photo.`);
      return;
    }
    rubricBuffer = rubricCheck.correctedBuffer || rubricFile.buffer;
  }

  let estimatedCount = 800;
  try {
    const pdfParser = new PDFParse({ data: papersFile.buffer as Uint8Array });
    const parsed = await pdfParser.getText();
    estimatedCount = Math.max(1, Math.round((parsed.text || '').length / 800) || 800);
  } catch (err) {
    logger.warn('Failed to parse PDF page count for Telegram batch, defaulting to 800', err);
  }

  const job = await prisma.batchJob.create({
    data: {
      userId: session.userId || `telegram-${chatId}`,
      telegramChatId: chatId,
      paperType: 'mcq',
      status: 'PROCESSING',
      detectedCount: estimatedCount,
    },
  });

  (async () => {
    try {
      const highVolumeService = HighVolumeBatchService.getInstance();
      const gradedResults = await highVolumeService.processBatch({
        paperType: 'mcq',
        papersBuffer: papersFile.buffer,
        paperMimeType,
        rubricBuffer,
        rubricMimeType,
        estimatedStudentCount: estimatedCount,
      });

      for (const res of gradedResults) {
        await prisma.batchJobResult.create({
          data: {
            jobId: job.id,
            studentId: res.studentId || null,
            studentName: res.studentName || null,
            totalScore: res.totalAwardedScore,
            maxScore: res.maxPossibleScore,
            gradedQuestions: JSON.stringify(res.gradedQuestions),
            confidence: res.identityConfidence,
          },
        });
      }

      const excelBuffer = await generateBatchExcelReportFromGradedResults('AutoMark Telegram Batch', gradedResults);
      const filename = `automark-results-${job.id}.xlsx`;

      const exportsDir = path.join(process.cwd(), 'exports');
      await fs.mkdir(exportsDir, { recursive: true });
      const excelFilePath = path.join(exportsDir, filename);
      await fs.writeFile(excelFilePath, excelBuffer);

      const excelUrl = `${baseUrl}/exports/${filename}`;

      await prisma.batchJob.update({
        where: { id: job.id },
        data: {
          status: 'DONE',
          detectedCount: gradedResults.length,
          excelUrl,
          summary: JSON.stringify({ totalPapers: gradedResults.length }),
        },
      });

      const lowConfidenceCount = gradedResults.filter(r => r.identityConfidence === 'low' || r.identityConfidence === 'unknown').length;
      const failingCount = gradedResults.filter(r => r.maxPossibleScore > 0 && (r.totalAwardedScore / r.maxPossibleScore) < 0.5).length;

      const completionMsg = `🎉 **Batch Grading Complete!**\n\n` +
        `📊 Total Scripts Graded: **${gradedResults.length}**\n` +
        `⚠️ Flagged for Review (Low Confidence/Unverified ID): **${lowConfidenceCount}**\n` +
        `📉 Scoring Below Pass Threshold (<50%): **${failingCount}**\n\n` +
        `📥 Download Excel report below for detailed question-by-question problem breakdowns:`;

      await botService.sendMessage(chatId, completionMsg);
      await botService.sendDocument(chatId, excelBuffer, filename, `📊 Results Excel Report (${gradedResults.length} students)`);
    } catch (err: any) {
      logger.error(`Telegram batch job ${job.id} failed:`, err);
      await prisma.batchJob.update({
        where: { id: job.id },
        data: { status: 'FAILED', errorMessage: err.message },
      });
      await botService.sendMessage(chatId, `❌ Batch grading failed: ${err.message}`);
    }
  })();
}

async function handleGradeCommand(chatId: string, session: any) {
  const lang = session.language;
  const msg = lang === 'rw'
    ? `📥 **Gahunda y'Ibizamini**:\n1. Ohereza PDF y'ibizamini\n2. Ohereza ifoto cyangwa PDF ya rubric/ipaki y'ibisubizo\n\nAI irahita ikora batch kugihe!`
    : `📥 **Batch Grading Guide**:\n1. Upload the exam papers PDF file\n2. Upload the rubric image/PDF\n\nAI will automatically trigger high-volume grading and send you the Excel report!`;

  await botService.sendMessage(chatId, msg, { reply_markup: buildTelegramKeyboard(lang) });
}

async function handleStatusCommand(chatId: string, session: any) {
  const jobs = await prisma.batchJob.findMany({
    where: { telegramChatId: chatId },
    orderBy: { createdAt: 'desc' },
    take: 3,
  });

  let msg = `📊 **Telegram Bot Status**\n- Provider: *${session.provider.toUpperCase()}*\n- Language: *${session.language}*\n\n`;
  if (jobs.length === 0) {
    msg += `No active or recent batch jobs.`;
  } else {
    msg += `**Recent Batch Jobs**:\n`;
    for (const j of jobs) {
      msg += `- Job \`${j.id.slice(0, 8)}\`: *${j.status}* (${j.detectedCount || 0} scripts)\n`;
    }
  }

  await botService.sendMessage(chatId, msg, { reply_markup: buildTelegramKeyboard(session.language) });
}

/**
 * Conversational Q&A Handler with Real-Time Token Editing.
 *
 * Routes on session.provider (the field the /model command actually
 * writes to — NOT a "preferredModel" field, which does not exist
 * anywhere in this schema). Two paths:
 *
 * 1. session.provider === 'gonkarouter' (and GONKA_API_KEY configured):
 *    routes through aiService.runGonkaAgentLoop, using the same
 *    buildPromptForIntent routing + classifyIntent the web chat route
 *    uses, with reasoning tags stripped both mid-stream and on the final
 *    message, and recent per-chat turn history included for multi-turn
 *    context.
 * 2. Everything else: falls back to the existing Claude-based
 *    generalAssist path (unchanged from before), with stripThinkingTags
 *    applied defensively before any message is sent — cheap insurance in
 *    case a future model swap on that path also emits reasoning tags.
 *
 * NOTE (pre-existing, not introduced here): before this change, this
 * handler ALWAYS used the Claude path regardless of session.provider —
 * a teacher who ran /model nvidianim still got Claude-generated
 * conversational replies. This fix only wires up the Gonka branch
 * explicitly; gemini/nvidianim conversational routing parity is a
 * separate, pre-existing gap worth its own follow-up.
 */
async function handleConversationalQuery(chatId: string, session: any, userQuery: string) {
  await botService.sendChatAction(chatId, 'typing');

  const lang = session.language || 'en';
  const thinkingMsg = lang === 'rw' ? '✨ *Bwenge AI irimo gutekereza...*' : '✨ *Bwenge AI is thinking...*';
  const initialMsg = await botService.sendMessage(chatId, thinkingMsg);
  if (!initialMsg) return;

  const initialMsgId = initialMsg.message_id;
  const userId = session.userId || `telegram-${chatId}`;
  const selectedProvider = String(session.provider || 'gemini').toLowerCase();
  // Existing Telegram sessions may retain a legacy provider value. If this
  // deployment has Gonka configured, route conversational traffic through it.
  const useGonka = Boolean(process.env.GONKA_API_KEY) || process.env.AI_PROVIDER === 'gonkarouter';

  let accumulatedText = '';
  let lastEditTime = Date.now();

  const assistantSystemPrompt = `You are Bwenge AI Assistant, a friendly, creative, and highly capable AI assistant for teachers, students, and institutions on Telegram.
You MUST respond strictly in ${lang === 'rw' ? 'Kinyarwanda (Ururimi rw\'Ikinyarwanda)' : 'English'}.
When the user asks you to perform an action in ordinary language, do it with the matching Telegram action tool instead of only telling them which slash command to type. Use the grading, exam, form, research, scanner, status, quota, discussion, and language tools when appropriate. If required information or files are missing, ask a short follow-up or let the tool request the missing upload.
Even if the user sends nonsense, gibberish, off-topic, or random text, ALWAYS respond politely, maintain a helpful persona, and guide them back to Bwenge AI capabilities:
- Batch grading student papers (/grade)
- Mobile web document scanner (/scan)
- Online form creation (Web & USSD *182*8*1#) (/form)
- Exam paper and marking rubric generation (/exam)
- Deep research briefing (/research)
Offer actionable next steps and invite them to run commands or upload documents!`;

  try {
    if (useGonka) {
      const intent = await classifyIntent(userQuery, false);
      const { system, prompt } = buildPromptForIntent(intent, userQuery, { hydratedContext: assistantSystemPrompt });
      const history = getHistory(chatId);

      await aiService.runGonkaAgentLoop({
        prompt,
        system,
        history,
        tools: [...generalTools, ...telegramActionTools],
        executeTool: (name, input) => executeBotConversationalTool(chatId, userId, name, input),
        onEvent: async (event) => {
          if (event.type === 'text') {
            if (event.data.replaceFullText) {
              accumulatedText = event.data.text || '';
            } else {
              accumulatedText += event.data.text || '';
            }
            const now = Date.now();
            if (now - lastEditTime > 1500 && accumulatedText.trim().length > 0) {
              lastEditTime = now;
              await botService.editMessageText(chatId, initialMsgId, accumulatedText.slice(0, 4000));
            }
          } else if (event.type === 'tool_call') {
            accumulatedText += `\n> 🛠️ *Executing tool*: \`${event.data.name}\`...\n`;
            const now = Date.now();
            if (now - lastEditTime > 1500) {
              lastEditTime = now;
              await botService.editMessageText(chatId, initialMsgId, accumulatedText.slice(0, 4000));
            }
          }
        },
      });

      const finalText = stripThinkingTags(accumulatedText);
      if (finalText.trim().length > 0) {
        await botService.editMessageText(chatId, initialMsgId, finalText.slice(0, 4000));
      }

      appendHistory(chatId, 'user', userQuery);
      appendHistory(chatId, 'assistant', String(finalText));
      return;
    }

    // Route each supported Telegram model to its matching provider.
    if (selectedProvider === 'gemini') {
      const stream = await aiService.streamGeminiContent({
        contents: [{ role: 'user', parts: [{ text: `${assistantSystemPrompt}\n\nUSER MESSAGE: ${userQuery}` }] }],
      });
      for await (const chunk of stream as any) {
        accumulatedText += chunk.text || '';
        const now = Date.now();
        if (now - lastEditTime > 1500 && accumulatedText.trim()) {
          lastEditTime = now;
          await botService.editMessageText(chatId, initialMsgId, accumulatedText.slice(0, 4000));
        }
      }
    } else if (selectedProvider === 'nvidianim') {
      await aiService.streamNvidiaNimChat(userQuery, {
        system: assistantSystemPrompt,
        onToken: (token: string) => {
          accumulatedText += token;
          const now = Date.now();
          if (now - lastEditTime > 1500 && accumulatedText.trim()) {
            lastEditTime = now;
            void botService.editMessageText(chatId, initialMsgId, accumulatedText.slice(0, 4000));
          }
        },
      });
    } else if (selectedProvider === 'ollama') {
      const baseUrl = (process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/$/, '');
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: process.env.OLLAMA_MODEL || 'qwen2.5:3b', stream: false,
          messages: [
            { role: 'system', content: assistantSystemPrompt },
            { role: 'user', content: userQuery },
          ],
        }),
      });
      if (!response.ok) throw new Error(`Ollama request failed (${response.status}).`);
      const data: any = await response.json();
      accumulatedText = data.message?.content || '';
    } else {
      if (!(await aiService.providerAvailable('anthropic'))) {
        throw new Error(`Provider "${selectedProvider}" is not configured for Telegram chat.`);
      }
    await aiService.generalAssist({
      userId: chatId,
      messages: [
        { role: 'user', content: `${assistantSystemPrompt}\n\nUSER MESSAGE: ${userQuery}` }
      ],
      tools: generalTools,
      onEvent: async (event) => {
        if (event.type === 'text') {
          accumulatedText += event.data.text || '';
          const now = Date.now();
          if (now - lastEditTime > 1500 && accumulatedText.trim().length > 0) {
            lastEditTime = now;
            await botService.editMessageText(chatId, initialMsgId, stripThinkingTags(accumulatedText).slice(0, 4000));
          }
        } else if (event.type === 'tool_call') {
          accumulatedText += `\n> 🛠️ *Executing tool*: \`${event.data.name}\`...\n`;
          const now = Date.now();
          if (now - lastEditTime > 1500) {
            lastEditTime = now;
            await botService.editMessageText(chatId, initialMsgId, stripThinkingTags(accumulatedText).slice(0, 4000));
          }
        }
      },
    });
    }

    const finalText = stripThinkingTags(accumulatedText);
    if (finalText.trim().length > 0) {
      await botService.editMessageText(chatId, initialMsgId, finalText.slice(0, 4000));
    } else {
      const fallbackGuidedText = lang === 'rw'
        ? `👋 Muraho! Ndi **Bwenge AI Assistant**.\n\nNshobora kugufasha gukora ibizamini, gukosora, kurema ifomu, gukora scanner, cyangwa gukora ubushakashatsi.\n\nAndika /help cyangwa koresha icyo ushaka mu buryo bwa menu!`
        : `👋 Hello! I am **Bwenge AI Assistant**.\n\nI can help you grade exams, scan documents, create application forms, generate exam papers, or conduct research.\n\nType /help or select an option from the menu below!`;
      await botService.editMessageText(chatId, initialMsgId, fallbackGuidedText);
    }

    appendHistory(chatId, 'user', userQuery);
    appendHistory(chatId, 'assistant', String(finalText));
  } catch (err: any) {
    logger.error('Telegram conversational AI error:', err);
    const errorGuide = lang === 'rw'
      ? `👋 **Bwenge AI Assistant**\n\nUmbabarire, habaye akabazo mu gutunganya ubutumwa bwawe. Nshobora kugufasha binyuze mu gukoresha amakomande:\n- /scan (Mobile Scanner)\n- /form (Ifomu y'ubusabe)\n- /exam (Kora Igizamini)\n- /grade (Kosora Ibizamini)`
      : `👋 **Bwenge AI Assistant**\n\nI apologize, I encountered a minor issue processing that message. How can I assist you today?\n- /scan (Mobile Scanner)\n- /form (Create Application Form)\n- /exam (Generate Exam & Rubric)\n- /grade (Batch Grading)`;
    await botService.editMessageText(chatId, initialMsgId, errorGuide).catch(() => {});
  }
}

export default router;
