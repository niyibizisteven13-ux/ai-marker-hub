import { prisma } from '../../db.js';
import logger from '../../utils/logger.js';
import { telegramApi, type TelegramApi } from './api.js';
import { deliverAttachment, runAssistantTurn, type IncomingFile } from './agentBridge.js';
import { esc } from './format.js';
import {
  FILES_PER_PAGE, backKeyboard, card, filesCard, filesKeyboard, guideCard, homeCard, homeKeyboard, langOf, markCard, markKeyboard, scanCard, scanKeyboard, settingsCard, settingsKeyboard, type Lang, type PlanView,
} from './ui.js';
import type { InlineKeyboard } from './api.js';
import { copy } from './uiText.js';
import { bannerFileId, bannerPng, rememberBannerFileId } from './banner.js';
import { issueScanToken, markUrl, miniAppReady, scannerUrl } from './scanSession.js';

/**
 * Telegram update router for the assistant: home menu and inline navigation, settings, "My files", files
 * sent by the user (with quick actions), albums, group-chat etiquette, flood protection and duplicate
 * delivery protection. Features that live in the legacy route (batch grading, scanner, transcription,
 * forms, status, quota, result discussion, account linking) are reached through LegacyHooks.
 */

export interface LegacyHooks {
  /** Returns the session (created on first contact) with a linked user id. */
  session(chatId: string, from?: { first_name?: string; language_code?: string }): Promise<any>;
  /** Account-link deep links (/start <code>); returns true when handled. */
  link(chatId: string, session: any, text: string): Promise<boolean>;
  /** Legacy slash commands (/scan, /grade, /exam, /form, /research, /status, /quota, /discuss, /done, /markphoto, …). */
  command(chatId: string, session: any, text: string): Promise<void>;
  /** Bot-specific plain-language actions (scanner, batch grading, forms, status, quota, discussion, language). */
  naturalAction(chatId: string, session: any, text: string): Promise<boolean>;
  /** Text while a legacy mode is active (result discussion, form wizard); returns true when handled. */
  modeText(chatId: string, session: any, text: string): Promise<boolean>;
  /** Files while a legacy mode is active (batch staging, single-photo marking, transcription); returns true when handled. */
  modeFile(chatId: string, session: any, files: Array<{ fileId: string; name: string; isPhoto: boolean }>, caption: string): Promise<boolean>;
  transcribe(chatId: string, session: any, fileId: string, name: string): Promise<void>;
}

const MAX_PENDING = 10;
const PENDING_TTL = 30 * 60_000;
const RATE = { windowMs: 60_000, max: 20 };

const seenUpdates = new Map<number, number>();
const pending = new Map<string, { files: Array<IncomingFile & { telegramId: string }>; at: number }>();
const rate = new Map<string, number[]>();
const albums = new Map<string, { chatId: string; session: any; caption: string; replyTo?: number; items: Array<{ fileId: string; name: string; mime: string; isPhoto: boolean }>; timer: NodeJS.Timeout }>();
let botUsername: string | null = process.env.TELEGRAM_BOT_USERNAME ?? null;

setInterval(() => {
  const now = Date.now();
  for (const [k, t] of seenUpdates) if (now - t > 10 * 60_000) seenUpdates.delete(k);
  for (const [k, p] of pending) if (now - p.at > PENDING_TTL) pending.delete(k);
  for (const [k, list] of rate) if (!list.some((t) => now - t < RATE.windowMs)) rate.delete(k);
}, 60_000).unref();

/** Test hook: clears in-memory state. */
export function resetRouterState() { seenUpdates.clear(); pending.clear(); rate.clear(); for (const a of albums.values()) clearTimeout(a.timer); albums.clear(); }

const limited = (chatId: string) => {
  const now = Date.now();
  const list = (rate.get(chatId) ?? []).filter((t) => now - t < RATE.windowMs);
  list.push(now);
  rate.set(chatId, list);
  return list.length > RATE.max;
};

async function accountOf(session: any): Promise<{ linked: boolean; email?: string | null; name?: string | null; plan?: PlanView }> {
  if (!session.userId) return { linked: false };
  const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { email: true, name: true } }).catch(() => null);
  const linked = !!user && !user.email.endsWith('@users.invalid');
  return { linked, email: linked ? user!.email : null, name: linked ? user!.name : null, plan: await planView(session.userId).catch(() => undefined) };
}

