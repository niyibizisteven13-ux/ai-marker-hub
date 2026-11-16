import { useCallback, useEffect, useRef, useState } from 'react';
import { authFetch } from '../utils/authFetch';

/**
 * MySEB is a paid service. Shown when a lecturer asks for a code and has no plan or test credit: the two prices, how to pay (MTN Mobile Money
 * code, then the screenshot on WhatsApp), and "I have paid", which tells the administrator. It checks every 15 seconds and carries on by itself
 * (gets the code) as soon as the administrator has enabled the account.
 */
export interface Payment { monthUsd: number; monthRwf: number; testRwf: number; momoCode: string; momoName: string; whatsapp: string | null; whatsappLink: string | null }
interface Mine { status: { hasAccess: boolean; monthUntil: string | null; tests: number }; payment: Payment; pendingRequest: { plan: 'MONTH' | 'TEST'; createdAt: string } | null }
const rwf = (n: number) => `${Math.round(n).toLocaleString('en-US')} RWF`;
const api = async (path: string, init?: RequestInit) => {
  const r = await authFetch(path, { ...init, headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...(init?.headers ?? {}) } });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(b.error || 'Something went wrong.');
  return b;
};

export default function MySebPayPanel({ payment, onAccess, onClose }: { payment: Payment; onAccess: () => void; onClose: () => void }) {
  const [mine, setMine] = useState<Mine | null>(null);
  const [plan, setPlan] = useState<'MONTH' | 'TEST'>('MONTH');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [copied, setCopied] = useState(false);
  const done = useRef(false);
  const check = useCallback(async () => {
    try { const d: Mine = (await api('/api/myseb-access')).data; setMine(d); if (d.status.hasAccess && !done.current) { done.current = true; onAccess(); } } catch { /* try again at the next check */ }
  }, [onAccess]);
  useEffect(() => { void check(); const t = window.setInterval(check, 15_000); return () => window.clearInterval(t); }, [check]);
  const p = mine?.payment ?? payment;
  const waiting = mine?.pendingRequest;
  const paid = async () => {
    setBusy(true); setErr('');
    try { await api('/api/myseb-access/request', { method: 'POST', body: JSON.stringify({ plan, note }) }); await check(); } catch (e) { setErr(e instanceof Error ? e.message : 'Could not send.'); } finally { setBusy(false); }
  };
  const copy = () => { void navigator.clipboard?.writeText(p.momoCode).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 2000); }).catch(() => undefined); };
  const btn = 'min-h-11 rounded-xl px-4 text-sm font-bold';
  return (
    <div role="dialog" aria-label="MySEB payment" className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-3 sm:items-center" onClick={onClose}>
      <div className="max-h-[92dvh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl border border-white/10 bg-slate-900 p-5 text-slate-100 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div><h2 className="text-lg font-bold">MySEB is a paid service</h2><p className="text-sm text-slate-400">Pick a plan, pay with Mobile Money, and you get your code within a few minutes.</p></div>
          <button type="button" onClick={onClose} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold hover:bg-white/10">Close</button>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {([['MONTH', `US$${p.monthUsd} a month`, `about ${rwf(p.monthRwf)}`, 'Unlimited tests for 30 days'], ['TEST', rwf(p.testRwf), 'one test', 'One live room (all its codes)']] as const).map(([id, price, sub, what]) => (
            <label key={id} className={`cursor-pointer rounded-xl border p-3 ${plan === id ? 'border-sky-400 bg-sky-500/10' : 'border-white/10 bg-white/5'}`}>
              <input type="radio" name="plan" className="sr-only" checked={plan === id} onChange={() => setPlan(id)} />
              <p className="text-base font-bold">{price}</p><p className="text-xs text-slate-400">{sub}</p><p className="mt-1 text-xs text-slate-300">{what}</p>
            </label>
          ))}
        </div>

        <ol className="space-y-3 text-sm">
          <li className="rounded-xl bg-white/5 p-3">
            <p className="font-semibold">1. Pay with MTN Mobile Money</p>
            <p className="mt-1 text-slate-300">Pay <b>{plan === 'MONTH' ? rwf(p.monthRwf) : rwf(p.testRwf)}</b> to the code <b className="text-lg tracking-wider text-white">{p.momoCode}</b>, name <b>{p.momoName}</b>.</p>
            <button type="button" onClick={copy} className="mt-2 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold hover:bg-white/10">{copied ? 'Copied' : 'Copy the code'}</button>
          </li>
          <li className="rounded-xl bg-white/5 p-3">
            <p className="font-semibold">2. Send the payment screenshot on WhatsApp</p>
            {p.whatsappLink
              ? <a href={p.whatsappLink} target="_blank" rel="noreferrer" className={`${btn} mt-2 inline-flex items-center bg-emerald-500 text-white hover:bg-emerald-400`}>Open WhatsApp (+{p.whatsapp})</a>
              : <p className="mt-1 text-amber-300">The WhatsApp number is not set yet. Ask your administrator for it.</p>}
            <p className="mt-1 text-xs text-slate-400">Include the email you use on Bwenge.</p>
          </li>
          <li className="rounded-xl bg-white/5 p-3">
            <p className="font-semibold">3. Tell us you have paid</p>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Optional: the time or the MoMo message" aria-label="Note" className="mt-2 w-full rounded-lg border border-white/15 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-sky-400" />
            {waiting
              ? <p role="status" className="mt-2 rounded-lg bg-sky-500/10 p-2 text-sm text-sky-200">We have your request ({waiting.plan === 'MONTH' ? 'monthly' : 'one test'}). We are checking the payment: this usually takes a few minutes. This page continues by itself.</p>
              : <button type="button" disabled={busy} onClick={() => void paid()} className={`${btn} mt-2 bg-white text-slate-900 hover:bg-slate-200 disabled:opacity-50`}>I have paid</button>}
            {err && <p role="alert" className="mt-2 text-sm text-rose-300">{err}</p>}
          </li>
        </ol>
        <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
          <span>{mine?.status.monthUntil ? `Monthly plan until ${new Date(mine.status.monthUntil).toLocaleDateString()}` : mine ? `${mine.status.tests} test credit(s)` : ''}</span>
          <button type="button" onClick={() => void check()} className="underline">Check again</button>
        </div>
      </div>
    </div>
  );
}
