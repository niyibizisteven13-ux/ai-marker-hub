import logger from '../../utils/logger.js';

/**
 * Typed client for the Telegram Bot API. Retries flood-control (429 retry_after) once or twice, falls back
 * to plain text when Telegram rejects HTML entities, and treats "message is not modified" as success.
 * Without TELEGRAM_BOT_TOKEN it runs in mock mode: calls are logged and recorded, never sent.
 */

export type InlineButton = { text: string; callback_data?: string; url?: string; web_app?: { url: string } };
export type InlineKeyboard = { inline_keyboard: InlineButton[][] };
export interface SentMessage { message_id: number; chat?: { id: number | string }; photo?: Array<{ file_id: string }>; document?: { file_id: string } }

export class TelegramApiError extends Error {
  constructor(public method: string, public status: number, public description: string) {
    super(`Telegram ${method} failed: ${description}`);
  }
}

const stripTags = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

export class TelegramApi {
  readonly mock: boolean;
  /** Calls made in mock mode (handy in development and tests). */
  readonly mockLog: Array<{ method: string; payload: Record<string, unknown> }> = [];
  private seq = 1;

  constructor(private token = process.env.TELEGRAM_BOT_TOKEN?.trim() ?? '', private base = (process.env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/$/, '')) {
    this.mock = !token;
  }

  private url(method: string) { return `${this.base}/bot${this.token}/${method}`; }