/** Plan, credits left today, GO balance and renewal date: the same account state as the website. */
async function planView(userId: string): Promise<PlanView> {
  const { planFor, walletBalance, PLANS, toRwf } = await import('../billing/plans.js');
  const { usedTotals } = await import('../billing/usage.js');
  const [plan, wallet, used, sub] = await Promise.all([planFor(userId), walletBalance(userId), usedTotals(userId), prisma.subscription.findUnique({ where: { userId } }).catch(() => null)]);
  const base = (process.env.APP_BASE_URL || 'https://www.bwenge.space').replace(/\/$/, '');
  const paid = plan.id === 'PRO' || plan.id === 'INSTITUTION';
  return {
    plan: plan.name, dailyLimit: plan.limits.daily, creditsLeft: Math.max(0, plan.limits.daily - used.used.day), wallet,
    renewsOn: paid && sub?.endDate ? new Date(sub.endDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Kigali' }) : null,
    upgradeUrl: paid ? null : `${base}/upgrade`, upgradePrice: paid ? null : `${toRwf(PLANS.PRO.priceUsd ?? 0).toLocaleString('en-US')} RWF`,
  };
}

/** A message to update in place; `media` when it is a photo (the home banner), whose text is a caption. */
type Target = { id: number; media: boolean } | undefined;
const CAPTION_MAX = 1024;
/** Telegram user ids are positive; group and channel chat ids are negative. */
const isPrivate = (chatId: string) => !chatId.startsWith('-');

/** Shows a screen: edits the target message when there is one, otherwise sends a new message. */
async function show(api: TelegramApi, chatId: string, target: Target, html: string, keyboard?: InlineKeyboard) {
  if (target && !target.media) return api.editMessage(chatId, target.id, html, keyboard);
  if (target && html.length <= CAPTION_MAX) return api.editCaption(chatId, target.id, html, keyboard);
  return api.sendMessage(chatId, html, { keyboard });
}

const targetOf = (m: any): Target => (m?.message_id ? { id: m.message_id, media: Boolean(m.photo || m.document || m.caption !== undefined) } : undefined);

/** The scanner screen: a Mini App button in private chats (HTTPS), otherwise a signed link valid for 30 minutes. */
export async function showScan(api: TelegramApi, chatId: string, session: any, target?: Target) {
  const lang = langOf(session.language);
  const miniApp = isPrivate(chatId) && miniAppReady();
  const url = miniApp ? scannerUrl() : scannerUrl(issueScanToken(chatId));
  await show(api, chatId, target, scanCard(lang, !miniApp), scanKeyboard(lang, url, miniApp));
}

/** Mark exams: the Mark Mini App (scheme, students one tap per page, instructions), marking then runs in this chat. */
export async function showMark(api: TelegramApi, chatId: string, session: any, target?: Target) {
  const lang = langOf(session.language);
  const miniApp = isPrivate(chatId) && miniAppReady();
  const url = miniApp ? markUrl() : markUrl(issueScanToken(chatId));
  await show(api, chatId, target, markCard(lang, !miniApp), markKeyboard(lang, url, miniApp));
}

/**
 * A scan sent from the scanner page arrives in the chat as a PDF with quick actions (transcribe, mark,
 * summarise), exactly like a file the user sent; the next typed message also uses it.
 */
export async function deliverScan(chatId: string, session: any, pdf: Buffer, name: string, pages: number, api: TelegramApi = telegramApi()) {
  const lang = langOf(session.language);
  const pageLabel = lang === 'rw' ? `impapuro ${pages}` : lang === 'fr' ? `${pages} page${pages > 1 ? 's' : ''}` : `${pages} page${pages > 1 ? 's' : ''}`;
  const file = { name, mime: 'application/pdf', data: pdf };
  const prev = pending.get(chatId);
  const sentPreview = { ...file, telegramId: '' };
  const all = [...(prev && Date.now() - prev.at < PENDING_TTL ? prev.files : []), sentPreview].slice(-MAX_PENDING);
  const { keyboard, hint } = quickActions(lang, all);
  const sent = await api.sendDocument(chatId, { data: pdf, name, mime: 'application/pdf' }, card('📷', name, esc(copy(lang).scan.received(pageLabel)), hint), keyboard);
  sentPreview.telegramId = sent?.document?.file_id ?? '';
  pending.set(chatId, { files: all, at: Date.now() });
}

async function showFiles(api: TelegramApi, chatId: string, session: any, page: number, target?: Target) {
  const lang = langOf(session.language);
  const where = { userId: session.userId };
  const [total, rows] = await Promise.all([
    prisma.generatedArtifact.count({ where }).catch(() => 0),
    prisma.generatedArtifact.findMany({ where, orderBy: { updatedAt: 'desc' }, skip: page * FILES_PER_PAGE, take: FILES_PER_PAGE }).catch(() => []),
  ]);
  const html = filesCard(lang, rows as any, page, total);
  const kb = filesKeyboard(lang, rows as any, page, total);
  await show(api, chatId, target, html, kb);
}

/** Home: the branded banner with the menu as its caption (sent by file_id after the first upload). */
async function showHome(api: TelegramApi, chatId: string, session: any, firstName?: string, target?: Target) {
  const lang = langOf(session.language);
  const account = await accountOf(session);
  const html = homeCard(lang, account.name?.split(' ')[0] || firstName);
  const kb = homeKeyboard(lang, isPrivate(chatId) && miniAppReady() ? scannerUrl() : undefined);
  if (target) { await show(api, chatId, target, html, kb); return; }
  try {
    const cached = bannerFileId(lang);
    const sent = await api.sendPhoto(chatId, cached ?? { data: bannerPng(lang), name: 'bwenge.png' }, html, kb);
    if (!cached) rememberBannerFileId(lang, sent?.photo?.at(-1)?.file_id);
  } catch (e) {
    logger.warn('[telegram] banner unavailable, sending the text menu', { errorType: (e as Error)?.name });
    await api.sendMessage(chatId, html, { keyboard: kb });
  }
}

function quickActions(lang: Lang, files: IncomingFile[]) {
  const tabular = files.some((f) => /csv|spreadsheet|excel/.test(f.mime) || /\.(csv|xlsx|xls|tsv)$/i.test(f.name));
  const visual = files.some((f) => f.mime.startsWith('image/') || f.mime === 'application/pdf');
  const L = {
    en: { sum: '📝 Summarise', chart: '📊 Chart + Excel', stats: '🧮 Statistics', tr: '📄 Transcribe', mark: '✅ Mark as exam scripts', ask: 'Or just type what you need.' },
    rw: { sum: '📝 Incamake', chart: '📊 Igishushanyo + Excel', stats: '🧮 Imibare', tr: '📄 Kwandika', mark: '✅ Gukosora', ask: 'Cyangwa wandike icyo ukeneye.' },
    fr: { sum: '📝 Résumer', chart: '📊 Graphique + Excel', stats: '🧮 Statistiques', tr: '📄 Transcrire', mark: '✅ Corriger les copies', ask: 'Ou écrivez simplement ce qu’il vous faut.' },
  }[lang];
  const rows = [[{ text: L.sum, callback_data: 'q:sum' }, ...(tabular ? [{ text: L.chart, callback_data: 'q:chart' }] : [])]];
  if (tabular) rows.push([{ text: L.stats, callback_data: 'q:stats' }]);
  if (visual) rows.push([{ text: L.tr, callback_data: 'q:tr' }, { text: L.mark, callback_data: 'q:mark' }]);
  return { keyboard: { inline_keyboard: rows }, hint: L.ask };
}

const QUICK_PROMPTS: Record<string, Record<Lang, string>> = {
  sum: { en: 'Summarise the attached file(s) clearly, with the key points and any important numbers.', rw: 'Incamake dosiye zometse, ugaragaze ingingo z’ingenzi n’imibare y’ingenzi.', fr: 'Résume clairement le(s) fichier(s) joint(s), avec les points clés et les chiffres importants.' },
  chart: { en: 'Analyse the attached data, make the most useful chart of it and give me an Excel workbook of the key results.', rw: 'Sesengura amakuru yometse, ukore igishushanyo kibereye kandi umpe Excel y’ibisubizo by’ingenzi.', fr: 'Analyse les données jointes, fais le graphique le plus utile et donne-moi un classeur Excel des résultats clés.' },
  stats: { en: 'Run descriptive statistics on the attached data (counts, means, medians, spread, missing values) and explain what stands out.', rw: 'Kora imibare y’ibanze ku makuru yometse (umubare, impuzandengo, median, ikwirakwira, ibibura) maze usobanure ibigaragara.', fr: 'Calcule les statistiques descriptives des données jointes (effectifs, moyennes, médianes, dispersion, valeurs manquantes) et explique ce qui ressort.' },
  tr: { en: 'Transcribe the attached pages exactly as written, page by page. Mark anything you cannot read as [illegible].', rw: 'Andika inyandiko iri ku mpapuro zometse uko yanditse, urupapuro ku rundi. Ahatasomeka andika [illegible].', fr: 'Transcris fidèlement les pages jointes, page par page. Indique ce qui est illisible par [illegible].' },
  mark: { en: 'Mark these exam scripts. Use the marking scheme if one is attached; otherwise ask me for it.', rw: 'Kosora izi mpapuro z’ibizamini. Koresha marking scheme niba yometse; bitabaye ibyo uyinsabe.', fr: 'Corrige ces copies. Utilise le barème s’il est joint ; sinon demande-le-moi.' },
};

async function downloadIncoming(api: TelegramApi, items: Array<{ fileId: string; name: string; mime: string }>, lang: Lang, chatId: string): Promise<Array<IncomingFile & { telegramId: string }> | null> {
  const out: Array<IncomingFile & { telegramId: string }> = [];
  for (const it of items) {
    try { out.push({ name: it.name, mime: it.mime, data: await api.downloadFile(it.fileId), telegramId: it.fileId }); } catch (e: any) {
      await api.sendMessage(chatId, card('⚠️', copy(lang).errorTitle, esc(e?.status === 413 ? copy(lang).fileTooLarge : `${it.name}: ${copy(lang).fileMissing}`)));
      return null;
    }
  }
  return out;
}

async function handleFiles(api: TelegramApi, legacy: LegacyHooks, chatId: string, session: any, items: Array<{ fileId: string; name: string; mime: string; isPhoto: boolean }>, captionText: string, replyTo?: number) {
  const lang = langOf(session.language);
  if (await legacy.modeFile(chatId, session, items, captionText)) return;
  const files = await downloadIncoming(api, items, lang, chatId);
  if (!files) return;
  if (captionText.trim()) {
    await runAssistantTurn({ chatId, session, text: captionText.trim(), files, replyTo });
    return;
  }
  const prev = pending.get(chatId);
  const all = [...(prev && Date.now() - prev.at < PENDING_TTL ? prev.files : []), ...files].slice(-MAX_PENDING);
  pending.set(chatId, { files: all, at: Date.now() });
  const { keyboard, hint } = quickActions(lang, all);
  const names = all.map((f) => `• ${esc(f.name)}`).join('\n');
  await api.sendMessage(chatId, card('📎', all.length === 1 ? all[0].name : `${all.length} files`, `${copy(lang).receivedFile(all.length === 1 ? esc(all[0].name) : `${all.length} files`)}${all.length > 1 ? `\n${names}` : ''}`, hint), { keyboard, replyTo });
}

export async function handleUpdate(update: any, legacy: LegacyHooks, api: TelegramApi = telegramApi()): Promise<void> {
  if (typeof update?.update_id === 'number') {
    if (seenUpdates.has(update.update_id)) return; // Telegram redelivers when a response is slow
    seenUpdates.set(update.update_id, Date.now());
  }
  if (update.callback_query) return handleCallback(update.callback_query, legacy, api);
  const msg = update.message ?? update.edited_message;
  if (!msg?.chat) return;
  const chatId = String(msg.chat.id);
  const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup';
  let text: string = (msg.text ?? msg.caption ?? '').trim();

  // In groups, only answer commands, replies to the bot and messages that mention it.
  if (isGroup) {
    const mention = botUsername ? new RegExp(`@${botUsername}\\b`, 'i') : null;
    const addressed = text.startsWith('/') || msg.reply_to_message?.from?.is_bot || (mention && mention.test(text));
    if (!addressed) return;
    if (mention) text = text.replace(mention, '').trim();
  }
  if (update.edited_message) return; // edits are not re-run

  const session = await legacy.session(chatId, msg.from);
  const lang = langOf(session.language);
  if (limited(chatId)) { await api.sendMessage(chatId, card('⏳', copy(lang).working, esc(copy(lang).slowDown))); return; }
  if (text && await legacy.link(chatId, session, text)) return;

  // Files: documents, photos (albums are collected into one request), voice notes.
  const doc = msg.document;
  const photo = Array.isArray(msg.photo) && msg.photo.length ? msg.photo[msg.photo.length - 1] : null;
  if (doc || photo) {
    const item = doc
      ? { fileId: doc.file_id, name: doc.file_name || 'document', mime: doc.mime_type || 'application/octet-stream', isPhoto: false }
      : { fileId: photo.file_id, name: `photo-${msg.message_id}.jpg`, mime: 'image/jpeg', isPhoto: true };
    if ((doc?.file_size ?? photo?.file_size ?? 0) > 20 * 1024 * 1024) { await api.sendMessage(chatId, card('⚠️', copy(lang).errorTitle, esc(copy(lang).fileTooLarge))); return; }
    if (msg.media_group_id) {
      const key = `${chatId}:${msg.media_group_id}`;
      const album = albums.get(key) ?? { chatId, session, caption: '', replyTo: msg.message_id, items: [], timer: undefined as any };
      album.items.push(item);
      if (text) album.caption = text;
      clearTimeout(album.timer);
      album.timer = setTimeout(() => {
        albums.delete(key);
        handleFiles(api, legacy, chatId, album.session, album.items, album.caption, album.replyTo).catch((e) => logger.error('[telegram] album failed', { errorType: (e as Error)?.name }));
      }, 1500);
      albums.set(key, album);
      return;
    }
    await handleFiles(api, legacy, chatId, session, [item], text, msg.message_id);
    return;
  }
  if (msg.voice || msg.audio || msg.video || msg.sticker || msg.location || msg.contact) {
    await api.sendMessage(chatId, card('💬', copy(lang).errorTitle, esc(copy(lang).unsupportedMessage)));
    return;
  }
  if (!text) return;

  // Commands: the new screens here, everything else in the legacy route.
  if (text.startsWith('/')) {
    const [raw, ...rest] = text.split(/\s+/);
    const cmd = raw.split('@')[0].toLowerCase();
    switch (cmd) {
      case '/start': case '/menu': await showHome(api, chatId, session, msg.from?.first_name); return;
      case '/help': await api.sendMessage(chatId, guideCard(lang, 'help'), { keyboard: backKeyboard(lang) }); return;
      case '/files': await showFiles(api, chatId, session, 0); return;
      case '/scan': case '/scanner': await showScan(api, chatId, session); return;
      case '/mark': await showMark(api, chatId, session); return;
      case '/settings': case '/language': case '/plan': { const acc = await accountOf(session); await api.sendMessage(chatId, settingsCard(lang, acc), { keyboard: settingsKeyboard(lang, acc.plan) }); return; }
      case '/new': case '/reset':
        pending.delete(chatId);
        await prisma.telegramSession.update({ where: { chatId }, data: { history: [], lastPrompt: null, activeDiscussJobId: null, stagedMode: null } }).catch(() => undefined);
        await api.sendMessage(chatId, card('✨', lang === 'rw' ? 'Ikiganiro gishya' : lang === 'fr' ? 'Nouvelle conversation' : 'New conversation', esc(copy(lang).homeFooter)));
        return;
      case '/tutor': case '/socratic': {
        const topic = rest.join(' ').slice(0, 200);
        await prisma.telegramSession.update({ where: { chatId }, data: { learning: { mode: 'socratic', ...(topic ? { topic } : {}) } } }).catch(() => undefined);
        await api.sendMessage(chatId, card('🎓', lang === 'rw' ? 'Umwarimu ubaza ibibazo' : lang === 'fr' ? 'Tuteur socratique' : 'Socratic tutor', esc(lang === 'rw' ? 'Nzakuyobora nkoresheje ibibazo n’inama aho kuguha igisubizo. Andika ikibazo cyawe. /normal kugira ngo uhagarike.' : lang === 'fr' ? 'Je vous guide par des questions et des indices au lieu de donner la réponse. Écrivez votre exercice. /normal pour arrêter.' : 'I will guide you with questions and hints instead of giving the answer. Send your problem. /normal to stop.')));
        return;
      }
      case '/roleplay': {
        if (rest.length) {
          await prisma.telegramSession.update({ where: { chatId }, data: { learning: { mode: 'roleplay', character: rest.join(' ').slice(0, 120) } } }).catch(() => undefined);
          await api.sendMessage(chatId, card('🎭', 'Roleplay', esc(`I am now ${rest.join(' ').slice(0, 120)}. Start the conversation; say "end" for feedback, /normal to stop.`)));
        } else {
          const { ROLEPLAY_PRESETS } = await import('../learning/modes.js');
          await api.sendMessage(chatId, card('🎭', 'Roleplay', esc('Pick a scenario, or type /roleplay followed by who I should play (e.g. /roleplay a bank clerk in Kigali).')), {
            keyboard: { inline_keyboard: ROLEPLAY_PRESETS.map((p) => [{ text: p.title, callback_data: `lm:${p.id}` }]) },
          });
        }
        return;
      }
      case '/normal': {
        await prisma.telegramSession.update({ where: { chatId }, data: { learning: null as any } }).catch(() => undefined);
        await api.sendMessage(chatId, card('💬', lang === 'rw' ? 'Ikiganiro gisanzwe' : lang === 'fr' ? 'Mode normal' : 'Normal mode', esc(lang === 'rw' ? 'Nsubiye ku kiganiro gisanzwe.' : lang === 'fr' ? 'Retour au mode normal.' : 'Back to normal answers.')));
        return;
      }
      case '/chat': case '/ask':
        if (rest.length) await runAssistantTurn({ chatId, session, text: rest.join(' '), replyTo: msg.message_id });
        else await api.sendMessage(chatId, guideCard(lang, 'create'), { keyboard: backKeyboard(lang) });
        return;
      default: await legacy.command(chatId, session, text); return;
    }
  }

  // Legacy reply-keyboard buttons from older versions of the bot map onto the new screens.
  if (/^(❓|💬|🤖|📸)\s/.test(text)) {
    if (text.startsWith('❓')) await api.sendMessage(chatId, guideCard(lang, 'help'), { keyboard: backKeyboard(lang) });
    else if (text.startsWith('📸')) await showScan(api, chatId, session);
    else await showHome(api, chatId, session, msg.from?.first_name);
    return;
  }

  if (await legacy.modeText(chatId, session, text)) return;
  // Files sent just before belong to this request, so it goes to the assistant with them.
  const queued = pending.get(chatId);
  const files = queued && Date.now() - queued.at < PENDING_TTL ? queued.files : [];
  if (!files.length && await legacy.naturalAction(chatId, session, text)) return;
  pending.delete(chatId);
  await runAssistantTurn({ chatId, session, text, files, replyTo: msg.message_id });
}

async function handleCallback(q: any, legacy: LegacyHooks, api: TelegramApi) {
  const chatId = String(q.message?.chat?.id ?? '');
  const target = targetOf(q.message);
  const data: string = q.data ?? '';
  if (!chatId || !data) { await api.answerCallback(q.id); return; }
  const session = await legacy.session(chatId, q.from);
  let lang = langOf(session.language);
  const [kind, arg = ''] = [data.slice(0, data.indexOf(':')), data.slice(data.indexOf(':') + 1)];
  try {
    switch (kind) {
      case 'm': {
        await api.answerCallback(q.id);
        if (arg === 'home') await showHome(api, chatId, session, q.from?.first_name, target);
        else if (arg === 'settings') { const acc = await accountOf(session); await show(api, chatId, target, settingsCard(lang, acc), settingsKeyboard(lang, acc.plan)); }
        else if (arg === 'scan') await showScan(api, chatId, session, target);
        else if (arg === 'mark') await showMark(api, chatId, session, target);
        else if (['create', 'transcribe', 'library', 'help'].includes(arg)) {
          if (arg === 'transcribe') await prisma.telegramSession.update({ where: { chatId }, data: { stagedMode: 'transcribe' } }).catch(() => undefined);
          await show(api, chatId, target, guideCard(lang, arg as any), backKeyboard(lang));
        }
        return;
      }
      case 'lm': {
        const { ROLEPLAY_PRESETS } = await import('../learning/modes.js');
        const p = ROLEPLAY_PRESETS.find((x) => x.id === arg);
        await api.answerCallback(q.id);
        if (!p) return;
        await prisma.telegramSession.update({ where: { chatId }, data: { learning: p.settings as any } }).catch(() => undefined);
        await api.sendMessage(chatId, card('🎭', p.title, esc(`${p.settings.scenario ?? ''}\n\nI am ${p.settings.character}. You start: say hello. Say "end" for feedback, /normal to stop.`)));
        return;
      }
      case 'l': {
        lang = langOf(arg);
        const updated = await prisma.telegramSession.update({ where: { chatId }, data: { language: lang } });
        await api.answerCallback(q.id, copy(lang).languageSet);
        const acc = await accountOf(updated);
        await show(api, chatId, target, settingsCard(lang, acc), settingsKeyboard(lang, acc.plan));
        return;
      }
      case 'fp': {
        await api.answerCallback(q.id);
        await showFiles(api, chatId, session, Math.max(0, Number(arg) || 0), target);
        return;
      }
      case 'f': {
        const a = await prisma.generatedArtifact.findUnique({ where: { id: arg } }).catch(() => null);
        if (!a || a.userId !== session.userId || a.status !== 'ready') { await api.answerCallback(q.id, copy(lang).fileMissing, true); return; }
        const { outputService } = await import('../educationRuntime.js');
        const ref = await outputService.attachmentRef(a);
        const { fileStore } = await import('../AiService.js');
        if (!ref || !(await deliverAttachment({ api, fileStore }, chatId, session.userId, ref))) { await api.answerCallback(q.id, copy(lang).fileMissing, true); return; }
        await api.answerCallback(q.id);
        return;
      }
      case 'a': {
        await api.answerCallback(q.id);
        if (arg === 'regen') {
          if (!session.lastPrompt) { await api.sendMessage(chatId, esc(copy(lang).nothingToRegenerate)); return; }
          await runAssistantTurn({ chatId, session, text: session.lastPrompt });
        }
        return;
      }
      case 'q': {
        await api.answerCallback(q.id);
        const queued = pending.get(chatId);
        if (!queued?.files.length) { await api.sendMessage(chatId, esc(copy(lang).fileMissing)); return; }
        // Keep the file's message; only remove its buttons so the action cannot be tapped twice.
        if (target) await api.call('editMessageReplyMarkup', { chat_id: chatId, message_id: target.id, reply_markup: { inline_keyboard: [] } }).catch(() => undefined);
        if (arg === 'tr' && queued.files.every((f) => f.telegramId)) {
          pending.delete(chatId);
          for (const f of queued.files) await legacy.transcribe(chatId, session, f.telegramId, f.name);
          return;
        }
        pending.delete(chatId);
        await runAssistantTurn({ chatId, session, text: QUICK_PROMPTS[arg]?.[lang] ?? QUICK_PROMPTS.sum[lang], files: queued.files });
        return;
      }
      default:
        // Callbacks from older bot versions.
        await api.answerCallback(q.id);
    }
  } catch (e) {
    logger.error('[telegram] callback failed', { errorType: (e as Error)?.name, kind });
    await api.answerCallback(q.id, copy(lang).errorTitle, true);
  }
}

/** Registers the command menu in every supported language. */
export async function registerTelegramCommands(api: TelegramApi = telegramApi()) {
  await api.setCommands(copy('en').commands);
  for (const l of ['rw', 'fr'] as const) await api.setCommands(copy(l).commands, l).catch(() => undefined);
  // Profile texts shown before the first /start, and the "Scan" button beside the message field.
  await api.setProfile(copy('en').profile.description, copy('en').profile.short).catch(() => undefined);
  for (const l of ['rw', 'fr'] as const) await api.setProfile(copy(l).profile.description, copy(l).profile.short, l).catch(() => undefined);
  if (miniAppReady()) await api.setMenuButton({ type: 'web_app', text: copy('en').profile.menuButton, web_app: { url: scannerUrl() } }).catch(() => undefined);
  try {
    const me = await api.call<{ username?: string }>('getMe', {});
    if (me?.username) botUsername = me.username;
  } catch { /* username stays from TELEGRAM_BOT_USERNAME */ }
}
