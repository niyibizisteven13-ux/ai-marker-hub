import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, CheckCircle2, Clock, Copy, Loader2, MessageCircle, Ticket, UtensilsCrossed, X } from 'lucide-react';
import { publicApi } from '../../biz/api';
import { THEMES, rwf, type PublicBusiness } from '../../biz/types';
import type { PassInfo } from '../../biz/types';
import { useTx } from '../../biz/i18n';

/**
 * Programs on the public page: the plans a business sells, the join form, and the student's pass. The pass is the page itself (?pass=<secret>): the
 * student keeps the link, the QR code on it holds only the secret, and the business scans it each time. No sign-in, no app.
 */
type Program = NonNullable<PublicBusiness['programs']>[number];
const DAY: Record<string, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
const ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const daysText = (ds: string[], t: (s: string) => string) => { const s = ORDER.filter((d) => ds.includes(d)); if (s.length === 7) return t('Every day'); const run = s.length > 1 && s.every((d, i) => ORDER.indexOf(d) === ORDER.indexOf(s[0]) + i); return run ? `${t(DAY[s[0]])}–${t(DAY[s[s.length - 1]])}` : s.map((d) => t(DAY[d])).join(', '); };
const shortDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kigali' });
export const savedPass = (slug: string): string | null => { try { return localStorage.getItem(`bz-pass:${slug}`); } catch { return null; } };
const savePass = (slug: string, token: string) => { try { localStorage.setItem(`bz-pass:${slug}`, token); } catch { /* optional */ } };
export const passLink = (slug: string, token: string) => `${window.location.origin}/b/${slug}?pass=${token}`;

