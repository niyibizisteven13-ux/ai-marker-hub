import { getStudioLang, tx } from '../../biz/studioI18n';
import { RW_WORDS, fill, wordsOf } from '../../../server/services/biz/programWords';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Camera, Check, CheckCircle2, Copy, Loader2, MessageCircle, Pause, Pencil, Play, Plus, ScanLine, Share2, Trash2, Undo2, Users, UtensilsCrossed, X, XCircle } from 'lucide-react';
import { ownerApi } from '../../biz/api';
import type { DayId, MemberInfo, ProgramInfo, ProgramSummary, RedeemResult, TodayInfo } from '../../biz/types';
import { rwf, type Business } from '../../biz/types';
import { btn, btnGhost, btnPrimary, card, input, msg, Title } from './ui';

/**
 * Programs (programs) in the owner's studio. A restaurant sells a plan once (say 40,000 RWF for a month of lunches), students join from a
 * shared link and pay, and every day the student shows a pass (QR code); the owner scans it here and the system says whether to serve.
 * Three screens: Today (scan, who has used, who has not come), Members (payments, pauses, extensions), Plans (make one, share the link).
 */
/** The owner's own words (what they call the program, the people, the pass, one use…), with plain defaults, and a translator that fills them into a template. */
const useWords = (b: Business) => { const w = wordsOf(b.programText, getStudioLang() === 'rw' ? RW_WORDS : undefined); return { w, t: (s: string) => fill(tx(s), w) }; };
const DAY_LABEL: Record<DayId, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
const ALL_DAYS: DayId[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const shortDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kigali' });
const waLink = (phone: string, text: string) => `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
export const planLink = (slug: string, programId: string) => `${typeof window !== 'undefined' ? window.location.origin : 'https://www.bwenge.space'}/b/${slug}?plan=${programId}`;

const STATE_STYLE: Record<string, string> = {
  active: 'bg-emerald-500/15 text-emerald-700', pending: 'bg-amber-500/20 text-amber-800', not_started: 'bg-sky-500/15 text-sky-700', expired: 'bg-[var(--app-panel-hover)] text-[var(--app-muted)]',
  paused: 'bg-violet-500/15 text-violet-700', cancelled: 'bg-rose-500/15 text-rose-700',
};
const STATE_LABEL: Record<string, string> = { active: 'Active', pending: 'Waiting for payment', not_started: 'Starts soon', expired: 'Ended', paused: 'Paused', cancelled: 'Cancelled' };
const StateTag = ({ s }: { s: string }) => <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATE_STYLE[s] ?? ''}`}>{tx(STATE_LABEL[s] ?? s)}</span>;

/** A short beep and a buzz, so the cook at the counter knows without looking at the phone. */
function signal(ok: boolean) {
  try { navigator.vibrate?.(ok ? 80 : [60, 60, 60]); } catch { /* optional */ }
  try {
    const A = (window as any).AudioContext || (window as any).webkitAudioContext; if (!A) return; const c = new A(); const o = c.createOscillator(); const g = c.createGain();
    o.frequency.value = ok ? 880 : 220; g.gain.value = 0.08; o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + (ok ? 0.12 : 0.3)); setTimeout(() => c.close?.(), 500);
  } catch { /* optional */ }
}

export function QrImage({ text, size = 176 }: { text: string; size?: number }) {
  const [src, setSrc] = useState('');
  useEffect(() => { let on = true; void import('qrcode').then(async (m: any) => { const url = await (m.default ?? m).toDataURL(text, { margin: 1, width: size * 2, errorCorrectionLevel: 'M' }); if (on) setSrc(url); }).catch(() => undefined); return () => { on = false; }; }, [text, size]);
  return src ? <img src={src} width={size} height={size} alt={tx("QR code")} className="rounded-lg bg-white p-1.5" /> : <div style={{ width: size, height: size }} className="animate-pulse rounded-lg bg-[var(--app-panel-hover)]" />;
}

