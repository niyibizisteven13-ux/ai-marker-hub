import { isFlexibleMeal, tickDeadline, mealInk, cardPaper, dailyMealPaper } from '../../../server/services/biz/mealCard';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Check, CheckCheck, CheckCircle2, Clock, Loader2, LogOut, MessageCircle, Ticket, UtensilsCrossed, X, KeyRound } from 'lucide-react';
import { VerifiedBadge } from '../VerifiedBadge';
import { BizApiError, publicApi, stampImageUrl } from '../../biz/api';
import { useScanner } from './useScanner';
import { THEMES, CATEGORIES, rwf, type PublicBusiness } from '../../biz/types';
import type { CardInfo, MeInfo } from '../../biz/types';
import { useTx } from '../../biz/i18n';
import { RW_WORDS, fill, wordsOf } from '../../../server/services/biz/programWords';
import type { Lang } from '../../biz/types';

/**
 * Programs on the public page. A customer scans the business's QR code, joins once (name, phone, the owner's 4-digit join code, then a passcode of their
 * own), and from then on signs in with phone number and passcode to see their card: dates down the side, one column per item, a check mark for every use,
 * and the QR code the business scans. No app and no link to guard: the passcode is the key.
 */
type Program = NonNullable<PublicBusiness['programs']>[number];
const DAY: Record<string, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
const ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const daysText = (ds: string[], t: (s: string) => string) => { const s = ORDER.filter((d) => ds.includes(d)); if (s.length === 7) return t('Every day'); const run = s.length > 1 && s.every((d, i) => ORDER.indexOf(d) === ORDER.indexOf(s[0]) + i); return run ? `${t(DAY[s[0]])}–${t(DAY[s[s.length - 1]])}` : s.map((d) => t(DAY[d])).join(', '); };
const shortDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const dayNum = (d: string) => Number(d.slice(8, 10));
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kigali' });

/** The owner's own words for this business (plain defaults for anything not named), and a translator that fills them into a template. */
function useWords(b: PublicBusiness, lang: Lang) { const tx = useTx(); const w = wordsOf(b.programText, lang === 'rw' ? RW_WORDS : undefined); return { w, tx, t: (s: string) => fill(tx(s), w) }; }

/* ---- the sign-in on this phone: kept for the session, or for 30 days when the customer asks ---- */
const KEY = (slug: string) => `bz-sess:${slug}`;
const OFFLINE_KEY = (slug: string) => `bz-card-offline:${slug}`;
const OFFLINE_MAX_AGE = 24 * 60 * 60 * 1000;
type OfflineCard = { savedAt: number; card: CardInfo; me: MeInfo };

function rememberOfflineCard(slug: string, card: CardInfo, me: MeInfo) {
  try {
    // Only keep a snapshot on a device where the customer chose to stay signed in.
    if (!localStorage.getItem(KEY(slug))) return;
    const { qr, payment, tick, ...view } = card;
    const { receipt, ...today } = view.today;
    const {
      code, phone, idNumber, ...member
    } = view.member;
    localStorage.setItem(OFFLINE_KEY(slug), JSON.stringify({
      savedAt: Date.now(),
      card: { ...view, today, member: { ...member, code: '', phone: '' } },
      me: { name: me.name, phone: '', cards: me.cards },
    }));
  } catch { /* The live card works if device storage is unavailable. */ }
}

function readOfflineCard(slug: string, cardId?: string, programId?: string): OfflineCard | null {
  try {
    if (!loadSession(slug)) return null;
    const saved = JSON.parse(localStorage.getItem(OFFLINE_KEY(slug)) ?? 'null') as OfflineCard | null;
    if (!saved || Date.now() - saved.savedAt >= OFFLINE_MAX_AGE) return null;
    if ((cardId && saved.card.cardId !== cardId) || (programId && saved.card.programId !== programId)) return null;
    if (saved.card.today.serverTime !== undefined) saved.card.today.serverTime += Math.max(0, Date.now() - saved.savedAt);
    return saved;
  } catch { return null; }
}

export function loadSession(slug: string): string | null {
  try { const raw = sessionStorage.getItem(KEY(slug)) ?? localStorage.getItem(KEY(slug)); if (!raw) return null; const s = JSON.parse(raw) as { token: string; exp: number }; if (s.exp < Date.now()) { clearSession(slug); return null; } return s.token; } catch { return null; }
}
export function saveSession(slug: string, token: string, expiresAt: string, remember: boolean) {
  const v = JSON.stringify({ token, exp: Date.parse(expiresAt) }); try { localStorage.removeItem(OFFLINE_KEY(slug)); localStorage.removeItem(KEY(slug)); sessionStorage.removeItem(KEY(slug)); (remember ? localStorage : sessionStorage).setItem(KEY(slug), v); (remember ? sessionStorage : localStorage).removeItem(KEY(slug)); } catch { /* optional */ }
}
/** The user name is remembered on this phone, so a returning customer only types the passcode. It is not a secret on its own. */
const UKEY = (slug: string) => `bz-user:${slug}`;
export const loadUser = (slug: string): string => { try { return localStorage.getItem(UKEY(slug)) ?? ''; } catch { return ''; } };
export const saveUser = (slug: string, u: string) => { try { if (u) localStorage.setItem(UKEY(slug), u); } catch { /* optional */ } };
export const forgetUser = (slug: string) => { try { localStorage.removeItem(UKEY(slug)); } catch { /* optional */ } };
export function clearSession(slug: string) { try { sessionStorage.removeItem(KEY(slug)); localStorage.removeItem(KEY(slug)); localStorage.removeItem(OFFLINE_KEY(slug)); } catch { /* optional */ } }

const fieldBase = 'mt-1 w-full rounded-xl border border-[#D9DEE5] bg-white px-3.5 text-base outline-none focus:border-[#0E1722]';
const field = `${fieldBase} min-h-12`;
const mealField = `${fieldBase} min-h-11`;
function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return <div role="dialog" aria-modal="true" aria-label={label} className="fixed inset-0 z-[300] flex items-end justify-center bg-black/50 sm:items-center" onClick={onClose}><div onClick={(e) => e.stopPropagation()} className="max-h-[92vh] w-full max-w-md space-y-3 overflow-auto rounded-t-3xl bg-white p-5 sm:rounded-3xl">{children}</div></div>;
}

