import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, CheckCircle2, Clock, Loader2, LogOut, MessageCircle, Ticket, UtensilsCrossed, X, KeyRound } from 'lucide-react';
import { publicApi } from '../../biz/api';
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
export function loadSession(slug: string): string | null {
  try { const raw = sessionStorage.getItem(KEY(slug)) ?? localStorage.getItem(KEY(slug)); if (!raw) return null; const s = JSON.parse(raw) as { token: string; exp: number }; if (s.exp < Date.now()) { clearSession(slug); return null; } return s.token; } catch { return null; }
}
export function saveSession(slug: string, token: string, expiresAt: string, remember: boolean) {
  const v = JSON.stringify({ token, exp: Date.parse(expiresAt) }); try { (remember ? localStorage : sessionStorage).setItem(KEY(slug), v); (remember ? sessionStorage : localStorage).removeItem(KEY(slug)); } catch { /* optional */ }
}
/** The user name is remembered on this phone, so a returning customer only types the passcode. It is not a secret on its own. */
const UKEY = (slug: string) => `bz-user:${slug}`;
export const loadUser = (slug: string): string => { try { return localStorage.getItem(UKEY(slug)) ?? ''; } catch { return ''; } };
export const saveUser = (slug: string, u: string) => { try { if (u) localStorage.setItem(UKEY(slug), u); } catch { /* optional */ } };
export const forgetUser = (slug: string) => { try { localStorage.removeItem(UKEY(slug)); } catch { /* optional */ } };
export function clearSession(slug: string) { try { sessionStorage.removeItem(KEY(slug)); localStorage.removeItem(KEY(slug)); } catch { /* optional */ } }

const field = 'mt-1 min-h-12 w-full rounded-xl border border-[#D9DEE5] bg-white px-3.5 text-base outline-none focus:border-[#0E1722]';
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
            {p.windows?.length ? <p className="mt-1 text-xs text-[#5B6470]">{p.windows.map((w) => `${w.item} ${w.from}–${w.to}`).join(' · ')}</p> : null}
            {p.description && <p className="mt-2 text-sm text-[#3A4350]">{p.description}</p>}
            {p.terms && <p className="mt-2 text-xs text-[#5B6470]">{p.terms}</p>}
            <button type="button" disabled={preview || p.full} onClick={() => onJoin(p)} style={{ background: theme.accent, color: theme.on }} className="mt-4 min-h-12 rounded-xl px-4 text-base font-semibold disabled:opacity-50">{p.full ? t('This {program} is full') : preview ? tx('Preview') : t('Join this {program}')}</button>
          </article>))}
      </div>
    </section>
  );
}
const useWordsUses = (b: PublicBusiness, lang: Lang) => wordsOf(b.programText, lang === 'rw' ? RW_WORDS : undefined).uses;