/* ------------------------------------------------------------------ camera: read a pass QR code */
function useScanner(active: boolean, onCode: (text: string) => void) {
  const video = useRef<HTMLVideoElement>(null); const [error, setError] = useState(''); const [ready, setReady] = useState(false);
  const cb = useRef(onCode); cb.current = onCode;
  useEffect(() => {
    if (!active) return; let stop = false; let stream: MediaStream | null = null; let timer = 0; let last = ''; let lastAt = 0;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error(tx('This browser cannot open the camera. Type the code instead.'));
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (stop) { stream.getTracks().forEach((t) => t.stop()); return; }
        const v = video.current!; v.srcObject = stream; v.setAttribute('playsinline', 'true'); await v.play(); setReady(true);
        const Detector = (window as any).BarcodeDetector; const detector = Detector ? new Detector({ formats: ['qr_code'] }) : null;
        const jsQR = detector ? null : (await import('jsqr')).default; const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        const tick = async () => {
          if (stop) return;
          try {
            let text = '';
            if (v.readyState >= 2 && v.videoWidth) {
              if (detector) { const found = await detector.detect(v); text = found[0]?.rawValue ?? ''; }
              else { const w = 480, h = Math.round((v.videoHeight / v.videoWidth) * w); canvas.width = w; canvas.height = h; ctx.drawImage(v, 0, 0, w, h); text = jsQR!(ctx.getImageData(0, 0, w, h).data, w, h)?.data ?? ''; }
            }
            if (text && (text !== last || Date.now() - lastAt > 4000)) { last = text; lastAt = Date.now(); cb.current(text); }
          } catch { /* a frame that cannot be read is skipped */ }
          timer = window.setTimeout(tick, 220);
        };
        void tick();
      } catch (e) { setError(e instanceof Error && e.name !== 'NotAllowedError' ? e.message : tx('Allow the camera to scan passes, or type the code instead.')); }
    })();
    return () => { stop = true; window.clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()); setReady(false); };
  }, [active]);
  return { video, error, ready };
}

/* ------------------------------------------------------------------ the three screens */
export function ProgramsView({ b, onChange }: { b: Business; onChange: () => void }) {
  const { w, t } = useWords(b);
  const [tab, setTab] = useState<'today' | 'members' | 'plans' | 'names'>('today');
  const [data, setData] = useState<{ programs: ProgramInfo[]; summary: ProgramSummary } | null>(null); const [err, setErr] = useState('');
  const load = useCallback(async () => { try { setData(await ownerApi.programs(b.id)); setErr(''); } catch (e) { setErr(msg(e)); } }, [b.id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (data && !data.programs.length) setTab('plans'); }, [data?.programs.length]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return err ? <p role="alert" className="text-sm text-rose-600">{err}</p> : <Loader2 className="animate-spin" aria-label={tx("Loading")} />;
  const s = data.summary; const tabs = [{ id: 'today' as const, label: tx('Today'), icon: ScanLine }, { id: 'members' as const, label: t("{Members}"), icon: Users }, { id: 'plans' as const, label: t("{Programs}"), icon: UtensilsCrossed }, { id: 'names' as const, label: tx('Names'), icon: Pencil }];
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-semibold tracking-tight">{t("{Programs}")}</h1>
      <p className="max-w-2xl text-sm text-[var(--app-muted)]">{t("Sell a {program} once. Customers join from a link, pay, and show a {pass} on their phone. You scan it each time, and it checks that they may use it now.")}</p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[[t("Active {members}"), String(s.active)], [tx('Waiting for payment'), String(s.pending)], [tx('Sold this month'), rwf(s.soldThisMonth)], [tx('Ending in 3 days'), String(s.expiring.length)]].map(([k, v]) => <div key={k} className={`${card} !p-4`}><p className="text-xs text-[var(--app-muted)]">{k}</p><p className="mt-1 font-display text-xl font-semibold tabular-nums">{v}</p></div>)}
      </div>
      <div className="inline-flex rounded-xl bg-[var(--app-bg)] p-1" role="tablist" aria-label={t("{Programs}")}>
        {tabs.map((t) => { const Icon = t.icon; return <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={`inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3.5 text-sm font-semibold ${tab === t.id ? 'bg-[var(--app-panel)] shadow-sm' : 'text-[var(--app-muted)]'}`}><Icon size={15} aria-hidden="true" />{t.label}</button>; })}
      </div>
      {tab === 'today' && <TodayTab b={b} hasPlans={data.programs.length > 0} onChange={() => { void load(); onChange(); }} goPlans={() => setTab('plans')} />}
      {tab === 'members' && <MembersTab b={b} programs={data.programs} summary={s} onChange={() => { void load(); onChange(); }} />}
      {tab === 'names' && <NamesTab b={b} onChange={() => { void load(); onChange(); }} />}
      {tab === 'plans' && <PlansTab b={b} programs={data.programs} onChange={() => { void load(); onChange(); }} />}
    </div>
  );
}

