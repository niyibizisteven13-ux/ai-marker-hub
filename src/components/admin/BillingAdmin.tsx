import { useCallback, useEffect, useState } from 'react';
import { Banknote, BellRing, CheckCircle2, Coins, Loader2, Pause, Play, PlugZap, ShieldAlert, ShieldCheck, XCircle, Plus, RefreshCw, Save, Search, Sparkles, Trash2, TrendingUp, Users } from 'lucide-react';
import { authFetch } from '../../utils/authFetch';

/**
 * Admin → Upgrades & Subscriptions: revenue vs AI cost, prices / exchange rate / GO packs / plan limits,
 * Mobile Money payments (re-check with MTN), and per-user plans and GO credits. All changes are logged server-side.
 */

type PlanId = 'FREE' | 'GO' | 'STARTER' | 'PRO' | 'PLUS' | 'INSTITUTION';
type SoldPlan = 'STARTER' | 'PRO' | 'PLUS';
interface Limits { daily: number; weekly: number; monthly: number; perDay: { tool: number; vision: number; artifact: number; marking: number }; maxMessageChars: number; maxAttachments: number; maxUploadMb: number; storageMb: number; memory: boolean; memoryItems: number }
interface Overview {
  revenue: { rwf: number; usd: number; payments: number }; aiCost: { usd: number; rwf: number; credits: number }; margin: { usd: number; percent: number | null };
  pendingPayments: number; subscriptions: Record<SoldPlan | 'INSTITUTION', number>; goCredits: { sold: number; used: number };
  momo: { mode: 'live' | 'sandbox' | 'simulated' | 'off'; targetEnv: string; currency: string; callback: boolean };
}
interface Effective { fxUsdRwf: number; goPacks: Array<{ id: string; rwf: number; credits: number }>; plans: Record<PlanId, { name: string; sold: boolean; priceUsd: number | null; priceRwf: number | null; limits: Limits }> }
interface AdminPayment { id: string; createdAt: string; paidAt: string | null; purpose: string; months: number; credits: number; amountRwf: number; currency: string; phoneMasked: string; status: string; reason: string | null; receiptNumber: string | null; user: { email?: string; name?: string } }
interface AdminUser { id: string; email: string; name: string; plan: PlanId; subscription: { planType: string; status: string; endDate: string | null } | null; wallet: number; usedToday: number; dailyLimit: number; telegram: boolean }

const card = 'rounded-2xl border border-[#263052] bg-[#0E1426] p-5';
const input = 'w-full rounded-lg border border-[#2A3760] bg-[#0A1020] px-2.5 py-1.5 text-sm text-white outline-none focus:border-[#3FA7E0]';
const btn = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50';
const rwf = (n: number) => `${Math.round(n).toLocaleString('en-US')} RWF`;
const PLAN_IDS: PlanId[] = ['FREE', 'GO', 'STARTER', 'PRO', 'PLUS', 'INSTITUTION'];
const SOLD: SoldPlan[] = ['STARTER', 'PRO', 'PLUS'];

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await authFetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'Request failed.');
  return body as T;
}

