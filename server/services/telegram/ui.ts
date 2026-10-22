import { copy } from './uiText.js';
import { esc } from './format.js';
import type { InlineButton, InlineKeyboard } from './api.js';

/**
 * Bwenge's Telegram design system: card layouts (icon + bold title, short body, muted footer), inline
 * keyboards that navigate in place, and the live progress card. Callback data stays under Telegram's
 * 64-byte limit: m:<menu>, f:<artifactId> (send file), fp:<page>, l:<lang>, a:<action>.
 * Icon system (one emoji per feature, used the same way in the banner, menus, cards and buttons):
 * 📊 charts & files · 📝 marking · 📷 scanner · 📄 transcription · 🔎 library · 📁 my files · ⚙️ settings · ❓ help.
 */

export type Lang = 'en' | 'rw' | 'fr';
export const langOf = (v: unknown): Lang => (v === 'rw' || v === 'fr' ? v : 'en');

export interface StepView { label: string; status: 'running' | 'done' | 'error'; detail?: string }

export const card = (icon: string, title: string, body: string, footer?: string) =>
  `${icon} <b>${esc(title)}</b>\n\n${body}${footer ? `\n\n<i>${footer}</i>` : ''}`;

export function homeCard(lang: Lang, name?: string | null) {
  const t = copy(lang);
  return card('👋', name ? t.helloName(name) : t.hello, `${t.intro}\n\n<b>${t.whatICanDo}</b>\n${t.capabilities.map((c) => `${c[0]} ${c[1]}`).join('\n')}`, t.homeFooter);
}

/** `miniAppUrl` (private chats over HTTPS) makes the scan button open the scanner directly inside Telegram. */
export function homeKeyboard(lang: Lang, miniAppUrl?: string): InlineKeyboard {
  const b = copy(lang).buttons;
  const scan: InlineButton = miniAppUrl ? { text: b.scan, web_app: { url: miniAppUrl } } : { text: b.scan, callback_data: 'm:scan' };
  return {
    inline_keyboard: [
      [{ text: b.create, callback_data: 'm:create' }, { text: b.mark, callback_data: 'm:mark' }],
      [scan, { text: b.transcribe, callback_data: 'm:transcribe' }],
      [{ text: b.library, callback_data: 'm:library' }, { text: b.files, callback_data: 'fp:0' }],
      [{ text: b.settings, callback_data: 'm:settings' }, { text: b.help, callback_data: 'm:help' }],
    ],
  };
}

export function scanCard(lang: Lang, viaLink: boolean) {
  const s = copy(lang).scan;
  return card('📷', s.title, `${s.body}\n\n${s.steps.map((step, i) => `<b>${i + 1}.</b> ${step}`).join('\n')}`, viaLink ? `${s.footer} ${s.groupHint}` : s.footer);
}

/** Opens the scanner as a Mini App when possible, otherwise as a signed link. */
export function scanKeyboard(lang: Lang, url: string, miniApp: boolean): InlineKeyboard {
  const open: InlineButton = miniApp ? { text: copy(lang).scan.open, web_app: { url } } : { text: copy(lang).scan.open, url };
  return backKeyboard(lang, [[open]]);
}

export const backKeyboard = (lang: Lang, extra: InlineKeyboard['inline_keyboard'] = []): InlineKeyboard =>
  ({ inline_keyboard: [...extra, [{ text: copy(lang).buttons.back, callback_data: 'm:home' }]] });

/** Help cards opened from the home menu: what to send and example requests. */
export function guideCard(lang: Lang, topic: 'create' | 'mark' | 'transcribe' | 'library' | 'help') {
  const g = copy(lang).guides[topic];
  return card(g.icon, g.title, `${g.body}\n\n<b>${copy(lang).tryAsking}</b>\n${g.examples.map((e) => `› <code>${esc(e)}</code>`).join('\n')}`);
}

/** Plan state shown in Settings: the same account, plan and credits as on the website. */
export interface PlanView { plan: string; creditsLeft: number; dailyLimit: number; wallet: number; renewsOn?: string | null; upgradeUrl?: string | null; upgradePrice?: string | null }

export function settingsCard(lang: Lang, account: { linked: boolean; email?: string | null; plan?: PlanView }) {
  const t = copy(lang);
  const p = account.plan;
  const planLines = p ? `\n\n<b>${lang === 'rw' ? 'Ifatabuguzi' : lang === 'fr' ? 'Offre' : 'Plan'}</b>: ${esc(p.plan)}${p.renewsOn ? ` · ${lang === 'fr' ? 'jusqu’au' : lang === 'rw' ? 'kugeza' : 'until'} ${esc(p.renewsOn)}` : ''}\n<b>${lang === 'rw' ? 'Credits z’uyu munsi' : lang === 'fr' ? 'Crédits du jour' : 'Credits today'}</b>: ${p.creditsLeft} / ${p.dailyLimit}${p.wallet ? `\n<b>GO</b>: ${p.wallet.toLocaleString('en-US')} credits` : ''}` : '';
  return card('⚙️', t.settings, `<b>${t.language}</b>: ${t.langName}\n<b>${t.account}</b>: ${account.linked && account.email ? esc(account.email) : t.notLinked}${planLines}`, account.linked ? undefined : t.linkHint);
}