/* ---------- Today: scan a pass, or type a code ---------- */
function TodayTab({ b, hasPlans, onChange, goPlans }: { b: Business; hasPlans: boolean; onChange: () => void; goPlans: () => void }) {
  const { w, t } = useWords(b);
  const [camera, setCamera] = useState(false); const [code, setCode] = useState(''); const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<(RedeemResult & { token?: string }) | null>(null); const [today, setToday] = useState<TodayInfo | null>(null); const [err, setErr] = useState('');
  const loadToday = useCallback(async () => { try { setToday(await ownerApi.today(b.id)); } catch (e) { setErr(msg(e)); } }, [b.id]);
  useEffect(() => { void loadToday(); const t = window.setInterval(() => void loadToday(), 20_000); return () => window.clearInterval(t); }, [loadToday]);
  const redeem = useCallback(async (body: { token?: string; code?: string; memberId?: string; force?: boolean; item?: string }) => {
    if (busy) return; setBusy(true);
    try { const r = await ownerApi.redeem(b.id, body); setResult({ ...r, token: body.token }); signal(r.ok); setCode(''); void loadToday(); onChange(); } catch (e) { setErr(msg(e)); } finally { setBusy(false); }
  }, [b.id, busy, loadToday, onChange]);
  const scanner = useScanner(camera && !result, (text) => { void redeem({ token: text }); });
  if (!hasPlans) return <div className={card}><p className="text-sm">{t("Make your first {program} to get started.")}</p><button type="button" className={`${btnPrimary} mt-3`} onClick={goPlans}><Plus size={16} />{t("Create a {program}")}</button></div>;
  const m = result?.member;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section className={`${card} space-y-3`} aria-label={t("Scan a {pass}")}>
        <Title>{t("Check a {pass}")}</Title>
        {result ? (
          <div role="status" aria-live="polite" className={`rounded-2xl p-5 text-center ${result.ok ? 'bg-emerald-500/15' : 'bg-rose-500/12'}`}>
            {result.ok ? <CheckCircle2 size={44} className="mx-auto text-emerald-600" aria-hidden="true" /> : <XCircle size={44} className="mx-auto text-rose-600" aria-hidden="true" />}
            <p className="mt-2 font-display text-2xl font-semibold">{m?.name ?? t("Unknown {pass}")}</p>
            <p className={`mt-1 text-base font-semibold ${result.ok ? 'text-emerald-700' : 'text-rose-700'}`}>{result.ok ? `${w.action}: ${result.item}` : result.message}</p>
            {m && <p className="mt-1 text-sm text-[var(--app-muted)]">{m.programTitle} · {m.usesLeft} {t("{uses} left")} · {tx('until')} {shortDate(m.endDate)}</p>}
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {result.ok && result.useId && <button type="button" className={btnGhost} onClick={async () => { try { await ownerApi.undoUse(b.id, result.useId!); setResult(null); void loadToday(); onChange(); } catch (e) { setErr(msg(e)); } }}><Undo2 size={15} />{tx("Undo")}</button>}
              {!result.ok && result.code === 'outside_window' && m && w.allowOverride && <button type="button" className={btnGhost} onClick={() => void redeem({ memberId: m.id, force: true })}>{tx("Allow anyway")}</button>}
              <button type="button" className={btnPrimary} onClick={() => setResult(null)}>{tx("Next")}</button>
            </div>
          </div>
        ) : (
          <>
            {camera ? (
              <div className="relative overflow-hidden rounded-2xl bg-black">
                <video ref={scanner.video} muted playsInline className="aspect-square w-full object-cover" aria-label={tx("Camera")} />
                <div className="pointer-events-none absolute inset-8 rounded-2xl border-2 border-white/80" aria-hidden="true" />
                {!scanner.ready && !scanner.error && <p className="absolute inset-0 grid place-items-center text-sm text-white"><Loader2 className="animate-spin" /></p>}
                <button type="button" className="absolute right-2 top-2 rounded-full bg-black/60 p-2 text-white" onClick={() => setCamera(false)} aria-label={tx("Close the camera")}><X size={16} /></button>
              </div>
            ) : <button type="button" className={`${btnPrimary} w-full !min-h-14 text-base`} onClick={() => setCamera(true)}><Camera size={20} />{t("Scan a {pass}")}</button>}
            {scanner.error && <p role="alert" className="text-sm text-amber-700">{scanner.error}</p>}
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (code.trim()) void redeem({ code }); }}>
              <input className={`${input} font-mono uppercase tracking-wider`} value={code} onChange={(e) => setCode(e.target.value)} placeholder="ABCD-2345" inputMode="text" autoCapitalize="characters" autoComplete="off" aria-label={t("{Pass} code")} />
              <button type="submit" disabled={busy || !code.trim()} className={btnPrimary}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}{tx("Check")}</button>
            </form>
            <p className="text-xs text-[var(--app-muted)]">{tx("No camera? Type the code shown under the customer's QR code.")}</p>
          </>
        )}
        {err && <p role="alert" className="text-sm text-rose-600">{err}</p>}
      </section>

      <section className={`${card} space-y-3`}>
        <Title>{tx("Today")}</Title>
        {!today ? <Loader2 className="animate-spin" aria-label={tx("Loading")} /> : (
          <>
            <p className="text-sm"><b className="text-2xl tabular-nums">{today.servedCount}</b> {tx("checked in")} · <b className="tabular-nums">{today.notYet.length}</b> {t("have a {program} today and have not come yet")}</p>
            {!today.open && <p className="rounded-xl bg-[var(--app-bg)] p-3 text-sm text-[var(--app-muted)]">{t("Your {programs} are not available today.")}</p>}
            {today.served.length > 0 && <ul className="max-h-64 divide-y divide-[var(--app-line)] overflow-auto text-sm">{today.served.map((s) => (
              <li key={s.useId} className="flex items-center justify-between gap-2 py-2"><span className="min-w-0"><b>{s.name}</b> <span className="text-[var(--app-muted)]">· {s.item} · {hhmm(s.at)}</span></span>
                {s.canUndo && <button type="button" className="text-xs text-rose-600 underline" onClick={async () => { try { await ownerApi.undoUse(b.id, s.useId); void loadToday(); onChange(); } catch (e) { setErr(msg(e)); } }}>{tx("Undo")}</button>}</li>))}</ul>}
            {today.notYet.length > 0 && <details className="text-sm"><summary className="cursor-pointer font-medium">{tx("Not yet today")} ({today.notYet.length})</summary>
              <ul className="mt-2 max-h-56 divide-y divide-[var(--app-line)] overflow-auto">{today.notYet.map((n) => <li key={n.memberId} className="flex items-center justify-between gap-2 py-1.5"><span>{n.name}</span><span className="font-mono text-xs text-[var(--app-muted)]">{n.code}</span></li>)}</ul></details>}
          </>
        )}
      </section>
    </div>
  );
}

