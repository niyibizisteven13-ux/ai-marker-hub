import { prisma } from '../../db.js';
import logger from '../../utils/logger.js';
import type { AttachmentRef } from '../ai/types.js';
import type { FileStore } from '../ai/files/FileStore.js';
import { describeToolCall, summarizeToolResult } from '../../../src/utils/toolSteps.js';
import type { TelegramApi } from './api.js';
import { esc, markdownToMessages, caption as fitCaption } from './format.js';
import { answerKeyboard, card, errorCard, fmtSize, langOf, progressCard, retryKeyboard, type Lang, type StepView } from './ui.js';
import { copy } from './uiText.js';
import { checkUsage } from '../billing/usage.js';

/**
 * One Telegram turn through the same assistant as the web chat: exam marking first (as on the web), then
 * generalAssist with the full toolkit (charts, Excel/Word/PowerPoint/PDF, statistics, knowledge search…).
 * A single progress message is edited live with the tool steps and then becomes the answer; files the
 * assistant created arrive as native photos (charts) and documents (everything else).
 */

export interface IncomingFile { name: string; mime: string; data: Buffer }
type Turn = { role: 'user' | 'assistant'; text: string };

export interface BridgeDeps {
  api: TelegramApi;
  fileStore: FileStore;
  assist: (o: { userId: string; learning?: import('../learning/modes.js').LearningSettings; messages: Array<{ role: 'user' | 'assistant'; content: string }>; files?: Array<{ type: 'image' | 'document'; base64: string; mediaType: string; name?: string }>; planText: string; onEvent: (e: any) => void; signal?: AbortSignal }) => Promise<{ content: Array<{ text: string }>; attachments?: AttachmentRef[] }>;
  exam?: (userId: string, text: string, files: Array<{ name: string; buffer: Buffer; mime?: string }>, onStatus: (t: string) => void) => Promise<{ text: string; attachments: AttachmentRef[] } | null>;
  editIntervalMs?: number;
}

let defaultDeps: Promise<BridgeDeps> | null = null;
async function loadDefaultDeps(api: TelegramApi): Promise<BridgeDeps> {
  const [{ AiService, fileStore }, runtime] = await Promise.all([import('../AiService.js'), import('../educationRuntime.js')]);
  const ai = AiService.getInstance();
  return {
    api, fileStore,
    assist: (o) => ai.generalAssist({ ...o, channel: 'telegram' } as any) as any,
    exam: async (userId, text, files, onStatus) => runtime.examChat.handle(userId, text, files, { onStatus }),
  };
}
export const bridgeDeps = (api: TelegramApi) => (defaultDeps ??= loadDefaultDeps(api));
/** Tests inject their own dependencies. */
export function setBridgeDeps(deps: BridgeDeps | null) { defaultDeps = deps ? Promise.resolve(deps) : null; }

const HISTORY_TURNS = 12;
const busy = new Map<string, number>();

const VISUAL = new Set(['chart', 'diagram', 'drawing', 'image']);
function fileLabel(a: Pick<AttachmentRef, 'mime' | 'kind'>): { icon: string; label: string } {
  const m = a.mime.split(';')[0];
  if (m === 'text/html') return { icon: '📰', label: 'Interactive report (open in a browser)' };
  if (/spreadsheetml|ms-excel/.test(m)) return { icon: '📗', label: 'Excel workbook' };
  if (/presentationml/.test(m)) return { icon: '📙', label: 'PowerPoint deck' };
  if (/wordprocessingml/.test(m)) return { icon: '📘', label: 'Word document' };
  if (m === 'application/pdf') return { icon: '📕', label: 'PDF' };
  if (a.kind === 'chart') return { icon: '📊', label: 'Chart' };
  if (a.kind === 'diagram') return { icon: '🧭', label: 'Diagram' };
  if (a.kind === 'archive') return { icon: '🗜️', label: 'ZIP archive' };
  if (a.kind === 'model3d') return { icon: '🧊', label: 'Interactive 3D model · open in a browser' };
  return { icon: '📄', label: 'File' };
}

