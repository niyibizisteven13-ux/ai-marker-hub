import type { KV } from './store.js';
import { appSettingKV, outbox } from './store.js';

/**
 * Tells a user something without them asking: Telegram first (they get it on their phone at once), then email, and if neither is
 * possible it waits in their outbox and the chat shows it the next time they open it. Every part can be replaced in a test.
 */
export interface Button { text: string; callback_data?: string; url?: string }
export interface Notice { title: string; text: string; /** Rows of buttons (Telegram only). */ buttons?: Button[][] }
export interface NotifyDeps {
  telegramChat(userId: string): Promise<string | null>;
  sendTelegram(chatId: string, html: string, keyboard?: { inline_keyboard: Button[][] }): Promise<void>;
  email(userId: string): Promise<string | null>;
  sendEmail(to: string, subject: string, text: string): Promise<boolean>;
  kv: KV;
}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export type Where = 'telegram' | 'email' | 'outbox';

export async function notifyUser(userId: string, n: Notice, deps: NotifyDeps): Promise<Where> {
  try {
    const chat = await deps.telegramChat(userId);
    if (chat) {
      await deps.sendTelegram(chat, `🔔 <b>${esc(n.title)}</b>\n\n${esc(n.text)}`, n.buttons?.length ? { inline_keyboard: n.buttons } : undefined);
      return 'telegram';
    }
  } catch { /* fall through to email */ }
  try {
    const to = await deps.email(userId);
    if (to && await deps.sendEmail(to, n.title, n.text)) return 'email';
  } catch { /* fall through to the outbox */ }
  await outbox(deps.kv).add(userId, { at: new Date().toISOString(), title: n.title, text: n.text });
  return 'outbox';
}

/** The real thing: the bot, the mailer and the user table. */
export async function liveNotifyDeps(): Promise<NotifyDeps> {
  const [{ prisma }, { telegramApi }, { markdownToMessages }] = await Promise.all([import('../../db.js'), import('../telegram/api.js'), import('../telegram/format.js')]);
  const db = prisma as any;
  return {
    kv: appSettingKV(),
    telegramChat: async (userId) => (await db.telegramSession.findFirst({ where: { userId }, orderBy: { lastActiveAt: 'desc' }, select: { chatId: true } }).catch(() => null))?.chatId ?? null,
    async sendTelegram(chatId, html, keyboard) {
      const api = telegramApi();
      const parts = markdownToMessages(html).slice(0, 4);
      for (const [i, p] of parts.entries()) await api.sendMessage(chatId, p, i === parts.length - 1 && keyboard ? { keyboard: keyboard as any } : {});
    },
    email: async (userId) => (await db.user.findUnique({ where: { id: userId }, select: { email: true } }).catch(() => null))?.email ?? null,
    async sendEmail(to, subject, text) {
      const { EmailService } = await import('../EmailService.js');
      const r = await EmailService.getInstance().sendEmail({ to, subject, text, html: `<pre style="font-family:inherit;white-space:pre-wrap">${esc(text)}</pre>` });
      return !!r.success && !r.skipped;
    },
  };
}