/* ---------- Members ---------- */
function MembersTab({ b, programs, summary, onChange }: { b: Business; programs: ProgramInfo[]; summary: ProgramSummary; onChange: () => void }) {
  const { w, t } = useWords(b);
  const [list, setList] = useState<MemberInfo[] | null>(null); const [q, setQ] = useState(''); const [state, setState] = useState(''); const [program, setProgram] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState('');
  const load = useCallback(async () => { try { setList(await ownerApi.members(b.id, { q, state, program })); setErr(''); } catch (e) { setErr(msg(e)); } }, [b.id, q, state, program]);
  useEffect(() => { const t = window.setTimeout(() => void load(), q ? 250 : 0); return () => window.clearTimeout(t); }, [load, q]);
  const act = async (id: string, fn: () => Promise<unknown>) => { setBusy(id); try { await fn(); await load(); onChange(); } catch (e) { setErr(msg(e)); } finally { setBusy(''); } };
  const remind = (m: MemberInfo) => waLink(m.phone, `${tx('Hello')} ${m.name}, ${t("your {program} at")} ${b.name} ${tx('ends on')} ${shortDate(m.endDate)}. ${tx('Renew to keep your plan going.')}`);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input className={`${input} !w-64`} value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx("Search name, phone or code")} aria-label={t("Search {members}")} />
        <select className={`${input} !w-52`} value={state} onChange={(e) => setState(e.target.value)} aria-label={tx("Show")}><option value="">{t("All {members}")}</option><option value="pending">{tx("Waiting for payment")}</option><option value="active">{tx("Active")}</option><option value="expired">{tx("Ended")}</option><option value="paused">{tx("Paused")}</option></select>
        {programs.length > 1 && <select className={`${input} !w-52`} value={program} onChange={(e) => setProgram(e.target.value)} aria-label={tx("Plan")}><option value="">{tx("All plans")}</option>{programs.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select>}
      </div>
      {summary.waitingConfirmation > 0 && <p className="rounded-xl bg-amber-500/15 px-3 py-2 text-sm text-amber-900"><b>{tx("Says paid")}: {summary.waitingConfirmation}.</b> {tx("Check your MoMo, then tap Confirm payment.")}</p>}
      {err && <p role="alert" className="text-sm text-rose-600">{err}</p>}
      {!list ? <Loader2 className="animate-spin" aria-label={tx("Loading")} /> : !list.length ? <p className={`${card} text-sm text-[var(--app-muted)]`}>{t("No {members} yet. Share a link from the {programs} screen.")}</p> : (
        <ul className="space-y-2">{list.map((m) => (
          <li key={m.id} className={`${card} !p-4`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0"><p className="font-semibold">{m.name} <StateTag s={m.state} /></p>
                <p className="text-xs text-[var(--app-muted)]">{m.programTitle} · +{m.phone} · <span className="font-mono">{m.code}</span>{m.idNumber ? ` · ${m.idNumber}` : ''}</p>
                <p className="mt-1 text-xs text-[var(--app-muted)]">{shortDate(m.startDate)} → {shortDate(m.endDate)}{m.state === 'active' ? ` · ${m.usesLeft} ${t("{uses} left")}` : ''}{m.claimed ? ` · ${tx('says paid')}${m.claimed.ref ? ` (${m.claimed.ref})` : ''}` : ''}</p></div>
              <div className="flex flex-wrap gap-1.5">
                {!m.paid && m.state !== 'cancelled' && <><button type="button" disabled={busy === m.id} className={`${btnPrimary} !min-h-9 !px-3 text-xs`} onClick={() => void act(m.id, () => ownerApi.confirmMember(b.id, m.id, 'momo'))}><Check size={14} />{tx("Confirm payment")} (MoMo)</button>
                  <button type="button" disabled={busy === m.id} className={`${btnGhost} !min-h-9 !px-3 text-xs`} onClick={() => void act(m.id, () => ownerApi.confirmMember(b.id, m.id, 'cash'))}>{tx("Paid in cash")}</button></>}
                {m.paid && m.state !== 'cancelled' && (m.state === 'paused' ? <button type="button" className={`${btnGhost} !min-h-9 !px-3 text-xs`} onClick={() => void act(m.id, () => ownerApi.setMember(b.id, m.id, { action: 'resume' }))}><Play size={13} />{tx("Resume")}</button>
                  : <button type="button" className={`${btnGhost} !min-h-9 !px-3 text-xs`} onClick={() => void act(m.id, () => ownerApi.setMember(b.id, m.id, { action: 'pause' }))}><Pause size={13} />{tx("Pause")}</button>)}
                {m.paid && m.state !== 'cancelled' && <button type="button" className={`${btnGhost} !min-h-9 !px-3 text-xs`} onClick={() => { const n = Number(window.prompt(tx('Add how many days?'), '3')); if (n >= 1) void act(m.id, () => ownerApi.setMember(b.id, m.id, { action: 'extend', days: n })); }}>{tx("Add days")}</button>}
                {(m.state === 'active' || m.state === 'expired') && <a className={`${btnGhost} !min-h-9 !px-3 text-xs`} href={remind(m)} target="_blank" rel="noopener noreferrer"><MessageCircle size={13} />{tx("WhatsApp")}</a>}
                {m.state !== 'cancelled' && <button type="button" className="px-2 text-xs text-rose-600 underline" onClick={() => { if (confirm(`${t("Cancel the {program} of")} ${m.name}?`)) void act(m.id, () => ownerApi.setMember(b.id, m.id, { action: 'cancel' })); }}>{tx("Cancel")}</button>}
              </div>
            </div>
          </li>))}</ul>
      )}
    </div>
  );
}

