import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { TelegramBotService } from '../services/TelegramBotService.js';
import { AiService } from '../services/AiService.js';
import { HighVolumeBatchService } from '../services/HighVolumeBatchService.js';
import { FormOrchestrator } from '../services/FormOrchestrator.js';
import { DocumentQualityService } from '../services/DocumentQualityService.js';
import { PaywallService } from '../services/PaywallService.js';
import { upload } from '../middleware/upload.js';
import { generalTools } from '../services/generalTools.js';
import { generateBatchExcelReportFromGradedResults } from '../../src/services/excelExporter.ts';
import logger from '../utils/logger.js';
import crypto from 'crypto';
import { PDFParse } from 'pdf-parse';
import fs from 'fs/promises';
import path from 'path';

const router = Router();
const prisma = new PrismaClient();
const botService = TelegramBotService.getInstance();
const aiService = AiService.getInstance();
const paywallService = PaywallService.getInstance();

// Scan Tokens for /scan signed single-use URLs.
// NOTE: same caveat as contextCache/batchJobs elsewhere in this codebase —
// in-memory only, so it won't survive multi-instance deploys or a restart
// mid-session. Swap for a Prisma table or Redis before scaling out.
const scanTokens = new Map<string, { chatId: string; expires: number }>();

// Without a sweep, a token that's generated and never redeemed (teacher
// opens /scan, then abandons it) stays in memory forever. Same pattern as
// the contextCache sweep in server.ts.
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

/**
 * Secret token middleware verifying incoming Telegram webhooks.
 */