export function settingsKeyboard(lang: Lang, plan?: PlanView): InlineKeyboard {
  const mark = (l: Lang, label: string) => ({ text: `${l === lang ? '✓ ' : ''}${label}`, callback_data: `l:${l}` });
  const upgrade: InlineButton[][] = plan?.upgradeUrl ? [[{ text: `⭐ ${lang === 'rw' ? 'Zamura' : lang === 'fr' ? 'Passer à PRO' : 'Upgrade to PRO'}${plan.upgradePrice ? ` · ${plan.upgradePrice}` : ''}`, url: plan.upgradeUrl }]] : [];
  return backKeyboard(lang, [[mark('en', 'English'), mark('rw', 'Kinyarwanda'), mark('fr', 'Français')], ...upgrade]);
}

/** The single live message shown while the AI works; edited in place, then replaced by the answer. */
export function progressCard(lang: Lang, steps: StepView[], seconds: number) {
  const t = copy(lang);
  const icon = (s: StepView) => (s.status === 'done' ? '✅' : s.status === 'error' ? '⚠️' : '⏳');
  const lines = steps.slice(-8).map((s) => `${icon(s)} ${esc(s.label)}${s.detail && s.status !== 'running' ? `\n     <i>${esc(s.detail)}</i>` : ''}`);
  return `${steps.some((s) => s.status === 'running') || !steps.length ? '⏳' : '✨'} <b>${t.working}</b>${seconds >= 5 ? ` · ${seconds}s` : ''}${lines.length ? `\n\n${lines.join('\n')}` : ''}`;
}

export const answerKeyboard = (lang: Lang, withFiles: boolean): InlineKeyboard => {
  const b = copy(lang).buttons;
  return { inline_keyboard: [[{ text: b.regenerate, callback_data: 'a:regen' }, ...(withFiles ? [{ text: b.files, callback_data: 'fp:0' }] : []), { text: b.menu, callback_data: 'm:home' }]] };
};

export const errorCard = (lang: Lang, detail?: string) => card('⚠️', copy(lang).errorTitle, esc(detail || copy(lang).errorBody), copy(lang).errorFooter);
export const retryKeyboard = (lang: Lang): InlineKeyboard => ({ inline_keyboard: [[{ text: copy(lang).buttons.retry, callback_data: 'a:regen' }, { text: copy(lang).buttons.menu, callback_data: 'm:home' }]] });

export interface FileRow { id: string; title: string; format: string; kind: string; sizeBytes: number | null; updatedAt: string | Date; status: string }
const KIND_ICON: Record<string, string> = { chart: '📊', diagram: '🧭', map: '🗺️', report: '📰', widget: '🧩', analysis: '🧮', image: '🖼️' };
const FORMAT_ICON: Record<string, string> = { xlsx: '📗', docx: '📘', pptx: '📙', pdf: '📕', html: '📰', svg: '📊', png: '🖼️', json: '🧮' };
export const fileIcon = (f: Pick<FileRow, 'kind' | 'format'>) => KIND_ICON[f.kind] ?? FORMAT_ICON[f.format] ?? '📄';
export const fmtSize = (n: number | null | undefined) => (n == null ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

export function ago(d: string | Date, lang: Lang) {
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  const t = copy(lang).ago;
  if (s < 60) return t.now;
  if (s < 3600) return t.min(Math.floor(s / 60));
  if (s < 86400) return t.hour(Math.floor(s / 3600));
  return new Date(d).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short' });
}

export const FILES_PER_PAGE = 6;

export function filesCard(lang: Lang, rows: FileRow[], page: number, total: number) {
  const t = copy(lang);
  if (!total) return card('📁', t.myFiles, t.noFiles);
  const list = rows.map((f, i) => `<b>${page * FILES_PER_PAGE + i + 1}.</b> ${fileIcon(f)} ${esc(f.title)}\n     <i>${f.format.toUpperCase()}${f.sizeBytes ? ` · ${fmtSize(f.sizeBytes)}` : ''} · ${ago(f.updatedAt, lang)}${f.status !== 'ready' ? ` · ${f.status}` : ''}</i>`);
  return card('📁', t.myFiles, list.join('\n'), t.filesFooter(page + 1, Math.max(1, Math.ceil(total / FILES_PER_PAGE))));
}

export function filesKeyboard(lang: Lang, rows: FileRow[], page: number, total: number): InlineKeyboard {
  const send = rows.map((f, i) => ({ text: `⬇️ ${page * FILES_PER_PAGE + i + 1}`, callback_data: `f:${f.id}` }));
  const grid: InlineKeyboard['inline_keyboard'] = [];
  for (let i = 0; i < send.length; i += 3) grid.push(send.slice(i, i + 3));
  const nav = [
    ...(page > 0 ? [{ text: '‹', callback_data: `fp:${page - 1}` }] : []),
    ...((page + 1) * FILES_PER_PAGE < total ? [{ text: '›', callback_data: `fp:${page + 1}` }] : []),
  ];
  if (nav.length) grid.push(nav);
  return backKeyboard(lang, grid);
}

export const commandList = (lang: Lang) => copy(lang).commands;