/* ---------- Plans: make one, share its link ---------- */
const blank = (): Partial<ProgramInfo> => ({ title: '', priceRwf: 30000, days: 30, items: ['Visit'], openDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], active: true });
function PlansTab({ b, programs, onChange }: { b: Business; programs: ProgramInfo[]; onChange: () => void }) {
  const { w, t } = useWords(b);
  const [edit, setEdit] = useState<Partial<ProgramInfo> | null>(programs.length ? null : blank()); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [copied, setCopied] = useState('');
  const save = async () => { if (!edit) return; setBusy(true); setErr(''); try { await ownerApi.saveProgram(b.id, edit as any); setEdit(null); onChange(); } catch (e) { setErr(msg(e)); } finally { setBusy(false); } };
  const copy = async (text: string, id: string) => { try { await navigator.clipboard.writeText(text); setCopied(id); setTimeout(() => setCopied(''), 1600); } catch { /* the link is shown anyway */ } };
  const set = (patch: Partial<ProgramInfo>) => setEdit((e) => ({ ...(e ?? {}), ...patch }));
  return (
    <div className="space-y-4">
      {!b.published && <p className="rounded-xl bg-amber-500/15 px-3 py-2.5 text-sm text-amber-900">{tx("Publish your page first (Public page → Publish), so customers can open the link.")}</p>}
      {programs.map((p) => {
        const link = planLink(b.slug, p.id); const share = `${t("Join our {program}")} "${p.title}" ${tx('at')} ${b.name}: ${rwf(p.priceRwf)} ${tx('for')} ${p.days} ${tx('days')}. ${link}`;
        return (
          <div key={p.id} className={`${card} space-y-3`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div><p className="font-display text-lg font-semibold">{p.title} {!p.active && <span className="ml-1 rounded-full bg-[var(--app-panel-hover)] px-2 py-0.5 align-middle text-[11px] font-medium text-[var(--app-muted)]">{t("Closed to new {members}")}</span>}</p>
                <p className="text-sm text-[var(--app-muted)]">{rwf(p.priceRwf)} · {p.days} {tx('days')}{p.totalUses ? ` · ${p.totalUses} ${w.uses}` : ''} · {p.items.join(', ')} · {p.openDays.map((d) => tx(DAY_LABEL[d])).join(' ')}</p>
                <p className="mt-1 text-xs text-[var(--app-muted)]">{p.counts?.active ?? 0} {tx('active')} · {p.counts?.pending ?? 0} {tx('waiting for payment')}</p></div>
              <div className="flex gap-1.5"><button type="button" className={`${btnGhost} !min-h-9 !px-3 text-xs`} onClick={() => setEdit(p)}><Pencil size={13} />{tx("Edit")}</button>
                <button type="button" className={`${btnGhost} !min-h-9 !px-3 text-xs`} onClick={async () => { try { await ownerApi.saveProgram(b.id, { ...p, active: !p.active }); onChange(); } catch (e) { setErr(msg(e)); } }}>{p.active ? tx('Close signups') : tx('Open signups')}</button>
                <button type="button" className="px-2 text-rose-600" aria-label={t("Delete {program}")} onClick={async () => { if (!confirm(`${tx('Delete')} "${p.title}"?`)) return; try { await ownerApi.deleteProgram(b.id, p.id); onChange(); } catch (e) { setErr(msg(e)); } }}><Trash2 size={15} /></button></div>
            </div>
            <div className="flex flex-wrap items-center gap-4 rounded-2xl bg-[var(--app-bg)] p-3">
              <QrImage text={link} size={112} />
              <div className="min-w-0 flex-1 space-y-2"><p className="text-xs font-medium text-[var(--app-muted)]">{tx("Share this link with your customers")}</p>
                <p className="break-all rounded-lg bg-[var(--app-panel)] px-2.5 py-1.5 font-mono text-xs">{link}</p>
                <div className="flex flex-wrap gap-2"><button type="button" className={`${btnGhost} !min-h-9 !px-3 text-xs`} onClick={() => void copy(link, p.id)}>{copied === p.id ? <Check size={13} /> : <Copy size={13} />}{copied === p.id ? tx('Copied') : tx('Copy link')}</button>
                  <a className={`${btnPrimary} !min-h-9 !px-3 text-xs`} href={`https://wa.me/?text=${encodeURIComponent(share)}`} target="_blank" rel="noopener noreferrer"><Share2 size={13} />{tx("Share on WhatsApp")}</a></div></div>
            </div>
          </div>);
      })}
      {err && !edit && <p role="alert" className="text-sm text-rose-600">{err}</p>}
      {!edit && <button type="button" className={btnPrimary} onClick={() => setEdit(blank())}><Plus size={16} />{t("New {program}")}</button>}
      {edit && (
        <form className={`${card} space-y-3`} onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <Title>{edit.id ? t("Edit {program}") : t("New {program}")}</Title>
          <label className="block text-sm font-medium">{t("{Program} name")}<input className={`${input} mt-1`} value={edit.title ?? ''} onChange={(e) => set({ title: e.target.value })} placeholder={tx("Monthly pass")} required maxLength={60} /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-medium">{tx("Price (RWF), paid once")}<input className={`${input} mt-1`} inputMode="numeric" value={edit.priceRwf ?? ''} onChange={(e) => set({ priceRwf: Number(e.target.value.replace(/\D/g, '')) })} required /></label>
            <label className="block text-sm font-medium">{tx("Lasts (days)")}<input className={`${input} mt-1`} inputMode="numeric" value={edit.days ?? ''} onChange={(e) => set({ days: Number(e.target.value.replace(/\D/g, '')) })} required /></label>
          </div>
          <label className="block text-sm font-medium">{tx("What they get each day (separate with commas, for example Lunch or Entry)")}<input className={`${input} mt-1`} value={(edit.items ?? []).join(', ')} onChange={(e) => set({ items: e.target.value.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 4) })} placeholder="Lunch" /></label>
          <fieldset><legend className="text-sm font-medium">{tx("Days it is available")}</legend><div className="mt-1.5 flex flex-wrap gap-1.5">{ALL_DAYS.map((d) => { const on = (edit.openDays ?? []).includes(d); return <button key={d} type="button" aria-pressed={on} onClick={() => set({ openDays: on ? (edit.openDays ?? []).filter((x) => x !== d) : [...(edit.openDays ?? []), d] })} className={`min-h-10 rounded-xl px-3 text-sm font-semibold ${on ? 'bg-[var(--brand)] text-[var(--brand-on)]' : 'border border-[var(--app-line)] text-[var(--app-muted)]'}`}>{tx(DAY_LABEL[d])}</button>; })}</div></fieldset>
          <details><summary className="cursor-pointer text-sm font-medium">{tx("Times it is available (optional)")}</summary>
            <div className="mt-2 space-y-2">{(edit.items ?? []).map((item) => { const w = (edit.windows ?? []).find((x) => x.item === item); const upd = (from: string, to: string) => set({ windows: [...(edit.windows ?? []).filter((x) => x.item !== item), ...(from && to ? [{ item, from, to }] : [])] });
              return <div key={item} className="flex items-center gap-2 text-sm"><span className="w-24 truncate">{item}</span><input type="time" className={`${input} !w-32`} value={w?.from ?? ''} onChange={(e) => upd(e.target.value, w?.to ?? '')} aria-label={`${item} ${tx('from')}`} />–<input type="time" className={`${input} !w-32`} value={w?.to ?? ''} onChange={(e) => upd(w?.from ?? '', e.target.value)} aria-label={`${item} ${tx('to')}`} /></div>; })}</div>
            <p className="mt-1 text-xs text-[var(--app-muted)]">{tx("Outside these times the scan says so, and you can still allow it.")}</p></details>
          <label className="block text-sm font-medium">{t("Maximum {members} (optional)")}<input className={`${input} mt-1 !w-40`} inputMode="numeric" value={edit.maxMembers ?? ''} onChange={(e) => set({ maxMembers: e.target.value ? Number(e.target.value.replace(/\D/g, '')) : undefined })} /></label>
          <label className="block text-sm font-medium">{t("Total {uses} (optional)")}<input className={`${input} mt-1 !w-40`} inputMode="numeric" value={edit.totalUses ?? ''} onChange={(e) => set({ totalUses: e.target.value ? Number(e.target.value.replace(/\D/g, '')) : undefined })} placeholder={tx("No limit")} /><span className="mt-1 block text-xs font-normal text-[var(--app-muted)]">{t("For example 10 visits or 4 haircuts. Leave empty for one {use} of each item per day.")}</span></label>
          <label className="block text-sm font-medium">{tx("Note for customers (optional)")}<textarea className={`${input} mt-1`} rows={2} maxLength={300} value={edit.terms ?? ''} onChange={(e) => set({ terms: e.target.value })} placeholder={tx("One use a day. Show your pass each time.")} /></label>
          {err && <p role="alert" className="text-sm text-rose-600"><AlertTriangle size={14} className="mr-1 inline" />{err}</p>}
          <div className="flex gap-2"><button type="submit" disabled={busy} className={btnPrimary}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}{t("Save {program}")}</button>{programs.length > 0 && <button type="button" className={btnGhost} onClick={() => { setEdit(null); setErr(''); }}>{tx("Cancel")}</button>}</div>
        </form>
      )}
    </div>
  );
}