/* ---- first visit: details, then the customer's own passcode ---- */
export function JoinFlow({ b, lang, program, onClose, onDone }: { b: PublicBusiness; lang: Lang; program: Program; onClose: () => void; onDone: () => void }) {
  const { tx, t, w } = useWords(b, lang); const theme = THEMES[b.theme] ?? THEMES.gold;
  const [step, setStep] = useState<1 | 2>(1); const [names, setNames] = useState<string[]>([]); const [f, setF] = useState({ username: '', name: '', phone: '', idNumber: '', joinCode: '', startDate: '', website: '', pin: '', pin2: '', remember: true }); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const days = Array.from({ length: 8 }, (_, i) => new Date(Date.now() + 2 * 3600_000 + i * 86_400_000).toISOString().slice(0, 10));
  const next = (e: React.FormEvent) => { e.preventDefault(); setErr(''); if (f.name.trim().length < 2) return setErr(tx('Please write your name.')); if (f.phone.replace(/\D/g, '').length < 9) return setErr(tx('Please write a phone number we can reach.')); if (program.needsCode && !/^\d{4}$/.test(f.joinCode.replace(/\D/g, ''))) return setErr(tx('Write the 4-digit join code the business gave you.')); setStep(2); void publicApi.usernames(b.slug, f.name).then((s) => { setNames(s); setF((p) => (p.username ? p : { ...p, username: s[0] ?? '' })); }).catch(() => undefined); };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('');
    if (f.username && !/^[a-z0-9]{3,12}$/.test(f.username)) return setErr(tx('A user name is 3 to 12 letters or numbers, with no spaces.'));
    if (!/^\d{4,6}$/.test(f.pin)) return setErr(tx('Choose a passcode of 4 to 6 digits.')); if (f.pin !== f.pin2) return setErr(tx('The two passcodes do not match.'));
    setBusy(true);
    try { const r = await publicApi.join(b.slug, program.id, { name: f.name, phone: f.phone, username: f.username || undefined, passcode: f.pin, joinCode: program.needsCode ? f.joinCode : undefined, idNumber: f.idNumber || undefined, startDate: f.startDate || undefined, remember: f.remember, website: f.website }); saveSession(b.slug, r.session, r.expiresAt, f.remember); saveUser(b.slug, r.username); onDone(); }
    catch (x) { const m = x instanceof Error ? x.message : tx('Something went wrong. Please try again.'); setErr(m); if (/join code/i.test(m)) setStep(1); } finally { setBusy(false); }
  };
  return (
    <Sheet label={t("Join this {program}")} onClose={onClose}>
      <div className="flex items-start justify-between gap-3"><div><h2 className="font-display text-xl font-semibold">{program.title}</h2><p className="text-sm text-[#5B6470]">{rwf(program.priceRwf)} · {program.days} {tx("days")}</p></div>
        <button type="button" onClick={onClose} aria-label={tx("Close")} className="rounded-full p-2 hover:bg-[#F2F4F7]"><X size={18} /></button></div>
      <p className="text-xs font-semibold uppercase tracking-wide text-[#5B6470]">{tx("Step")} {step} / 2 · {step === 1 ? tx('Your details') : tx('Your user name and passcode')}</p>
      {step === 1 ? (
        <form onSubmit={next} className="space-y-3">
          <label className="block text-sm font-medium">{tx("Your name")}<input className={field} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={60} autoComplete="name" /></label>
          <label className="block text-sm font-medium">{tx("Phone number")}<input className={field} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} required inputMode="tel" autoComplete="tel" placeholder="0788 123 456" /></label>
          {program.needsCode && <label className="block text-sm font-medium">{tx("Join code")}<input className={`${field} font-mono text-xl tracking-[0.5em]`} value={f.joinCode} onChange={(e) => setF({ ...f, joinCode: e.target.value.replace(/\D/g, '').slice(0, 4) })} inputMode="numeric" maxLength={4} placeholder="••••" required /><span className="mt-1 block text-xs font-normal text-[#5B6470]">{tx("4 digits, given to you by the business.")}</span></label>}
          {w.askId && <label className="block text-sm font-medium">{w.idLabel} ({tx("optional")})<input className={field} value={f.idNumber} onChange={(e) => setF({ ...f, idNumber: e.target.value })} maxLength={30} /></label>}
          <label className="block text-sm font-medium">{tx("Start on")}<select className={field} value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })}><option value="">{tx("Today")}</option>{days.slice(1).map((d) => <option key={d} value={d}>{shortDate(d)}</option>)}</select></label>
          <input value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 opacity-0" />
          {err && <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</p>}
          <button type="submit" style={{ background: theme.accent, color: theme.on }} className="min-h-12 w-full rounded-xl text-base font-semibold">{tx("Next")}</button>
        </form>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <div className="block text-sm font-medium">{tx("Your user name")}
            <input className={`${field} font-semibold`} value={f.username} onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) })} maxLength={12} autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username" aria-label={tx("Your user name")} />
            {names.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label={tx("Suggestions")}>{names.map((n) => <button key={n} type="button" aria-pressed={f.username === n} onClick={() => setF({ ...f, username: n })} className={`min-h-9 rounded-full border px-3 text-sm font-semibold ${f.username === n ? 'border-[#0E1722] bg-[#0E1722] text-white' : 'border-[#D9DEE5] bg-white'}`}>{n}</button>)}</div>}
            <span className="mt-1 block text-xs font-normal text-[#5B6470]">{tx("Short, so it is easy to type. This phone will remember it.")}</span></div>
          <p className="rounded-xl bg-[#F2F4F7] p-3 text-sm text-[#3A4350]">{t("You will use this passcode every time you open your {pass}. Do not share it.")}</p>
          <label className="block text-sm font-medium">{tx("Passcode")} <span className="font-normal text-[#5B6470]">({tx("4 to 6 digits")})</span><input className={`${field} font-mono text-xl tracking-[0.4em]`} type="password" value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value.replace(/\D/g, '').slice(0, 6) })} inputMode="numeric" autoComplete="new-password" required autoFocus /></label>
          <label className="block text-sm font-medium">{tx("Confirm passcode")}<input className={`${field} font-mono text-xl tracking-[0.4em]`} type="password" value={f.pin2} onChange={(e) => setF({ ...f, pin2: e.target.value.replace(/\D/g, '').slice(0, 6) })} inputMode="numeric" autoComplete="new-password" required /></label>
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
export function SignIn({ b, lang, onClose, onDone }: { b: PublicBusiness; lang: Lang; onClose: () => void; onDone: () => void }) {
  const { tx, t } = useWords(b, lang); const theme = THEMES[b.theme] ?? THEMES.gold; const [known, setKnown] = useState(() => loadUser(b.slug)); const [f, setF] = useState({ who: '', pin: '', remember: true }); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const go = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); setErr(''); try { const who = (known || f.who).trim(); const byName = /[a-z]/i.test(who); const r = await publicApi.login(b.slug, byName ? { username: who, passcode: f.pin, remember: f.remember } : { phone: who, passcode: f.pin, remember: f.remember }); saveSession(b.slug, r.session, r.expiresAt, f.remember); saveUser(b.slug, r.username); onDone(); } catch (x) { setErr(x instanceof Error ? x.message : tx('Something went wrong. Please try again.')); } finally { setBusy(false); } };
  return (
    <Sheet label={t("Sign in to your {pass}")} onClose={onClose}>
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
    </Sheet>
  );
}