/** Sends one created file natively: charts and images as photos (PNG preview), everything else as a document. */
export async function deliverAttachment(deps: Pick<BridgeDeps, 'api' | 'fileStore'>, chatId: string, userId: string, a: AttachmentRef): Promise<boolean> {
  const { icon, label } = fileLabel(a);
  const title = a.name.replace(/\.[a-z0-9]{2,5}$/i, '');
  const cap = fitCaption(`${icon} <b>${esc(title)}</b>\n<i>${label} · ${fmtSize(a.size)}</i>`);
  try {
    if (VISUAL.has(a.kind) && (a.previewId || /^image\/(png|jpeg)$/.test(a.mime))) {
      const img = a.previewId ? await deps.fileStore.read(a.previewId, userId) : await deps.fileStore.read(a.id, userId);
      await deps.api.chatAction(chatId, 'upload_photo');
      await deps.api.sendPhoto(chatId, { data: img.data, name: `${title}.png` }, cap);
      return true;
    }
    const { meta, data } = await deps.fileStore.read(a.id, userId);
    if (a.kind === 'model3d') {
      // Telegram cannot show 3D: send a self-contained viewer page that opens in the phone's browser.
      const [{ validateScene }, { sceneHtml }] = await Promise.all([import('../../../src/lib/scene/spec.js'), import('../spatial/sceneHtml.js')]);
      const html = sceneHtml(validateScene(JSON.parse(data.toString('utf8'))));
      await deps.api.chatAction(chatId, 'upload_document');
      await deps.api.sendDocument(chatId, { data: Buffer.from(html, 'utf8'), name: `${title.replace(/\.scene$/i, '')}.html`, mime: 'text/html' }, cap);
      return true;
    }
    await deps.api.chatAction(chatId, 'upload_document');
    await deps.api.sendDocument(chatId, { data, name: meta.name, mime: meta.mime.split(';')[0] }, cap);
    return true;
  } catch (e) {
    logger.warn('[telegram] file delivery failed', { errorType: (e as Error)?.name, kind: a.kind });
    return false;
  }
}

function historyOf(session: any): Turn[] {
  return Array.isArray(session?.history) ? (session.history as Turn[]).filter((t) => t && (t.role === 'user' || t.role === 'assistant') && typeof t.text === 'string').slice(-HISTORY_TURNS) : [];
}

export interface TurnInput { chatId: string; session: any; text: string; files?: IncomingFile[]; replyTo?: number }