/* ---------- Names: the owner chooses every word ---------- */
const PRESETS: Array<{ label: string; text: Record<string, string> }> = [
  { label: 'Restaurant for students', text: { program: 'Meal card', programs: 'Meal cards', member: 'student', members: 'students', pass: 'card', use: 'meal', uses: 'meals', action: 'Serve', idLabel: 'Student ID' } },
  { label: 'Gym', text: { program: 'Membership', programs: 'Memberships', member: 'member', members: 'members', pass: 'card', use: 'visit', uses: 'visits', action: 'Check in', idLabel: 'Membership number' } },
  { label: 'Salon or barber', text: { program: 'Package', programs: 'Packages', member: 'client', members: 'clients', pass: 'voucher', use: 'visit', uses: 'visits', action: 'Redeem', idLabel: '' } },
  { label: 'Laundry', text: { program: 'Wash card', programs: 'Wash cards', member: 'customer', members: 'customers', pass: 'card', use: 'wash', uses: 'washes', action: 'Redeem', idLabel: '' } },
];
const NAME_FIELDS: Array<{ key: string; label: string; hint: string }> = [
  { key: 'program', label: 'What you call this (one)', hint: 'Meal card, Membership, Package…' }, { key: 'programs', label: 'What you call this (many)', hint: 'Meal cards' },
  { key: 'member', label: 'What you call the people who join (one)', hint: 'student, member, client…' }, { key: 'members', label: 'The people who join (many)', hint: 'students' },
  { key: 'pass', label: 'What you call the pass they show', hint: 'card, ticket, voucher…' }, { key: 'action', label: 'Word on the check-in result', hint: 'Serve, Check in, Redeem…' },
  { key: 'use', label: 'What one use is called (one)', hint: 'meal, visit, wash…' }, { key: 'uses', label: 'One use is called (many)', hint: 'meals' },
];
function NamesTab({ b, onChange }: { b: Business; onChange: () => void }) {
  const saved = b.programText ?? {};
  const init = () => ({ ...Object.fromEntries(NAME_FIELDS.map((x) => [x.key, String((saved as any)[x.key] ?? '')])), idLabel: String(saved.idLabel ?? ''), askId: saved.askId !== false, allowOverride: saved.allowOverride !== false });
  const [f, setF] = useState<Record<string, any>>(init); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [ok, setOk] = useState('');
  const w = wordsOf({ ...f, askId: f.askId, allowOverride: f.allowOverride } as any, getStudioLang() === 'rw' ? RW_WORDS : undefined);
  const save = async () => { setBusy(true); setErr(''); setOk(''); try { await ownerApi.programText(b.id, f); setOk(tx('Saved')); onChange(); } catch (e) { setErr(msg(e)); } finally { setBusy(false); } };
  const t = (s: string) => fill(tx(s), w);
  return (
    <form className={`${card} space-y-4`} onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <Title>{tx("Your words")}</Title>
      <p className="text-sm text-[var(--app-muted)]">{tx("Every business calls these things something different. Choose the words your customers and staff will see. Leave a box empty to use the plain word.")}</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label={tx("Start from an example")}>{PRESETS.map((p) => <button key={p.label} type="button" className={`${btnGhost} !min-h-9 !px-3 text-xs`} onClick={() => setF({ ...f, ...p.text, askId: p.text.idLabel !== '' })}>{tx(p.label)}</button>)}</div>
      <div className="grid gap-3 sm:grid-cols-2">{NAME_FIELDS.map((x) => (
        <label key={x.key} className="block text-sm font-medium">{tx(x.label)}<input className={`${input} mt-1`} value={f[x.key] ?? ''} maxLength={24} onChange={(e) => setF({ ...f, [x.key]: e.target.value })} placeholder={x.hint} /></label>))}</div>
      <div className="space-y-2">
        <label className="flex items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5 accent-[var(--brand)]" checked={f.askId} onChange={(e) => setF({ ...f, askId: e.target.checked })} />{tx("Ask for an ID when someone joins")}</label>
        {f.askId && <label className="block text-sm font-medium">{tx("What the ID is called")}<input className={`${input} mt-1 !w-72`} value={f.idLabel} maxLength={30} onChange={(e) => setF({ ...f, idLabel: e.target.value })} placeholder="ID number, Student ID…" /></label>}
        <label className="flex items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5 accent-[var(--brand)]" checked={f.allowOverride} onChange={(e) => setF({ ...f, allowOverride: e.target.checked })} />{tx("Staff may allow a use outside the set times")}</label>
      </div>
      <div className="rounded-2xl bg-[var(--app-bg)] p-4 text-sm" aria-live="polite">
        <p className="mb-1 text-xs font-medium text-[var(--app-muted)]">{tx("How it will read")}</p>
        <p><b>{fill('{Programs}', w)}</b> · {fill('{Pass}', w)}: <span className="font-mono">K7QM-X3P9</span></p>
        <p>{fill('{Member}', w)}: Alice · 24 {w.uses} {tx('left')}</p>
        <p>{fill('{Pass}', w)} → <b>{w.action}: Lunch</b></p>
        <p className="text-[var(--app-muted)]">{t("Join this {program}")} · {t("My {pass}")}</p>
      </div>
      {err && <p role="alert" className="text-sm text-rose-600"><AlertTriangle size={14} className="mr-1 inline" />{err}</p>}
      <div className="flex items-center gap-3"><button type="submit" disabled={busy} className={btnPrimary}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}{tx("Save")}</button>{ok && <span role="status" className="text-sm text-emerald-700">{ok}</span>}</div>
    </form>
  );
}
