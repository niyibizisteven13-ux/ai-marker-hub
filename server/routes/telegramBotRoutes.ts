import { Router, Request, Response } from 'express';
import { prisma } from '../db.js';
import { TelegramBotService } from '../services/TelegramBotService.js';
import { AiService } from '../services/AiService.js';
import { HighVolumeBatchService } from '../services/HighVolumeBatchService.js';
import { FormOrchestrator } from '../services/FormOrchestrator.js';
import { DocumentQualityService } from '../services/DocumentQualityService.js';
import { PaywallService } from '../services/PaywallService.js';
import { upload } from '../middleware/upload.js';
import { generateBatchExcelReportFromGradedResults } from '../../src/services/excelExporter.ts';
import { stripThinkingTags } from '../utils/textSanitizers.js';
import logger from '../utils/logger.js';
import { consumeTelegramLink } from '../services/telegramLinkStore.js';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { PDFParse } from 'pdf-parse';
import fs from 'fs/promises';
import path from 'path';
import { getTelegramTranscriber } from '../services/educationRuntime.js';
import { deliverScan, handleUpdate as handleTelegramUpdate, showScan, type LegacyHooks } from '../services/telegram/router.js';
import { telegramApi } from '../services/telegram/api.js';
import { mergePlaceholderAccount } from '../services/billing/accounts.js';
import { resolveScanToken, verifyInitData } from '../services/telegram/scanSession.js';
import { runAssistantTurn } from '../services/telegram/agentBridge.js';

const router = Router();
const botService = TelegramBotService.getInstance();
// Async handwriting/scan transcription (/api/documents pipeline): submit a job, notify when it settles.
const transcriber = getTelegramTranscriber(botService);
const wantsTranscription = (session: any, caption?: string) => session?.stagedMode === 'transcribe' || /^\/(transcribe|soma)\b/i.test(caption?.trim() ?? '');

async function startTranscription(chatId: string, session: any, fileId: string, fileName: string) {
  if (session?.stagedMode === 'transcribe') await prisma.telegramSession.update({ where: { chatId }, data: { stagedMode: null } });
  await transcriber.submit(chatId, session?.userId, { fileId, fileName }, session?.language);
}
const aiService = AiService.getInstance();
const paywallService = PaywallService.getInstance();

// Where locally-uploaded (web-scanner) files land before being picked up
// by checkAndTriggerBatchGrading, alongside Telegram-native uploads.
const SCAN_UPLOADS_DIR = path.join(process.cwd(), 'uploads', 'telegram-scans');


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
 * Tool executor for conversational bot chat (Gonka path). Deliberately
 * covers only the tools that make sense in a text-only Telegram
 * conversation — build_form, generate_visual_annotation,
 * cross_reference_visuals, and generate_browser_extension from
 * server.ts's fuller tool set either need a UI surface or an attached
 * image this handler doesn't have, and are left unhandled with an
 * explicit message rather than silently pretending to support them.
 */

async function getTelegramSession(chatId: string) {
  const session = await prisma.telegramSession.findUnique({ where: { chatId } });
  if (!session) throw new Error('Telegram session not found.');
  return session;
}


/**
 * Scanner uploads (scanner.html). The sender is identified by Telegram Mini App initData (header
 * X-Telegram-Init-Data) or by the token in a /scan link. A token stays valid for 30 minutes, so one scan
 * session can send a PDF per student. During /grade batch mode the file is staged for grading as before;
 * otherwise it arrives in the chat as a PDF with quick actions.
 */