export async function runAssistantTurn(input: TurnInput, depsOverride?: BridgeDeps): Promise<{ text: string; attachments: number } | null> {
  const { chatId, session } = input;
  const lang: Lang = langOf(session.language);
  const t = copy(lang);
  const deps = depsOverride ?? await bridgeDeps((await import('./api.js')).telegramApi());
  const { api } = deps;

  // One turn per chat at a time; a second message while busy gets a short note instead of a parallel run.
  const started = busy.get(chatId);
  if (started && Date.now() - started < 10 * 60_000) {
    await api.sendMessage(chatId, card('⏳', t.working, esc(t.slowDown)), { replyTo: input.replyTo, silent: true });
    return null;
  }
  const userId: string = session.userId;

  // Plan limits (daily / weekly / monthly credits, per-feature caps), the same as on the web.
  const visual = (input.files ?? []).some((f) => /^image\/|application\/pdf/.test(f.mime));
  const gate = userId ? await checkUsage(userId, { kind: visual ? 'vision' : 'chat', chars: input.text.length, attachments: input.files?.length ?? 0 }).catch(() => null) : null;
  if (gate && !gate.allowed) {
    const base = (process.env.APP_BASE_URL || 'https://www.bwenge.space').replace(/\/$/, '');
    await api.sendMessage(chatId, card('⏳', lang === 'rw' ? 'Wageze ku rugero' : lang === 'fr' ? 'Limite atteinte' : 'Limit reached', esc(gate.message ?? '')), {
      replyTo: input.replyTo,
      keyboard: { inline_keyboard: [[...(gate.upgrade ? [{ text: lang === 'rw' ? '⭐ Zamura konti' : lang === 'fr' ? '⭐ Passer à PRO' : '⭐ Upgrade', url: `${base}${gate.upgrade.url}` }] : []), { text: t.buttons.menu, callback_data: 'm:home' }]] },
    });
    return null;
  }
  busy.set(chatId, Date.now());

  const steps: Array<StepView & { id: string; name: string }> = [];
  let text = '';
  const attachments: AttachmentRef[] = [];
  const t0 = Date.now();
  let lastEdit = 0;
  let pending: NodeJS.Timeout | null = null;
  const interval = deps.editIntervalMs ?? 1200;

  const progress = await api.sendMessage(chatId, progressCard(lang, [], 0), { replyTo: input.replyTo, silent: true });
  const typing = setInterval(() => void api.chatAction(chatId, 'typing'), 4500);
  void api.chatAction(chatId, 'typing');

  const render = () => {
    const preview = text.trim() ? `\n\n${esc(text.replace(/<\/?[a-z][^>]*>/gi, '').slice(-700))}` : '';
    return progressCard(lang, steps, Math.round((Date.now() - t0) / 1000)) + preview;
  };
  const flush = async () => {
    pending = null;
    lastEdit = Date.now();
    await api.editMessage(chatId, progress.message_id, render()).catch(() => undefined);
  };
  const schedule = () => {
    if (pending) return;
    const wait = Math.max(0, interval - (Date.now() - lastEdit));
    pending = setTimeout(() => void flush(), wait);
  };

  const onEvent = (e: any) => {
    if (e.type === 'text' && !e.data?.isThinking) { text += e.data?.text ?? ''; schedule(); }
    else if (e.type === 'turn_reset') { text = ''; schedule(); }
    else if (e.type === 'tool_call') {
      steps.push({ id: e.data.id, name: e.data.name, label: describeToolCall(e.data.name, e.data.input), status: 'running' });
      schedule();
    } else if (e.type === 'tool_result') {
      const s = steps.find((x) => x.id === e.data.id) ?? steps.find((x) => x.name === e.data.name && x.status === 'running');
      if (s) { s.status = e.data.isError ? 'error' : 'done'; s.detail = summarizeToolResult(e.data.output, !!e.data.isError); }
      schedule();
    } else if (e.type === 'attachment' && e.data?.id && !attachments.some((a) => a.id === e.data.id)) attachments.push(e.data);
  };

  try {
    const files = input.files ?? [];
    // Exam marking through chat first, exactly like the web chat.
    const exam = deps.exam ? await deps.exam(userId, input.text, files.map((f) => ({ name: f.name, buffer: f.data, mime: f.mime })), (status) => {
      const last = steps.at(-1);
      if (last?.status === 'running') last.status = 'done';
      steps.push({ id: `exam-${steps.length}`, name: 'exam', label: status, status: 'running' });
      schedule();
    }).catch((e) => { logger.warn('[telegram] exam chat failed', { errorType: (e as Error)?.name }); return null; }) : null;

    let answer: string;
    if (exam) {
      for (const s of steps) if (s.status === 'running') s.status = 'done';
      answer = exam.text;
      for (const a of exam.attachments) if (!attachments.some((x) => x.id === a.id)) attachments.push(a);
    } else {
      const { parseLearning } = await import('../learning/modes.js');
      const r = await deps.assist({
        userId,
        learning: parseLearning(session?.learning),
        messages: [...historyOf(session).map((h) => ({ role: h.role, content: h.text })), { role: 'user' as const, content: input.text }],
        files: files.map((f) => ({ type: f.mime.startsWith('image/') ? 'image' as const : 'document' as const, base64: f.data.toString('base64'), mediaType: f.mime, name: f.name })),
        planText: input.text,
        onEvent,
      });
      answer = r.content?.[0]?.text ?? '';
      for (const a of r.attachments ?? []) if (!attachments.some((x) => x.id === a.id)) attachments.push(a);
    }

    if (pending) { clearTimeout(pending); pending = null; }
    clearInterval(typing);

    // The progress message becomes the answer; long answers continue in follow-up messages.
    const body = answer.trim() || (attachments.length ? `${t.readyCaption} ✨` : t.errorBody);
    const chunks = markdownToMessages(body);
    const footer = attachments.length ? `\n\n<i>📎 ${attachments.length === 1 ? '1 file' : `${attachments.length} files`} below</i>` : '';
    const keyboard = answerKeyboard(lang, attachments.length > 0);
    if (chunks.length === 1) await api.editMessage(chatId, progress.message_id, chunks[0] + footer, keyboard);
    else {
      await api.editMessage(chatId, progress.message_id, chunks[0]);
      for (const [i, c] of chunks.slice(1).entries()) await api.sendMessage(chatId, i === chunks.length - 2 ? c + footer : c, i === chunks.length - 2 ? { keyboard } : {});
    }
    let delivered = 0;
    for (const a of attachments) if (await deliverAttachment(deps, chatId, userId, a)) delivered++;
    if (delivered < attachments.length) await api.sendMessage(chatId, card('⚠️', t.errorTitle, esc(t.fileMissing)));

    const history = [...historyOf(session), { role: 'user' as const, text: input.text.slice(0, 4000) }, { role: 'assistant' as const, text: body.slice(0, 4000) }].slice(-HISTORY_TURNS);
    await prisma.telegramSession.update({ where: { chatId }, data: { history, lastPrompt: input.text.slice(0, 4000), lastActiveAt: new Date() } }).catch(() => undefined);
    return { text: body, attachments: delivered };
  } catch (e) {
    if (pending) clearTimeout(pending);
    clearInterval(typing);
    logger.error('[telegram] assistant turn failed', { errorType: (e as Error)?.name, code: (e as any)?.code ?? (e as any)?.category });
    await api.editMessage(chatId, progress.message_id, errorCard(lang), retryKeyboard(lang)).catch(() => undefined);
    await prisma.telegramSession.update({ where: { chatId }, data: { lastPrompt: input.text.slice(0, 4000) } }).catch(() => undefined);
    return null;
  } finally {
    busy.delete(chatId);
  }
}