/* ---- the card, laid out like the paper one ---- */
const BLOCK = 15;
function PaperCard({ b, card, w }: { b: PublicBusiness; card: CardInfo; w: ReturnType<typeof wordsOf> }) {
  const tx = useTx(); const theme = THEMES[b.theme] ?? THEMES.gold; const cat = CATEGORIES.find((c) => c.id === b.category)?.label ?? '';
  const cal = card.calendar; const blocks = Math.max(1, Math.ceil(cal.length / BLOCK)); const todayIdx = cal.findIndex((d) => d.date === card.today.date);
  const [blk, setBlk] = useState(() => (todayIdx >= 0 ? Math.floor(todayIdx / BLOCK) : card.today.date > (cal[cal.length - 1]?.date ?? '') ? blocks - 1 : 0));
  const rows = cal.slice(blk * BLOCK, blk * BLOCK + BLOCK); const items = card.program.items;
  const ink = '#14213D'; const paper = `color-mix(in srgb, ${theme.accent} 16%, #FFFFFF)`; const line = `color-mix(in srgb, ${ink} 35%, ${paper})`;
  const m = card.member; const local = (x: string) => (x.startsWith('250') ? `0${x.slice(3)}` : x); const phones = [b.contact.phone, b.contact.whatsapp].filter((x): x is string => !!x).map(local).filter((x, i, a) => a.indexOf(x) === i);
  const stamp = m.paid ? { text: tx('PAID'), color: '#2848C8' } : { text: tx('NOT PAID'), color: '#B91C1C' };
  const short = (s: string) => (s.length > 10 ? `${s.slice(0, 9)}…` : s);
  return (
    <div className="relative overflow-hidden rounded-2xl border p-4 shadow-sm" style={{ background: paper, borderColor: line, color: ink }}>
      <span aria-hidden="true" className="absolute left-1/2 top-2 h-3 w-3 -translate-x-1/2 rounded-full border" style={{ background: '#F5F7FA', borderColor: line }} />
      <div className="mt-3 text-center">
        {cat && <p className="text-[11px] font-bold uppercase tracking-[0.25em]" style={{ color: `color-mix(in srgb, ${ink} 70%, ${paper})` }}>{cat}</p>}
        <p className="font-display text-3xl font-semibold uppercase leading-tight tracking-wide">{b.name}</p>
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
          <thead><tr style={{ background: `color-mix(in srgb, ${ink} 8%, ${paper})` }}><th className="w-16 border-b border-r px-1 py-1.5 text-xs font-extrabold" style={{ borderColor: ink }}>{tx('Date')}</th>{items.map((it) => <th key={it} title={it} className="border-b border-r px-1 py-1.5 text-xs font-extrabold last:border-r-0" style={{ borderColor: ink }}>{short(it)}</th>)}</tr></thead>
          <tbody>
            {rows.map((d) => { const isToday = d.date === card.today.date; return (
              <tr key={d.date} style={isToday ? { background: `color-mix(in srgb, ${theme.accent} 28%, ${paper})` } : undefined}>
                <th scope="row" className="border-b border-r px-1 py-1 text-left text-xs font-bold" style={{ borderColor: line }}><span className="text-base tabular-nums">{dayNum(d.date)}</span> <span className="font-semibold opacity-70">{tx(DAY[d.dow])}</span>{isToday && <span className="sr-only"> {tx('today')}</span>}</th>
                {items.map((it) => { const used = d.used.includes(it); const at = card.today.date === d.date ? card.today.used.find((u) => u.item === it)?.at : undefined;
                  return <td key={it} title={used ? `${it}${at ? ` ${clock(at)}` : ''}` : undefined} className="h-9 border-b border-r p-0 text-lg last:border-r-0" style={{ borderColor: line, ...(!d.open ? { background: `repeating-linear-gradient(135deg, transparent 0 4px, color-mix(in srgb, ${ink} 14%, transparent) 4px 5px)` } : {}) }}>
                    {used ? <Check size={20} strokeWidth={3} role="img" aria-label={`${it}: ${tx("Checked in")}`} className="mx-auto text-emerald-700" /> : !d.open ? <span className="text-xs opacity-50" aria-label={tx('Closed')}>—</span> : null}</td>; })}
              </tr>); })}
          </tbody>
        </table>
      </div>
      {blocks > 1 && <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label={tx('Show days')}>{Array.from({ length: blocks }, (_, i) => <button key={i} type="button" aria-pressed={blk === i} onClick={() => setBlk(i)} className="min-h-9 rounded-lg border px-2.5 text-xs font-semibold" style={blk === i ? { background: ink, color: '#fff', borderColor: ink } : { borderColor: line }}>{tx('Days')} {i * BLOCK + 1}–{Math.min(cal.length, (i + 1) * BLOCK)}</button>)}</div>}
      <div className="mt-3 grid grid-cols-2 gap-2 text-left"><div className="rounded-xl border p-2.5" style={{ borderColor: line }}><p className="text-xs opacity-70">{fill('{Uses} left', w)}</p><p className="font-display text-xl font-semibold tabular-nums">{m.usesLeft}</p></div><div className="rounded-xl border p-2.5" style={{ borderColor: line }}><p className="text-xs opacity-70">{tx('Valid until')}</p><p className="font-display text-xl font-semibold">{shortDate(m.endDate)}</p></div></div>
    </div>
  );
}