export function PlansSection({ b, lang, preview, onJoin, onOpen }: { b: PublicBusiness; lang: Lang; preview: boolean; onJoin: (p: Program) => void; onOpen: () => void }) {
  const { tx, t } = useWords(b, lang); const theme = THEMES[b.theme] ?? THEMES.gold;
  if (!b.programs?.length) return null;
  return (
    <section id="plans" className="scroll-mt-20">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-2xl font-semibold tracking-tight"><UtensilsCrossed size={22} aria-hidden="true" />{t("{Programs}")}</h2>
        {!preview && <button type="button" onClick={onOpen} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#E7EAEE] bg-white px-4 text-sm font-semibold"><Ticket size={16} aria-hidden="true" />{t("My {pass}")}</button>}
      </div>
      <p className="mb-4 max-w-xl text-sm text-[#5B6470]">{t("Pay once, then just show your {pass} each time.")}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {b.programs.map((p) => (
          <article key={p.id} className="flex flex-col rounded-3xl border border-[#E7EAEE] bg-white p-5">
            <h3 className="font-display text-lg font-semibold">{p.title}</h3>
            <p className="mt-1 font-display text-2xl font-semibold tabular-nums">{rwf(p.priceRwf)}</p>
            <p className="text-sm text-[#5B6470]">{p.days} {tx("days")}{p.totalUses ? ` · ${p.totalUses} ${useWordsUses(b, lang)}` : ''} · {p.items.join(' + ')} · {daysText(p.openDays, tx)}</p>
            {(p.tariffs?.length ?? 0) > 1 && <p className="mt-1 text-xs text-[#5B6470]">{p.tariffs.map(x => `${x.days} ${tx('days')} · ${rwf(x.priceRwf)}`).join('  /  ')}</p>}
            {p.windows?.length ? <p className="mt-1 text-xs text-[#5B6470]">{p.windows.map((w) => `${w.item} ${w.from}–${w.to}`).join(' · ')}</p> : null}
            {p.description && <p className="mt-2 text-sm text-[#3A4350]">{p.description}</p>}
            {p.terms && <p className="mt-2 text-xs text-[#5B6470]">{p.terms}</p>}
            <button type="button" disabled={preview} onClick={() => onJoin(p)} style={{ background: theme.accent, color: theme.on }} className="mt-4 min-h-12 rounded-xl px-4 text-base font-semibold disabled:opacity-50">{p.full ? t('Open my {pass}') : preview ? tx('Preview') : t('Join this {program}')}</button>
          </article>))}
      </div>
    </section>
  );
}
const useWordsUses = (b: PublicBusiness, lang: Lang) => wordsOf(b.programText, lang === 'rw' ? RW_WORDS : undefined).uses;

/* ---- first visit: details, then the customer's own passcode ---- */
export function JoinFlow({ b, lang, program, onClose, onDone, renewing = false }: { renewing?: boolean; b: PublicBusiness; lang: Lang; program: Program; onClose: () => void; onDone: () => void }) {
  const { tx, t, w } = useWords(b, lang); const theme = THEMES[b.theme] ?? THEMES.gold;
  const tariffs = program.tariffs?.length ? program.tariffs : [{ days: program.days, priceRwf: program.priceRwf }];
  const [tariffDays, setTariffDays] = useState(tariffs[0].days);
  const tariff = tariffs.find(x => x.days === tariffDays) ?? tariffs[0];
  const [entry, setEntry] = useState<'choice' | 'signin' | 'join'>(renewing && !program.full ? 'join' : 'choice');
  const [step, setStep] = useState<1 | 2>(1); const [names, setNames] = useState<string[]>([]); const [f, setF] = useState({ username: '', name: '', phone: '', idNumber: '', joinCode: '', website: '', pin: '', pin2: '', remember: true }); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const next = (e: React.FormEvent) => { e.preventDefault(); setErr(''); if (f.name.trim().length < 2) return setErr(tx('Please write your name.')); if (f.phone.replace(/\D/g, '').length < 9) return setErr(tx('Please write a phone number we can reach.')); if (program.needsCode && !/^\d{4}$/.test(f.joinCode.replace(/\D/g, ''))) return setErr(tx('Write the 4-digit join code the business gave you.')); setStep(2); if (renewing) return; void publicApi.usernames(b.slug, f.name).then((s) => { setNames(s); setF((p) => (p.username ? p : { ...p, username: s[0] ?? '' })); }).catch(() => undefined); };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('');
    if (f.username && !/^[a-z0-9]{3,12}$/.test(f.username)) return setErr(tx('A user name is 3 to 12 letters or numbers, with no spaces.'));
    if (!/^\d{4,6}$/.test(f.pin)) return setErr(tx('Choose a passcode of 4 to 6 digits.')); if (f.pin !== f.pin2) return setErr(tx('The two passcodes do not match.'));
    setBusy(true);
    try { const r = await publicApi.join(b.slug, program.id, { name: f.name, phone: f.phone, username: f.username || undefined, passcode: f.pin, joinCode: program.needsCode ? f.joinCode : undefined, idNumber: f.idNumber || undefined, remember: f.remember, website: f.website, tariffDays: tariff.days }); saveSession(b.slug, r.session, r.expiresAt, f.remember); saveUser(b.slug, r.username); onDone(); }
    catch (x) { const m = x instanceof Error ? x.message : tx('Something went wrong. Please try again.'); setErr(m); if (/join code/i.test(m)) setStep(1); } finally { setBusy(false); }
  };
  if (entry === 'signin') return <SignIn b={b} lang={lang} onClose={() => setEntry('choice')} onDone={onDone} />;
  if (entry === 'choice') return <Sheet label={program.title} onClose={onClose}>
    <h2 className="font-display text-xl font-semibold">{program.title}</h2>
    <button className="min-h-12 w-full rounded-xl px-4 font-semibold" style={{ background: theme.accent, color: theme.on }} onClick={() => setEntry('signin')}>{tx("Enter passcode to open my card")}</button>
    <button disabled={program.full} className="min-h-12 w-full rounded-xl border px-4 font-semibold disabled:opacity-50" onClick={() => setEntry('join')}>{program.full ? t('This {program} is full') : tx("Join as a new member")}</button>
    <button className="min-h-10 w-full" onClick={onClose}>{tx("Close")}</button>
  </Sheet>;
  return (
    <Sheet label={t("Join this {program}")} onClose={onClose}>
      <div className="flex items-start justify-between gap-3"><div><h2 className="font-display text-xl font-semibold">{program.title}</h2><p className="text-sm text-[#5B6470]">{rwf(tariff.priceRwf)} · {tariff.days} {tx("days")}</p></div>
        <button type="button" onClick={onClose} aria-label={tx("Close")} className="rounded-full p-2 hover:bg-[#F2F4F7]"><X size={18} /></button></div>
      <p className="text-xs font-semibold uppercase tracking-wide text-[#5B6470]">{tx("Step")} {step} / 2 · {step === 1 ? tx('Your details') : tx('Your user name and passcode')}</p>
      {step === 1 ? (
        <form onSubmit={next} className="space-y-3">
          {tariffs.length > 1 && <label className="block text-sm font-medium">{tx("Choose your card option")}<select className={field} value={tariffDays} onChange={(e) => setTariffDays(Number(e.target.value))}>{tariffs.map(option => <option key={option.days} value={option.days}>{option.days} {tx("days")} · {rwf(option.priceRwf)}</option>)}</select></label>}
          <label className="block text-sm font-medium">{tx("Your name")}<input className={field} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={60} autoComplete="name" /></label>
          <label className="block text-sm font-medium">{tx("Phone number")}<input className={field} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} required inputMode="tel" autoComplete="tel" placeholder="0788 123 456" /></label>
          {program.needsCode && <label className="block text-sm font-medium">{tx("Join code")}<input className={`${field} font-mono text-xl tracking-[0.5em]`} value={f.joinCode} onChange={(e) => setF({ ...f, joinCode: e.target.value.replace(/\D/g, '').slice(0, 4) })} inputMode="numeric" maxLength={4} placeholder="••••" required /><span className="mt-1 block text-xs font-normal text-[#5B6470]">{tx("4 digits, given to you by the business.")}</span></label>}
          {w.askId && <label className="block text-sm font-medium">{w.idLabel} ({tx("optional")})<input className={field} value={f.idNumber} onChange={(e) => setF({ ...f, idNumber: e.target.value })} maxLength={30} /></label>}
          <input value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 opacity-0" />
          {err && <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</p>}
          <button type="submit" style={{ background: theme.accent, color: theme.on }} className="min-h-12 w-full rounded-xl text-base font-semibold">{tx("Next")}</button>
        </form>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          {!renewing && <div className="block text-sm font-medium">{tx("Your user name")}
            <input className={`${field} font-semibold`} value={f.username} onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) })} maxLength={12} autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username" aria-label={tx("Your user name")} />
            {names.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label={tx("Suggestions")}>{names.map((n) => <button key={n} type="button" aria-pressed={f.username === n} onClick={() => setF({ ...f, username: n })} className={`min-h-9 rounded-full border px-3 text-sm font-semibold ${f.username === n ? 'border-[#0E1722] bg-[#0E1722] text-white' : 'border-[#D9DEE5] bg-white'}`}>{n}</button>)}</div>}
            <span className="mt-1 block text-xs font-normal text-[#5B6470]">{tx("Short, so it is easy to type. This phone will remember it.")}</span></div>}
          <p className="rounded-xl bg-[#F2F4F7] p-3 text-sm text-[#3A4350]">{t("You will use this passcode every time you open your {pass}. Do not share it.")}</p>
          <label className="block text-sm font-medium">{renewing ? tx("Your existing passcode") : tx("Passcode")} <span className="font-normal text-[#5B6470]">({tx("4 to 6 digits")})</span><input className={`${field} font-mono text-xl tracking-[0.4em]`} type="password" value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value.replace(/\D/g, '').slice(0, 6) })} inputMode="numeric" autoComplete="new-password" required autoFocus /></label>
          <label className="block text-sm font-medium">{renewing ? tx("Confirm existing passcode") : tx("Confirm passcode")}<input className={`${field} font-mono text-xl tracking-[0.4em]`} type="password" value={f.pin2} onChange={(e) => setF({ ...f, pin2: e.target.value.replace(/\D/g, '').slice(0, 6) })} inputMode="numeric" autoComplete="new-password" required /></label>
          <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-0.5 h-5 w-5" checked={f.remember} onChange={(e) => setF({ ...f, remember: e.target.checked })} />{tx("Keep me signed in on this phone for 30 days")}</label>
          {err && <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</p>}
          <div className="flex gap-2"><button type="button" onClick={() => { setStep(1); setErr(''); }} className="min-h-12 rounded-xl border border-[#D9DEE5] px-4 text-base font-semibold">{tx("Back")}</button>
            <button type="submit" disabled={busy} style={{ background: theme.accent, color: theme.on }} className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl text-base font-semibold disabled:opacity-60">{busy ? <Loader2 className="animate-spin" size={18} /> : <Ticket size={18} />}{t("Get my {pass}")}</button></div>
          <p className="text-center text-xs text-[#5B6470]">{tx("You will pay on the next screen.")}</p>
        </form>
      )}
    </Sheet>
  );
}

