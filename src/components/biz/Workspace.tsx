import { useCallback, useEffect, useMemo, useState } from 'react';
import { Megaphone, ImagePlus, Lock, Camera, Bot, BellRing, ArrowDownRight, ArrowUpRight, Banknote, Check, Copy, Download, EyeOff, Globe, KeyRound, Loader2, Package, Plus, Receipt, Send, Share2, ShieldCheck, Smartphone, Sparkles, Trash2, TrendingUp, Users, Wallet, X, AlertTriangle, ShoppingBag, CircleCheck, Clock, Ban } from 'lucide-react';
import { ownerApi, prepareImage } from '../../biz/api';
import type { Mine } from '../../biz/api';
import { pageUrl, rwf, type AgentSettings, type Business, type Dashboard, type LedgerEntry, type SecretsStatus } from '../../biz/types';
import { btn, btnGhost, btnPrimary, card, input, msg, rwfShort, Tag, Title } from './ui';

type Go = (view: string) => void;
const money = (n: number) => `RWF ${n.toLocaleString('en-US')}`;
const shortDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const hello = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };
const timeOf = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function Change({ v }: { v: number | null }) {
  if (v === null) return <span className="text-xs text-[var(--app-faint)]">no data yesterday</span>;
  const up = v >= 0; return <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${up ? 'text-emerald-700' : 'text-rose-600'}`}>{up ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{Math.abs(v)}% <span className="font-normal text-[var(--app-muted)]">vs yesterday</span></span>;
}
function Kpi({ icon: Icon, label, value, tint, children }: { icon: typeof Wallet; label: string; value: string; tint: string; children?: React.ReactNode }) {
  return (
    <div className={`rounded-2xl border border-[var(--app-line)] p-4 ${tint}`}>
      <div className="flex items-center gap-2.5"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/80 shadow-sm"><Icon size={18} aria-hidden="true" /></span><p className="text-sm font-medium text-[var(--app-muted)]">{label}</p></div>
      <p className="mt-3 font-display text-[19px] font-semibold leading-none tracking-tight sm:text-[26px]">{value}</p><div className="mt-2 min-h-[18px]">{children}</div>
    </div>
  );
}

/** Area chart of sales per day, drawn with SVG (no chart library). Hover or touch shows the day's number. */
function SalesChart({ series }: { series: Dashboard['series'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640, H = 230, L = 46, R = 12, T = 14, B = 26; const max = Math.max(1000, ...series.map((s) => s.sales)); const nice = Math.ceil(max / 1000) * 1000;
  const x = (i: number) => L + (series.length <= 1 ? 0 : (i / (series.length - 1)) * (W - L - R)); const y = (v: number) => T + (1 - v / nice) * (H - T - B);
  const line = series.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(s.sales).toFixed(1)}`).join(' '); const area = `${line} L${x(series.length - 1)},${H - B} L${x(0)},${H - B} Z`;
  const ticks = [0, 0.5, 1].map((f) => f * nice); const h = hover === null ? series.length - 1 : hover;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full touch-none" role="img" aria-label="Sales per day" onMouseLeave={() => setHover(null)}
        onPointerMove={(e) => { const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); const px = ((e.clientX - r.left) / r.width) * W; setHover(Math.max(0, Math.min(series.length - 1, Math.round(((px - L) / (W - L - R)) * (series.length - 1))))); }}>
        <defs><linearGradient id="bz-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--brand)" stopOpacity="0.35" /><stop offset="100%" stopColor="var(--brand)" stopOpacity="0.02" /></linearGradient></defs>
        {ticks.map((t) => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--app-line)" strokeDasharray="3 4" /><text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--app-faint)">{rwfShort(t)}</text></g>)}
        <path d={area} fill="url(#bz-area)" /><path d={line} fill="none" stroke="var(--brand)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {[0, Math.floor((series.length - 1) / 2), series.length - 1].filter((v, i, a) => a.indexOf(v) === i).map((i) => <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === series.length - 1 ? 'end' : 'middle'} fontSize="11" fill="var(--app-faint)">{shortDay(series[i].day)}</text>)}
        {series[h] && <><line x1={x(h)} x2={x(h)} y1={T} y2={H - B} stroke="var(--brand)" strokeOpacity="0.4" /><circle cx={x(h)} cy={y(series[h].sales)} r="5" fill="var(--app-panel)" stroke="var(--brand)" strokeWidth="2.5" /></>}
      </svg>
      {series[h] && <div className="pointer-events-none absolute top-1 whitespace-nowrap rounded-lg bg-[#0E1722] px-2.5 py-1.5 text-xs font-semibold text-white shadow-lg" style={{ left: `${Math.min(78, Math.max(2, (x(h) / W) * 100 - 8))}%` }}>{shortDay(series[h].day)} · {money(series[h].sales)}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ a small sheet for recording things */
export type EntryKind = 'sale' | 'expense' | 'pay';
export function EntrySheet({ b, kind, onClose, onDone, secrets }: { b: Business; kind: EntryKind; onClose: () => void; onDone: () => void; secrets: SecretsStatus | null }) {
  const [f, setF] = useState({ amount: '', item: '', qty: '', customer: '', phone: '', method: 'cash', category: 'stock', productId: '', status: 'completed' }); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const payReady = !!secrets && (secrets.mtn.set || secrets.airtel.set); const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const pick = (id: string) => { const p = b.products.find((x) => x.id === id); setF((x) => ({ ...x, productId: id, item: p?.name ?? x.item, amount: p && p.price && !x.amount ? String(p.price * (Number(x.qty) || 1)) : x.amount })); };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const amount = Number(f.amount.replace(/[,\s]/g, ''));
      if (kind === 'pay') await ownerApi.requestPayment(b.id, { phone: f.phone, amount, item: f.item || undefined, customer: f.customer || undefined });
      else await ownerApi.addEntry(b.id, { type: kind, amount, item: f.item, qty: f.qty ? Number(f.qty) : undefined, customer: f.customer, method: kind === 'sale' ? f.method : undefined, category: kind === 'expense' ? f.category : undefined, productId: f.productId || undefined, status: kind === 'sale' ? f.status : undefined });
      onDone(); onClose();
    } catch (x) { setErr(msg(x)); } finally { setBusy(false); }
  };
  const title = kind === 'sale' ? 'New sale' : kind === 'expense' ? 'Add expense' : 'Request a payment';
  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-[var(--app-panel)] p-5 shadow-2xl sm:rounded-3xl">
        <div className="mb-4 flex items-center justify-between"><h2 className="font-display text-xl font-semibold">{title}</h2><button type="button" aria-label="Close" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-xl hover:bg-[var(--app-panel-hover)]"><X size={18} /></button></div>
        {kind === 'pay' && !payReady ? (
          <div className="rounded-xl bg-amber-500/10 p-4 text-sm"><p className="font-semibold">Online payments are not set up yet.</p><p className="mt-1 text-[var(--app-muted)]">Add your MTN or Airtel keys in Secrets, then you can ask a customer to pay from here.</p></div>
        ) : (<div className="space-y-3.5">
          {kind !== 'expense' && b.products.length > 0 && <label className="block text-sm"><span className="mb-1.5 block text-[var(--app-muted)]">Product (optional)</span><select className={input} value={f.productId} onChange={(e) => pick(e.target.value)}><option value="">Other / not on the page</option>{b.products.map((p) => <option key={p.id} value={p.id}>{p.name}{p.price !== null ? ` · ${p.price.toLocaleString('en-US')}` : ''}</option>)}</select></label>}
          <label className="block text-sm"><span className="mb-1.5 block text-[var(--app-muted)]">{kind === 'expense' ? 'What was it for?' : 'What was sold?'}</span><input className={input} value={f.item} maxLength={80} placeholder={kind === 'expense' ? 'Flour, transport, rent…' : 'Bread, haircut, 2 kg tomatoes…'} onChange={(e) => set('item', e.target.value)} /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm"><span className="mb-1.5 block text-[var(--app-muted)]">Total (RWF)</span><input required className={input} inputMode="numeric" value={f.amount} onChange={(e) => set('amount', e.target.value.replace(/[^\d,\s]/g, ''))} /></label>
            {kind !== 'pay' && <label className="block text-sm"><span className="mb-1.5 block text-[var(--app-muted)]">Quantity</span><input className={input} inputMode="decimal" value={f.qty} onChange={(e) => set('qty', e.target.value.replace(/[^\d.]/g, ''))} /></label>}
            {kind === 'pay' && <label className="block text-sm"><span className="mb-1.5 block text-[var(--app-muted)]">Customer phone</span><input required className={input} inputMode="tel" placeholder="0788 123 456" value={f.phone} onChange={(e) => set('phone', e.target.value)} /></label>}
          </div>
          {kind !== 'expense' && <label className="block text-sm"><span className="mb-1.5 block text-[var(--app-muted)]">Customer name (optional)</span><input className={input} value={f.customer} maxLength={60} onChange={(e) => set('customer', e.target.value)} /></label>}
          {kind === 'sale' && <div className="grid grid-cols-2 gap-3"><label className="block text-sm"><span className="mb-1.5 block text-[var(--app-muted)]">Paid with</span><select className={input} value={f.method} onChange={(e) => set('method', e.target.value)}><option value="cash">Cash</option><option value="momo">Mobile money</option><option value="card">Card</option><option value="credit">On credit</option></select></label>
            <label className="block text-sm"><span className="mb-1.5 block text-[var(--app-muted)]">Status</span><select className={input} value={f.status} onChange={(e) => set('status', e.target.value)}><option value="completed">Completed</option><option value="pending">Pending</option></select></label></div>}
          {kind === 'expense' && <label className="block text-sm"><span className="mb-1.5 block text-[var(--app-muted)]">Category</span><select className={input} value={f.category} onChange={(e) => set('category', e.target.value)}>{['stock', 'rent', 'transport', 'salaries', 'utilities', 'marketing', 'other'].map((c) => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}</select></label>}
          {kind === 'pay' && <p className="rounded-xl bg-[var(--app-bg)] p-3 text-xs text-[var(--app-muted)]">The customer gets a prompt on their phone and approves with their PIN. Money goes straight to your own MTN or Airtel account.</p>}
          {err && <p role="alert" className="text-sm text-rose-600">{err}</p>}
          <button type="submit" disabled={busy || !f.amount} className={`${btnPrimary} w-full`}>{busy ? <Loader2 size={16} className="animate-spin" /> : kind === 'pay' ? <Send size={16} /> : <Check size={16} />}{kind === 'pay' ? 'Send payment request' : 'Save'}</button>
        </div>)}
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------ dashboard */
export function DashboardView({ b, go, onChange, secrets, open }: { b: Business; go: Go; onChange: () => void; secrets: SecretsStatus | null; open: (k: EntryKind) => void }) {
  const [days, setDays] = useState<7 | 30 | 90>(7); const [d, setD] = useState<Dashboard | null>(null); const [err, setErr] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const [qr, setQr] = useState('');
  const url = pageUrl(b.slug);
  const load = useCallback(() => { ownerApi.dashboard(b.id, days).then(setD).catch((e) => setErr(msg(e))); }, [b.id, days]);
  useEffect(() => { load(); }, [load, b.updatedAt]);
  useEffect(() => { let alive = true; void import('qrcode').then((m: any) => (m.default ?? m).toDataURL(url, { margin: 1, width: 400, color: { dark: '#0E1722', light: '#FFFFFF' } })).then((x: string) => { if (alive) setQr(x); }).catch(() => undefined); return () => { alive = false; }; }, [url]);
  const toggle = async () => { setBusy(true); setNote(''); try { await ownerApi.publish(b.id, !b.published); onChange(); } catch (e) { setNote(msg(e)); } finally { setBusy(false); } };
  const copy = async () => { try { await navigator.clipboard.writeText(url); setNote('Link copied'); } catch { setNote('Copy the link by hand'); } };
  const maxTop = Math.max(1, ...(d?.top.map((t) => t.amount) ?? [1]));
  const quick: Array<[string, typeof Plus, () => void]> = [['New sale', ShoppingBag, () => open('sale')], ['Add expense', Receipt, () => open('expense')], ['Request payment', Smartphone, () => open('pay')], ['Add product', Package, () => go('products')], ['Share link', Share2, () => void copy()]];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0"><h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">{hello()} 👋</h1><p className="mt-1 text-[15px] text-[var(--app-muted)]">Here is how <b className="text-[var(--app-text)]">{b.name}</b> is doing today.</p></div>
        <span className="inline-flex items-center gap-2 rounded-xl border border-[var(--app-line)] bg-[var(--app-panel)] px-3.5 py-2 text-sm font-medium">{new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>
      </div>
      {err && <p role="alert" className="rounded-xl bg-rose-500/10 px-4 py-2.5 text-sm text-rose-600">{err}</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={Wallet} label="Total sales" value={d ? money(d.today.sales) : '…'} tint="bg-gradient-to-br from-emerald-50 to-white"><Change v={d?.change.sales ?? null} /></Kpi>
        <Kpi icon={ShoppingBag} label="Orders" value={d ? String(d.today.orders) : '…'} tint="bg-gradient-to-br from-sky-50 to-white"><Change v={d?.change.orders ?? null} /></Kpi>
        <Kpi icon={Users} label="Customers (30 days)" value={d ? String(d.customers) : '…'} tint="bg-gradient-to-br from-violet-50 to-white"><span className="text-xs text-[var(--app-muted)]">named in your sales</span></Kpi>
        <Kpi icon={TrendingUp} label="Profit (est.)" value={d ? money(d.today.profit) : '…'} tint="bg-gradient-to-br from-amber-50 to-white"><Change v={d?.change.profit ?? null} /></Kpi>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.7fr_1fr]">
        <div className={card}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="font-display text-lg font-semibold">Sales overview</h2>
            <div className="inline-flex rounded-xl bg-[var(--app-bg)] p-1" role="tablist" aria-label="Period">{([7, 30, 90] as const).map((n) => <button key={n} type="button" role="tab" aria-selected={days === n} onClick={() => setDays(n)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${days === n ? 'bg-[var(--brand)] text-[var(--brand-on)]' : 'text-[var(--app-muted)]'}`}>{n === 7 ? '7 days' : n === 30 ? '30 days' : '90 days'}</button>)}</div></div>
          {d ? <><SalesChart series={d.series} /><div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm"><div><p className="text-xs text-[var(--app-muted)]">Sales</p><b>{money(d.range.sales)}</b></div><div><p className="text-xs text-[var(--app-muted)]">Expenses</p><b>{money(d.range.expenses)}</b></div><div><p className="text-xs text-[var(--app-muted)]">Profit</p><b className={d.range.profit < 0 ? 'text-rose-600' : ''}>{money(d.range.profit)}</b></div></div></> : <div className="h-56 animate-pulse rounded-xl bg-[var(--app-bg)]" />}
        </div>
        <div className={card}>
          <div className="mb-3 flex items-center justify-between"><h2 className="font-display text-lg font-semibold">Top products</h2><button type="button" onClick={() => go('sales')} className="text-sm font-semibold text-[var(--brand-strong,var(--brand))]">View all</button></div>
          {!d?.top.length ? <p className="text-sm text-[var(--app-muted)]">Record a few sales and your best sellers show up here.</p> : <ul className="space-y-3.5">{d.top.map((t) => <li key={t.name}><div className="flex items-baseline justify-between gap-2 text-sm"><span className="min-w-0 truncate font-medium">{t.name}</span><b className="shrink-0">{money(t.amount)}</b></div><div className="mt-1 flex items-center gap-2"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--app-bg)]"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${(t.amount / maxTop) * 100}%` }} /></div><span className="text-xs text-[var(--app-muted)]">{t.qty} sold</span></div></li>)}</ul>}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className={card}><h2 className="mb-3 font-display text-lg font-semibold">Quick actions</h2>
          <div className="grid grid-cols-3 gap-2.5">{quick.map(([l, Icon, fn]) => <button key={l} type="button" onClick={fn} className="flex flex-col items-center gap-2 rounded-2xl border border-[var(--app-line)] bg-[var(--app-bg)] px-2 py-3.5 text-center text-xs font-semibold hover:bg-[var(--app-panel-hover)]"><Icon size={20} className="text-[var(--brand-strong,var(--brand))]" aria-hidden="true" />{l}</button>)}</div></div>
        <div className={card}><div className="mb-3 flex items-center justify-between"><h2 className="font-display text-lg font-semibold">Orders today</h2><button type="button" onClick={() => go('sales')} className="text-sm font-semibold text-[var(--brand-strong,var(--brand))]">View all</button></div>
          {([['Completed', d?.orders.completed, CircleCheck, 'bg-emerald-50 text-emerald-700'], ['Pending', d?.orders.pending, Clock, 'bg-amber-50 text-amber-700'], ['Cancelled', d?.orders.cancelled, Ban, 'bg-rose-50 text-rose-700']] as const).map(([l, n, Icon, tint]) => <div key={l} className={`mb-2 flex items-center justify-between rounded-xl px-3.5 py-2.5 text-sm font-medium last:mb-0 ${tint}`}><span className="inline-flex items-center gap-2"><Icon size={16} />{l}</span><b>{n ?? '…'}</b></div>)}</div>
        <div className={card}><div className="mb-3 flex items-center justify-between"><h2 className="font-display text-lg font-semibold">Low stock alert</h2><button type="button" onClick={() => go('products')} className="text-sm font-semibold text-[var(--brand-strong,var(--brand))]">Manage</button></div>
          {!d?.lowStock.length ? <p className="text-sm text-[var(--app-muted)]">{b.products.some((p) => typeof p.stock === 'number') ? 'Nothing is running low.' : 'Add stock counts to your products to get alerts here.'}</p> : <ul className="space-y-2">{d.lowStock.map((l) => <li key={l.id} className="flex items-center justify-between rounded-xl bg-rose-50 px-3.5 py-2.5 text-sm"><span className="inline-flex items-center gap-2 font-medium"><AlertTriangle size={15} className="text-rose-600" />{l.name}</span><span className="font-semibold text-rose-700">only {l.stock}{l.unit ? ` ${l.unit}` : ''} left</span></li>)}</ul>}</div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <div className={card}><div className="mb-3 flex items-center justify-between"><h2 className="font-display text-lg font-semibold">Recent activity</h2><button type="button" onClick={() => go('sales')} className="text-sm font-semibold text-[var(--brand-strong,var(--brand))]">Open notebook</button></div>
          {!d?.recent.length ? <p className="text-sm text-[var(--app-muted)]">Nothing yet. Press New sale, or tell the Bwenge assistant: “today I sold 5 loaves for 4,000”.</p> : <ul className="divide-y divide-[var(--app-line)]">{d.recent.slice(0, 6).map((e) => <EntryRow key={e.id} e={e} />)}</ul>}</div>
        <div className={card}>
          <Title kind="public">Your public page</Title>
          <div className="flex items-center gap-4"><div className="shrink-0">{qr ? <img src={qr} alt={`QR code for ${url}`} className="h-24 w-24 rounded-xl border border-[var(--app-line)] bg-white p-1" /> : <div className="h-24 w-24 rounded-xl bg-[var(--app-bg)]" />}</div>
            <div className="min-w-0"><p className="text-sm font-semibold">{b.suspended ? 'Hidden by Bwenge' : b.published ? 'Live' : 'Not published yet'}</p><p className="mt-0.5 break-all font-mono text-[13px] text-[var(--app-muted)]">{url.replace(/^https?:\/\//, '')}</p>
              <div className="mt-2 flex flex-wrap gap-2"><button type="button" onClick={() => void copy()} className={`${btnGhost} !min-h-9 !px-3 text-xs`}><Copy size={14} />Copy</button>{qr && <a className={`${btnGhost} !min-h-9 !px-3 text-xs`} href={qr} download={`${b.slug}-qr.png`}><Download size={14} />QR</a>}</div></div></div>
          <button type="button" disabled={busy || !!b.suspended} onClick={() => void toggle()} className={`${b.published ? btnGhost : btnPrimary} mt-4 w-full`}>{busy ? <Loader2 size={16} className="animate-spin" /> : b.published ? <EyeOff size={16} /> : <Globe size={16} />}{b.published ? 'Unpublish page' : 'Publish my page'}</button>
          {note && <p role="status" className="mt-2 text-center text-xs text-[var(--app-muted)]">{note}</p>}
          {!(secrets?.mtn.set || secrets?.airtel.set) && <button type="button" onClick={() => go('secrets')} className="mt-3 flex w-full items-center gap-2 rounded-xl bg-[var(--app-bg)] px-3 py-2.5 text-left text-xs text-[var(--app-muted)] hover:bg-[var(--app-panel-hover)]"><KeyRound size={14} className="shrink-0 text-[var(--brand-strong,var(--brand))]" />Let customers pay by MTN or Airtel from your page: add your keys in Secrets.</button>}
        </div>
      </div>
      <div className={`${card} flex flex-wrap items-center gap-4`}><Sparkles className="text-[var(--brand-strong,var(--brand))]" /><div className="min-w-0 flex-1"><p className="font-semibold">Ask your Bwenge assistant</p><p className="text-sm text-[var(--app-muted)]">“Today I sold 5 loaves for 4,000”, “how is my week?”, “what is running out?”, “ask 0788 123 456 to pay 3,000”.</p></div><div className="flex flex-wrap gap-2"><button type="button" className={btnPrimary} onClick={() => go('agent')}><Bot size={16} />Business agent</button><button type="button" className={btnGhost} onClick={() => go('chat')}>Ask the agent</button></div></div>
    </div>
  );
}

/* ------------------------------------------------------------------ one row of the notebook */
const STATUS: Record<LedgerEntry['status'], string> = { completed: 'bg-emerald-50 text-emerald-700', pending: 'bg-amber-50 text-amber-700', cancelled: 'bg-rose-50 text-rose-700' };
export function EntryRow({ e, actions }: { e: LedgerEntry; actions?: React.ReactNode }) {
  const sale = e.type === 'sale';
  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${sale ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{sale ? <ArrowUpRight size={18} /> : <ArrowDownRight size={18} />}</span>
      <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{e.item || (sale ? 'Sale' : 'Expense')}{e.qty ? <span className="font-normal text-[var(--app-muted)]"> × {e.qty}</span> : null}</p>
        <p className="truncate text-xs text-[var(--app-muted)]">{timeOf(e.at)}{e.customer ? ` · ${e.customer}` : ''}{e.pay ? ` · ${e.pay.provider === 'mtn' ? 'MTN' : 'Airtel'} ${e.pay.phone}` : e.method ? ` · ${e.method}` : ''}{e.category && !sale ? ` · ${e.category}` : ''}{e.src === 'page' ? ' · from your page' : e.src === 'chat' ? ' · by chat' : ''}</p></div>
      {sale && <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${STATUS[e.status]}`}>{e.pay?.state === 'pending' ? 'Waiting for customer' : e.status}</span>}
      <b className={`text-sm tabular-nums ${sale ? '' : 'text-rose-600'}`}>{sale ? '' : '−'}{money(e.amount)}</b>{actions}
    </li>
  );
}

/* ------------------------------------------------------------------ sales & orders, expenses */
export function NotebookView({ b, type, open, onChange }: { b: Business; type: 'sale' | 'expense'; open: (k: EntryKind) => void; onChange: () => void }) {
  const [list, setList] = useState<LedgerEntry[] | null>(null); const [days, setDays] = useState(30); const [err, setErr] = useState(''); const [filter, setFilter] = useState<'all' | LedgerEntry['status']>('all');
  const load = useCallback(() => { ownerApi.ledger(b.id, { type, days }).then(setList).catch((e) => setErr(msg(e))); }, [b.id, type, days]);
  useEffect(() => { load(); }, [load, b.updatedAt]);
  const act = async (fn: () => Promise<unknown>) => { setErr(''); try { await fn(); load(); onChange(); } catch (e) { setErr(msg(e)); } };
  const shown = (list ?? []).filter((e) => filter === 'all' || e.status === filter); const total = shown.filter((e) => e.status === 'completed').reduce((a, e) => a + e.amount, 0);
  const csv = () => { const rows = [['Date', 'Type', 'Item', 'Qty', 'Amount RWF', 'Status', 'Customer', 'Method', 'Category'], ...(list ?? []).map((e) => [e.at, e.type, e.item ?? '', e.qty ?? '', e.amount, e.status, e.customer ?? '', e.pay ? e.pay.provider : e.method ?? '', e.category ?? ''])]; const t = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([t], { type: 'text/csv' })); a.download = `${b.slug}-${type === 'sale' ? 'sales' : 'expenses'}.csv`; a.click(); URL.revokeObjectURL(a.href); };
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="font-display text-2xl font-semibold tracking-tight">{type === 'sale' ? 'Sales and orders' : 'Expenses'}</h1><Tag kind="private" /></div>
        <div className="flex flex-wrap gap-2">{type === 'sale' && <button type="button" className={btnGhost} onClick={() => open('pay')}><Smartphone size={16} />Request payment</button>}<button type="button" className={btnPrimary} onClick={() => open(type)}><Plus size={16} />{type === 'sale' ? 'New sale' : 'Add expense'}</button></div></div>
      <div className={card}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">{(type === 'sale' ? (['all', 'completed', 'pending', 'cancelled'] as const) : (['all'] as const)).map((s) => <button key={s} type="button" aria-pressed={filter === s} onClick={() => setFilter(s)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${filter === s ? 'bg-[var(--brand)] text-[var(--brand-on)]' : 'bg-[var(--app-bg)] text-[var(--app-muted)]'}`}>{s[0].toUpperCase() + s.slice(1)}</button>)}</div>
          <div className="flex items-center gap-2"><select aria-label="Period" className={`${input} !w-auto !py-1.5`} value={days} onChange={(e) => setDays(Number(e.target.value))}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option><option value={365}>Last year</option></select><button type="button" className={`${btnGhost} !min-h-9 !px-3 text-xs`} onClick={csv} disabled={!list?.length}><Download size={14} />CSV</button></div></div>
        {err && <p role="alert" className="mb-2 text-sm text-rose-600">{err}</p>}
        {!list ? <Loader2 className="animate-spin text-[var(--brand)]" /> : !shown.length ? <p className="py-6 text-center text-sm text-[var(--app-muted)]">Nothing here yet. {type === 'sale' ? 'Press New sale, or tell the assistant what you sold.' : 'Press Add expense, or tell the assistant what you spent.'}</p> : (
          <><ul className="divide-y divide-[var(--app-line)]">{shown.slice(0, 200).map((e) => <EntryRow key={e.id} e={e} actions={<div className="flex gap-1.5">
            {type === 'sale' && e.status === 'pending' && e.pay?.state !== 'pending' && <button type="button" className={`${btnGhost} !min-h-9 !px-3 text-xs`} onClick={() => void act(() => ownerApi.setEntry(b.id, e.id, 'completed'))}>Confirm</button>}
            {e.pay?.state === 'pending' && <button type="button" className={`${btnGhost} !min-h-9 !px-3 text-xs`} onClick={() => void act(() => ownerApi.refreshPayment(b.id, e.id))}>Check</button>}
            {type === 'sale' && e.status === 'pending' && <button type="button" className={`${btnGhost} !min-h-9 !px-3 text-xs`} onClick={() => void act(() => ownerApi.setEntry(b.id, e.id, 'cancelled'))}>Cancel</button>}
            <button type="button" aria-label="Delete entry" className={`${btnGhost} !min-h-9 !px-2.5 text-rose-600`} onClick={() => { if (confirm('Delete this entry?')) void act(() => ownerApi.removeEntry(b.id, e.id)); }}><Trash2 size={14} /></button></div>} />)}</ul>
            <p className="mt-3 border-t border-[var(--app-line)] pt-3 text-right text-sm text-[var(--app-muted)]">{type === 'sale' ? 'Completed in this list' : 'Total'}: <b className="text-[var(--app-text)]">{money(type === 'sale' ? total : shown.reduce((a, e) => a + e.amount, 0))}</b></p></>)}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ customers and reports */
export function CustomersView({ b }: { b: Business }) {
  const [list, setList] = useState<LedgerEntry[] | null>(null);
  useEffect(() => { void ownerApi.ledger(b.id, { type: 'sale', days: 365 }).then(setList).catch(() => setList([])); }, [b.id]);
  const rows = useMemo(() => { const m = new Map<string, { name: string; total: number; n: number; last: string }>(); for (const e of list ?? []) { if (!e.customer || e.status !== 'completed') continue; const k = e.customer.toLowerCase(); const r = m.get(k) ?? { name: e.customer, total: 0, n: 0, last: e.at }; r.total += e.amount; r.n += 1; if (e.at > r.last) r.last = e.at; m.set(k, r); } return [...m.values()].sort((a, c) => c.total - a.total); }, [list]);
  return (<div className="space-y-5"><div><h1 className="font-display text-2xl font-semibold tracking-tight">Customers</h1><Tag kind="private" /></div>
    <div className={card}>{!list ? <Loader2 className="animate-spin text-[var(--brand)]" /> : !rows.length ? <p className="text-sm text-[var(--app-muted)]">Customers appear when you add a name to a sale, or when someone orders or pays on your page.</p> : (
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-[var(--app-muted)]"><th className="py-2 pr-3 font-medium">Customer</th><th className="px-3 font-medium">Purchases</th><th className="px-3 font-medium">Spent</th><th className="px-3 font-medium">Last</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.name} className="border-t border-[var(--app-line)]"><td className="py-2.5 pr-3 font-medium">{r.name}</td><td className="px-3 tabular-nums">{r.n}</td><td className="px-3 font-semibold tabular-nums">{money(r.total)}</td><td className="px-3 text-[var(--app-muted)]">{timeOf(r.last)}</td></tr>)}</tbody></table></div>)}</div></div>);
}
export function ReportsView({ b }: { b: Business }) {
  const [days, setDays] = useState<7 | 30 | 90>(30); const [d, setD] = useState<Dashboard | null>(null); const [exp, setExp] = useState<Array<[string, number]>>([]);
  useEffect(() => { ownerApi.dashboard(b.id, days).then(setD).catch(() => undefined); void ownerApi.ledger(b.id, { type: 'expense', days }).then((l) => { const m = new Map<string, number>(); for (const e of l) m.set(e.category ?? 'other', (m.get(e.category ?? 'other') ?? 0) + e.amount); setExp([...m.entries()].sort((a, c) => c[1] - a[1])); }).catch(() => undefined); }, [b.id, days]);
  const maxE = Math.max(1, ...exp.map(([, v]) => v));
  return (<div className="space-y-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="font-display text-2xl font-semibold tracking-tight">Reports</h1><Tag kind="private" /></div>
    <div className="inline-flex rounded-xl bg-[var(--app-panel)] p-1 border border-[var(--app-line)]">{([7, 30, 90] as const).map((n) => <button key={n} type="button" aria-pressed={days === n} onClick={() => setDays(n)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${days === n ? 'bg-[var(--brand)] text-[var(--brand-on)]' : 'text-[var(--app-muted)]'}`}>{n} days</button>)}</div></div>
    {d && <><div className="grid grid-cols-2 gap-3 lg:grid-cols-3"><Kpi icon={Wallet} label="Sales" value={money(d.range.sales)} tint="bg-gradient-to-br from-emerald-50 to-white" /><Kpi icon={Receipt} label="Expenses" value={money(d.range.expenses)} tint="bg-gradient-to-br from-rose-50 to-white" /><Kpi icon={TrendingUp} label="Profit (est.)" value={money(d.range.profit)} tint="bg-gradient-to-br from-amber-50 to-white" /></div>
      <div className={card}><h2 className="mb-3 font-display text-lg font-semibold">Sales per day</h2><SalesChart series={d.series} /></div>
      <div className="grid gap-5 lg:grid-cols-2"><div className={card}><h2 className="mb-3 font-display text-lg font-semibold">Where the money went</h2>{!exp.length ? <p className="text-sm text-[var(--app-muted)]">No expenses recorded.</p> : <ul className="space-y-3">{exp.map(([k, v]) => <li key={k}><div className="flex justify-between text-sm"><span className="font-medium capitalize">{k}</span><b>{money(v)}</b></div><div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--app-bg)]"><div className="h-full rounded-full bg-rose-400" style={{ width: `${(v / maxE) * 100}%` }} /></div></li>)}</ul>}</div>
        <div className={card}><h2 className="mb-3 font-display text-lg font-semibold">Best sellers</h2>{!d.top.length ? <p className="text-sm text-[var(--app-muted)]">No sales recorded.</p> : <ol className="space-y-2.5 text-sm">{d.top.map((t, i) => <li key={t.name} className="flex justify-between gap-3"><span><b className="mr-2 text-[var(--app-faint)]">{i + 1}</b>{t.name}</span><b>{money(t.amount)}</b></li>)}</ol>}</div></div></>}
  </div>);
}

/* ------------------------------------------------------------------ secrets: payment keys, write-only */
export function SecretsView({ b, secrets, reload }: { b: Business; secrets: SecretsStatus | null; reload: () => void }) {
  const [open, setOpen] = useState<'mtn' | 'airtel' | null>(null); const [vals, setVals] = useState<Record<string, string>>({}); const [env, setEnv] = useState('production'); const [busy, setBusy] = useState(''); const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  if (!secrets) return <Loader2 className="animate-spin text-[var(--brand)]" />;
  const NAME = { mtn: 'MTN MoMo', airtel: 'Airtel Money' } as const; const ENVS = { mtn: [['production', 'Live (real money)'], ['sandbox', 'Sandbox (testing)']], airtel: [['production', 'Live (real money)'], ['staging', 'Staging (testing)']] } as const;
  const run = async (k: string, fn: () => Promise<unknown>, ok: string) => { setBusy(k); setNote(null); try { await fn(); setNote({ ok: true, text: ok }); reload(); } catch (e) { setNote({ ok: false, text: msg(e) }); } finally { setBusy(''); } };
  const start = (p: 'mtn' | 'airtel') => { setOpen(p); setVals({}); setEnv('production'); setNote(null); };
  const any = secrets.mtn.set || secrets.airtel.set;
  return (
    <div className="space-y-5">
      <div><h1 className="font-display text-2xl font-semibold tracking-tight">Secrets and payments</h1><Tag kind="private" /></div>
      <div className={`${card} flex gap-4`}><ShieldCheck className="mt-0.5 shrink-0 text-emerald-700" /><div className="text-sm leading-relaxed text-[var(--app-muted)]"><p className="font-semibold text-[var(--app-text)]">Your keys are write-only and encrypted.</p><p className="mt-1">Once you save them, nobody can read them back, not you, not Bwenge staff, and not the assistant. They are used only to ask MTN or Airtel to send a payment prompt to your customer's phone. Money goes straight to your own account; Bwenge never holds it. Never paste keys in the chat.</p></div></div>

      {(['mtn', 'airtel'] as const).map((p) => { const st = secrets[p]; return (
        <div key={p} className={card}>
          <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><span className={`flex h-11 w-11 items-center justify-center rounded-xl text-sm font-bold ${p === 'mtn' ? 'bg-yellow-300 text-black' : 'bg-red-600 text-white'}`}>{p === 'mtn' ? 'MTN' : 'Air'}</span><div><h2 className="font-display text-lg font-semibold">{NAME[p]}</h2><p className="text-xs text-[var(--app-muted)]">{st.set ? `Keys saved · ${st.environment} · key ${st.hint} · ${st.at ? new Date(st.at).toLocaleDateString() : ''}` : 'Not connected'}</p></div></div>
            <div className="flex flex-wrap gap-2">{st.set && <button type="button" className={btnGhost} disabled={busy === `t${p}`} onClick={() => void run(`t${p}`, () => ownerApi.testSecrets(b.id, p), `${NAME[p]} accepted your keys.`)}>{busy === `t${p}` ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}Test keys</button>}
              <button type="button" className={btnPrimary} onClick={() => start(p)}><KeyRound size={15} />{st.set ? 'Replace keys' : 'Add keys'}</button>
              {st.set && <button type="button" className={`${btnGhost} text-rose-600`} onClick={() => { if (confirm(`Remove ${NAME[p]} keys? Customers will no longer be able to pay with ${NAME[p]}.`)) void run(`c${p}`, () => ownerApi.clearSecrets(b.id, p), 'Keys removed.'); }}>Remove</button>}</div></div>
          {open === p && (
            <form className="mt-5 space-y-3.5 border-t border-[var(--app-line)] pt-5" autoComplete="off" onSubmit={(e) => { e.preventDefault(); void run(`s${p}`, async () => { await ownerApi.saveSecrets(b.id, p, { ...vals, environment: env }); setOpen(null); setVals({}); }, `${NAME[p]} keys saved. Press “Test keys” to check them.`); }}>
              {secrets.fields[p].map((f) => <label key={f.id} className="block text-sm"><span className="mb-1 block font-medium">{f.label}</span><input required type={f.secret ? 'password' : 'text'} autoComplete="off" spellCheck={false} className={`${input} font-mono`} value={vals[f.id] ?? ''} onChange={(e) => setVals((v) => ({ ...v, [f.id]: e.target.value }))} /><span className="mt-1 block text-xs text-[var(--app-faint)]">{f.help}</span></label>)}
              <label className="block text-sm"><span className="mb-1 block font-medium">Environment</span><select className={input} value={env} onChange={(e) => setEnv(e.target.value)}>{ENVS[p].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
              <div className="flex gap-2"><button type="submit" disabled={busy === `s${p}`} className={btnPrimary}>{busy === `s${p}` ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />}Encrypt and save</button><button type="button" className={btnGhost} onClick={() => { setOpen(null); setVals({}); }}>Cancel</button></div>
            </form>)}
        </div>); })}
      {note && <p role="status" className={`rounded-xl px-4 py-2.5 text-sm ${note.ok ? 'bg-emerald-500/10 text-emerald-700' : 'bg-rose-500/10 text-rose-600'}`}>{note.text}</p>}

      <div className={card}><Title kind="public" hint="Customers scan your QR code, choose what they want, type their phone number and approve on their phone. You see the sale appear in your notebook as soon as it is paid.">Accept payments on your page</Title>
        <label className="flex items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5 accent-[var(--brand)]" disabled={!any} checked={secrets.acceptPay && any} onChange={(e) => void run('acc', () => ownerApi.update(b.id, { acceptPay: e.target.checked }), e.target.checked ? 'Customers can now pay on your page.' : 'Online payment is off.')} />Let customers pay on my page (MTN and Airtel){!any && <span className="text-xs text-[var(--app-faint)]">add keys first</span>}</label>
        <label className="mt-3 flex items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5 accent-[var(--brand)]" disabled={!any || !secrets.acceptPay} checked={secrets.payOpen} onChange={(e) => void run('open', () => ownerApi.update(b.id, { payOpen: e.target.checked }), e.target.checked ? 'Customers can type any amount.' : 'Customers pay for products only.')} />Also let customers type any amount (for a shop counter with no fixed price)</label>
        <div className="mt-4 rounded-xl bg-[var(--app-bg)] p-3 text-xs text-[var(--app-muted)]">Pay link for your counter QR: <span className="break-all font-mono">{pageUrl(b.slug)}#pay</span></div>
      </div>
      <div className={card}><h2 className="mb-2 font-display text-lg font-semibold">Where to get the keys</h2>
        <ul className="space-y-2 text-sm text-[var(--app-muted)]"><li><b className="text-[var(--app-text)]">MTN MoMo:</b> register on the MTN MoMo developer portal, subscribe to <i>Collections</i> for your country, create an API user and API key. For live payments MTN asks you to complete their go-live checks.</li><li><b className="text-[var(--app-text)]">Airtel Money:</b> register on the Airtel Africa Open API portal, create an application with the <i>Collection</i> product and copy the client ID and secret. Live use needs Airtel's approval.</li></ul>
        <p className="mt-3 text-xs text-[var(--app-faint)]">Bwenge sends payment requests exactly as MTN and Airtel describe them. Test with the sandbox keys first; live payments depend on your provider's approval of your account.</p></div>
    </div>
  );
}

/* ------------------------------------------------------------------ the business agent */
const LEVEL_INFO: Array<{ id: AgentSettings['level']; name: string; text: string; can: string[]; cannot: string }> = [
  { id: 'off', name: 'Off', text: 'The agent does nothing on its own. You can still ask the assistant anything in the chat.', can: [], cannot: '' },
  { id: 'watch', name: 'Watch', text: 'Looks after the numbers and tells you. Never changes anything.', can: ['Morning plan, closing summary, weekly review', 'Instant alerts: new order, payment received, low stock, new message'], cannot: 'Cannot change anything.' },
  { id: 'assist', name: 'Assist', text: 'Watches, and suggests changes you approve with one tap on Telegram.', can: ['Everything in Watch', 'Proposes: confirm an order, restock, mark out of stock, ask a customer to pay'], cannot: 'Nothing happens until you tap Do it.' },
  { id: 'run', name: 'Run', text: 'Assist, plus safe housekeeping done for you.', can: ['Everything in Assist', 'Settles payments MTN or Airtel say are paid', 'Marks messages as seen'], cannot: 'Still asks before anything that moves money or changes your page.' },
];
export function AgentView({ b }: { b: Business }) {
  const [a, setA] = useState<AgentSettings | null>(null); const [busy, setBusy] = useState(false); const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { void ownerApi.agent(b.id).then(setA).catch((e) => setNote({ ok: false, text: msg(e) })); }, [b.id]);
  const save = async (patch: Partial<AgentSettings>) => { if (!a) return; const prev = a; setA({ ...a, ...patch }); setBusy(true); setNote(null); try { setA(await ownerApi.setAgent(b.id, patch)); setNote({ ok: true, text: 'Saved.' }); } catch (e) { setA(prev); setNote({ ok: false, text: msg(e) }); } finally { setBusy(false); } };
  if (!a) return <Loader2 className="animate-spin text-[var(--brand)]" />;
  const on = a.level !== 'off';
  return (
    <div className="space-y-5">
      <div><h1 className="font-display text-2xl font-semibold tracking-tight">Business agent</h1><Tag kind="private" /></div>
      <div className={`${card} flex gap-4`}><Bot className="mt-0.5 shrink-0 text-[var(--brand-strong,var(--brand))]" /><p className="text-sm leading-relaxed text-[var(--app-muted)]">Your Bwenge assistant can look after the business while you are away. It reads your real notebook and stock, and messages you on Telegram (or email, or here in the chat). <b className="text-[var(--app-text)]">It can never publish your page, delete anything, change prices, touch your payment keys, or send a payment request without your yes.</b></p></div>
      <div className="grid gap-3 sm:grid-cols-2">{LEVEL_INFO.map((l) => (
        <button key={l.id} type="button" aria-pressed={a.level === l.id} disabled={busy} onClick={() => void save({ level: l.id })} className={`rounded-2xl border p-4 text-left transition ${a.level === l.id ? 'border-[var(--brand)] bg-[var(--brand)]/10 ring-2 ring-[var(--brand)]/30' : 'border-[var(--app-line)] bg-[var(--app-panel)] hover:bg-[var(--app-panel-hover)]'}`}>
          <p className="flex items-center justify-between font-display text-lg font-semibold">{l.name}{a.level === l.id && <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--brand)] text-[var(--brand-on)]"><Check size={14} /></span>}</p>
          <p className="mt-1 text-sm text-[var(--app-muted)]">{l.text}</p>
          {l.can.length > 0 && <ul className="mt-2.5 space-y-1 text-[13px]">{l.can.map((c) => <li key={c} className="flex gap-2"><Check size={14} className="mt-0.5 shrink-0 text-emerald-700" />{c}</li>)}</ul>}
          {l.cannot && <p className="mt-2 text-xs font-medium text-[var(--app-muted)]">{l.cannot}</p>}
        </button>))}</div>
      {on && <div className={card}><Title hint="Times are Rwanda time (Kigali).">What it sends you</Title>
        <ul className="space-y-3.5 text-sm">{([['alerts', BellRing, 'Instant alerts', 'New order, payment received, low stock, new message'], ['morning', Clock, 'Morning plan · 07:30', 'Yesterday in one line, and what needs you today'], ['evening', Receipt, 'Closing summary · 19:30', 'Today’s sales, expenses and profit, and what to prepare'], ['weekly', TrendingUp, 'Weekly review · Monday 08:00', 'The week against your usual, best and worst days, suggestions']] as const).map(([k, Icon, t, d]) => (
          <li key={k}><label className="flex cursor-pointer items-start gap-3"><input type="checkbox" className="mt-1 h-5 w-5 accent-[var(--brand)]" checked={a[k]} disabled={busy} onChange={(e) => void save({ [k]: e.target.checked } as Partial<AgentSettings>)} /><span><span className="flex items-center gap-2 font-semibold"><Icon size={15} aria-hidden="true" />{t}</span><span className="block text-[var(--app-muted)]">{d}</span></span></label></li>))}</ul>
        <p className="mt-4 rounded-xl bg-[var(--app-bg)] p-3 text-xs text-[var(--app-muted)]">Each message uses a few of your Bwenge credits. Link Telegram in Settings → Connections to get them on your phone at once.</p></div>}
      {note && <p role="status" className={`rounded-xl px-4 py-2.5 text-sm ${note.ok ? 'bg-emerald-500/10 text-emerald-700' : 'bg-rose-500/10 text-rose-600'}`}>{note.text}</p>}
      <div className={card}><h2 className="mb-2 font-display text-lg font-semibold">Or just tell it</h2><ul className="space-y-1.5 text-sm text-[var(--app-muted)]"><li>“Turn on my business agent in assist mode.”</li><li>“Today I sold 5 loaves for 4,000 and bought flour for 8,000.”</li><li>“Ask 0788 123 456 to pay 3,000 for the cake.”</li><li>“What is running out? Order more of anything under 5.”</li></ul><a className={`${btnGhost} mt-3`} href="/chat">Open the assistant</a></div>
    </div>
  );
}

/* ------------------------------------------------------------------ chat with the business agent */
interface ChatMsg { role: 'user' | 'assistant'; text: string; image?: string }
const toDataUrl = (b: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error('Could not read that photo.')); r.readAsDataURL(b); });
export function AgentChatView({ b, onChange }: { b: Business; onChange: () => void }) {
  const key = `bz-chat-${b.id}`; const [msgs, setMsgs] = useState<ChatMsg[]>(() => { try { return JSON.parse(sessionStorage.getItem(key) ?? '[]'); } catch { return []; } });
  const [text, setText] = useState(''); const [photo, setPhoto] = useState<{ url: string; name: string } | null>(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const end = useMemo(() => ({ current: null as HTMLDivElement | null }), []);
  useEffect(() => { try { sessionStorage.setItem(key, JSON.stringify(msgs.slice(-30).map((m) => ({ role: m.role, text: m.text })))); } catch { /* storage is optional */ } end.current?.scrollIntoView({ block: 'end' }); }, [msgs, key, end]);
  const pick = async (f: File | undefined) => { if (!f) return; setErr(''); try { const p = await prepareImage(f); if (p.blob.size > 5.5 * 1024 * 1024) throw new Error('That photo is too big. Take it again closer, or smaller.'); setPhoto({ url: await toDataUrl(p.blob), name: f.name }); } catch (e) { setErr(msg(e)); } };
  const send = async (t = text) => {
    const message = t.trim(); if (!message || busy) return; const image = photo?.url; setErr(''); setText(''); setPhoto(null); setBusy(true);
    const history = msgs.map((m) => ({ role: m.role, text: m.text })); setMsgs((m) => [...m, { role: 'user', text: message, image }]);
    try { const reply = await ownerApi.agentChat(b.id, { message, history, ...(image ? { image } : {}) }); setMsgs((m) => [...m, { role: 'assistant', text: reply }]); onChange(); }
    catch (e) { setErr(msg(e)); } finally { setBusy(false); }
  };
  const chips = ['How is my business today?', 'Today I sold 5 loaves for 4,000', 'What is running out?', 'How was my week?', 'Show my pending orders'];
  return (
    <div className="flex h-[calc(100dvh-9.5rem)] min-h-[420px] flex-col lg:h-[calc(100dvh-8rem)]">
      <div className="mb-3 flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--brand)] text-[var(--brand-on)]"><Bot size={22} /></span><div className="min-w-0 flex-1"><h1 className="font-display text-xl font-semibold leading-tight">Business Agent</h1><p className="truncate text-xs text-[var(--app-muted)]">Runs {b.name} with you · records sales, watches stock, sends payment requests · private</p></div>
        {msgs.length > 0 && <button type="button" className={`${btnGhost} !min-h-9 !px-3 text-xs`} onClick={() => { setMsgs([]); try { sessionStorage.removeItem(key); } catch { /* ignore */ } }}>New chat</button>}</div>
      <div className={`${card} flex min-h-0 flex-1 flex-col !p-0`}>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
          {!msgs.length && <div className="py-6 text-center"><p className="font-display text-lg font-semibold">What shall we do today?</p><p className="mx-auto mt-1 max-w-sm text-sm text-[var(--app-muted)]">Tell me what you sold or spent, send a photo of your sales book, or ask how the business is doing.</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">{chips.map((c) => <button key={c} type="button" onClick={() => void send(c)} className="rounded-full border border-[var(--app-line)] bg-[var(--app-bg)] px-3.5 py-2 text-sm font-medium hover:bg-[var(--app-panel-hover)]">{c}</button>)}</div></div>}
          {msgs.map((m, i) => <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed ${m.role === 'user' ? 'bg-[var(--brand)] text-[var(--brand-on)]' : 'bg-[var(--app-bg)]'}`}>{m.image && <img src={m.image} alt="Your photo" className="mb-2 max-h-48 rounded-xl" />}{m.text}</div></div>)}
          {busy && <div className="flex justify-start"><div className="inline-flex items-center gap-2 rounded-2xl bg-[var(--app-bg)] px-4 py-2.5 text-sm text-[var(--app-muted)]"><Loader2 size={15} className="animate-spin" />Working on it…</div></div>}
          <div ref={(el) => { end.current = el; }} />
        </div>
        {err && <p role="alert" className="border-t border-[var(--app-line)] px-4 py-2 text-sm text-rose-600">{err}</p>}
        {photo && <div className="flex items-center gap-3 border-t border-[var(--app-line)] px-4 py-2"><img src={photo.url} alt="" className="h-12 w-12 rounded-lg object-cover" /><span className="min-w-0 flex-1 truncate text-sm text-[var(--app-muted)]">{photo.name}</span><button type="button" aria-label="Remove photo" onClick={() => setPhoto(null)} className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-[var(--app-panel-hover)]"><X size={16} /></button></div>}
        <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="flex items-end gap-2 border-t border-[var(--app-line)] p-3">
          <input id="bz-chat-photo" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
          <label htmlFor="bz-chat-photo" aria-label="Attach a photo of your sales book" className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-[var(--app-line)] hover:bg-[var(--app-panel-hover)]"><Camera size={18} /></label>
          <textarea value={text} rows={1} maxLength={2000} placeholder="Tell your agent…" aria-label="Message to your agent" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} className={`${input} max-h-32 min-h-11 resize-none`} />
          <button type="submit" disabled={busy || !text.trim()} aria-label="Send" className={`${btnPrimary} !px-4`}>{busy ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />}</button>
        </form>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ the dashboard needs a paid plan */
export function LockedGate({ mine, onRefresh }: { mine: Mine; onRefresh: () => void }) {
  const u = mine.upgrade; const names = mine.businesses.map((b) => b.name);
  return (
    <div className="mx-auto max-w-xl py-6">
      <div className={`${card} text-center`}>
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--brand)]/15 text-[var(--brand-strong,var(--brand))]"><Lock size={26} aria-hidden="true" /></span>
        <h1 className="mt-4 font-display text-2xl font-semibold tracking-tight">Unlock your business dashboard</h1>
        <p className="mx-auto mt-2 max-w-md text-[15px] text-[var(--app-muted)]">{names.length ? <>Your page <b className="text-[var(--app-text)]">{names[0]}</b> is still visible to customers. To manage it again you need a plan.</> : 'Run your business here: a public page and link, a sales and expenses notebook, stock, customer orders, mobile-money payments, and an agent that looks after it all.'}</p>
        <ul className="mx-auto mt-5 max-w-sm space-y-2 text-left text-sm">{['Public page with short link, QR code and feed', 'Sales, expenses, stock and customers', 'Customers order and pay by MTN or Airtel', 'Business agent: daily plan, alerts, one-tap approvals'].map((t) => <li key={t} className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-emerald-700" />{t}</li>)}</ul>
        {u && <p className="mt-6 font-display text-3xl font-semibold">{u.priceRwf ? `${u.priceRwf.toLocaleString('en-US')} RWF` : u.name}<span className="ml-1.5 text-base font-normal text-[var(--app-muted)]">{u.priceNote}</span></p>}
        {u && <p className="mt-1 text-xs text-[var(--app-muted)]">{u.name} plan or higher. It also gives you the Bwenge assistant credits.</p>}
        <a href={u?.url ?? '/upgrade'} className={`${btnPrimary} mt-5 w-full`}>Choose a plan and pay</a>
        <button type="button" onClick={onRefresh} className={`${btnGhost} mt-2.5 w-full`}>I have paid, check again</button>
        <p className="mt-4 text-xs text-[var(--app-faint)]">Pay by mobile money from the upgrade page. Once your payment is confirmed this page unlocks by itself.</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ the public feed */
const ago = (iso: string) => { const s = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 1000)); return s < 3600 ? `${Math.max(1, Math.round(s / 60))} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };
export function FeedView({ b, onChange }: { b: Business; onChange: () => void }) {
  const [posts, setPosts] = useState<import('../../biz/types').Post[] | null>(null); const [urls, setUrls] = useState<Record<string, string>>({}); const [text, setText] = useState(''); const [files, setFiles] = useState<Array<{ blob: Blob; name: string; url: string }>>([]);
  const [busy, setBusy] = useState(''); const [err, setErr] = useState(''); const [note, setNote] = useState(''); const link = `${pageUrl(b.slug)}#updates`;
  const load = useCallback(() => { ownerApi.posts(b.id).then(setPosts).catch((e) => setErr(msg(e))); void ownerApi.mediaUrls(b.id).then(setUrls).catch(() => undefined); }, [b.id]);
  useEffect(() => { load(); }, [load]);
  const pick = async (list: FileList | null) => { if (!list) return; setErr(''); const next = [...files]; for (const f of Array.from(list)) { if (next.length >= 4) { setErr('A post can have up to 4 photos.'); break; } if (!f.type.startsWith('image/')) { setErr('Only photos can go in a post. Videos go in Public page → Photos and videos.'); continue; } const p = await prepareImage(f); next.push({ ...p, url: URL.createObjectURL(p.blob) }); } setFiles(next); };
  const post = async (e: React.FormEvent) => {
    e.preventDefault(); if (!text.trim() && !files.length) return; setErr(''); setBusy('Posting…');
    try { const ids: string[] = []; for (const [i, f] of files.entries()) { setBusy(`Uploading photo ${i + 1} of ${files.length}…`); ids.push((await ownerApi.upload(b.id, f.blob, f.name, () => undefined, 'feed')).id); } setBusy('Posting…'); await ownerApi.addPost(b.id, { text, mediaIds: ids }); setText(''); files.forEach((f) => URL.revokeObjectURL(f.url)); setFiles([]); load(); onChange(); }
    catch (x) { setErr(msg(x)); } finally { setBusy(''); }
  };
  const act = async (fn: () => Promise<unknown>) => { setErr(''); try { await fn(); load(); } catch (x) { setErr(msg(x)); } };
  const copy = async (t: string, what: string) => { try { await navigator.clipboard.writeText(t); setNote(`${what} copied`); } catch { setNote('Copy it by hand'); } };
  return (
    <div className="space-y-5">
      <div><h1 className="font-display text-2xl font-semibold tracking-tight">Feed</h1><Tag kind="public" /></div>
      <div className={card}><p className="text-sm text-[var(--app-muted)]">Everything you post here appears on your public page under <b className="text-[var(--app-text)]">Updates</b>, newest first. Share the feed link so customers follow what is new.</p>
        <p className="mt-3 break-all rounded-xl bg-[var(--app-bg)] px-4 py-3 font-mono text-[14px]">{link.replace(/^https?:\/\//, '')}</p>
        <div className="mt-3 flex flex-wrap gap-2"><button type="button" className={btnGhost} onClick={() => void copy(link, 'Feed link')}><Copy size={15} />Copy feed link</button><a className={btnGhost} target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(`${b.name}: what's new\n${link}`)}`}><Share2 size={15} />Share on WhatsApp</a><a className={btnGhost} target="_blank" rel="noreferrer" href={link}><Globe size={15} />Open</a></div>{note && <p role="status" className="mt-2 text-xs text-[var(--app-muted)]">{note}</p>}
        {!b.published && <p className="mt-3 rounded-xl bg-amber-500/10 px-3 py-2 text-xs">Your page is not published yet, so nobody can see the feed. Publish it from the Dashboard.</p>}</div>
      <form onSubmit={post} className={card}>
        <h2 className="mb-3 font-display text-lg font-semibold">New update</h2>
        <textarea className={input} rows={4} maxLength={1000} value={text} placeholder="What's new? A fresh batch, a promotion, opening hours for a holiday…" aria-label="Update text" onChange={(e) => setText(e.target.value)} /><p className="mt-1 text-right text-xs text-[var(--app-faint)]">{text.length}/1000</p>
        {files.length > 0 && <ul className="mb-3 flex flex-wrap gap-2">{files.map((f, i) => <li key={f.url} className="relative"><img src={f.url} alt="" className="h-20 w-20 rounded-xl object-cover" /><button type="button" aria-label="Remove photo" onClick={() => setFiles(files.filter((_, j) => j !== i))} className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-[#0E1722] text-white"><X size={12} /></button></li>)}</ul>}
        {err && <p role="alert" className="mb-2 text-sm text-rose-600">{err}</p>}
        <div className="flex flex-wrap items-center gap-2"><input id="bz-feed-photos" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple className="sr-only" onChange={(e) => { void pick(e.target.files); e.target.value = ''; }} /><label htmlFor="bz-feed-photos" className={`${btnGhost} cursor-pointer`}><ImagePlus size={16} />Add photos</label>
          <button type="submit" disabled={!!busy || (!text.trim() && !files.length)} className={`${btnPrimary} ml-auto`}>{busy ? <><Loader2 size={16} className="animate-spin" />{busy}</> : <><Send size={16} />Post update</>}</button></div>
      </form>
      <div className="space-y-3">
        {posts === null ? <Loader2 className="animate-spin text-[var(--brand)]" /> : !posts.length ? <p className={`${card} text-sm text-[var(--app-muted)]`}>No updates yet. Post your first one above: a photo of today's best product works well.</p> : [...posts].sort((a, c) => Number(!!c.pinned) - Number(!!a.pinned)).map((p) => (
          <article key={p.id} className={card}>
            <div className="flex items-center justify-between gap-2 text-xs text-[var(--app-muted)]"><span>{ago(p.at)}{p.pinned && <span className="ml-2 rounded-full bg-[var(--brand)]/20 px-2 py-0.5 font-semibold text-[var(--app-text)]">Pinned</span>}</span>
              <div className="flex gap-1.5"><button type="button" className={`${btnGhost} !min-h-9 !px-3 text-xs`} onClick={() => void act(() => ownerApi.setPost(b.id, p.id, { pinned: !p.pinned }))}>{p.pinned ? 'Unpin' : 'Pin'}</button><button type="button" aria-label="Copy link to this post" className={`${btnGhost} !min-h-9 !px-2.5`} onClick={() => void copy(`${pageUrl(b.slug)}?post=${p.id}#post-${p.id}`, 'Post link')}><Copy size={14} /></button><button type="button" aria-label="Delete post" className={`${btnGhost} !min-h-9 !px-2.5 text-rose-600`} onClick={() => { if (confirm('Delete this update?')) void act(() => ownerApi.removePost(b.id, p.id)); }}><Trash2 size={14} /></button></div></div>
            {p.text && <p className="mt-2 whitespace-pre-wrap text-[15px]">{p.text}</p>}
            {p.mediaIds.length > 0 && <ul className={`mt-3 grid gap-2 ${p.mediaIds.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>{p.mediaIds.map((id) => <li key={id} className="overflow-hidden rounded-xl bg-[var(--app-bg)]">{urls[id] ? <img src={urls[id]} alt="" className="max-h-72 w-full object-cover" /> : <div className="h-32" />}</li>)}</ul>}
          </article>))}
      </div>
    </div>
  );
}