/* ---- the customer's dashboard ---- */
export function Dashboard({ b, lang, onClose, onSignedOut, scanCode }: { b: PublicBusiness; lang: Lang; onClose: () => void; onSignedOut: () => void; scanCode?: string }) {
  const { tx, t, w } = useWords(b, lang); const theme = THEMES[b.theme] ?? THEMES.gold; const slug = b.slug;
  const [me, setMe] = useState<MeInfo | null>(null); const [card, setCard] = useState<CardInfo | null>(null); const [sel, setSel] = useState<string | undefined>(); const [err, setErr] = useState('');
  const [phone, setPhone] = useState(''); const [ref, setRef] = useState(''); const [busy, setBusy] = useState(false); const [big, setBig] = useState(false); const [pinOpen, setPinOpen] = useState(false); const [pins, setPins] = useState({ cur: '', next: '' }); const [pinMsg, setPinMsg] = useState('');
  const waiting = useRef(false); const session = () => loadSession(slug);
  const [typed, setTyped] = useState(''); const [flash, setFlash] = useState('');
  const fail = useCallback((e: unknown) => { const m = e instanceof Error ? e.message : tx('Something went wrong. Please try again.'); if (/sign in again/i.test(m)) { clearSession(slug); onSignedOut(); return; } setErr(m); }, [slug, onSignedOut, tx]);
  const load = useCallback(async () => { const s = session(); if (!s) { onSignedOut(); return; } try { const [m, c] = await Promise.all([publicApi.me(slug, s), publicApi.card(slug, s, sel)]); setMe(m); setCard(c); setErr(''); waiting.current = !!c.payment?.promptSent; if (!sel) setSel(c.cardId); } catch (e) { fail(e); } }, [slug, sel, fail, onSignedOut]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); const i = window.setInterval(() => void load(), waiting.current ? 4000 : 15_000); return () => window.clearInterval(i); }, [load, card?.payment?.promptSent]);
  const act = async (fn: (s: string, id: string) => Promise<unknown>) => { const s = session(); if (!s || !card) return; setBusy(true); setErr(''); try { await fn(s, card.cardId); await load(); } catch (e) { fail(e); } finally { setBusy(false); } };
  const doTick = async (code: string) => { const s = session(); if (!s) return; setBusy(true); setErr(''); setFlash(''); try { const r = await publicApi.tick(slug, s, code, card?.cardId); setTyped(''); setFlash(`${r.item} ${tx('ticked')}`); setSel(r.cardId); await load(); } catch (e) { fail(e); } finally { setBusy(false); } };
  // The business's QR code opens this page with the code in the address: tick straight away, once, then tidy the address.
  const auto = useRef(false); useEffect(() => { if (!scanCode || auto.current || !card) return; auto.current = true; void doTick(scanCode).finally(() => { try { const u = new URL(window.location.href); u.searchParams.delete('tick'); window.history.replaceState({}, '', u.pathname + u.search); } catch { /* optional */ } }); }, [scanCode, card]); // eslint-disable-line react-hooks/exhaustive-deps
  const m = card?.member; const usedUp = !!card && m?.state === 'active' && !!card.program.totalUses && m.usesLeft === 0;
  const tone = !m ? '#5B6470' : usedUp ? '#B91C1C' : m.state === 'active' ? '#15803D' : m.state === 'pending' || m.state === 'not_started' ? '#B45309' : '#B91C1C';
  const label = !m ? '' : usedUp ? t('ALL {USES} TAKEN') : ({ active: tx('ACTIVE'), pending: tx('WAITING FOR PAYMENT'), not_started: tx('STARTS SOON'), expired: tx('PLAN ENDED'), paused: tx('PAUSED'), cancelled: tx('CANCELLED') } as Record<string, string>)[m.state];
  return (
    <div role="dialog" aria-modal="true" aria-label={t("My {pass}")} className="fixed inset-0 z-[320] overflow-auto bg-[#F5F7FA]">
      <div className="mx-auto max-w-md px-4 pb-10 pt-4">
        <div className="mb-3 flex items-center justify-between gap-2"><div className="min-w-0"><p className="truncate font-display text-lg font-semibold">{b.name}</p>{me && <p className="truncate text-sm text-[#5B6470]">{tx('Hello')}, {me.name}</p>}</div>
          <div className="flex items-center gap-1"><button type="button" onClick={() => setPinOpen((v) => !v)} aria-label={tx('Change passcode')} title={tx('Change passcode')} className="rounded-full p-2 hover:bg-white"><KeyRound size={18} /></button>
            <button type="button" onClick={async () => { const s = session(); if (s) await publicApi.logout(slug, s); clearSession(slug); onSignedOut(); }} aria-label={tx('Sign out')} title={tx('Sign out')} className="rounded-full p-2 hover:bg-white"><LogOut size={18} /></button>
            <button type="button" onClick={onClose} aria-label={tx('Close')} className="rounded-full p-2 hover:bg-white"><X size={20} /></button></div></div>
        {pinOpen && <form className="mb-3 space-y-2 rounded-2xl bg-white p-4" onSubmit={async (e) => { e.preventDefault(); setPinMsg(''); const s = session(); if (!s) return; try { await publicApi.changePasscode(slug, s, pins.cur, pins.next); setPinMsg(tx('Passcode changed.')); setPins({ cur: '', next: '' }); } catch (x) { setPinMsg(x instanceof Error ? x.message : ''); } }}>
          <input className={`${field} font-mono tracking-[0.4em]`} type="password" inputMode="numeric" placeholder={tx('Current passcode')} value={pins.cur} onChange={(e) => setPins({ ...pins, cur: e.target.value.replace(/\D/g, '').slice(0, 6) })} />
          <input className={`${field} font-mono tracking-[0.4em]`} type="password" inputMode="numeric" placeholder={tx('New passcode')} value={pins.next} onChange={(e) => setPins({ ...pins, next: e.target.value.replace(/\D/g, '').slice(0, 6) })} />
          <button type="submit" className="min-h-11 w-full rounded-xl border-2 border-[#0E1722] text-sm font-semibold">{tx('Save')}</button>{pinMsg && <p role="status" className="text-sm text-[#3A4350]">{pinMsg}</p>}</form>}
        {me && me.cards.length > 1 && <div className="mb-3 flex gap-2 overflow-x-auto" role="tablist">{me.cards.map((c) => <button key={c.id} role="tab" aria-selected={card?.cardId === c.id} type="button" onClick={() => { setSel(c.id); setCard(null); }} className={`shrink-0 rounded-xl px-3 py-2 text-sm font-semibold ${card?.cardId === c.id ? 'bg-[#0E1722] text-white' : 'bg-white'}`}>{c.programTitle}</button>)}</div>}
        {!card && !err && <div className="grid place-items-center py-24"><Loader2 className="animate-spin" aria-label={tx('Loading')} /></div>}
        {err && <p role="alert" className="mb-3 rounded-2xl bg-rose-50 p-4 text-sm text-rose-700">{err}</p>}
        {flash && <p role="status" className="mb-3 flex items-center gap-2 rounded-2xl bg-emerald-50 p-4 text-base font-semibold text-emerald-800"><CheckCircle2 size={20} aria-hidden="true" />{flash}</p>}
        {card && m && (
          <div className="space-y-3">
            <div className="rounded-full px-4 py-2 text-center text-sm font-bold tracking-wide text-white" style={{ background: tone }}>{label}</div>
            {m.state === 'active' && card.tick && (
              <div className="rounded-2xl bg-white p-4" aria-live="polite">
                <p className="font-display text-lg font-semibold">{tx('Scan the business\'s code')}</p>
                <p className="mb-3 text-sm text-[#5B6470]">{tx('Point your phone camera at the code shown at the business. Your card is ticked at once. No camera? Type the 6 digits.')}</p>
                <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (/^\d{6}$/.test(typed)) void doTick(typed); }}>
                  <input className={`${field} !mt-0 font-mono text-2xl tracking-[0.3em]`} value={typed} onChange={(e) => setTyped(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" maxLength={6} placeholder="••••••" aria-label={tx('Code shown at the business')} />
                  <button type="submit" disabled={busy || typed.length !== 6} style={{ background: theme.accent, color: theme.on }} className="min-h-12 shrink-0 rounded-xl px-5 text-base font-semibold disabled:opacity-50">{busy ? <Loader2 className="mx-auto animate-spin" size={18} /> : tx('Tick')}</button></form>
                <div className="mt-3 flex flex-wrap gap-2">{card.tick.items.map((x) => { const done = card.today.used.find((u) => u.item === x.item); return <span key={x.item} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold ${done ? 'bg-emerald-50 text-emerald-800' : 'bg-[#F2F4F7] text-[#5B6470]'}`}>{done && <CheckCircle2 size={14} aria-hidden="true" />}{x.item}{done ? ` ${clock(done.at)}` : ''}</span>; })}</div>
                {card.tick.undo && <p role="status" className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-900"><span>{card.tick.undo.item} {tx('ticked')}. {tx('Wrong tap?')}</span><button type="button" disabled={busy} onClick={() => void act((s, id) => publicApi.untick(slug, s, id, card.tick!.undo!.useId))} className="min-h-9 px-2 font-semibold underline">{tx('Undo')}</button></p>}
              </div>)}
            <PaperCard b={b} card={card} w={w} />
            {(m.state === 'active' || m.state === 'not_started') && card.qr && (
              <div className="rounded-2xl bg-white p-4 text-center">
                <button type="button" onClick={() => setBig(true)} aria-label={tx('Tap to enlarge')} className="mx-auto block"><Qr text={card.qr} size={168} /></button>
                <p className="mt-1 font-mono text-lg font-semibold tracking-widest">{m.code}</p>
                <p className="text-sm text-[#5B6470]">{tx('Show this when you arrive. If the camera does not work, read the code.')} {tx('Tap the code to enlarge it.')}</p>
                {m.state === 'active' && (card.today.used.length ? <p className="mt-2 flex items-center justify-center gap-1.5 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800"><CheckCircle2 size={16} />{card.today.used.map((e) => `${e.item} ${clock(e.at)}`).join(' · ')}</p> : <p className="mt-2 rounded-xl bg-[#F2F4F7] px-3 py-2 text-sm">{card.today.openToday ? tx('Not used yet today') : tx('Not available today')}</p>)}
                {m.state === 'not_started' && <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">{t('Your {program} starts on')} {shortDate(m.startDate)}.</p>}
                <p className="mt-2 flex items-center justify-center gap-1.5 text-xs text-[#5B6470]"><Clock size={13} aria-hidden="true" /><Ticking /></p>
              </div>)}
            {m.state === 'pending' && card.payment && (
              <div className="space-y-3 rounded-2xl bg-white p-4 text-left">
                <p className="text-center font-display text-3xl font-semibold tabular-nums">{rwf(card.payment.amount)}</p>
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