export default function BillingAdmin({ notify }: { notify: (msg: string, error?: boolean) => void }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [eff, setEff] = useState<Effective | null>(null);
  const [payments, setPayments] = useState<AdminPayment[]>([]);
  const [status, setStatus] = useState('');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [q, setQ] = useState('');
  const [health, setHealth] = useState<{ ok: boolean; steps: Array<{ step: string; ok: boolean; detail: string }> } | null>(null);
  const [testing, setTesting] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadOverview = useCallback(async () => {
    const [o, s] = await Promise.all([api<Overview & { success: boolean }>('/api/admin/billing/overview'), api<{ effective: Effective }>('/api/admin/billing/settings')]);
    setOverview(o);
    setEff(s.effective);
  }, []);
  const loadPayments = useCallback(async () => setPayments((await api<{ payments: AdminPayment[] }>(`/api/admin/billing/payments${status ? `?status=${status}` : ''}`)).payments), [status]);
  const loadUsers = useCallback(async () => setUsers((await api<{ users: AdminUser[] }>(`/api/admin/billing/users?q=${encodeURIComponent(q)}`)).users), [q]);

  useEffect(() => { void loadOverview().catch((e) => notify(e.message, true)); }, [loadOverview, notify]);
  useEffect(() => { void loadPayments().catch((e) => notify(e.message, true)); }, [loadPayments, notify]);
  useEffect(() => { const t = window.setTimeout(() => void loadUsers().catch((e) => notify(e.message, true)), 250); return () => window.clearTimeout(t); }, [loadUsers, notify]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); notify(ok); await Promise.all([loadOverview(), loadPayments(), loadUsers()]); } catch (e) { notify((e as Error).message, true); } finally { setBusy(false); }
  };

  const saveSettings = () => eff && run(() => api('/api/admin/billing/settings', {
    method: 'PUT',
    body: JSON.stringify({
      schema: 2,
      fxUsdRwf: eff.fxUsdRwf,
      prices: Object.fromEntries(SOLD.map((id) => [id, { priceRwf: eff.plans[id].priceRwf ?? 0 }])),
      goPacks: eff.goPacks,
      limits: Object.fromEntries(PLAN_IDS.map((id) => [id, eff.plans[id].limits])),
    }),
  }), 'Prices and limits saved. They apply immediately.');

  const setPlanField = (id: PlanId, patch: Partial<Effective['plans'][PlanId]>) => setEff((e) => (e ? { ...e, plans: { ...e.plans, [id]: { ...e.plans[id], ...patch } } } : e));
  const setLimit = (id: PlanId, key: keyof Limits | `perDay.${keyof Limits['perDay']}`, value: number | boolean) => setEff((e) => {
    if (!e) return e;
    const l = { ...e.plans[id].limits, perDay: { ...e.plans[id].limits.perDay } };
    if (String(key).startsWith('perDay.')) (l.perDay as any)[String(key).slice(7)] = value; else (l as any)[key] = value;
    return { ...e, plans: { ...e.plans, [id]: { ...e.plans[id], limits: l } } };
  });

  const momoTone = overview?.momo.mode === 'live' ? 'bg-emerald-500/15 text-emerald-300' : overview?.momo.mode === 'off' ? 'bg-rose-500/15 text-rose-300' : 'bg-amber-500/15 text-amber-300';

  return (
    <div className="space-y-6">
      <AiGuardPanel notify={notify} />
      <SalesPanel notify={notify} />

      {/* Overview */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={<Banknote size={16} />} label="Revenue this month" value={overview ? rwf(overview.revenue.rwf) : '…'} detail={overview ? `≈ $${overview.revenue.usd} · ${overview.revenue.payments} payments` : ''} />
        <Kpi icon={<TrendingUp size={16} />} label="AI cost this month" value={overview ? `$${overview.aiCost.usd}` : '…'} detail={overview ? `${overview.aiCost.credits.toLocaleString('en-US')} credits used · margin ${overview.margin.percent ?? '—'}${overview.margin.percent != null ? '%' : ''}` : ''} />
        <Kpi icon={<Sparkles size={16} />} label="Active plans" value={overview ? SOLD.map((id) => `${overview.subscriptions[id] ?? 0} ${id === 'PRO' ? 'Pro' : id === 'PLUS' ? 'Plus' : 'Starter'}`).join(' · ') : '…'} detail={overview ? `${overview.subscriptions.INSTITUTION ? `${overview.subscriptions.INSTITUTION} Institution · ` : ''}${overview.pendingPayments} payments pending` : ''} />
        <Kpi icon={<Coins size={16} />} label="GO credits" value={overview ? `${overview.goCredits.sold.toLocaleString('en-US')} sold` : '…'} detail={overview ? `${overview.goCredits.used.toLocaleString('en-US')} used this month` : ''} />
      </div>

      {overview && (
        <div className={`${card} flex flex-wrap items-center justify-between gap-3`}>
          <div className="text-sm text-[#C9D3F0]">
            MTN Mobile Money: <span className={`ml-1 rounded-md px-2 py-0.5 text-xs font-bold uppercase ${momoTone}`}>{overview.momo.mode}</span>
            <span className="ml-2 text-xs text-[#8A97C2]">target {overview.momo.targetEnv} · currency {overview.momo.currency} · callbacks {overview.momo.callback ? 'on (HTTPS)' : 'off (polling only)'}</span>
            {overview.momo.mode === 'off' && <p className="mt-1 text-xs text-[#8A97C2]">Add MOMO_COLLECTION_PRIMARY_KEY, MOMO_API_USER, MOMO_API_KEY and MOMO_TARGET_ENV to the server environment to accept payments.</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <button className={`${btn} bg-[#1A2240] text-[#C9D3F0] hover:bg-[#222C50]`} disabled={testing} onClick={async () => {
              setTesting(true);
              try { setHealth(await api('/api/admin/billing/momo/test', { method: 'POST' })); } catch (e) { notify(e instanceof Error ? e.message : 'Test failed', true); } finally { setTesting(false); }
            }}>{testing ? <Loader2 size={13} className="animate-spin" /> : <PlugZap size={13} />} Test MTN connection</button>
            <button className={`${btn} bg-[#1A2240] text-[#C9D3F0] hover:bg-[#222C50]`} disabled={busy} onClick={() => run(() => api('/api/admin/billing/renewals/run', { method: 'POST' }), 'Renewal reminders checked')}><BellRing size={13} /> Send due renewal reminders</button>
          </div>
          {health && (
            <ul className="w-full space-y-1.5 border-t border-[#263052] pt-3 text-xs">
              {health.steps.map((st) => (
                <li key={st.step} className="flex items-start gap-2">
                  {st.ok ? <CheckCircle2 size={14} className="mt-px shrink-0 text-emerald-400" /> : <XCircle size={14} className="mt-px shrink-0 text-rose-400" />}
                  <span><b className="text-[#E4E9F7]">{st.step}:</b> <span className="text-[#8A97C2]">{st.detail}</span></span>
                </li>
              ))}
              <li className={`pt-1 font-semibold ${health.ok ? 'text-emerald-300' : 'text-rose-300'}`}>{health.ok ? 'Payments are ready to accept.' : 'Payments are not ready yet.'}</li>
            </ul>
          )}
        </div>
      )}

      {/* Prices and limits */}
      {eff && (
        <div className={`${card} space-y-5`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><h3 className="text-base font-semibold text-white">Prices, exchange rate and limits</h3><p className="text-xs text-[#8A97C2]">Changes apply to new payments and to everyone's limits immediately.</p></div>
            <button className={`${btn} bg-[#3FA7E0] text-white hover:bg-[#3596CB]`} disabled={busy} onClick={() => void saveSettings()}><Save size={13} /> Save changes</button>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Num label="1 USD in RWF" value={eff.fxUsdRwf} onChange={(v) => setEff({ ...eff, fxUsdRwf: v })} />
            {SOLD.map((id) => (
              <Num key={id} label={`${eff.plans[id].name} (RWF / month)`} step={100} value={eff.plans[id].priceRwf ?? 0} onChange={(v) => setPlanField(id, { priceRwf: v })} hint={`≈ $${((eff.plans[id].priceRwf ?? 0) / eff.fxUsdRwf).toFixed(2)}`} />
            ))}
          </div>

          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#8A97C2]">GO credit packs</h4>
            <div className="space-y-2">
              {eff.goPacks.map((p, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2 sm:max-w-md">
                  <Num label={i ? '' : 'Price (RWF)'} value={p.rwf} onChange={(v) => setEff({ ...eff, goPacks: eff.goPacks.map((x, j) => (j === i ? { ...x, rwf: v, id: `go-${v}` } : x)) })} />
                  <Num label={i ? '' : 'Credits'} value={p.credits} onChange={(v) => setEff({ ...eff, goPacks: eff.goPacks.map((x, j) => (j === i ? { ...x, credits: v } : x)) })} />
                  <button aria-label="Remove pack" className={`${btn} mb-0.5 text-[#8A97C2] hover:text-rose-300`} disabled={eff.goPacks.length <= 1} onClick={() => setEff({ ...eff, goPacks: eff.goPacks.filter((_, j) => j !== i) })}><Trash2 size={14} /></button>
                </div>
              ))}
              {eff.goPacks.length < 8 && <button className={`${btn} bg-[#1A2240] text-[#C9D3F0]`} onClick={() => setEff({ ...eff, goPacks: [...eff.goPacks, { id: `go-${Date.now() % 100000}`, rwf: 10_000, credits: 4_350 }] })}><Plus size={13} /> Add pack</button>}
            </div>
          </div>

          <div className="overflow-x-auto">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#8A97C2]">Limits per plan</h4>
            <table className="w-full min-w-[760px] text-xs">
              <thead><tr className="text-left text-[#8A97C2]">{['Plan', 'Credits / day', '/ week', '/ month', 'Tool answers / day', 'Scans / day', 'Files / day', 'Marking / day', 'Storage (MB)', 'Memory'].map((h) => <th key={h} className="px-1.5 py-1 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {PLAN_IDS.map((id) => {
                  const l = eff.plans[id].limits;
                  return (
                    <tr key={id} className="border-t border-[#1E2848]">
                      <td className="px-1.5 py-1.5 font-semibold text-white">{eff.plans[id].name}{eff.plans[id].sold ? '' : <span className="block text-[10px] font-normal text-[#8A97C2]">not sold online</span>}</td>
                      {(['daily', 'weekly', 'monthly'] as const).map((k) => <td key={k} className="px-1"><input className={input} type="number" min={1} value={l[k]} onChange={(e) => setLimit(id, k, Number(e.target.value))} /></td>)}
                      {(['tool', 'vision', 'artifact', 'marking'] as const).map((k) => <td key={k} className="px-1"><input className={input} type="number" min={0} value={l.perDay[k]} onChange={(e) => setLimit(id, `perDay.${k}`, Number(e.target.value))} /></td>)}
                      <td className="px-1"><input className={input} type="number" min={10} step={512} value={l.storageMb ?? 0} onChange={(e) => setLimit(id, 'storageMb', Number(e.target.value))} aria-label={`${id} storage in MB`} /></td>
                      <td className="px-1.5 text-center"><input type="checkbox" checked={l.memory} onChange={(e) => setLimit(id, 'memory', e.target.checked)} aria-label={`${id} memory`} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Users */}
      <div className={`${card} space-y-3`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-base font-semibold text-white"><Users size={16} /> Users, plans and GO credits</h3>
          <label className="flex items-center gap-2 rounded-lg border border-[#2A3760] bg-[#0A1020] px-2.5 text-[#8A97C2]"><Search size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email" className="bg-transparent py-1.5 text-sm text-white outline-none" /></label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-xs">
            <thead><tr className="text-left text-[#8A97C2]">{['User', 'Plan', 'Until', 'GO credits', 'Today', 'Telegram', 'Actions'].map((h) => <th key={h} className="px-2 py-1.5 font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-[#1E2848] text-[#C9D3F0]">
                  <td className="px-2 py-2"><div className="font-medium text-white">{u.name}</div><div className="text-[#8A97C2]">{u.email}</div></td>
                  <td className="px-2"><span className="rounded-md bg-[#1A2240] px-1.5 py-0.5 font-bold">{u.plan}</span></td>
                  <td className="px-2">{u.subscription?.endDate && u.subscription.status === 'ACTIVE' ? new Date(u.subscription.endDate).toLocaleDateString() : '—'}</td>
                  <td className="px-2 tabular-nums">{u.wallet.toLocaleString('en-US')}</td>
                  <td className="px-2 tabular-nums">{u.usedToday} / {u.dailyLimit}</td>
                  <td className="px-2">{u.telegram ? 'Linked' : '—'}</td>
                  <td className="px-2">
                    <div className="flex flex-wrap gap-1">
                      {(['STARTER', 'PRO', 'PLUS', 'INSTITUTION'] as const).map((id) => (
                        <button key={id} className={`${btn} ${id === 'INSTITUTION' ? 'bg-indigo-500/15 text-indigo-300' : 'bg-amber-500/15 text-amber-300'}`} disabled={busy} onClick={() => { const d = window.prompt(`Grant ${eff?.plans[id].name ?? id} for how many days?`, '30'); if (d) void run(() => api(`/api/admin/billing/users/${u.id}/plan`, { method: 'POST', body: JSON.stringify({ plan: id, days: Number(d) }) }), `${eff?.plans[id].name ?? id} granted to ${u.email}`); }}>{id === 'INSTITUTION' ? 'Inst.' : id === 'PRO' ? 'Pro' : id === 'PLUS' ? 'Plus' : 'Starter'}</button>
                      ))}
                      <button className={`${btn} bg-[#1A2240] text-[#C9D3F0]`} disabled={busy || u.plan === 'FREE' || u.plan === 'GO'} onClick={() => { if (window.confirm(`Move ${u.email} to Free now?`)) void run(() => api(`/api/admin/billing/users/${u.id}/plan`, { method: 'POST', body: JSON.stringify({ plan: 'FREE' }) }), `${u.email} moved to Free`); }}>Free</button>
                      <button className={`${btn} bg-sky-500/15 text-sky-300`} disabled={busy} onClick={() => {
                        const v = window.prompt('GO credits to add (negative to remove):', '100');
                        if (!v) return;
                        const note = window.prompt('Reason (shown in the ledger):', 'Admin adjustment') ?? '';
                        void run(() => api(`/api/admin/billing/users/${u.id}/credits`, { method: 'POST', body: JSON.stringify({ delta: Number(v), note: note || 'Admin adjustment' }) }), 'Credits updated');
                      }}><Coins size={12} /> Credits</button>
                    </div>
                  </td>
                </tr>
              ))}
              {!users.length && <tr><td colSpan={7} className="px-2 py-6 text-center text-[#8A97C2]">No users match.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Payments */}
      <div className={`${card} space-y-3`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-base font-semibold text-white"><Banknote size={16} /> Mobile Money payments</h3>
          <select className={`${input} w-auto`} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Payment status">
            <option value="">All statuses</option><option value="SUCCESSFUL">Paid</option><option value="PENDING">Pending</option><option value="FAILED">Failed</option><option value="EXPIRED">Not approved</option>
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-xs">
            <thead><tr className="text-left text-[#8A97C2]">{['Date', 'User', 'Item', 'Amount', 'Phone', 'Status', 'Receipt', ''].map((h, i) => <th key={i} className="px-2 py-1.5 font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-t border-[#1E2848] text-[#C9D3F0]">
                  <td className="px-2 py-2">{new Date(p.paidAt ?? p.createdAt).toLocaleString()}</td>
                  <td className="px-2">{p.user?.email ?? '—'}</td>
                  <td className="px-2">{p.purpose === 'GO_PACK' ? `GO · ${p.credits} credits` : `${p.purpose} · ${p.months} mo`}</td>
                  <td className="px-2 tabular-nums">{p.amountRwf.toLocaleString('en-US')} {p.currency}</td>
                  <td className="px-2">{p.phoneMasked}</td>
                  <td className="px-2"><span className={`rounded-md px-1.5 py-0.5 font-semibold ${p.status === 'SUCCESSFUL' ? 'bg-emerald-500/15 text-emerald-300' : p.status === 'PENDING' ? 'bg-amber-500/15 text-amber-300' : 'bg-rose-500/15 text-rose-300'}`}>{p.status}</span>{p.reason ? <span className="ml-1 text-[#8A97C2]">{p.reason}</span> : null}</td>
                  <td className="px-2">{p.receiptNumber ?? '—'}</td>
                  <td className="px-2">{p.status === 'PENDING' && <button className={`${btn} bg-[#1A2240] text-[#C9D3F0]`} disabled={busy} onClick={() => void run(() => api(`/api/admin/billing/payments/${p.id}/recheck`, { method: 'POST' }), 'Checked with MTN')}><RefreshCw size={12} /> Check</button>}</td>
                </tr>
              ))}
              {!payments.length && <tr><td colSpan={8} className="px-2 py-6 text-center text-[#8A97C2]">No payments yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      {busy && <div className="fixed bottom-6 right-6 rounded-full bg-[#1A2240] p-2 text-white shadow-lg"><Loader2 size={18} className="animate-spin" /></div>}
    </div>
  );
}

function Kpi({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail: string }) {
  return (
    <div className={card}>
      <div className="flex items-center gap-2 text-xs text-[#8A97C2]">{icon} {label}</div>
      <div className="mt-2 text-xl font-semibold text-white">{value}</div>
      <div className="mt-1 text-xs text-[#8A97C2]">{detail}</div>
    </div>
  );
}

function Num({ label, value, onChange, step = 1, hint }: { label: string; value: number; onChange: (v: number) => void; step?: number; hint?: string }) {
  return (
    <label className="block text-[11px] font-medium text-[#8A97C2]">
      {label}
      <input className={`${input} mt-1`} type="number" step={step} value={Number.isFinite(value) ? value : 0} onChange={(e) => onChange(Number(e.target.value))} />
      {hint && <span className="mt-0.5 block text-[10px] text-[#6C789E]">{hint}</span>}
    </label>
  );
}

// ── AI generation: pause switch and profit guard ─────────────────────────────
interface GuardGroup { users: number; costUsd: number; credits: number; actions: number }
interface Guard {
  settings: { paused: boolean; pausedReason?: string | null; pausedAt?: string | null; lossGuard: { enabled: boolean; freeBudgetUsd: number; mode: 'free_only' | 'all' } };
  economics: {
    revenueUsd: number; costUsd: number; marginUsd: number; free: GuardGroup; paying: GuardGroup & { revenueUsd: number };
    byChannel: Array<GuardGroup & { channel: string }>; topUsers: Array<{ user: string; paying: boolean; costUsd: number; credits: number; actions: number }>;
    costPerFreeUser: number | null; costPerPayingUser: number | null; revenuePerPayingUser: number | null; conversionPercent: number | null;
  };
  block: 'none' | 'free' | 'all'; reason: string | null;
}
const usd = (n: number | null | undefined) => (n == null ? '—' : `$${n < 1 && n > 0 ? n.toFixed(4) : n.toFixed(2)}`);

function AiGuardPanel({ notify }: { notify: (msg: string, error?: boolean) => void }) {
  const [g, setG] = useState<Guard | null>(null);
  const [busy, setBusy] = useState(false);
  const [budget, setBudget] = useState('');
  const load = useCallback(async () => {
    const r = await api<Guard>('/api/admin/billing/ai-guard');
    setG(r); setBudget(String(r.settings.lossGuard.freeBudgetUsd));
  }, []);
  useEffect(() => { void load().catch((e) => notify(e.message, true)); const t = window.setInterval(() => void load().catch(() => undefined), 60_000); return () => window.clearInterval(t); }, [load, notify]);
  const save = async (body: object, ok: string) => {
    setBusy(true);
    try { const r = await api<Guard>('/api/admin/billing/ai-guard', { method: 'PUT', body: JSON.stringify(body) }); setG(r); notify(ok); } catch (e) { notify((e as Error).message, true); } finally { setBusy(false); }
  };
  if (!g) return <div className={`${card} text-sm text-[#8A97C2]`}><Loader2 size={14} className="mr-2 inline animate-spin" />Loading AI status…</div>;
  const e = g.economics;
  const paused = g.settings.paused;
  const tone = g.block === 'none' ? 'border-emerald-500/30 bg-emerald-500/[0.06]' : 'border-rose-500/40 bg-rose-500/[0.08]';
  const statusText = paused ? 'Paused by an administrator: no one can generate (admins can still test).'
    : g.block === 'all' ? `Stopped by the profit guard for everyone: ${g.reason}.`
      : g.block === 'free' ? `Free users stopped by the profit guard: ${g.reason}. Paying users continue.`
        : 'Running. Generation is allowed for everyone within their plan.';
  return (
    <section className={`rounded-2xl border p-5 ${tone}`}>
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-2 text-base font-semibold text-white">{g.block === 'none' ? <ShieldCheck size={18} className="text-emerald-400" /> : <ShieldAlert size={18} className="text-rose-400" />} AI generation</h3>
          <p className="mt-1 text-sm text-[#C9D3F0]">{statusText}</p>
        </div>
        <button disabled={busy} onClick={() => save({ paused: !paused }, paused ? 'AI generation resumed.' : 'AI generation paused for everyone.')}
          className={`${btn} px-4 py-2 text-sm ${paused ? 'bg-emerald-500 text-white hover:bg-emerald-400' : 'bg-rose-500 text-white hover:bg-rose-400'}`}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : paused ? <Play size={15} /> : <Pause size={15} />} {paused ? 'Resume AI' : 'Pause AI now'}
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={<Banknote size={16} />} label="Revenue this month" value={usd(e.revenueUsd)} detail={`${e.paying.users} paying users · ${usd(e.revenuePerPayingUser)} each`} />
        <Kpi icon={<TrendingUp size={16} />} label="AI cost this month" value={usd(e.costUsd)} detail={`margin ${e.marginUsd >= 0 ? '+' : ''}${usd(e.marginUsd)}`} />
        <Kpi icon={<Users size={16} />} label="Free users" value={`${e.free.users} · ${usd(e.free.costUsd)}`} detail={`${usd(e.costPerFreeUser)} per user · budget ${usd(g.settings.lossGuard.freeBudgetUsd)}`} />
        <Kpi icon={<Sparkles size={16} />} label="Paying users" value={`${e.paying.users} · ${usd(e.paying.costUsd)}`} detail={`${usd(e.costPerPayingUser)} cost per user · conversion ${e.conversionPercent ?? '—'}${e.conversionPercent != null ? '%' : ''}`} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className={card}>
          <h4 className="text-sm font-semibold text-white">Profit guard</h4>
          <p className="mt-1 text-xs text-[#8A97C2]">Checks this month's AI cost against revenue every minute and stops generation by itself before the platform loses money.</p>
          <label className="mt-3 flex items-center gap-2 text-sm text-[#C9D3F0]">
            <input type="checkbox" checked={g.settings.lossGuard.enabled} disabled={busy} onChange={(ev) => save({ lossGuard: { enabled: ev.target.checked } }, ev.target.checked ? 'Profit guard on.' : 'Profit guard off.')} /> Stop generation automatically when losing money
          </label>
          <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-[#8A97C2]">
            <label>Monthly free budget (USD)
              <div className="mt-1 flex gap-1.5"><input className={input} inputMode="decimal" value={budget} onChange={(ev) => setBudget(ev.target.value)} />
                <button className={`${btn} bg-[#1A2240] text-[#C9D3F0] hover:bg-[#222C50]`} disabled={busy || !(Number(budget) >= 0)} onClick={() => save({ lossGuard: { freeBudgetUsd: Number(budget) } }, 'Free budget saved.')}><Save size={13} /></button></div>
            </label>
            <label>When in loss, stop
              <select className={`${input} mt-1`} value={g.settings.lossGuard.mode} disabled={busy} onChange={(ev) => save({ lossGuard: { mode: ev.target.value } }, 'Saved.')}>
                <option value="free_only">free users only</option>
                <option value="all">everyone except admins</option>
              </select>
            </label>
          </div>
        </div>
        <div className={card}>
          <h4 className="text-sm font-semibold text-white">Usage by platform</h4>
          <table className="mt-2 w-full text-left text-xs text-[#C9D3F0]">
            <thead className="text-[#8A97C2]"><tr><th className="py-1">Platform</th><th>Users</th><th>Actions</th><th>Credits</th><th>Cost</th></tr></thead>
            <tbody>{e.byChannel.map((c) => <tr key={c.channel} className="border-t border-[#263052]"><td className="py-1.5 capitalize">{c.channel}</td><td>{c.users}</td><td>{c.actions}</td><td>{c.credits.toLocaleString('en-US')}</td><td>{usd(c.costUsd)}</td></tr>)}
              {!e.byChannel.length && <tr><td colSpan={5} className="py-2 text-[#8A97C2]">No usage this month yet.</td></tr>}</tbody>
          </table>
          {e.topUsers.length > 0 && <>
            <h4 className="mt-4 text-sm font-semibold text-white">Highest cost users</h4>
            <ul className="mt-1 space-y-1 text-xs text-[#C9D3F0]">{e.topUsers.slice(0, 5).map((u) => <li key={u.user} className="flex justify-between gap-2"><span className="truncate">{u.user} <span className={`ml-1 rounded px-1.5 py-px text-[10px] ${u.paying ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/10 text-[#8A97C2]'}`}>{u.paying ? 'paying' : 'free'}</span></span><span>{u.actions} actions · {usd(u.costUsd)}</span></li>)}</ul>
          </>}
        </div>
      </div>
    </section>
  );
}

/** "Pause upgrades": stops new plan and top-up purchases (web and Telegram) until it is turned off. */
function SalesPanel({ notify }: { notify: (msg: string, error?: boolean) => void }) {
  const [state, setState] = useState<{ paused: boolean; message: string | null; pausedAt: string | null; defaultMessage: string } | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { void api<typeof state & object>('/api/admin/billing/sales').then((s) => { setState(s); setMessage(s.message ?? ''); }).catch((e) => notify(e.message, true)); }, [notify]);
  if (!state) return null;
  const set = async (paused: boolean) => {
    if (paused && !state.paused && !window.confirm('Pause upgrades? Nobody will be able to buy a plan or top up until you resume. Current plans keep working.')) return;
    setBusy(true);
    try {
      const s = await api<NonNullable<typeof state>>('/api/admin/billing/sales', { method: 'PUT', body: JSON.stringify({ paused, message: message.trim() || null }) });
      setState(s);
      notify(paused ? 'Upgrades paused. The Upgrade page shows your message.' : 'Upgrades are open again.');
    } catch (e) { notify((e as Error).message, true); } finally { setBusy(false); }
  };
  return (
    <div className={`${card} space-y-3 ${state.paused ? 'border-amber-500/50' : ''}`}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-2 text-base font-semibold text-white">
            Upgrades
            <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold uppercase ${state.paused ? 'bg-amber-500/20 text-amber-300' : 'bg-emerald-500/15 text-emerald-300'}`}>{state.paused ? 'Paused' : 'Open'}</span>
          </h3>
          <p className="text-xs text-[#8A97C2]">{state.paused
            ? `Nobody can buy a plan or top up${state.pausedAt ? ` since ${new Date(state.pausedAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}. Payments already started still finish; current plans keep working; you can still give plans to users below.`
            : 'People can buy plans and top-ups. Pause to stop new purchases, for example while prices change or payments are checked.'}</p>
        </div>
        {state.paused
          ? <button className={`${btn} bg-emerald-500 text-white hover:bg-emerald-600`} disabled={busy} onClick={() => void set(false)}>{busy ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Resume upgrades</button>
          : <button className={`${btn} bg-amber-500 text-[#1A1200] hover:bg-amber-400`} disabled={busy} onClick={() => void set(true)}>{busy ? <Loader2 size={13} className="animate-spin" /> : <Pause size={13} />} Pause upgrades</button>}
      </div>
      <label className="block text-xs text-[#8A97C2]">Message shown on the Upgrade page while paused
        <input className={`${input} mt-1`} maxLength={300} value={message} placeholder={state.defaultMessage} onChange={(e) => setMessage(e.target.value)} disabled={busy} />
      </label>
      {state.paused && message.trim() !== (state.message ?? '') && <button className={`${btn} bg-[#1A2240] text-[#C9D3F0] hover:bg-[#222C50]`} disabled={busy} onClick={() => void set(true)}><Save size={13} /> Update message</button>}
    </div>
  );
}