/* ---- coming back: phone number and passcode ---- */
export function SignIn({ b, lang, onClose, onDone, app = false }: { b: PublicBusiness; lang: Lang; onClose: () => void; onDone: (passcode: string) => void; app?: boolean }) {
  const { tx, t } = useWords(b, lang); const theme = THEMES[b.theme] ?? THEMES.gold; const [known, setKnown] = useState(() => loadUser(b.slug)); const [f, setF] = useState({ who: '', pin: '', remember: true }); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const go = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); setErr(''); try { const who = (known || f.who).trim(); const byName = /[a-z]/i.test(who); const r = await publicApi.login(b.slug, byName ? { username: who, passcode: f.pin, remember: f.remember } : { phone: who, passcode: f.pin, remember: f.remember }); saveSession(b.slug, r.session, r.expiresAt, f.remember); saveUser(b.slug, r.username); onDone(f.pin); } catch (x) { setErr(x instanceof Error ? x.message : tx('Something went wrong. Please try again.')); } finally { setBusy(false); } };
  const content = <>
      {app && <div className="mb-5 flex items-center gap-3"><img src={`/api/biz/public/${encodeURIComponent(b.slug)}/icon-192.png`} alt="" width={48} height={48} className="rounded-xl" /><h1 className="font-display text-xl font-semibold">{b.name}</h1></div>}
      <div className="flex items-start justify-between gap-3"><h2 className="font-display text-xl font-semibold">{t("Sign in to your {pass}")}</h2><button type="button" onClick={onClose} aria-label={tx("Close")} className="rounded-full p-2 hover:bg-[#F2F4F7]"><X size={18} /></button></div>
      <form onSubmit={go} className="space-y-3">
        {known
          ? <p className="flex items-center justify-between gap-2 rounded-xl bg-[#F2F4F7] px-3 py-2.5 text-sm"><span>{tx("Signing in as")} <b className="text-base">{known}</b></span><button type="button" onClick={() => { forgetUser(b.slug); setKnown(''); }} className="min-h-9 px-2 font-semibold underline">{tx("Not you?")}</button></p>
          : <label className="block text-sm font-medium">{tx("User name or phone number")}<input className={field} value={f.who} onChange={(e) => setF({ ...f, who: e.target.value })} required autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username" /></label>}
        <label className="block text-sm font-medium">{tx("Passcode")}<input className={`${field} font-mono text-xl tracking-[0.4em]`} type="password" value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value.replace(/\D/g, '').slice(0, 6) })} inputMode="numeric" autoComplete="current-password" required autoFocus={!!known} /></label>
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-0.5 h-5 w-5" checked={f.remember} onChange={(e) => setF({ ...f, remember: e.target.checked })} />{tx("Keep me signed in on this phone for 30 days")}</label>
        {err && <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</p>}
        <button type="submit" disabled={busy} style={{ background: theme.accent, color: theme.on }} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl text-base font-semibold disabled:opacity-60">{busy ? <Loader2 className="animate-spin" size={18} /> : <KeyRound size={18} />}{tx("Sign in")}</button>
        <p className="text-center text-xs text-[#5B6470]">{tx("Forgot your passcode? Ask the business to reset it.")}</p>
      </form>
  </>;
  const label = t("Sign in to your {pass}");
  return app ? <main className="fixed inset-0 z-[300] overflow-auto bg-[#F5F7FA] px-4 py-8"><section aria-label={label} className="mx-auto max-w-md space-y-3 rounded-2xl bg-white p-5 shadow-sm">{content}</section></main>
    : <Sheet label={label} onClose={onClose}>{content}</Sheet>;
}

/* ---- the card, laid out like the paper one ---- */
const BLOCK = 15;
export function CardWatermark({ businessId, image }: { businessId?: string; image?: string }) {
  if (!businessId || !image) return null;
  return <img alt="" aria-hidden="true" draggable={false} src={stampImageUrl(businessId, image)}
    className="pointer-events-none absolute inset-0 -z-10 m-auto h-[82%] w-[82%] select-none object-contain opacity-20" />;
}