export function PlansSection({ b, preview, onJoin, onOpenPass }: { b: PublicBusiness; preview: boolean; onJoin: (p: Program) => void; onOpenPass: (token: string) => void }) {
  const tx = useTx(); const theme = THEMES[b.theme] ?? THEMES.gold; const have = !preview ? savedPass(b.slug) : null;
  if (!b.programs?.length) return null;
  return (
    <section id="plans" className="scroll-mt-20">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-2xl font-semibold tracking-tight"><UtensilsCrossed size={22} aria-hidden="true" />{tx("Programs")}</h2>
        {have && <button type="button" onClick={() => onOpenPass(have)} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#E7EAEE] bg-white px-4 text-sm font-semibold"><Ticket size={16} aria-hidden="true" />{tx("My pass")}</button>}
      </div>
      <p className="mb-4 max-w-xl text-sm text-[#5B6470]">{tx("Pay once, then just show your pass each time.")}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {b.programs.map((p) => (
          <article key={p.id} className="flex flex-col rounded-3xl border border-[#E7EAEE] bg-white p-5">
            <h3 className="font-display text-lg font-semibold">{p.title}</h3>
            <p className="mt-1 font-display text-2xl font-semibold tabular-nums">{rwf(p.priceRwf)}</p>
            <p className="text-sm text-[#5B6470]">{tx("for")} {p.days} {tx("days")}{p.totalUses ? ` · ${p.totalUses} ${tx('uses')}` : ''} · {p.items.join(' + ')} · {daysText(p.openDays, tx)}</p>
            {p.windows?.length ? <p className="mt-1 text-xs text-[#5B6470]">{p.windows.map((w) => `${w.item} ${w.from}–${w.to}`).join(' · ')}</p> : null}
            {p.description && <p className="mt-2 text-sm text-[#3A4350]">{p.description}</p>}
            {p.terms && <p className="mt-2 text-xs text-[#5B6470]">{p.terms}</p>}
            <button type="button" disabled={preview || p.full} onClick={() => onJoin(p)} style={{ background: theme.accent, color: theme.on }} className="mt-4 min-h-12 rounded-xl px-4 text-base font-semibold disabled:opacity-50">{p.full ? tx('This plan is full') : preview ? tx('Preview') : tx('Join this plan')}</button>
          </article>))}
      </div>
    </section>
  );
}

export function JoinDialog({ b, program, onClose, onJoined }: { b: PublicBusiness; program: Program; onClose: () => void; onJoined: (token: string) => void }) {
  const tx = useTx(); const theme = THEMES[b.theme] ?? THEMES.gold;
  const [f, setF] = useState({ name: '', phone: '', studentId: '', startDate: '', website: '' }); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const days = Array.from({ length: 8 }, (_, i) => { const d = new Date(Date.now() + 2 * 3600_000 + i * 86_400_000).toISOString().slice(0, 10); return d; });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { const r = await publicApi.join(b.slug, program.id, { name: f.name, phone: f.phone, studentId: f.studentId || undefined, startDate: f.startDate || undefined, website: f.website }); savePass(b.slug, r.token); onJoined(r.token); }
    catch (x) { setErr(x instanceof Error ? x.message : tx('Something went wrong. Please try again.')); } finally { setBusy(false); }
  };
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  const field = 'mt-1 min-h-12 w-full rounded-xl border border-[#D9DEE5] bg-white px-3.5 text-base outline-none focus:border-[#0E1722]';
  return (
    <div role="dialog" aria-modal="true" aria-label={tx("Join this plan")} className="fixed inset-0 z-[300] flex items-end justify-center bg-black/50 sm:items-center" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="max-h-[92vh] w-full max-w-md space-y-3 overflow-auto rounded-t-3xl bg-white p-5 sm:rounded-3xl">
        <div className="flex items-start justify-between gap-3"><div><h2 className="font-display text-xl font-semibold">{program.title}</h2><p className="text-sm text-[#5B6470]">{rwf(program.priceRwf)} · {program.days} {tx("days")}</p></div>
          <button type="button" onClick={onClose} aria-label={tx("Close")} className="rounded-full p-2 hover:bg-[#F2F4F7]"><X size={18} /></button></div>
        <label className="block text-sm font-medium">{tx("Your name")}<input className={field} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={60} autoComplete="name" /></label>
        <label className="block text-sm font-medium">{tx("Phone number")}<input className={field} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} required inputMode="tel" autoComplete="tel" placeholder="0788 123 456" /></label>
        <label className="block text-sm font-medium">{tx("Student ID (optional)")}<input className={field} value={f.studentId} onChange={(e) => setF({ ...f, studentId: e.target.value })} maxLength={30} /></label>
        <label className="block text-sm font-medium">{tx("Start on")}<select className={field} value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })}><option value="">{tx("Today")}</option>{days.slice(1).map((d) => <option key={d} value={d}>{shortDate(d)}</option>)}</select></label>
        <input value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 opacity-0" />
        {err && <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</p>}
        <button type="submit" disabled={busy} style={{ background: theme.accent, color: theme.on }} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl text-base font-semibold disabled:opacity-60">{busy ? <Loader2 className="animate-spin" size={18} /> : <Ticket size={18} />}{tx("Get my pass")}</button>
        <p className="text-center text-xs text-[#5B6470]">{tx("You will pay on the next screen.")}</p>
      </form>
    </div>
  );
}

function Qr({ text, size }: { text: string; size: number }) {
  const [src, setSrc] = useState('');
  useEffect(() => { let on = true; void import('qrcode').then(async (m: any) => { const u = await (m.default ?? m).toDataURL(text, { margin: 1, width: size * 2, errorCorrectionLevel: 'M', color: { dark: '#0E1722', light: '#FFFFFF' } }); if (on) setSrc(u); }).catch(() => undefined); return () => { on = false; }; }, [text, size]);
  return src ? <img src={src} width={size} height={size} alt="" className="mx-auto rounded-2xl" /> : <div style={{ width: size, height: size }} className="mx-auto animate-pulse rounded-2xl bg-[#F2F4F7]" />;
}
const Ticking = () => { const [t, setT] = useState(() => new Date()); useEffect(() => { const i = window.setInterval(() => setT(new Date()), 1000); return () => window.clearInterval(i); }, []); return <span className="font-mono tabular-nums">{t.toLocaleTimeString('en-GB', { timeZone: 'Africa/Kigali' })}</span>; };

