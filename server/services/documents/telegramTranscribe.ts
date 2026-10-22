import type { FileStore } from '../ai/files/FileStore.js';
import type { FileJob, FileJobQueue } from '../ai/jobs/fileJobQueue.js';
import { JobError } from '../ai/jobs/fileJobQueue.js';
import type { DocumentService } from './service.js';

/**
 * Telegram front end for the document pipeline. The webhook only downloads the file, submits a job
 * and replies with its id; a queue listener messages the chat when the job settles. The chat id is
 * stored in the persisted job payload, so a notification still arrives after a server restart.
 */

export interface TelegramTransport {
  sendMessage(chatId: string, text: string, options?: Record<string, unknown>): Promise<unknown>;
  downloadTelegramFile(fileId: string): Promise<{ buffer: Buffer; filePath: string } | null>;
}

const t = (lang: string | undefined, en: string, rw: string) => (lang === 'rw' ? rw : en);

export function createTelegramTranscriber(deps: { bot: TelegramTransport; documents: DocumentService; queue: FileJobQueue; fileStore: FileStore; baseUrl: string }) {
  /** Submits a Telegram photo/document for transcription. `userId` must be the linked Bwenge account. */
  async function submit(chatId: string, userId: string | null | undefined, file: { fileId: string; fileName: string }, language?: string): Promise<string | null> {
    if (!userId || userId.startsWith('telegram-')) {
      await deps.bot.sendMessage(chatId, t(language, 'Link this chat to your Bwenge account first (Settings → Telegram), then send the page again.', 'Banza uhuze iyi chat na konti yawe ya Bwenge (Settings → Telegram), hanyuma wongere wohereze ipaji.'));
      return null;
    }
    const downloaded = await deps.bot.downloadTelegramFile(file.fileId);
    if (!downloaded) {
      await deps.bot.sendMessage(chatId, t(language, 'I could not download that file from Telegram. Please send it again.', 'Sinashoboye gukura iyo dosiye kuri Telegram. Ongera uyohereze.'));
      return null;
    }
    const name = file.fileName || downloaded.filePath.split('/').pop() || 'page.jpg';
    try {
      const { job, duplicate } = await deps.documents.submit(userId, { originalname: name, buffer: downloaded.buffer }, {
        languageHint: language === 'rw' ? 'Kinyarwanda, English' : undefined, crossCheck: true, notifyTelegramChatId: chatId,
      });
      await deps.bot.sendMessage(chatId, duplicate
        ? t(language, `This file is already being processed (job ${job.id.slice(0, 8)}). I will message you when it is ready.`, `Iyi dosiye irimo gusomwa (job ${job.id.slice(0, 8)}). Nzakumenyesha birangiye.`)
        : t(language, `Reading your document (job ${job.id.slice(0, 8)}). I will message you when the transcription is ready; flagged parts will be marked for checking.`, `Ndimo gusoma inyandiko yawe (job ${job.id.slice(0, 8)}). Nzakumenyesha birangiye; ibice bishidikanywaho bizagaragazwa.`));
      return job.id;
    } catch (e) {
      const msg = e instanceof JobError ? e.message : t(language, 'The document could not be submitted. Try again later.', 'Inyandiko ntiyashoboye koherezwa. Ongera ugerageze nyuma.');
      await deps.bot.sendMessage(chatId, `❌ ${msg}`);
      return null;
    }
  }

  async function onSettled(job: FileJob) {
    if (job.type !== 'document.process') return;
    const chatId = (job.payload as { notifyTelegramChatId?: string })?.notifyTelegramChatId;
    if (!chatId) return;
    if (job.status === 'failed') {
      await deps.bot.sendMessage(chatId, `❌ ${job.error?.message ?? 'The document could not be processed.'}`);
      return;
    }
    if (job.status !== 'completed') return;
    const r = job.result as { documentId: string; reportFileId?: string; pages: number; needsReview: boolean };
    const rec = await deps.documents.get(job.ownerId, r.documentId);
    if (!rec) return;
    const flagged = rec.result.pages.reduce((a, p) => a + p.elements.filter((e) => e.needsReview).length, 0);
    const text = (await deps.documents.text(job.ownerId, r.documentId)) ?? '';
    const preview = text.length > 1200 ? `${text.slice(0, 1200)}…` : text;
    const link = r.reportFileId ? `${deps.baseUrl.replace(/\/$/, '')}${deps.fileStore.signedUrl(r.reportFileId, 24 * 60 * 60 * 1000)}` : null;
    await deps.bot.sendMessage(chatId, [
      `✅ Transcription ready: ${r.pages} page(s)${flagged ? `, ${flagged} part(s) flagged for checking` : ''}.`,
      '',
      preview,
      '',
      link ? `Full report with the flagged regions (link valid 24 h): ${link}` : '',
      flagged ? 'Flagged parts may be misread: compare them with your page before relying on them.' : '',
    ].filter((l, i, a) => l || a[i - 1]).join('\n'), { parse_mode: undefined });
  }

  return { submit, onSettled, register: () => deps.queue.onSettled(onSettled) };
}