function useMealClock(serverTime?: number, history?: CardInfo['history']) {
  const [now, setNow] = useState(serverTime ?? Date.now());
  useEffect(() => {
    const start = performance.now();
    const initial = serverTime ?? Date.now();
    const deadlines = (history ?? []).map(tickDeadline);
    let timer = 0;
    function refresh() {
      window.clearTimeout(timer);
      const time = initial + performance.now() - start;
      setNow(time);
      const future = deadlines.filter(deadline => deadline > time);
      if (future.length) timer = window.setTimeout(refresh, Math.ceil(Math.min(...future) - time));
    }
    refresh();
    document.addEventListener('visibilitychange', refresh);
    return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [serverTime, history]);
  return now;
}

const mealTickStyle = <style>{`
        @media (prefers-reduced-motion: no-preference) {
          .biz-meal-tick-path {
            stroke-dasharray: 1;
            animation: bizMealTickDraw 1.2s ease-out both;
          }
        }
        @keyframes bizMealTickDraw {
          from { stroke-dashoffset: 1; }
          to { stroke-dashoffset: 0; }
        }
      `}</style>;
function PendingMealTick({ label, color }: { label: string; color?: string }) {
  return <svg width={22} height={22} viewBox="0 0 52 52" fill="none" stroke="currentColor" role="img" aria-label={label} className="shrink-0" style={{ color }}>
                        <circle cx="26" cy="26" r="23" strokeWidth="3" />
                        <path className="biz-meal-tick-path" pathLength={1} d="M14.1 27.2l7.1 7.2 16.7-16.8" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>;
}

export function PaperCard({ b, card, w, animateMealTicks = false }: { b: Pick<PublicBusiness, 'category' | 'theme' | 'name' | 'contact' | 'verified'>; card: CardInfo; w: ReturnType<typeof wordsOf>; animateMealTicks?: boolean }) {
  const tx = useTx(); const theme = THEMES[b.theme] ?? THEMES.gold; const cat = CATEGORIES.find((c) => c.id === b.category)?.label ?? '';
  const layout = card.program.cardLayout;
  const cal = card.calendar.filter((day) => !layout?.hiddenDates.includes(day.date));
  const blocks = Math.max(1, Math.ceil(cal.length / BLOCK)); const todayIdx = cal.findIndex((d) => d.date >= card.today.date);
  const [blk, setBlk] = useState(() => (todayIdx >= 0 ? Math.floor(todayIdx / BLOCK) : blocks - 1));
  const block = Math.min(blk, blocks - 1);
  const rows = cal.slice(block * BLOCK, block * BLOCK + BLOCK);
  const items = card.program.items.filter((item) => !layout?.hiddenItems.includes(item));
  const shuffle = b.category === 'restaurant' && card.program.shuffleCardColor;
  const checkedColor = card.today.checkedMeal?.color;
  const ink = checkedColor ? mealInk(checkedColor) : '#14213D';
  const paper = card.today.weekly ? checkedColor ?? '#ffffff' : shuffle ? dailyMealPaper(card.today.date, card.program.cardColor) : card.today.used.length ? cardPaper(card.program.arrivalColor ?? '#86efac') : card.program.cardColor ? cardPaper(card.program.cardColor) : `color-mix(in srgb, ${theme.accent} 16%, #FFFFFF)`; const line = `color-mix(in srgb, ${ink} 35%, ${paper})`;
  const m = card.member; const local = (x: string) => (x.startsWith('250') ? `0${x.slice(3)}` : x); const phones = [b.contact.phone, b.contact.whatsapp].filter((x): x is string => !!x).map(local).filter((x, i, a) => a.indexOf(x) === i);
  const guestCard = b.category === 'restaurant' && card.program.checkIn === 'self';
  const now = useMealClock(card.today.serverTime, card.history);
  const balance = guestCard && card.program.totalUses ? Math.max(0, card.program.totalUses - m.usedTotal) : m.usesLeft;
  const stamp = m.paid ? { text: tx('PAID'), color: '#2848C8' } : { text: tx('NOT PAID'), color: '#B91C1C' };
  const short = (s: string) => (s.length > 10 ? `${s.slice(0, 9)}…` : s);
  return (
    <div className="relative isolate overflow-hidden rounded-2xl border p-4 shadow-sm" style={{ background: paper, borderColor: line, color: ink }}>
      {animateMealTicks && mealTickStyle}
      <CardWatermark businessId={card.business.id} image={card.program.stampImage} />
      <span aria-hidden="true" className="absolute left-1/2 top-2 h-3 w-3 -translate-x-1/2 rounded-full border" style={{ background: '#F5F7FA', borderColor: line }} />
      <div className="mt-3 text-center">
        {cat && <p className="text-[11px] font-bold uppercase tracking-[0.25em]" style={{ color: `color-mix(in srgb, ${ink} 70%, ${paper})` }}>{cat}</p>}
        <p className="font-display text-3xl font-semibold uppercase leading-tight tracking-wide">{b.name}{b.verified && <VerifiedBadge size={18} className="ml-1" />}</p>
        {phones.length > 0 && <p className="mt-1 text-sm font-semibold">Tel: {phones.join(' / ')}</p>}
      </div>
      <div className="relative mt-4 space-y-2 text-[15px]">
        <p className="flex items-end gap-2"><b className="shrink-0">{tx('Name')}:</b><span className="flex-1 border-b border-dotted px-1 font-semibold" style={{ borderColor: ink }}>{m.name}</span></p>
        <p className="flex items-end gap-2"><b className="shrink-0">{tx('Period')}:</b><span className="flex-1 border-b border-dotted px-1 font-semibold" style={{ borderColor: ink }}>{shortDate(m.startDate)} → {shortDate(m.endDate)}</span></p>
        <p className="flex items-end gap-2"><b className="shrink-0">{card.program.title}</b><span className="flex-1 border-b border-dotted px-1 text-right font-mono tracking-wider" style={{ borderColor: ink }}>{m.code}</span></p>
        {m.idNumber && <p className="flex items-end gap-2"><b className="shrink-0">{w.idLabel}:</b><span className="flex-1 border-b border-dotted px-1" style={{ borderColor: ink }}>{m.idNumber}</span></p>}
        <span aria-hidden="true" className="pointer-events-none absolute -right-1 -top-1 rotate-[-10deg] rounded-md border-2 px-2 py-0.5 text-center text-[11px] font-extrabold leading-tight tracking-wider" style={{ color: stamp.color, borderColor: stamp.color, opacity: 0.85 }}>{stamp.text}<br /><span className="text-[9px] font-bold">{b.name}</span></span>
      </div>
      <div className="mt-4 overflow-hidden rounded-lg border" style={{ borderColor: ink }}>
        <table className="w-full table-fixed border-collapse text-center text-sm" aria-label={tx('Dates and uses')}>
          <thead><tr style={{ background: `color-mix(in srgb, ${ink} 8%, transparent)` }}><th className="w-16 border-b border-r px-1 py-1.5 text-xs font-extrabold" style={{ borderColor: ink }}>{tx('Date')}</th>{items.map((it) => <th key={it} title={it} className="border-b border-r px-1 py-1.5 text-xs font-extrabold last:border-r-0" style={{ borderColor: ink }}>{short(it)}</th>)}</tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={items.length + 1} className="p-3">{tx('No dates shown')}</td></tr>}
            {rows.map((d) => { const isToday = d.date === card.today.date; return (
              <tr key={d.date} style={isToday && !shuffle && !card.today.weekly ? { background: `color-mix(in srgb, ${theme.accent} 28%, transparent)` } : undefined}>
                <th scope="row" className="border-b border-r px-1 py-1 text-left text-xs font-bold" style={{ borderColor: line }}><span className="text-base tabular-nums">{dayNum(d.date)}</span> <span className="font-semibold opacity-70">{tx(DAY[d.dow])}</span>{isToday && <span className="sr-only"> {tx('today')}</span>}</th>
                {items.map((it) => { const count = d.used.filter(item => item === it).length; const used = count > 0; const latest = card.history?.filter(u => (u.cellDate ?? u.date) === d.date && u.item === it).at(-1); const at = latest?.at; const aged = (guestCard || animateMealTicks) && latest && now >= tickDeadline(latest); const Mark = aged ? CheckCheck : Check;
                  return <td key={it} title={used ? `${it}${at ? ` ${clock(at)}` : ''}` : undefined} className="relative h-9 overflow-hidden border-b border-r p-0 text-lg last:border-r-0" style={{ borderColor: line, ...(!d.open ? { background: `repeating-linear-gradient(135deg, transparent 0 4px, color-mix(in srgb, ${ink} 14%, transparent) 4px 5px)` } : {}) }}>
                    {used ? <span className="inline-flex items-center gap-1">{animateMealTicks && latest && !aged ? (
                      <PendingMealTick key={latest.id ?? latest.at} label={`${it}: ${tx("Checked in")}`} color={ink} />
                    ) : <Mark size={animateMealTicks ? 22 : 20} strokeWidth={2.2} role="img" aria-label={`${it}: ${aged ? tx("Check-in timer elapsed") : tx("Checked in")}`} className="relative mx-auto" style={{ color: guestCard ? ink : '#047857' }} />}{count > 1 && <b className="text-sm">×{count}</b>}</span> : !d.open ? <span className="text-xs opacity-50" aria-label={tx('Closed')}>—</span> : null}</td>; })}
              </tr>); })}
          </tbody>
        </table>
      </div>
      {blocks > 1 && <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label={tx('Show days')}>{Array.from({ length: blocks }, (_, i) => <button key={i} type="button" aria-pressed={block === i} onClick={() => setBlk(i)} className="min-h-9 rounded-lg border px-2.5 text-xs font-semibold" style={block === i ? { background: ink, color: '#fff', borderColor: ink } : { borderColor: line }}>{layout?.hiddenDates.length ? `${shortDate(cal[i * BLOCK].date)} – ${shortDate(cal[Math.min(cal.length, (i + 1) * BLOCK) - 1].date)}` : `${tx('Days')} ${i * BLOCK + 1}–${Math.min(cal.length, (i + 1) * BLOCK)}`}</button>)}</div>}
      <div className="mt-3 grid grid-cols-2 gap-2 text-left"><div className="rounded-xl border p-2.5" style={{ borderColor: line }}><p className="text-xs opacity-70">{guestCard && !card.program.totalUses ? tx('Servings recorded') : fill('{Uses} left', w)}</p><p className="font-display text-xl font-semibold tabular-nums">{guestCard && !card.program.totalUses ? m.usedTotal : balance}</p></div><div className="rounded-xl border p-2.5" style={{ borderColor: line }}><p className="text-xs opacity-70">{tx('Valid until')}</p><p className="font-display text-xl font-semibold">{shortDate(m.endDate)}</p></div></div>
    </div>
  );
}

function scanVenueCode(raw: string, slug: string): string | null {
  const text = raw.trim();
  if (/^\d{6}$/.test(text)) return text;
  try {
    const url = new URL(text);
    const isBwenge = url.protocol === 'https:' && /^(www\.)?bwenge\.(space|biz)$/.test(url.hostname);
    if (url.origin !== window.location.origin && !isBwenge) return null;
    const code = url.searchParams.get('tick');
    return url.pathname.replace(/\/$/, '') === `/b/${encodeURIComponent(slug)}` && code && /^\d{6}$/.test(code) ? code : null;
  } catch {
    return null;
  }
}