router.post(['/scan-upload', '/scan-upload/:sessionToken'], upload.single('file'), async (req: Request, res: Response) => {
  try {
    const chatId = resolveScanToken(req.params.sessionToken) ?? verifyInitData(req.get('x-telegram-init-data'));
    if (!chatId) {
      return res.status(401).json({ error: 'This scan session has expired. Open the scanner again from Telegram.' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    const session = await prisma.telegramSession.findUnique({ where: { chatId } });
    if (!session) {
      return res.status(404).json({ error: 'Start the Bwenge bot in Telegram first.' });
    }

    const qualityService = DocumentQualityService.getInstance();
    const qualityCheck = await qualityService.prepareScannedPage(req.file.buffer, req.file.mimetype);

    if (!qualityCheck.ok) {
      return res.status(400).json({ error: qualityCheck.reason || 'Image quality gate rejected file.' });
    }

    const filename = (path.basename(req.file.originalname || 'scan.pdf').replace(/[^\p{L}\p{N} ._()-]/gu, '').trim().slice(0, 80)) || 'scan.pdf';
    const data = qualityCheck.correctedBuffer || req.file.buffer;

    if (session.stagedMode !== 'batch') {
      if (req.file.mimetype !== 'application/pdf') return res.status(415).json({ error: 'The scanner sends PDF files.' });
      let pages = 1;
      const parser = new PDFParse({ data: new Uint8Array(data) });
      try { pages = (await parser.getInfo()).total || 1; } catch { /* label only */ } finally { await parser.destroy().catch(() => undefined); }
      await deliverScan(chatId, session, data, /\.pdf$/i.test(filename) ? filename : `${filename}.pdf`, pages);
      return res.json({ success: true, pages });
    }

    await fs.mkdir(SCAN_UPLOADS_DIR, { recursive: true });
    const isRubric = /rubric|key|scheme|bar[eè]me/i.test(filename);
    const safeExt = path.extname(filename).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 10) || '.jpg';
    const storedPath = path.join(SCAN_UPLOADS_DIR, `${isRubric ? 'rubric' : 'paper'}-${chatId}-${crypto.randomUUID()}${safeExt}`);

    await fs.writeFile(storedPath, data);

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
      logger.error('Post-scan-upload grading trigger failed.', { errorType: err instanceof Error ? err.name : 'Error' });
    });

    res.json({ success: true, staged: isRubric ? 'rubric' : 'paper' });
  } catch (err: any) {
    logger.error('Web scanner upload failed', err);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Scan upload failed. Please retry.' : err.message });
  }
});