  async call<T = any>(method: string, payload: Record<string, unknown>, files?: Record<string, { data: Buffer; name: string; mime?: string }>): Promise<T> {
    if (this.mock) {
      this.mockLog.push({ method, payload });
      if (this.mockLog.length > 500) this.mockLog.shift();
      logger.info(`[Telegram mock] ${method}`, { chat: payload.chat_id });
      return { message_id: this.seq++, chat: { id: payload.chat_id } } as T;
    }
    for (let attempt = 0; ; attempt++) {
      let body: BodyInit;
      const headers: Record<string, string> = {};
      if (files) {
        const form = new FormData();
        for (const [k, v] of Object.entries(payload)) if (v !== undefined && v !== null) form.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
        for (const [k, f] of Object.entries(files)) form.append(k, new Blob([new Uint8Array(f.data)], { type: f.mime ?? 'application/octet-stream' }), f.name);
        body = form;
      } else {
        body = JSON.stringify(payload);
        headers['Content-Type'] = 'application/json';
      }
      const res = await fetch(this.url(method), { method: 'POST', headers, body, signal: AbortSignal.timeout(files ? 120_000 : 30_000) });
      const data: any = await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }));
      if (data.ok) return data.result as T;
      const desc = String(data.description ?? '');
      if (res.status === 429 && attempt < 2) {
        const wait = Math.min(Number(data.parameters?.retry_after ?? 1), 30) * 1000;
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      if (/message is not modified/i.test(desc)) return {} as T;
      if (payload.parse_mode === 'HTML' && /can't parse entities|unsupported start tag|can't find end tag/i.test(desc) && attempt < 2) {
        logger.warn('[Telegram] HTML rejected, resending as plain text', { method });
        const key = typeof payload.text === 'string' ? 'text' : 'caption';
        payload = { ...payload, parse_mode: undefined, [key]: stripTags(String(payload[key] ?? '')) };
        continue;
      }
      throw new TelegramApiError(method, res.status, desc);
    }
  }

  sendMessage(chatId: string, html: string, opts: { keyboard?: InlineKeyboard; replyTo?: number; silent?: boolean; preview?: boolean } = {}) {
    return this.call<SentMessage>('sendMessage', {
      chat_id: chatId, text: html, parse_mode: 'HTML', reply_markup: opts.keyboard,
      link_preview_options: { is_disabled: !opts.preview }, disable_notification: opts.silent,
      ...(opts.replyTo ? { reply_parameters: { message_id: opts.replyTo, allow_sending_without_reply: true } } : {}),
    });
  }

  editMessage(chatId: string, messageId: number, html: string, keyboard?: InlineKeyboard) {
    return this.call('editMessageText', { chat_id: chatId, message_id: messageId, text: html, parse_mode: 'HTML', reply_markup: keyboard, link_preview_options: { is_disabled: true } });
  }

  deleteMessage(chatId: string, messageId: number) {
    return this.call('deleteMessage', { chat_id: chatId, message_id: messageId }).catch(() => undefined);
  }

  /** `photo` is new bytes or the file_id of a photo already on Telegram's servers. */
  sendPhoto(chatId: string, photo: { data: Buffer; name: string } | string, captionHtml: string, keyboard?: InlineKeyboard) {
    const payload = { chat_id: chatId, caption: captionHtml, parse_mode: 'HTML', reply_markup: keyboard };
    return typeof photo === 'string'
      ? this.call<SentMessage>('sendPhoto', { ...payload, photo })
      : this.call<SentMessage>('sendPhoto', payload, { photo: { ...photo, mime: 'image/png' } });
  }

  editCaption(chatId: string, messageId: number, html: string, keyboard?: InlineKeyboard) {
    return this.call('editMessageCaption', { chat_id: chatId, message_id: messageId, caption: html, parse_mode: 'HTML', reply_markup: keyboard });
  }

  sendDocument(chatId: string, doc: { data: Buffer; name: string; mime?: string }, captionHtml: string, keyboard?: InlineKeyboard) {
    return this.call<SentMessage>('sendDocument', { chat_id: chatId, caption: captionHtml, parse_mode: 'HTML', reply_markup: keyboard }, { document: doc });
  }

  answerCallback(id: string, text?: string, alert = false) {
    return this.call('answerCallbackQuery', { callback_query_id: id, text, show_alert: alert }).catch(() => undefined);
  }

  chatAction(chatId: string, action: 'typing' | 'upload_document' | 'upload_photo' = 'typing') {
    return this.call('sendChatAction', { chat_id: chatId, action }).catch(() => undefined);
  }

  /** The button beside the message field; a web_app button opens the Mini App (the scanner). */
  setMenuButton(button: { type: 'web_app'; text: string; web_app: { url: string } } | { type: 'commands' }) {
    return this.call('setChatMenuButton', { menu_button: button });
  }

  /** Profile texts: "What can this bot do?" (description) and the short about line. */
  async setProfile(description: string, shortDescription: string, languageCode?: string) {
    const lc = languageCode ? { language_code: languageCode } : {};
    await this.call('setMyDescription', { description, ...lc });
    await this.call('setMyShortDescription', { short_description: shortDescription, ...lc });
  }

  setCommands(commands: Array<{ command: string; description: string }>, languageCode?: string) {
    return this.call('setMyCommands', { commands, ...(languageCode ? { language_code: languageCode } : {}) });
  }

  /** Downloads a file the user sent (bots may download up to 20 MB). */
  async downloadFile(fileId: string, maxBytes = 20 * 1024 * 1024): Promise<Buffer> {
    if (this.mock) throw new TelegramApiError('getFile', 400, 'file downloads are unavailable in mock mode');
    const info = await this.call<{ file_path?: string; file_size?: number }>('getFile', { file_id: fileId });
    if (!info.file_path) throw new TelegramApiError('getFile', 400, 'no file path');
    if ((info.file_size ?? 0) > maxBytes) throw new TelegramApiError('getFile', 413, `file larger than ${Math.round(maxBytes / 1048576)} MB`);
    const res = await fetch(`${this.base}/file/bot${this.token}/${info.file_path}`, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new TelegramApiError('download', res.status, `HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new TelegramApiError('download', 413, 'file too large');
    return buf;
  }
}

let shared: TelegramApi | null = null;
export const telegramApi = () => (shared ??= new TelegramApi());
/** Tests replace the shared client. */
export function setTelegramApi(api: TelegramApi | null) { shared = api; }