/* ---- the customer's dashboard ---- */
export function Dashboard({ b, lang, onClose, onSignedOut, programId, initialCard, scanCode, takeScanPasscode }: { b: PublicBusiness; lang: Lang; onClose: () => void; onSignedOut: () => void; programId?: string; initialCard?: string; scanCode?: string; takeScanPasscode?: () => string }) {
  const { tx, t, w } = useWords(b, lang); const theme = THEMES[b.theme] ?? THEMES.gold; const slug = b.slug;
  const [me, setMe] = useState<MeInfo | null>(null); const [card, setCard] = useState<CardInfo | null>(null); const [sel, setSel] = useState<string | undefined>(initialCard); const [err, setErr] = useState('');
  const [phone, setPhone] = useState(''); const [ref, setRef] = useState(''); const [busy, setBusy] = useState(false); const [big, setBig] = useState(false); const [pinOpen, setPinOpen] = useState(false); const [pins, setPins] = useState({ cur: '', next: '' }); const [pinMsg, setPinMsg] = useState('');
  const [offline, setOffline] = useState(() => !navigator.onLine);
  const [syncedAt, setSyncedAt] = useState<number>();
  const [tab, setTab] = useState<'today' | 'card' | 'manage'>('today');
  const [manualCode, setManualCode] = useState(false);
  const [newCardDays, setNewCardDays] = useState<number>(); const [addingCard, setAddingCard] = useState(false);
  const waiting = useRef(false); const session = () => loadSession(slug);
  const [typed, setTyped] = useState(''); const [flash, setFlash] = useState('');
  const [camera, setCamera] = useState(false);
  const [confirmationCode, setConfirmationCode] = useState('');
  const [useCurrentCode, setUseCurrentCode] = useState(false);
  const [scanPasscode, setScanPasscode] = useState('');
  const [checkinError, setCheckinError] = useState('');
  const [mealBox, setMealBox] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [batchId, setBatchId] = useState('');
  const receiptClock = useMealClock(card?.today.serverTime, card?.history);
  const checkingIn = useRef(false);
  const fail = useCallback((e: unknown) => { const m = e instanceof Error ? e.message : tx('Something went wrong. Please try again.'); if (/sign in again/i.test(m)) { clearSession(slug); onSignedOut(); return; } setErr(m); }, [slug, onSignedOut, tx]);
  const load = useCallback(async () => {
    const s = session();
    if (!s) { onSignedOut(); return; }
    try {
      const m = await publicApi.me(slug, s);
      const id = sel ?? m.cards.find(entry => entry.programId === programId)?.id;
      if (programId && !id) throw new Error(tx('You have no card for this program. Open the program link and choose Join as a new member.'));
      const c = await publicApi.card(slug, s, id);
      if (session() !== s) return;
      setMe(m);
      setCard(c);
      setErr('');
      setOffline(false);
      setSyncedAt(Date.now());
      waiting.current = !!c.payment?.promptSent;
      if (!sel) setSel(c.cardId);
      if (b.category === 'restaurant') rememberOfflineCard(slug, c, m);
    } catch (e) {
      if (session() !== s) return;
      if (b.category === 'restaurant' && (!navigator.onLine || e instanceof TypeError)) {
        const saved = readOfflineCard(slug, sel, programId);
        setOffline(true);
        setCard(current => current ?? saved?.card ?? null);
        if (saved) { setMe(current => current ?? saved.me); setSyncedAt(saved.savedAt); }
        setErr('');
        return;
      }
      setCard(null);
      fail(e);
    }
  }, [slug, sel, programId, fail, onSignedOut, b.category, tx]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => { if (navigator.onLine) void load(); }, waiting.current ? 4000 : 15_000);
    const reconnect = () => { void load(); };
    const disconnect = () => { if (b.category === 'restaurant') { setOffline(true); setCamera(false); setScanPasscode(''); } };
    const visible = () => { if (navigator.onLine && document.visibilityState === 'visible') reconnect(); };
    window.addEventListener('online', reconnect);
    window.addEventListener('offline', disconnect);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('online', reconnect);
      window.removeEventListener('offline', disconnect);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [load, card?.payment?.promptSent, b.category]);
  useEffect(() => {
    const id = card?.cardId;
    const version = card?.version;
    const token = session();
    if (offline || b.category !== 'restaurant' || !id || !version || !token || card?.member.state !== 'active') return;
    const controller = new AbortController();
    let timer = 0;
    async function watch() {
      try {
        const next = await publicApi.card(slug, token!, id, version, controller.signal);
        if (controller.signal.aborted || session() !== token) return;
        setCard(next);
        if (me) rememberOfflineCard(slug, next, me);
        setSyncedAt(Date.now());
        if (next.version === version) timer = window.setTimeout(watch, 0);
      } catch {
        if (!controller.signal.aborted) timer = window.setTimeout(watch, 3000);
      }
    }
    void watch();
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [slug, b.category, card?.cardId, card?.member.state, card?.version, offline, me]);
  const act = async (fn: (s: string, id: string) => Promise<unknown>) => { const s = session(); if (offline || !s || !card) return; setBusy(true); setErr(''); try { await fn(s, card.cardId); await load(); } catch (e) { fail(e); } finally { setBusy(false); } };
  const addCard = async () => {
    const s = session(); const days = newCardDays ?? card?.program.tariffs[0]?.days;
    if (offline || !s || !card?.programId || days === undefined) return;
    setAddingCard(true); setErr('');
    try {
      const { cardId } = await publicApi.addCard(slug, s, card.programId, days);
      setSel(cardId); setNewCardDays(undefined);
      const [nextMe, nextCard] = await Promise.all([publicApi.me(slug, s), publicApi.card(slug, s, cardId)]);
      setMe(nextMe); setCard(nextCard); setFlash(tx('Card added. Complete payment to activate it.'));
    } catch (e) { fail(e); }
    finally { setAddingCard(false); }
  };
  async function doTick(code: string, passcode?: string, currentCode = false) {
    const token = session();
    if (offline || !token || checkingIn.current) return;
    checkingIn.current = true;
    setBusy(true);
    setCheckinError('');
    setFlash('');
    try {
      const batch = b.category === 'restaurant' ? { batchId, quantity: Number(quantity), item: mealBox || undefined } : undefined;
      const result = await publicApi.tick(slug, token, code, passcode, batch ? card?.cardId : undefined, batch, currentCode);
      setConfirmationCode('');
      setUseCurrentCode(false);
      setTyped('');
      setSel(result.cardId);
      setFlash(batch ? `${result.item} × ${batch.quantity} · ${tx('ticked')}` : `${result.item} ${tx('ticked')}`);
      if (result.cardId === card?.cardId) await load();
    } catch (error) {
      if (error instanceof BizApiError && error.code === 'SESSION') {
        fail(error);
      } else {
        if (error instanceof TypeError && b.category === 'restaurant') {
          setOffline(true);
          setCheckinError(tx('Reconnect to verify your check-in. If it is missing, re-enter your passcode to retry.'));
          return;
        }
        if (error instanceof BizApiError && error.code === 'BAD_CODE') setConfirmationCode('');
        setCheckinError(error instanceof Error ? error.message : tx('Something went wrong. Please try again.'));
      }
    } finally {
      setScanPasscode('');
      setBusy(false);
      checkingIn.current = false;
    }
  }

  function prepareCheckin(code: string, passcode?: string, currentCode = false) {
    setCamera(false);
    setCheckinError('');
    setFlash('');
    if (b.category === 'restaurant' || card?.tick?.requiresPasscode) {
      setConfirmationCode(currentCode ? 'current-code' : code);
      setUseCurrentCode(currentCode);
      setScanPasscode(passcode ?? '');
      setMealBox(card?.tick?.items.find(option => option.allowed)?.item ?? card?.program.items.find(isFlexibleMeal) ?? '');
      setQuantity('1');
      setBatchId(crypto.randomUUID());
    } else {
      void doTick(code);
    }
  }

  const scanner = useScanner(camera && card?.member.state === 'active' && !!card.tick, (raw) => {
    const code = scanVenueCode(raw, slug);
    if (code) prepareCheckin(code);
    else setCheckinError(tx("Scan the check-in QR shown at this business."));
  }, tx);

  // A link opened by the phone camera uses the same confirmation as an in-app scan.
  const auto = useRef(false);
  useEffect(() => {
    if (offline || !scanCode || auto.current || !card) return;
    auto.current = true;
    prepareCheckin(scanCode, takeScanPasscode?.());
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('tick');
      window.history.replaceState({}, '', url.pathname + url.search);
    } catch { /* optional */ }
  }, [scanCode, card, offline]); // eslint-disable-line react-hooks/exhaustive-deps
  const restaurant = b.category === 'restaurant';
  const m = card?.member; const usedUp = !!card && m?.state === 'active' && !!card.program.totalUses && m.usedTotal >= card.program.totalUses;
  const tone = !m ? '#5B6470' : usedUp ? '#B91C1C' : m.state === 'active' ? '#15803D' : m.state === 'pending' || m.state === 'not_started' ? '#B45309' : '#B91C1C';
  const label = !m ? '' : usedUp ? t('ALL {USES} TAKEN') : ({ active: tx('ACTIVE'), pending: tx('WAITING FOR PAYMENT'), not_started: tx('STARTS SOON'), expired: tx('PLAN ENDED'), paused: tx('PAUSED'), cancelled: tx('CANCELLED') } as Record<string, string>)[m.state];
  const showCheckin = (m?.state === 'active' && card?.tick) || confirmationCode || checkinError;
  const purchasePanel = !offline && card && m && card.canAddCards && (m.state === 'active' || m.state === 'expired') && card.program.tariffs.length > 0 && (
    <section className={`grid gap-2 rounded-2xl bg-white ${restaurant ? "p-3 min-[400px]:grid-cols-[minmax(0,1fr)_auto] md:grid-cols-1" : "p-4"}`}>
      {(!restaurant || m.state === 'expired') && <p className="col-span-full font-semibold">{m.state === 'expired' ? tx('Renew this card') : tx('Add another card')}</p>}
      <label className="block min-w-0 text-sm">{tx('Choose a duration and price')}
        <select className={restaurant ? mealField : field} value={newCardDays ?? card.program.tariffs[0].days} onChange={(e) => setNewCardDays(Number(e.target.value))}>
          {card.program.tariffs.map(option => <option key={option.days} value={option.days}>{option.days} {tx('days')} · {rwf(option.priceRwf)}</option>)}
        </select>
      </label>
      <button type="button" disabled={addingCard || busy} onClick={() => void addCard()} style={{ background: theme.accent, color: theme.on }} className="min-h-11 w-full self-end rounded-xl px-3 text-sm font-semibold disabled:opacity-50">
        {addingCard ? <Loader2 className="mx-auto animate-spin" size={18} /> : m.state === 'expired' ? tx('Request renewal') : tx('Add another card')}
      </button>
      <p className="col-span-full text-xs text-[#5B6470]">{tx('The card starts after the business confirms your payment.')}</p>
    </section>
  );
  return (
    <div role="dialog" aria-modal="true" aria-label={t("My {pass}")} className="fixed inset-0 z-[320] overflow-auto bg-[#F5F7FA]">
      <div className={`mx-auto pt-4 ${restaurant ? "max-w-4xl px-3 pb-20 sm:px-5 md:pb-10" : "max-w-md px-4"}`}>
        {restaurant && card && <nav aria-label={tx('Meal card sections')} className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-3 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
          {([['today', 'Today'], ['card', 'My card'], ['manage', 'Manage']] as const).map(([id, label]) => <button key={id} type="button" aria-current={tab === id ? 'page' : undefined} className={`min-h-12 text-sm font-semibold ${tab === id ? 'border-t-2 border-current text-slate-950' : 'text-slate-600'}`} onClick={() => { if (id !== 'today') setCamera(false); setTab(id); }}>{tx(label)}</button>)}
        </nav>}
        <div className="mb-3 flex items-center justify-between gap-2"><div className="min-w-0"><p className="truncate font-display text-lg font-semibold">{b.name}{b.verified && <VerifiedBadge size={18} className="ml-1" />}</p>{me && <p className="truncate text-sm text-[#5B6470]">{tx('Hello')}, {me.name}</p>}</div>
          <div className="flex items-center gap-1"><button type="button" onClick={() => setPinOpen((v) => !v)} aria-label={tx('Change passcode')} title={tx('Change passcode')} className="rounded-full p-2 hover:bg-white"><KeyRound size={18} /></button>
            <button type="button" onClick={async () => { const s = session(); try { if (s && !offline) await publicApi.logout(slug, s); } finally { clearSession(slug); onSignedOut(); } }} aria-label={tx('Sign out')} title={tx('Sign out')} className="rounded-full p-2 hover:bg-white"><LogOut size={18} /></button>
            <button type="button" onClick={onClose} aria-label={tx('Close')} className="rounded-full p-2 hover:bg-white"><X size={20} /></button></div></div>
        {pinOpen && !offline && <form className="mb-3 space-y-2 rounded-2xl bg-white p-4" onSubmit={async (e) => { e.preventDefault(); setPinMsg(''); const s = session(); if (!s) return; try { await publicApi.changePasscode(slug, s, pins.cur, pins.next); setPinMsg(tx('Passcode changed.')); setPins({ cur: '', next: '' }); } catch (x) { setPinMsg(x instanceof Error ? x.message : ''); } }}>
          <input className={`${field} font-mono tracking-[0.4em]`} type="password" inputMode="numeric" placeholder={tx('Current passcode')} value={pins.cur} onChange={(e) => setPins({ ...pins, cur: e.target.value.replace(/\D/g, '').slice(0, 6) })} />
          <input className={`${field} font-mono tracking-[0.4em]`} type="password" inputMode="numeric" placeholder={tx('New passcode')} value={pins.next} onChange={(e) => setPins({ ...pins, next: e.target.value.replace(/\D/g, '').slice(0, 6) })} />
          <button type="submit" className="min-h-11 w-full rounded-xl border-2 border-[#0E1722] text-sm font-semibold">{tx('Save')}</button>{pinMsg && <p role="status" className="text-sm text-[#3A4350]">{pinMsg}</p>}</form>}
        {me && me.cards.length > 1 && <div className="mb-3 flex gap-2 overflow-x-auto" role="tablist">{me.cards.map((c) => <button key={c.id} role="tab" aria-selected={card?.cardId === c.id} disabled={offline} type="button" onClick={() => { setCamera(false); setConfirmationCode(''); setScanPasscode(''); setCheckinError(''); setSel(c.id); setCard(null); }} className={`flex shrink-0 flex-col items-start rounded-xl px-3 py-2 text-left ${card?.cardId === c.id ? 'bg-[#0E1722] text-white' : 'bg-white'}`}><span className="text-sm font-semibold">{c.programTitle}</span><span className="text-xs opacity-75">{tx(c.state)} · {shortDate(c.endDate)}</span></button>)}</div>}
        {offline && <p role="status" className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-950">
          {card ? tx('Offline · Showing your last synced meal card.') : tx('Offline · Open your meal card online once to save it on this phone.')}
          {syncedAt && <span className="block text-xs">{tx('Last synced')} · {new Date(syncedAt).toLocaleString('en-GB', { timeZone: 'Africa/Kigali' })}</span>}
        </p>}
        {!card && !err && !offline && <div className="grid place-items-center py-24"><Loader2 className="animate-spin" aria-label={tx('Loading')} /></div>}
        {err && <p role="alert" className="mb-3 rounded-2xl bg-rose-50 p-4 text-sm text-rose-700">{err}</p>}
        {flash && <p role="status" className="mb-3 flex items-center gap-2 rounded-2xl bg-emerald-50 p-4 text-base font-semibold text-emerald-800"><CheckCircle2 size={20} aria-hidden="true" />{flash}</p>}
        {card && m && (
          <div className="space-y-3">
            <div className={`rounded-full px-3 text-center text-sm font-bold tracking-wide text-white ${restaurant ? "w-fit py-1" : "py-2"}`} style={{ background: tone }}>{label}</div>
            {restaurant && tab === 'today' && <section className="space-y-2 rounded-2xl border border-slate-200 bg-white p-3 md:hidden">
              {mealTickStyle}
              <h2 className="font-display font-semibold">{tx('Today')}</h2>
              <div className="grid grid-cols-2 gap-2">
                {card.program.items.map(item => {
                  const use = card.today.used.filter(entry => entry.item === item).at(-1);
                  const record = use && card.history?.filter(entry => entry.at === use.at && entry.item === item).at(-1);
                  const aged = use && receiptClock >= tickDeadline(record ?? use);
                  return <div key={item} className={`flex min-w-0 items-center justify-between gap-1 rounded-xl px-2.5 py-2 ${use ? 'bg-emerald-50 text-emerald-900' : 'bg-slate-50 text-slate-700'}`}>
                    <span className="min-w-0 break-words text-sm font-semibold">{item}<span className="block text-xs font-normal">{use ? clock(use.at) : tx('Not used yet today')}</span></span>
                    {use && (aged ? <CheckCheck size={22} className="shrink-0" role="img" aria-label={tx('Check-in timer elapsed')} /> : <PendingMealTick key={use.at} label={tx('Checked in')} />)}
                  </div>;
                })}
              </div>
            </section>}
            {!restaurant && purchasePanel}
            {restaurant && tab === 'manage' && purchasePanel && <div className="md:hidden">{purchasePanel}</div>}
            <div className={restaurant && tab !== 'today' ? 'hidden space-y-3 md:block' : 'space-y-3'}>
            {!offline && card.today.receipt && receiptClock < tickDeadline(card.today.receipt) && <section aria-label={tx("Meal confirmation")} className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
              <p className="flex items-center gap-2 font-semibold"><CheckCircle2 size={20} />{tx("Meal confirmed")}</p>
              <p className="mt-1 text-2xl font-bold">{card.today.receipt.item} × {card.today.receipt.count}</p>
              <p>{m.name} · {card.today.date} · {clock(card.today.receipt.at)}</p>
              <p className="font-mono">#{card.today.receipt.reference}</p>
              <p className="text-sm">{tx("Show this confirmation to the waiter.")}</p>
            </section>}
            <div className={restaurant && showCheckin && purchasePanel ? "grid items-start gap-3 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]" : "contents"}>
              {showCheckin && !offline && (
                <div className={`rounded-2xl bg-white ${restaurant ? "space-y-2 p-3" : "space-y-3 p-4"}`}>
                  <p className={`font-display font-semibold ${restaurant ? "text-base" : "text-lg"}`}>{card.tick?.needsCode === false ? tx("Meal check-in") : tx("Scan the business's code")}</p>
                  {confirmationCode ? (
                    <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); if (/^\d{4,6}$/.test(scanPasscode)) void doTick(confirmationCode, scanPasscode, useCurrentCode); }}>
                      <label className="block text-sm font-semibold">{tx("Meal box to use")}
                        <select className={field} value={mealBox} onChange={e => setMealBox(e.target.value)}>
                          <option value="">{tx("Current meal")}</option>
                          {card.program.items.filter(item => isFlexibleMeal(item) || card.tick?.items.some(option => option.item === item && option.allowed)).map(item => <option key={item}>{item}</option>)}
                        </select>
                      </label>
                      <label className="block text-sm font-semibold">{tx("How many meal cells do you want to tick?")}
                        <input type="number" inputMode="numeric" required min={1} max={100} step={1} className={field} value={quantity} onChange={e => setQuantity(e.target.value)} autoFocus />
                      </label>
                      <p className="text-sm">{tx("Each tick uses one available day for this meal, starting today.")}</p>
                      <div className="flex gap-2">{[1, 2, 5].map(n => <button key={n} type="button" className="rounded-xl border px-4 py-2" aria-pressed={quantity === String(n)} onClick={() => setQuantity(String(n))}>{n}</button>)}</div>
                      <label className="block text-sm font-medium">{tx("Enter your passcode to confirm check-in")}
                        <input className={`${field} font-mono text-xl tracking-[0.3em]`} type="password" autoComplete="current-password" inputMode="numeric" minLength={4} maxLength={6} required value={scanPasscode} onChange={(event) => setScanPasscode(event.target.value.replace(/\D/g, ''))} />
                      </label>
                      <div className="flex gap-2">
                        <button type="submit" disabled={busy || scanPasscode.length < 4} style={{ background: theme.accent, color: theme.on }} className="min-h-12 flex-1 rounded-xl px-4 font-semibold disabled:opacity-50">{tx("Confirm check-in")}</button>
                        <button type="button" disabled={busy} className="min-h-12 rounded-xl border px-4 font-semibold" onClick={() => { setConfirmationCode(''); setUseCurrentCode(false); setScanPasscode(''); setCheckinError(''); }}>{tx("Cancel")}</button>
                      </div>
                    </form>
                  ) : m.state === 'active' && card.tick && (
                    <div className={restaurant ? "grid gap-2 min-[400px]:grid-cols-2" : "space-y-3"}>
                      {camera ? (
                        <div className="relative col-span-full mx-auto w-full max-w-sm overflow-hidden rounded-xl bg-black">
                          <video ref={scanner.video} muted playsInline className="aspect-square w-full object-cover" aria-label={tx("Camera")} />
                          <button type="button" className="absolute right-2 top-2 rounded-full bg-black/70 p-2 text-white" onClick={() => setCamera(false)} aria-label={tx("Close the camera")}><X size={18} /></button>
                          {!scanner.ready && !scanner.error && <Loader2 className="absolute left-1/2 top-1/2 animate-spin text-white" aria-label={tx("Loading")} />}
                        </div>
                      ) : (
                        <button type="button" disabled={busy} style={{ background: theme.accent, color: theme.on }} className={`flex w-full items-center justify-center gap-2 rounded-xl px-3 font-semibold disabled:opacity-50 ${restaurant ? "min-h-11 text-sm" : "min-h-12"}`} onClick={() => { setCheckinError(''); setCamera(true); }}><Camera size={19} aria-hidden="true" />{tx("Scan QR code")}</button>
                      )}
                      {camera && scanner.error && <p role="alert" className="col-span-full text-sm text-rose-700">{scanner.error}</p>}
                      {restaurant && <button type="button" aria-expanded={manualCode} onClick={() => setManualCode(value => !value)} className="min-h-11 rounded-xl border border-slate-200 px-3 text-sm font-semibold md:hidden">{tx('Use a code')}</button>}
                      {restaurant && <button type="button" disabled={busy} className={`${manualCode ? "" : "hidden md:block"} min-h-11 w-full rounded-xl border border-[#D9DEE5] px-3 text-sm font-semibold disabled:opacity-50`} onClick={() => prepareCheckin('', undefined, true)}>{tx('Use current meal code')}</button>}
                      <form className={`col-span-full gap-2 ${restaurant && !manualCode ? "hidden md:flex" : "flex"}`} onSubmit={(event) => { event.preventDefault(); if (/^\d{6}$/.test(typed)) prepareCheckin(typed); }}>
                        <input className={`${restaurant ? mealField : `${field} font-mono text-xl tracking-[0.3em]`} !mt-0 min-w-0`} value={typed} onChange={(event) => setTyped(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" maxLength={6} placeholder={tx("6-digit code")} aria-label={tx('Code shown at the business')} />
                        <button type="submit" disabled={busy || typed.length !== 6} className={`shrink-0 rounded-xl border border-[#D9DEE5] px-3 font-semibold disabled:opacity-50 ${restaurant ? "min-h-11 text-sm" : "min-h-12"}`}>{tx('Use code')}</button>
                      </form>
                    </div>
                  )}
                  {checkinError && <p role="alert" className="text-sm text-rose-700">{checkinError}</p>}
                  {card.program.windows?.length ? <p className="text-xs text-[#5B6470]">{tx("Serving hours (Kigali)")} · {card.program.windows.map((window) => `${window.item} ${window.from}–${window.to}`).join(' · ')}</p> : null}
                  {card.tick && <div className={restaurant ? "hidden flex-wrap gap-2 md:flex" : "flex flex-wrap gap-2"}>{card.tick.items.map((x) => { const done = card.today.used.find((u) => u.item === x.item); return <span key={x.item} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${done ? 'bg-emerald-50 text-emerald-800' : 'bg-[#F2F4F7] text-[#5B6470]'}`}>{done && <CheckCircle2 size={14} aria-hidden="true" />}{x.item}{done && <span className="tabular-nums opacity-80">· {clock(done.at)}</span>}</span>; })}</div>}
                  {card.tick?.undo && <p role="status" className="flex items-center justify-between gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-900"><span>{card.tick.undo.item} {tx('ticked')}. {tx('Wrong tap?')}</span><button type="button" disabled={busy} onClick={() => void act((s, id) => publicApi.untick(slug, s, id, card.tick!.undo!.useId))} className="min-h-9 px-2 font-semibold underline">{tx('Undo')}</button></p>}
                </div>
              )}
              {restaurant && purchasePanel && <div className="hidden md:block">{purchasePanel}</div>}
            </div>
            </div>
            <div className={restaurant && tab !== 'manage' ? 'hidden space-y-3 md:block' : 'space-y-3'}>
            {card.today.weekly && <p className="rounded-xl bg-white px-3 py-2 text-sm">{card.today.checkedMeal ? `${card.today.checkedMeal.item} · ${tx('Checked in')} · ${card.today.date}` : tx('The meal color appears after a confirmed check-in during serving hours.')}</p>}
            {!!card.history?.length && <details className="rounded-xl bg-white p-3 text-sm"><summary>{tx("Individual report")} · {card.history.length} {tx("check-ins")}</summary>
              <ul className="max-h-52 overflow-auto">{card.history.slice().reverse().map(u => <li key={u.id ?? u.at + u.item}>{u.date} · {clock(u.at)} · {u.item}{u.guest && ` · ${tx('Guest')}`}</li>)}</ul>
            </details>}
            </div>
            <div className={restaurant && tab !== 'card' ? 'hidden space-y-3 md:block' : 'space-y-3'}>
            <PaperCard key={card.cardId} b={b} card={card} w={w} animateMealTicks={restaurant} />
            {!offline && (m.state === 'active' || m.state === 'not_started') && card.qr && (
              <div className="rounded-2xl bg-white p-4 text-center">
                <button type="button" onClick={() => setBig(true)} aria-label={tx('Tap to enlarge')} className="mx-auto block"><Qr text={card.qr} size={168} /></button>
                <p className="mt-1 font-mono text-lg font-semibold tracking-widest">{m.code}</p>
                <p className="text-sm text-[#5B6470]">{tx('Show this when you arrive. If the camera does not work, read the code.')} {tx('Tap the code to enlarge it.')}</p>
                {m.state === 'active' && (card.today.used.length ? <p className="mt-2 flex items-center justify-center gap-1.5 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800"><CheckCircle2 size={16} />{card.today.used.map((e) => `${e.item} ${clock(e.at)}`).join(' · ')}</p> : <p className="mt-2 rounded-xl bg-[#F2F4F7] px-3 py-2 text-sm">{card.today.openToday ? tx('Not used yet today') : tx('Not available today')}</p>)}
                {m.state === 'not_started' && <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">{t('Your {program} starts on')} {shortDate(m.startDate)}.</p>}
                <p className="mt-2 flex items-center justify-center gap-1.5 text-xs text-[#5B6470]"><Clock size={13} aria-hidden="true" /><Ticking /></p>
              </div>)}
            </div>
            <div className={restaurant && tab !== 'manage' && m.state !== 'pending' ? 'hidden space-y-3 md:block' : 'space-y-3'}>
            {!offline && m.state === 'pending' && card.payment && (
              <div className="space-y-3 rounded-2xl bg-white p-4 text-left">
                <p className="text-center font-display text-3xl font-semibold tabular-nums">{rwf(card.payment.amount)}</p>
                <p className="text-center text-sm text-[#5B6470]">{m.purchaseDays} {tx('days')} · {tx('Starts after payment is confirmed')}</p>
                {b.products.filter((x) => x.price != null).length > 0 && (
                  <details className="rounded-xl bg-[#F2F4F7] px-3 py-2 text-sm"><summary className="min-h-9 cursor-pointer py-1.5 font-semibold">{tx('Our prices')}</summary>
                    <ul className="divide-y divide-[#D9DEE5]">{b.products.filter((x) => x.price != null).slice(0, 40).map((x) => <li key={x.id} className="flex items-baseline justify-between gap-3 py-1.5"><span className={x.available ? '' : 'text-[#5B6470] line-through'}>{x.name}{x.unit ? <span className="text-[#5B6470]"> / {x.unit}</span> : null}</span><b className="shrink-0 tabular-nums">{rwf(x.price as number)}</b></li>)}</ul></details>)}
                {card.payment.online && (card.payment.promptSent
                  ? <p role="status" className="flex items-center gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><Loader2 className="animate-spin" size={16} />{tx('Check your phone and approve the payment.')}</p>
                  : <div className="space-y-2"><label className="block text-sm font-medium">{tx('Pay with your phone (MTN or Airtel)')}<input className={field} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder={m.phone ? `0${m.phone.slice(3)}` : '0788 123 456'} /></label>
                    <button type="button" disabled={busy} onClick={() => void act((s, id) => publicApi.payCard(slug, s, id, phone || `0${m.phone.slice(3)}`))} style={{ background: theme.accent, color: theme.on }} className="min-h-12 w-full rounded-xl text-base font-semibold disabled:opacity-50">{busy ? <Loader2 className="mx-auto animate-spin" size={18} /> : tx('Send payment request')}</button></div>)}
                {!card.payment.online && card.payment.momoCode && <div className="rounded-xl bg-[#F2F4F7] p-3 text-sm"><p>{tx('Send')} <b>{rwf(card.payment.amount)}</b> {tx('by MoMo to')}</p><p className="mt-1 font-mono text-2xl font-semibold tracking-wider">{card.payment.momoCode}</p>{card.payment.momoName && <p className="text-[#5B6470]">{card.payment.momoName}</p>}</div>}
                {!card.payment.online && !card.payment.momoCode && <p className="rounded-xl bg-[#F2F4F7] p-3 text-sm">{tx('Pay the business in person, then tap the button below.')}</p>}
                {!card.payment.claimed ? (
                  <div className="space-y-2"><input className={field} value={ref} onChange={(e) => setRef(e.target.value)} placeholder={tx('MoMo reference (optional)')} maxLength={40} />
                    <button type="button" disabled={busy} onClick={() => void act((s, id) => publicApi.claimCard(slug, s, id, ref))} className="min-h-12 w-full rounded-xl border-2 border-[#0E1722] text-base font-semibold disabled:opacity-50">{tx('I have paid')}</button></div>
                ) : <p role="status" className="flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900"><Check size={16} />{t('Thank you. The business will confirm your payment, then this {pass} turns green.')}</p>}
                {card.payment.whatsapp && <a className="flex min-h-11 items-center justify-center gap-2 text-sm font-medium underline" href={`https://wa.me/${card.payment.whatsapp}?text=${encodeURIComponent(`${m.name} (${m.code}): ${tx('I joined')} "${card.program.title}".`)}`} target="_blank" rel="noopener noreferrer"><MessageCircle size={15} />{tx('Message the business')}</a>}
              </div>)}
            {(m.state === 'expired' || m.state === 'paused' || m.state === 'cancelled') && <p className="rounded-2xl bg-white p-4 text-sm">{m.state === 'expired' ? `${t('Your {program} ended on')} ${shortDate(m.endDate)}. ${tx('Join again from the business page to keep going.')}` : m.state === 'paused' ? t('The business paused your {program}. Ask them to resume it.') : t('This {program} was cancelled.')}</p>}
            {card.program.terms && <p className="px-1 text-xs text-[#5B6470]">{card.program.terms}</p>}
            </div>
          </div>)}
      </div>
      {big && card?.qr && <div role="dialog" aria-modal="true" aria-label={tx('QR code')} className="fixed inset-0 z-[400] grid place-items-center bg-white p-6" onClick={() => setBig(false)}><div className="text-center"><Qr text={card.qr} size={Math.min(320, typeof window !== 'undefined' ? window.innerWidth - 48 : 300)} /><p className="mt-3 font-mono text-2xl font-semibold tracking-widest">{card.member.code}</p><p className="mt-2 text-sm text-[#5B6470]">{tx('Tap anywhere to close')}</p></div></div>}
    </div>
  );
}

function Qr({ text, size }: { text: string; size: number }) {
  const [src, setSrc] = useState('');
  useEffect(() => { let on = true; void import('qrcode').then(async (m: any) => { const u = await (m.default ?? m).toDataURL(text, { margin: 1, width: size * 2, errorCorrectionLevel: 'M', color: { dark: '#0E1722', light: '#FFFFFF' } }); if (on) setSrc(u); }).catch(() => undefined); return () => { on = false; }; }, [text, size]);
  return src ? <img src={src} width={size} height={size} alt="" className="mx-auto rounded-2xl" /> : <div style={{ width: size, height: size }} className="mx-auto animate-pulse rounded-2xl bg-[#F2F4F7]" />;
}
const Ticking = () => { const [t, setT] = useState(() => new Date()); useEffect(() => { const i = window.setInterval(() => setT(new Date()), 1000); return () => window.clearInterval(i); }, []); return <span className="font-mono tabular-nums">{t.toLocaleTimeString('en-GB', { timeZone: 'Africa/Kigali' })}</span>; };