function buildTelegramKeyboard(lang: string = 'en') {
  const scanLabel = lang === 'rw' ? '📸 Scan (Urugero)' : '📸 Scan Documents';
  const agentLabel = lang === 'rw' ? '🤖 Agent (Ibizamini/Form)' : '🤖 Run Agent';
  const chatLabel = lang === 'rw' ? '💬 Ganira na AI' : '💬 AI Chat';
  const helpLabel = lang === 'rw' ? '❓ Ubufasha' : '❓ Help';

  return {
    keyboard: [
      [{ text: scanLabel }, { text: agentLabel }],
      [{ text: chatLabel }, { text: helpLabel }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

/** Map plain-language requests onto the same handlers as slash commands. */
async function handleNaturalLanguageAction(chatId: string, session: any, message: string, opts: { assistantFirst?: boolean } = {}): Promise<boolean> {
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

  // With the assistant first, exam papers and research go to the full assistant (real Word/PDF files, sources).
  if (!opts.assistantFirst && /\b(exam|test|quiz|ikizamini)\b/i.test(lower) && /\b(create|make|generate|write|prepare|need|want|kora|tegura)\b/i.test(lower)) {
    const genericRequest = /^(please\s+)?(create|make|generate|write|prepare|i need|i want|kora|tegura)\s+(an?\s+)?(exam|test|quiz|ikizamini)(\s+please)?[.!?]*$/i.test(text);
    await handleBotCommand(chatId, session, genericRequest ? '/exam' : `/exam ${text}`);
    return true;
  }

  if (!opts.assistantFirst && /\b(research|investigate|look\s+up|find\s+(the\s+)?latest|deep\s+search|ubushakashatsi|shakashaka)\b/i.test(lower)) {
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

/**
 * The assistant router (server/services/telegram/router.ts) handles every update; the bot-specific
 * features that live in this file are reached through these hooks.
 */
const legacyHooks: LegacyHooks = {
  async session(chatId, from) {
    let session = await prisma.telegramSession.findUnique({ where: { chatId } });
    if (!session) {
      const code = String(from?.language_code ?? '').slice(0, 2);
      session = await prisma.telegramSession.create({
        data: { chatId, provider: process.env.GONKA_API_KEY ? 'gonkarouter' : 'gemini', language: code === 'rw' || code === 'fr' ? code : 'en' },
      });
    }
    session = await ensureTelegramUser(chatId, session);
    try {
      await prisma.usageQuota.upsert({
        where: { userId_service: { userId: session.userId, service: 'grading' } },
        create: { userId: session.userId, service: 'grading', freeUsed: 0 },
        update: {},
      });
    } catch (e) {
      logger.warn('Failed to initialize Telegram grading quota:', e);
    }
    if (process.env.GONKA_API_KEY && session.provider !== 'gonkarouter') {
      session = await prisma.telegramSession.update({ where: { chatId }, data: { provider: 'gonkarouter' } });
    }
    return session;
  },

  async link(chatId, session, text) {
    const linkCode = text.match(/^\/(?:start|link)(?:@\w+)?\s+(?:link_)?([A-Za-z0-9_-]{20,64})$/i)?.[1];
    if (!linkCode) return false;
    const linkedUserId = consumeTelegramLink(linkCode);
    if (!linkedUserId) {
      await botService.sendMessage(chatId, 'This account link has expired or was already used. Generate a new link from Settings → Connections.');
      return true;
    }
    const existingLinkedUser = session.userId && session.userId !== linkedUserId
      ? await prisma.user.findUnique({ where: { id: session.userId }, select: { email: true } })
      : null;
    const isUnclaimedTelegramAccount = existingLinkedUser?.email.endsWith('@users.invalid') ?? false;
    if (session.userId && session.userId !== linkedUserId && !isUnclaimedTelegramAccount) {
      await botService.sendMessage(chatId, 'This Telegram chat is already linked to another Bwenge account. Disconnect it there before linking a different account.');
      return true;
    }
    // One account: usage, GO credits, memories, payments and files from the Telegram-only account move over.
    if (session.userId && isUnclaimedTelegramAccount) await mergePlaceholderAccount(session.userId, linkedUserId);
    await prisma.telegramSession.update({ where: { chatId }, data: { userId: linkedUserId } });
    await botService.sendMessage(chatId, '✅ Telegram is now securely linked to your Bwenge account. Your plan, credits, memory and files are the same here and on the web. Send /start for the menu.');
    return true;
  },

  command: (chatId, session, text) => handleBotCommand(chatId, session, text),
  naturalAction: (chatId, session, text) => handleNaturalLanguageAction(chatId, session, text, { assistantFirst: true }),

  async modeText(chatId, session, text) {
    if (session.activeDiscussJobId) { await handleDiscussQuery(chatId, session, text); return true; }
    if (session.stagedMode === 'form') { await handleFormCreationStep2(chatId, session, text); return true; }
    return false;
  },

  async modeFile(chatId, session, files, caption) {
    if (wantsTranscription(session, caption)) {
      for (const f of files) await startTranscription(chatId, session, f.fileId, f.name);
      return true;
    }
    const markPhoto = session.stagedMode === 'markphoto' || /^\/markphoto\b/i.test(caption);
    if (session.stagedMode === 'batch' || markPhoto) {
      for (const f of files) {
        if (f.isPhoto) await handleIncomingPhoto(chatId, session, f.fileId, caption || (markPhoto ? '/markphoto' : undefined));
        else await handleIncomingDocument(chatId, session, { file_id: f.fileId, file_name: f.name });
      }
      return true;
    }
    return false;
  },

  transcribe: (chatId, session, fileId, name) => startTranscription(chatId, session, fileId, name),
};

router.post('/webhook', verifyTelegramSecret, async (req: Request, res: Response) => {
  // Acknowledge at once: Telegram redelivers slow updates, and the router drops duplicates by update_id.
  res.status(200).json({ ok: true });
  try {
    if (!req.body || typeof req.body !== 'object') return;
    await handleTelegramUpdate(req.body, legacyHooks);
  } catch (err: any) {
    logger.error('Error handling Telegram Webhook update:', { errorType: err?.name });
  }
});

async function handleBotCommand(chatId: string, session: any, text: string) {
  try {
    const parts = text.trim().split(/\s+/);
    // Telegram appends @BotName to commands sent in group chats.
    const cmd = parts[0].split('@')[0].toLowerCase();
    const arg = parts.slice(1).join(' ');

    switch (cmd) {
      case '/start': {
        const lang = session.language;
        const userId = session.userId || `telegram-${chatId}`;
        const quota = await prisma.usageQuota.findUnique({
          where: { userId_service: { userId, service: 'grading' } },
        });
        const freeRemaining = Math.max(0, 20 - (quota?.freeUsed || 0));

        const welcome = lang === 'rw'
          ? `👋 **Muraho neza! Ndi Bwengebot - Your grading companion.**\n\n` +
            `🎁 **Ibizamini by'Asuba**: *${freeRemaining} free credits*\n\n` +
            `📌 **Commands 5 z'ingenzi**:\n` +
            `- 📸 **/scan** - Fungura mobile web scanner y'impapuro\n` +
            `- 🤖 **/agent** - Koresha AI Agent (Gukosora, Kora Ifomu, Igizamini, Ubushakashatsi)\n` +
            `- 💬 **/chat** - Ganira na Bwenge AI Assistant\n` +
            `- ❓ **/help** - Reba ubufasha bwuzuye\n` +
            `- 🚀 **/start** - Menya aho uherereye`
          : `👋 **Welcome to Bwengebot — Your grading companion!**\n\n` +
            `🎁 **Free Credits**: *${freeRemaining} remaining*\n\n` +
            `📌 **Available Commands**:\n` +
            `- 📸 **/scan** - Open mobile web document scanner\n` +
            `- 🤖 **/agent** - Run AI agent tasks (Batch grading, Form builder, Exam generator, Research)\n` +
            `- 💬 **/chat** - Chat with Bwenge AI Assistant\n` +
            `- ❓ **/help** - Show instructions & documentation\n` +
            `- 🚀 **/start** - Main menu`;

        await botService.sendMessage(chatId, welcome, {
          reply_markup: buildTelegramKeyboard(lang),
        });
        break;
      }

      case '/transcribe':
      case '/soma': {
        await prisma.telegramSession.update({ where: { chatId }, data: { stagedMode: 'transcribe' } });
        await botService.sendMessage(chatId, session.language === 'rw'
          ? '📝 Ohereza ifoto cyangwa PDF y\'inyandiko yanditse n\'intoki. Nzayisoma, nkwereke ibice bishidikanywaho, maze nkumenyeshe birangiye.'
          : '📝 Send a photo or PDF of the handwritten or scanned page. I will transcribe it, mark anything uncertain, and message you when it is ready.');
        break;
      }

      case '/help': {
        const lang = session.language;
        const helpText = lang === 'rw'
          ? `📖 **Ubufasha bwa Bwengebot**\n\n` +
            `1️⃣ **/scan**\nFungura link ya mobile scanner kugira ngo ufashe amapaji y'ibizamini n'ubunini bwiza.\n\n` +
            `2️⃣ **/agent**\nKoresha agent mu bikorwa:\n` +
            `- \`/agent grade\` (Gukosora ibizamini)\n` +
            `- \`/agent exam [isomo]\` (Kora igizamini na rubric)\n` +
            `- \`/agent form [intego]\` (Kora ifomu na USSD *182*8*1#)\n` +
            `- \`/agent research [icyo ushakashaka]\` (Ubushakashatsi)\n\n` +
            `3️⃣ **/chat**\nGanira na AI cyangwa ubaze ikibazo cyose ukeneye.\n\n` +
            `4️⃣ **/start**\nGarura menu nyamukuru.`
          : `📖 **Bwengebot Help Guide**\n\n` +
            `1️⃣ **/scan**\nOpens mobile web document scanner for student answer papers or rubrics.\n\n` +
            `2️⃣ **/agent**\nExecutes Bwenge AI agent services:\n` +
            `- \`/agent grade\` (Batch grade exam scripts)\n` +
            `- \`/agent exam [topic]\` (Generate exam & rubric)\n` +
            `- \`/agent form [purpose]\` (Create assessment form & USSD)\n` +
            `- \`/agent research [query]\` (Deep academic research)\n\n` +
            `3️⃣ **/chat**\nEngage in open conversational AI chat with Bwenge AI Assistant.\n\n` +
            `4️⃣ **/start**\nDisplay main menu and quick buttons.`;

        await botService.sendMessage(chatId, helpText, { reply_markup: buildTelegramKeyboard(lang) });
        break;
      }

      case '/scan': {
        await showScan(telegramApi(), chatId, session);
        break;
      }

      case '/agent': {
        const subArg = arg.trim();
        const subParts = subArg.split(/\s+/);
        const subCmd = subParts[0]?.toLowerCase();
        const subQuery = subParts.slice(1).join(' ');

        if (!subCmd) {
          await botService.sendMessage(chatId,
            `🤖 **Bwenge AI Agent**\n\nChoose an agent capability:\n` +
            `- \`/agent grade\` - Batch grade exams against rubric\n` +
            `- \`/agent exam [topic]\` - Generate exam & rubric\n` +
            `- \`/agent form [purpose]\` - Create form & USSD shortcode\n` +
            `- \`/agent research [query]\` - Deep web research\n\n` +
            `Example: \`/agent exam Physics Newton Laws 30\``
          );
          break;
        }

        if (subCmd === 'grade') {
          const existing = await prisma.telegramSession.findUnique({ where: { chatId } });
          const hasPaper = !!(existing?.stagedPaperFileId || existing?.stagedPaperLocalPath);
          const hasRubric = !!(existing?.stagedRubricFileId || existing?.stagedRubricLocalPath);
          if (hasPaper && hasRubric) {
            await checkAndTriggerBatchGrading(chatId);
          } else {
            await handleGradeCommand(chatId, session);
          }
        } else if (subCmd === 'exam') {
          await handleBotCommand(chatId, session, `/exam ${subQuery}`);
        } else if (subCmd === 'form') {
          await handleBotCommand(chatId, session, `/form ${subQuery}`);
        } else if (subCmd === 'research') {
          await handleBotCommand(chatId, session, `/research ${subQuery}`);
        } else {
          await botService.sendMessage(chatId, `Unknown agent subcommand \`${subCmd}\`. Use \`/agent grade\`, \`/agent exam\`, \`/agent form\`, or \`/agent research\`.`);
        }
        break;
      }

      case '/chat': {
        await runAssistantTurn({ chatId, session, text: arg.trim() || 'What can you do?' });
        break;
      }

      // Backward-compatible internal aliases
      case '/exam': {
        if (!(await ensurePaywallAccess(chatId, session, 'grading'))) return;
        const lang = session.language;
        if (!arg || arg.trim().length === 0) {
          await botService.sendMessage(chatId, lang === 'rw' ? '⚠️ Nyamuneka andika isomo. Urugero: `/agent exam Physics 30`' : '⚠️ Please specify topic. Example: `/agent exam Physics 30`');
          return;
        }
        await botService.sendChatAction(chatId, 'typing');
        await botService.sendMessage(chatId, `📝 Generating exam paper and marking rubric for: *${arg}*...`);
        try {
          const prompt = `You are a World-Class Assessment Architect. Generate a complete exam paper with matching rubric for: ${arg}. Respond in ${lang === 'rw' ? 'Kinyarwanda' : 'English'}.`;
          const result = await aiService.sendGonkaChat(prompt, { system: 'Generate complete, accurate assessment materials.' });
          await botService.sendMessage(chatId, `✨ **Exam Paper & Rubric Generated**:\n\n${result.slice(0, 3800)}`);
        } catch (err: any) {
          await botService.sendMessage(chatId, `❌ Exam generation failed: ${err.message}`);
        }
        break;
      }

      case '/form': {
        if (!(await ensurePaywallAccess(chatId, session, 'selection_scoring'))) return;
        if (arg && arg.trim().length > 0) {
          await handleFormCreationStep2(chatId, session, arg.trim());
        } else {
          await prisma.telegramSession.update({ where: { chatId }, data: { stagedMode: 'form' } });
          await botService.sendMessage(chatId, '📝 Please type the title or purpose of the application/assessment form you want to create.');
        }
        break;
      }

      case '/research': {
        if (!arg) {
          await botService.sendMessage(chatId, '⚠️ Please specify topic to research. Example: `/agent research AI in education`');
          return;
        }
        await botService.sendChatAction(chatId, 'typing');
        await botService.sendMessage(chatId, `🌐 Initiating Deep Research for: *${arg}*...`);
        try {
          const report = await aiService.runDeepResearch({ query: arg, userId: chatId });
          await botService.sendMessage(chatId, `📑 **Deep Research Report**:\n\n${stripThinkingTags(report as any).slice(0, 3800)}`);
        } catch (err: any) {
          await botService.sendMessage(chatId, `❌ Research failed: ${err.message}`);
        }
        break;
      }

      case '/grade': {
        const existing = await prisma.telegramSession.findUnique({ where: { chatId } });
        const hasPaper = !!(existing?.stagedPaperFileId || existing?.stagedPaperLocalPath);
        const hasRubric = !!(existing?.stagedRubricFileId || existing?.stagedRubricLocalPath);
        if (hasPaper && hasRubric) await checkAndTriggerBatchGrading(chatId);
        else await handleGradeCommand(chatId, session);
        break;
      }

      case '/model':
      case '/kinyarwanda':
      case '/english':
      case '/status':
      case '/quota': {
        await botService.sendMessage(chatId, `Command \`${cmd}\` executed.`);
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

      default: {
        await botService.sendMessage(chatId, `Unknown command \`${cmd}\`. Use /help to view available commands: /start, /scan, /agent, /help, /chat.`);
      }
    }
  } catch (err: any) {
    logger.error('Error handling Telegram bot command.', err);
    await botService.sendMessage(chatId, '❌ Sorry, something went wrong processing this command. Please try again or type /help.').catch(() => {});
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
  await runAssistantTurn({ chatId, session, text: contextPrompt });
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
      stagedMode: null, // batch mode ends once grading starts; later files go to the assistant again
    },
  });

  if (claim.count !== 1) {
    logger.info('Telegram staging claim skipped because another process already claimed it.');
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
  // Uploads are staged as papers / rubric only while this batch-grading mode is on.
  await prisma.telegramSession.update({ where: { chatId }, data: { stagedMode: 'batch' } });
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


export default router;