export function PassView({ b, token, onClose }: { b: PublicBusiness; token: string; onClose: () => void }) {
  const tx = useTx(); const theme = THEMES[b.theme] ?? THEMES.gold; const [p, setP] = useState<PassInfo | null>(null); const [err, setErr] = useState('');
  const [phone, setPhone] = useState(''); const [ref, setRef] = useState(''); const [busy, setBusy] = useState(false); const [copied, setCopied] = useState(false); const waiting = useRef(false);
  const load = useCallback(async () => { try { const r = await publicApi.pass(b.slug, token); setP(r); waiting.current = !!r.payment?.promptSent; setErr(''); } catch (e) { setErr(e instanceof Error ? e.message : tx('This pass could not be opened.')); } }, [b.slug, token, tx]);
  useEffect(() => { void load(); const i = window.setInterval(() => void load(), waiting.current ? 4000 : 15_000); return () => window.clearInterval(i); }, [load, p?.payment?.promptSent]);
  const act = async (fn: () => Promise<unknown>) => { setBusy(true); setErr(''); try { await fn(); await load(); } catch (e) { setErr(e instanceof Error ? e.message : tx('Something went wrong. Please try again.')); } finally { setBusy(false); } };
  const link = passLink(b.slug, token); const m = p?.member;
  const usedUp = !!m && m.state === 'active' && !!p?.program.totalUses && m.usesLeft === 0;
  const tone = !m ? '#5B6470' : usedUp ? '#B91C1C' : m.state === 'active' ? '#15803D' : m.state === 'pending' || m.state === 'not_started' ? '#B45309' : '#B91C1C';
  const label = !m ? '' : usedUp ? tx('ALL USES TAKEN') : ({ active: tx('ACTIVE'), pending: tx('WAITING FOR PAYMENT'), not_started: tx('STARTS SOON'), expired: tx('PLAN ENDED'), paused: tx('PAUSED'), cancelled: tx('CANCELLED') } as Record<string, string>)[m.state];
  const field = 'min-h-12 w-full rounded-xl border border-[#D9DEE5] bg-white px-3.5 text-base outline-none focus:border-[#0E1722]';
  return (
    <div role="dialog" aria-modal="true" aria-label={tx("My pass")} className="fixed inset-0 z-[320] overflow-auto bg-[#F5F7FA]">
      <div className="mx-auto max-w-md px-4 pb-10 pt-4">
        <div className="mb-3 flex items-center justify-between"><p className="font-display text-lg font-semibold">{b.name}</p><button type="button" onClick={onClose} aria-label={tx("Close")} className="rounded-full p-2 hover:bg-white"><X size={20} /></button></div>
        {!p && !err && <div className="grid place-items-center py-24"><Loader2 className="animate-spin" aria-label={tx("Loading")} /></div>}
        {err && !p && <p role="alert" className="rounded-2xl bg-rose-50 p-4 text-sm text-rose-700">{err}</p>}
        {p && m && (
          <div className="overflow-hidden rounded-3xl bg-white shadow-sm">
            <div className="px-5 py-3 text-center text-sm font-bold tracking-wide text-white" style={{ background: tone }}>{label}</div>
            <div className="space-y-4 p-5 text-center">
              <div><p className="font-display text-2xl font-semibold">{m.name}</p><p className="text-sm text-[#5B6470]">{p.program.title}</p></div>

              {(m.state === 'active' || m.state === 'not_started') && (
                <>
                  <Qr text={`BWPASS:${token}`} size={232} />
                  <p className="font-mono text-xl font-semibold tracking-widest">{m.code}</p>
                  <p className="text-sm text-[#5B6470]">{tx("Show this when you arrive. If the camera does not work, read the code.")}</p>
                  {m.state === 'active' && (p.today.used.length ? <p className="flex items-center justify-center gap-1.5 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800"><CheckCircle2 size={16} />{p.today.used.map((e) => `${e.item} ${clock(e.at)}`).join(' · ')}</p>
                    : p.today.openToday ? <p className="rounded-xl bg-[#F2F4F7] px-3 py-2 text-sm">{tx("Not used yet today")}</p> : <p className="rounded-xl bg-[#F2F4F7] px-3 py-2 text-sm">{tx("Not available today")}</p>)}
                  {m.state === 'not_started' && <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">{tx("Your plan starts on")} {shortDate(m.startDate)}.</p>}
                  <div className="grid grid-cols-2 gap-2 text-left"><div className="rounded-xl bg-[#F2F4F7] p-3"><p className="text-xs text-[#5B6470]">{tx("Uses left")}</p><p className="font-display text-xl font-semibold tabular-nums">{m.usesLeft}</p></div><div className="rounded-xl bg-[#F2F4F7] p-3"><p className="text-xs text-[#5B6470]">{tx("Valid until")}</p><p className="font-display text-xl font-semibold">{shortDate(m.endDate)}</p></div></div>
                  <p className="flex items-center justify-center gap-1.5 text-xs text-[#5B6470]"><Clock size={13} aria-hidden="true" /><Ticking /></p>
                </>
              )}

              {m.state === 'pending' && p.payment && (
                <div className="space-y-3 text-left">
                  <p className="text-center font-display text-3xl font-semibold tabular-nums">{rwf(p.payment.amount)}</p>
                  {p.payment.online && (p.payment.promptSent
                    ? <p role="status" className="flex items-center gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><Loader2 className="animate-spin" size={16} />{tx("Check your phone and approve the payment.")}</p>
                    : <div className="space-y-2"><label className="block text-sm font-medium">{tx("Pay with your phone (MTN or Airtel)")}<input className={`${field} mt-1`} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="0788 123 456" /></label>
                      <button type="button" disabled={busy || phone.replace(/\D/g, '').length < 9} onClick={() => void act(() => publicApi.payPass(b.slug, token, phone))} style={{ background: theme.accent, color: theme.on }} className="min-h-12 w-full rounded-xl text-base font-semibold disabled:opacity-50">{busy ? <Loader2 className="mx-auto animate-spin" size={18} /> : tx('Send payment request')}</button></div>)}
                  {!p.payment.online && p.payment.momoCode && <div className="rounded-xl bg-[#F2F4F7] p-3 text-sm"><p>{tx("Send")} <b>{rwf(p.payment.amount)}</b> {tx("by MoMo to")}</p><p className="mt-1 font-mono text-2xl font-semibold tracking-wider">{p.payment.momoCode}</p>{p.payment.momoName && <p className="text-[#5B6470]">{p.payment.momoName}</p>}</div>}
                  {!p.payment.online && !p.payment.momoCode && <p className="rounded-xl bg-[#F2F4F7] p-3 text-sm">{tx("Pay the business in person, then tap the button below.")}</p>}
                  {!p.payment.claimed ? (
                    <div className="space-y-2"><input className={field} value={ref} onChange={(e) => setRef(e.target.value)} placeholder={tx("MoMo reference (optional)")} maxLength={40} />
                      <button type="button" disabled={busy} onClick={() => void act(() => publicApi.claimPass(b.slug, token, ref))} className="min-h-12 w-full rounded-xl border-2 border-[#0E1722] text-base font-semibold disabled:opacity-50">{tx("I have paid")}</button></div>
                  ) : <p role="status" className="flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900"><Check size={16} />{tx("Thank you. The business will confirm your payment, then this pass turns green.")}</p>}
                  {p.payment.whatsapp && <a className="flex min-h-11 items-center justify-center gap-2 text-sm font-medium underline" href={`https://wa.me/${p.payment.whatsapp}?text=${encodeURIComponent(`${m.name} (${m.code}): ${tx('I joined')} "${p.program.title}".`)}`} target="_blank" rel="noopener noreferrer"><MessageCircle size={15} />{tx("Message the business")}</a>}
                </div>
              )}

              {(m.state === 'expired' || m.state === 'paused' || m.state === 'cancelled') && <p className="rounded-xl bg-[#F2F4F7] p-3 text-sm">{m.state === 'expired' ? `${tx('Your plan ended on')} ${shortDate(m.endDate)}. ${tx('Join again from the business page to keep going.')}` : m.state === 'paused' ? tx('The business paused your plan. Ask them to resume it.') : tx('This plan was cancelled.')}</p>}

              {p.program.terms && <p className="text-xs text-[#5B6470]">{p.program.terms}</p>}
              {p.history.length > 0 && <details className="text-left text-sm"><summary className="cursor-pointer font-medium">{tx("My history")} ({p.history.reduce((a, h) => a + h.items.length, 0)})</summary><ul className="mt-2 max-h-40 space-y-1 overflow-auto text-[#5B6470]">{p.history.slice().reverse().map((h) => <li key={h.date}>{shortDate(h.date)} · {h.items.join(', ')}</li>)}</ul></details>}
              <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* link is in the address bar */ } }} className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-[#0E1722] underline">{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? tx('Copied') : tx('Copy my pass link')}</button>
              <p className="text-xs text-[#5B6470]">{tx("Keep this link safe: anyone who has it can use your pass. Add this page to your home screen to open it fast.")}</p>
              {err && <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