function verifyTelegramSecret(req: Request, res: Response, next: () => void) {
  const secret = process.env.TELEGRAM_BOT_SECRET_TOKEN;
  if (!secret) return next(); // Skip verification if not configured

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
 * NOTE: 'general_assist' and 'research' are passed through here as
 * distinct service keys, separate from 'grading' — this fixes the
 * previous version, which billed every conversational chat message and
 * /research call against the same 'grading' credit pool a teacher was
 * shown as "20 free papers." VERIFY these two keys are recognized by
 * PaywallService.checkAccess before deploying: if they are not, either
 * add policy for them there, or map them to whatever bucket the product
 * intends free-form chat to draw from (server.ts's web chat route
 * skips the paywall entirely for its 'general' service — confirm
 * whether the bot should match that, rather than silently inventing a
 * new paid bucket here).
 */
async function ensurePaywallAccess(
  chatId: string,
  session: any,
  service: 'grading' | 'selection_scoring' | 'farming_advice' | 'general_assist' | 'research' = 'grading'
): Promise<boolean> {
  const userId = session.userId || `telegram-${chatId}`;
  const jobId = crypto.randomUUID();

  const access = await paywallService.checkAccess(userId, service as any, jobId);
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
 * Reads the bytes for a staged file regardless of where it came from —
 * a Telegram file_id (bot-native upload) or a local path (web-scanner
 * upload). This is the piece that was missing before: the web scanner
 * quality-checked and staged a *name* but never gave
 * checkAndTriggerBatchGrading anything it could actually download, so
 * scanned batches silently went nowhere. Both paths now resolve to the
 * same buffer shape.
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

/**
 * Deletes a locally-staged scan file after it's been read into memory,
 * so /scan uploads don't accumulate on disk indefinitely.
 */
async function cleanupLocalScanFile(localPath: string | null | undefined) {
  if (!localPath) return;
  try {
    await fs.unlink(localPath);
  } catch (err: any) {
    logger.warn(`Failed to clean up local scan file ${localPath}`, err.message);
  }
}

/**
 * Web Scanner Signed Upload Endpoint.
 *
 * FIX: previously this only recorded the uploaded file's *name* on the
 * session and never gave checkAndTriggerBatchGrading a way to actually
 * fetch the bytes — a file uploaded here was quality-checked and then
 * silently discarded, so /scan never triggered grading. This now
 * persists the corrected buffer to disk, stages a local path (the
 * Telegram-upload equivalent of stagedPaperFileId/stagedRubricFileId),
 * and explicitly triggers the same grading check both upload paths share.
 *
 * SCHEMA NOTE: this requires two additive columns on TelegramSession —
 * `stagedPaperLocalPath` and `stagedRubricLocalPath` (both nullable
 * String) — alongside the existing stagedPaperFileId/stagedRubricFileId.
 * Add the migration before deploying this route.
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

    // This is the call that was missing before — without it, a web-scanned
    // file just sat staged forever with nothing checking whether its pair
    // had also arrived.
    checkAndTriggerBatchGrading(chatId).catch((err) => {
      logger.error(`Post-scan-upload grading trigger failed for chat ${chatId}`, err);
    });

    res.json({ success: true, message: 'File processed and staged successfully.' });
  } catch (err: any) {
    logger.error('Web scanner upload failed', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Build interactive reply keyboard markup.
 */
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

router.post('/webhook', verifyTelegramSecret, async (req: Request, res: Response) => {
  // Always respond 200 OK immediately to Telegram to prevent retry floods
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
          data: { chatId, provider: 'gemini', language: 'en' },
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
        // Previously unsupported types (video, sticker, location, etc.)
        // fell through here with zero reply — silent from the teacher's
        // point of view, indistinguishable from the bot being broken.
        await botService.sendMessage(chatId,
          session.language === 'rw'
            ? '🤔 Ntabwo nashoboye gusoma ubu bwoko bw\'ubutumwa. Ohereza inyandiko, ifoto, cyangwa PDF.'
            : "🤔 I can't process that type of message yet. Please send text, a photo, or a PDF/document."
        );
        return;
      }

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

/**
 * Command Handler
 */
async function handleBotCommand(chatId: string, session: any, text: string) {
  try {
    const parts = text.split(' ');
    const cmd = parts[0].toLowerCase();
    const arg = parts.slice(1).join(' ');

    switch (cmd) {
    case '/start':
    case '/help': {
      const lang = session.language;
      const welcome = lang === 'rw'
        ? `👋 Muraho neza! Ndi **Bwenge AI Bot**.\n\n` +
          `⚙️ **AI Provider**: *${session.provider.toUpperCase()}*\n` +
          `🗣️ **Ururimi**: *Kinyarwanda*\n\n` +
          `📌 **Ibyo nshobora gukora**:\n` +
          `- Kosora ibizamini by'abanyeshuri na rubric (Upload PDF/Photo)\n` +
          `- Kosora ifoto imwe y'umunyeshuri (/markphoto)\n` +
          `- Mbaza ku birimo ibizamini byakozwe (/discuss)\n` +
          `- Kora form y'ubusabe (/form)\n` +
          `- Reba quota yo gukosora (/quota)\n` +
          `- Kora ibizamini n'amanota (/exam)\n` +
          `- Ubushakashatsi bwitondewe (/research)\n` +
          `- Hindura AI (/model gemini/claude/nvidianim)\n` +
          `- Hindura ururimi (/english)`
        : `👋 Welcome to **Bwenge AI Assistant Bot**!\n\n` +
          `⚙️ **Active Model**: *${session.provider.toUpperCase()}*\n` +
          `🗣️ **Language**: *English*\n\n` +
          `📌 **Key Capabilities**:\n` +
          `- Batch grade exam papers against rubric (Upload PDF/Photo)\n` +
          `- Single-script handwritten photo grading (/markphoto)\n` +
          `- Post-grading Q&A & student performance analysis (/discuss)\n` +
          `- Check quota & plan details (/quota)\n` +
          `- Create online application/assessment forms (/form)\n` +
          `- Generate exam papers and marking rubrics (/exam)\n` +
          `- Perform Deep Web Research (/research)\n` +
          `- Voice Note speech queries (Send voice note)\n` +
          `- Switch AI Model (/model gemini/claude/nvidianim)\n` +
          `- Switch language (/kinyarwanda)`;

      await botService.sendMessage(chatId, welcome, {
        reply_markup: buildTelegramKeyboard(lang),
      });
      break;
    }

    case '/model': {
      const selected = arg.toLowerCase().trim();
      if (['gemini', 'claude', 'nvidianim', 'ollama'].includes(selected)) {
        await prisma.telegramSession.update({
          where: { chatId },
          data: { provider: selected },
        });
        await botService.sendMessage(chatId, `🚀 AI Provider switched to **${selected.toUpperCase()}**!`);
      } else {
        await botService.sendMessage(chatId,
          `🤖 **Current Provider**: *${session.provider.toUpperCase()}*\n\n` +
          `To switch providers, run:\n` +
          `- \`/model gemini\` (Google Gemini 2.0 Flash - Fast)\n` +
          `- \`/model claude\` (Anthropic Claude Sonnet - Deep Reasoning)\n` +
          `- \`/model nvidianim\` (NVIDIA NIM Llama 4 - High Throughput)`
        );
      }
      break;
    }

    case '/kinyarwanda': {
      await prisma.telegramSession.update({ where: { chatId }, data: { language: 'rw' } });
      await botService.sendMessage(chatId, '🇷🇼 Ururimi ruhinduwe mu Kinyarwanda', {
        reply_markup: buildTelegramKeyboard('rw'),
      });
      break;
    }

    case '/english': {
      await prisma.telegramSession.update({ where: { chatId }, data: { language: 'en' } });
      await botService.sendMessage(chatId, '🇬🇧 Language switched to English!', {
        reply_markup: buildTelegramKeyboard('en'),
      });
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
      // If both files are already staged (e.g. teacher hit a paywall
      // block last time and just topped up), re-trigger the check
      // directly instead of re-showing the generic instructions —
      // otherwise a denied-then-paid teacher has no way to resume
      // without re-uploading both files from scratch.
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

      if (!arg) {
        await botService.sendMessage(chatId, '⚠️ Please specify subject and topic. Example: `/exam Physics Newton_Laws 30`');
        return;
      }
      await botService.sendChatAction(chatId, 'typing');
      await botService.sendMessage(chatId, `📝 Generating exam paper for: *${arg}*...`);

      try {
        const prompt = `Generate an exam paper with rubrics for: ${arg}. Return clear structured sections for Questions and Rubrics.`;
        const result = await aiService.generateContent({ contents: prompt });
        await botService.sendMessage(chatId, `✨ **Exam Paper Generated**:\n\n${result.text?.slice(0, 3500)}`);
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

      if (arg) {
        await handleFormCreationStep2(chatId, session, arg);
      } else {
        await prisma.telegramSession.update({
          where: { chatId },
          data: { stagedMode: 'form' },
        });
        await botService.sendMessage(chatId, session.language === 'rw'
          ? '📝 **Form Builder**: Ohereza umutwe cyangwa intego y\'iyi form (urugero: `Scholarship Application Form`)'
          : '📝 **Form Builder**: Please type the title or purpose of this application form (e.g. `Scholarship Application Form`).');
      }
      break;
    }

    case '/scan': {
      const sessionToken = crypto.randomUUID().slice(0, 12);
      scanTokens.set(sessionToken, { chatId, expires: Date.now() + 30 * 60 * 1000 });

      const baseUrl = process.env.APP_BASE_URL || 'http://localhost:3000';
      const scanUrl = `${baseUrl}/scan.html?token=${sessionToken}`;

      await botService.sendMessage(chatId,
        `📸 **Bwenge Mobile Web Scanner**\n\n` +
        `Use our web scanner for enhanced document capture, contrast correction, or large file uploads (>20MB):\n\n` +
        `🔗 [Open Bwenge Web Scanner](${scanUrl})\n\n` +
        `⏱️ This link expires in 30 minutes.`
      );
      break;
    }

    case '/research': {
      if (!(await ensurePaywallAccess(chatId, session, 'grading'))) return;

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
        await botService.sendMessage(chatId, `📑 **Deep Research Report**:\n\n${report.slice(0, 3800)}`);
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

/**
 * Conversational Form Creation Step 2
 */
async function handleFormCreationStep2(chatId: string, session: any, intentText: string) {
  await prisma.telegramSession.update({
    where: { chatId },
    data: { stagedMode: null },
  });

  await botService.sendChatAction(chatId, 'typing');
  await botService.sendMessage(chatId, `📝 Generating application form schema for: *${intentText}*...`);

  try {
    const formOrchestrator = FormOrchestrator.getInstance();
    const form = await formOrchestrator.generateFormSchema(session.userId || `telegram-${chatId}`, intentText);

    const baseUrl = process.env.APP_BASE_URL || 'http://localhost:3000';
    const formUrl = `${baseUrl}/forms/${form.id}`;

    await botService.sendMessage(chatId,
      `🎉 **Application Form Created!**\n\n` +
      `📋 **Title**: ${form.title || intentText}\n` +
      `📱 **USSD Application Code**: \`*182*8*1#\`\n` +
      `🔗 **Shareable Web Link**: ${formUrl}\n\n` +
      `Pricing tier: $0.20 USD per scored application.`
    );
  } catch (err: any) {
    await botService.sendMessage(chatId, `❌ Form creation failed: ${err.message}`);
  }
}

/**
 * Post-Grading Discuss Queries.
 *
 * FIX: single-photo (/markphoto) jobs never write BatchJobResult rows —
 * only batch jobs do. Previously, /discuss on a markphoto job silently
 * sent an empty-context prompt to the model with no indication anything
 * was missing. Now it falls back to the job's stored summary text and
 * tells the teacher explicitly that no per-question breakdown exists for
 * this job type, rather than pretending it has detail it doesn't.
 */
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

/**
 * Quota & Subscription Command Handler.
 *
 * NOTE: this reads Prisma directly rather than through a PaywallService
 * method, which risks drifting from whatever logic actually gates access
 * in ensurePaywallAccess/paywallService.checkAccess. If PaywallService
 * exposes (or is given) a getUsageSummary()/getQuotaStatus()-style method,
 * prefer that here so this display can never disagree with what actually
 * blocks a request. Left as direct reads for now since that method's
 * existence/shape wasn't confirmed.
 */
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

/**
 * Handles incoming document uploads (PDF exam papers or rubrics)
 */
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

/**
 * Handles incoming Telegram voice notes (Speech-to-Text via Whisper API)
 */
async function handleIncomingVoiceNote(chatId: string, session: any, fileId: string) {
  await botService.sendChatAction(chatId, 'typing');
  await botService.sendMessage(chatId, '🎙️ *Transcribing voice note...*');

  const voiceFile = await botService.downloadTelegramFile(fileId);
  if (!voiceFile) {
    await botService.sendMessage(chatId, '❌ Failed to download voice note from Telegram.');
    return;
  }

  const transcription = await botService.transcribeVoiceAudio(voiceFile.buffer);
  if (!transcription) {
    await botService.sendMessage(chatId, '⚠️ Voice note transcription is unavailable. Ensure OPENAI_API_KEY is configured for Whisper STT, or type text.');
    return;
  }

  await botService.sendMessage(chatId, `🗣️ **Transcribed**: "${transcription}"`);
  await handleConversationalQuery(chatId, session, transcription);
}

/**
 * Handles incoming photo uploads (Rubric images or Single-Script Vision Grading)
 */
async function handleIncomingPhoto(chatId: string, session: any, fileId: string, caption?: string) {
  const isMarkPhoto = session.stagedMode === 'markphoto' ||
    caption?.toLowerCase().startsWith('/markphoto') ||
    caption?.toLowerCase().includes('mark photo') ||
    caption?.toLowerCase().includes('grade photo');

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

/**
 * Atomic Staging Claim & Batch Grading Trigger.
 *
 * Handles staged files from EITHER source — Telegram file_id or a local
 * path from the web scanner — so this is the single place both upload
 * paths converge, instead of the web scanner having its own dead-end
 * logic as before.
 *
 * FIX: paywall access is now checked BEFORE the atomic claim clears the
 * staged fields. Previously a denied teacher had both files silently
 * wiped and had to re-upload everything from scratch after topping up.
 * Now a denial leaves the staged files in place, and re-running /grade
 * (see the /grade case above) or sending /buy then retrying will pick
 * them back up.
 */
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

  // Paywall check happens BEFORE clearing staged fields — see fix note above.
  if (!(await ensurePaywallAccess(chatId, session, 'grading'))) return;

  // Atomic claim: verify both staged refs are still present (from either
  // source) and clear all four fields in one conditional update. If
  // another concurrent webhook already claimed them, claim.count will be
  // 0 and this invocation backs off instead of double-triggering.
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

  // Clean up any local scan files now that they're read into memory.
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

  const qualityService = DocumentQualityService.getInstance();
  const rubricCheck = await qualityService.prepareScannedPage(rubricFile.buffer, 'image/jpeg');

  if (!rubricCheck.ok) {
    await botService.sendMessage(chatId, `⚠️ **Rubric Image Rejected**: ${rubricCheck.reason}. Please re-upload a clear rubric photo.`);
    return;
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
        rubricBuffer: rubricFile.buffer,
        rubricMimeType: 'image/jpeg',
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
 * NOTE: previously gated behind ensurePaywallAccess(..., 'grading'),
 * meaning every ordinary chat message silently drew from the same
 * limited credit pool a teacher was told was "20 free papers." That gate
 * has been removed here to avoid draining grading credits on unrelated
 * chat, matching how server.ts's own web chat route skips the paywall
 * for its 'general' service. CONFIRM this is the intended product
 * behavior — if free-form bot chat should still be cost-limited, add a
 * lighter rate limiter (e.g. N messages/hour per chatId) here instead of
 * reinstating the grading-credit paywall.
 */
async function handleConversationalQuery(chatId: string, session: any, userQuery: string) {
  await botService.sendChatAction(chatId, 'typing');

  const initialMsg = await botService.sendMessage(chatId, '✨ *Thinking...*');
  if (!initialMsg) return;

  const initialMsgId = initialMsg.message_id;
  let accumulatedText = '';
  let lastEditTime = Date.now();

  try {
    await aiService.generalAssist({
      userId: chatId,
      messages: [{ role: 'user', content: userQuery }],
      tools: generalTools,
      onEvent: async (event) => {
        if (event.type === 'text') {
          accumulatedText += event.data.text || '';
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

    if (accumulatedText.trim().length > 0) {
      await botService.editMessageText(chatId, initialMsgId, accumulatedText.slice(0, 4000));
    }
  } catch (err: any) {
    logger.error('Telegram conversational AI error:', err);
    await botService.editMessageText(chatId, initialMsgId, `Sorry, an error occurred processing your request: ${err.message}`);
  }
}

export default router;