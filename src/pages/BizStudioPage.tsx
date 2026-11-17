import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, Check, Copy, Download, Eye, EyeOff, ExternalLink, Film, Globe, ImagePlus, Inbox, LayoutDashboard, Loader2, Lock, MessageCircle, Package, Palette, Plus, Settings, Share2, Sparkles, Trash2, Upload } from 'lucide-react';
import BizPage from '../components/biz/BizPage';
import { BizApiError, ownerApi, prepareImage, type Mine } from '../biz/api';
import { CATEGORIES, DAYS, THEMES, pageUrl, rwf, type Business, type DayStats, type Enquiry, type Hours, type PublicBusiness } from '../biz/types';

/**
 * The owner's studio (/biz). Public tabs change what visitors see; private tabs (Overview numbers, Messages, Settings, Notebook) are only ever shown here.
 * Everything the owner can do here the Bwenge assistant can also do by chat.
 */
type Tab = 'overview' | 'page' | 'products' | 'gallery' | 'messages' | 'preview' | 'settings' | 'notebook';
const TABS: Array<{ id: Tab; label: string; icon: typeof Globe; kind: 'public' | 'private' }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, kind: 'private' }, { id: 'page', label: 'Page', icon: Palette, kind: 'public' }, { id: 'products', label: 'Products', icon: Package, kind: 'public' },
  { id: 'gallery', label: 'Photos and videos', icon: ImagePlus, kind: 'public' }, { id: 'messages', label: 'Messages', icon: Inbox, kind: 'private' }, { id: 'preview', label: 'Preview', icon: Eye, kind: 'public' },
  { id: 'settings', label: 'Settings', icon: Settings, kind: 'private' }, { id: 'notebook', label: 'Notebook', icon: BookOpen, kind: 'private' },
];
const card = 'rounded-2xl border border-[var(--app-line)] bg-[var(--app-panel)] p-5';
const input = 'w-full rounded-xl border border-[var(--app-line)] bg-[var(--app-bg)] px-3.5 py-2.5 text-sm text-[var(--app-text)] outline-none placeholder:text-[var(--app-faint)] focus:border-[var(--brand)]';
const btn = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold disabled:opacity-50';
const btnPrimary = `${btn} bg-[var(--brand)] text-[var(--brand-on)] hover:opacity-90`;
const btnGhost = `${btn} border border-[var(--app-line)] text-[var(--app-text)] hover:bg-[var(--app-panel-hover)]`;
const msg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Please try again.');

function Tag({ kind }: { kind: 'public' | 'private' }) {
  return kind === 'public'
    ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300"><Globe size={11} />Visitors see this</span>
    : <span className="inline-flex items-center gap-1 rounded-full bg-[var(--app-panel-hover)] px-2 py-0.5 text-[11px] font-medium text-[var(--app-muted)]"><Lock size={11} />Only you see this</span>;
}
const Title = ({ children, kind, hint }: { children: React.ReactNode; kind?: 'public' | 'private'; hint?: string }) => (
  <div className="mb-4"><div className="flex flex-wrap items-center gap-2"><h2 className="font-display text-xl font-semibold tracking-tight">{children}</h2>{kind && <Tag kind={kind} />}</div>{hint && <p className="mt-1 text-sm text-[var(--app-muted)]">{hint}</p>}</div>
);

/* ------------------------------------------------------------------ overview */
function Overview({ b, go, onChange, urlBase }: { b: Business; go: (t: Tab) => void; onChange: () => void; urlBase: string }) {
  const [stats, setStats] = useState<{ last30: DayStats; days: Array<{ day: string } & DayStats>; newMessages: number } | null>(null);
  const [busy, setBusy] = useState(false); const [note, setNote] = useState(''); const [qr, setQr] = useState('');
  const url = pageUrl(b.slug, urlBase);
  useEffect(() => { void ownerApi.stats(b.id).then(setStats).catch(() => undefined); }, [b.id]);
  useEffect(() => { let alive = true; void import('qrcode').then((m: any) => (m.default ?? m).toDataURL(url, { margin: 1, width: 360, color: { dark: '#0E1722', light: '#FFFFFF' } })).then((d: string) => { if (alive) setQr(d); }).catch(() => undefined); return () => { alive = false; }; }, [url]);
  const toggle = async () => { setBusy(true); setNote(''); try { await ownerApi.publish(b.id, !b.published); onChange(); } catch (e) { setNote(msg(e)); } finally { setBusy(false); } };
  const copy = async () => { try { await navigator.clipboard.writeText(url); setNote('Link copied'); } catch { setNote('Copy the link by hand'); } };
  const todo: Array<[string, boolean, Tab]> = [['Write a short description', !!(b.about || b.tagline), 'page'], ['Add your WhatsApp number', !!b.whatsapp, 'page'], ['Add a product or two', b.products.length > 0, 'products'], ['Add a photo', b.media.some((m) => m.kind === 'image'), 'gallery'], ['Set your opening hours', b.hours.length > 0, 'page']];
  const max = Math.max(1, ...(stats?.days.map((d) => d.views) ?? [1]));
  return (
    <div className="space-y-5">
      <div className={`${card} flex flex-wrap items-center justify-between gap-4`}>
        <div className="min-w-0"><p className="text-sm text-[var(--app-muted)]">Your page is</p><p className="font-display text-2xl font-semibold">{b.suspended ? 'Hidden by Bwenge' : b.published ? 'Live' : 'Not published yet'}</p>
          {b.suspended ? <p className="mt-1 text-sm text-rose-300">{b.suspended.reason}. Contact support.</p> : <p className="mt-1 text-sm text-[var(--app-muted)]">{b.published ? 'Anyone with the link can see it.' : 'Nobody can see it until you publish.'}</p>}</div>
        <button type="button" disabled={busy || !!b.suspended} onClick={() => void toggle()} className={b.published ? btnGhost : btnPrimary}>{busy ? <Loader2 size={16} className="animate-spin" /> : b.published ? <EyeOff size={16} /> : <Globe size={16} />}{b.published ? 'Unpublish' : 'Publish my page'}</button>
      </div>
      {note && <p role="status" className="rounded-xl bg-[var(--app-panel)] px-4 py-2.5 text-sm text-[var(--app-muted)]">{note}</p>}

      <div className={`${card} grid gap-5 sm:grid-cols-[1fr_auto]`}>
        <div className="min-w-0"><Title kind="public">Your short link</Title>
          <p className="break-all rounded-xl bg-[var(--app-bg)] px-4 py-3 font-mono text-[15px]">{url}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={btnGhost} onClick={() => void copy()}><Copy size={15} />Copy link</button>
            <a className={btnGhost} target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(`${b.name}${b.tagline ? ` · ${b.tagline}` : ''}\n${url}`)}`}><Share2 size={15} />Share on WhatsApp</a>
            <a className={btnGhost} target="_blank" rel="noreferrer" href={url}><ExternalLink size={15} />Open page</a>
          </div>
          <p className="mt-3 text-xs text-[var(--app-faint)]">To send customers to one part: <span className="font-mono">{url}#products</span>, <span className="font-mono">#gallery</span>, <span className="font-mono">#hours</span> or <span className="font-mono">#contact</span>.</p></div>
        <div className="flex flex-col items-center gap-2">{qr ? <img src={qr} alt={`QR code for ${url}`} className="h-36 w-36 rounded-xl bg-white p-1.5" /> : <div className="h-36 w-36 rounded-xl bg-[var(--app-bg)]" />}
          {qr && <a className="inline-flex items-center gap-1 text-xs text-[var(--app-muted)] hover:text-[var(--app-text)]" href={qr} download={`${b.slug}-qr.png`}><Download size={13} />Download QR</a>}</div>
      </div>

      <div className={card}><Title kind="private" hint="Last 30 days. Visitors never see these numbers.">Visits and taps</Title>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">{[['Visits', stats?.last30.views], ['WhatsApp taps', stats?.last30.whatsapp], ['Calls', stats?.last30.calls], ['Shares', stats?.last30.shares], ['New messages', stats?.newMessages]].map(([l, v]) => <div key={l as string} className="rounded-xl bg-[var(--app-bg)] p-3"><p className="text-xs text-[var(--app-muted)]">{l}</p><p className="font-display text-2xl font-semibold">{v ?? '…'}</p></div>)}</div>
        {stats && stats.days.length > 1 && <div className="mt-4 flex h-14 items-end gap-1" aria-label="Visits per day">{stats.days.map((d) => <div key={d.day} title={`${d.day}: ${d.views}`} className="flex-1 rounded-t bg-[var(--brand)]/70" style={{ height: `${Math.max(8, (d.views / max) * 100)}%` }} />)}</div>}
        {(stats?.newMessages ?? 0) > 0 && <button type="button" className={`${btnPrimary} mt-4`} onClick={() => go('messages')}><Inbox size={16} />Read {stats!.newMessages} new message{stats!.newMessages === 1 ? '' : 's'}</button>}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className={card}><Title hint="Tick these and your page is ready to share.">Get ready</Title>
          <ul className="space-y-2">{todo.map(([t, done, tab]) => <li key={t}><button type="button" onClick={() => go(tab)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left text-sm hover:bg-[var(--app-panel-hover)]"><span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${done ? 'bg-emerald-500 text-black' : 'border border-[var(--app-line)]'}`}>{done && <Check size={13} />}</span><span className={done ? 'text-[var(--app-faint)] line-through' : ''}>{t}</span></button></li>)}</ul>
        </div>
        <div className={card}><Title>Who sees what</Title>
          <div className="grid gap-4 text-sm sm:grid-cols-2">
            <div><Tag kind="public" /><ul className="mt-2 space-y-1.5 text-[var(--app-muted)]"><li>Name, tagline, description</li><li>Logo, cover, photos and videos you show</li><li>Products and prices</li><li>Hours, address, map</li><li>WhatsApp, phone, email you add</li><li>Your MoMo Pay code, only if you turn it on</li></ul></div>
            <div><Tag kind="private" /><ul className="mt-2 space-y-1.5 text-[var(--app-muted)]"><li>Messages visitors send</li><li>Visit and tap numbers</li><li>Hidden products, photos and videos</li><li>Your private notes</li><li>Your account and plan</li><li>The money notebook (coming)</li></ul></div>
          </div>
        </div>
      </div>
      <div className={`${card} flex flex-wrap items-center gap-4`}><Sparkles className="text-[var(--brand)]" /><div className="min-w-0 flex-1"><p className="font-semibold">Prefer to chat?</p><p className="text-sm text-[var(--app-muted)]">Tell the Bwenge assistant: “add rice at 1,500”, “we close at 8 on Saturdays”, “publish my page”.</p></div><a className={btnGhost} href="/chat">Open the assistant</a></div>
    </div>
  );
}

/* ------------------------------------------------------------------ page */
function PageTab({ b, onChange }: { b: Business; onChange: () => void }) {
  const init = useMemo(() => ({ name: b.name, category: b.category, theme: b.theme, tagline: b.tagline, about: b.about, whatsapp: b.whatsapp ?? '', phone: b.phone ?? '', email: b.email ?? '', address: b.address ?? '', mapUrl: b.mapUrl ?? '', website: b.website ?? '', instagram: b.instagram ?? '', facebook: b.facebook ?? '', momoCode: b.momoCode ?? '', momoName: b.momoName ?? '', showPay: b.showPay }), [b]);
  const [f, setF] = useState(init); const [hours, setHours] = useState<Hours[]>(b.hours); const [busy, setBusy] = useState(false); const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { setF(init); setHours(b.hours); }, [init, b.hours]);
  const dirty = JSON.stringify(f) !== JSON.stringify(init) || JSON.stringify(hours) !== JSON.stringify(b.hours);
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => { setBusy(true); setNote(null); try { await ownerApi.update(b.id, { ...f, hours }); setNote({ ok: true, text: 'Saved.' }); onChange(); } catch (e) { setNote({ ok: false, text: msg(e) }); } finally { setBusy(false); } };
  const hourOf = (d: string) => hours.find((h) => h.day === d);
  const setHour = (d: Hours['day'], patch: Partial<Hours> | null) => setHours((hs) => { const rest = hs.filter((h) => h.day !== d); return patch === null ? rest : [...rest, { day: d, open: '08:00', close: '18:00', ...hs.find((h) => h.day === d), ...patch }]; });
  return (
    <div className="space-y-5">
      <div className={card}><Title kind="public">About your business</Title>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm"><span className="mb-1.5 block text-[var(--app-muted)]">Business name</span><input className={input} value={f.name} maxLength={60} onChange={(e) => set('name', e.target.value)} /></label>
          <label className="block text-sm"><span className="mb-1.5 block text-[var(--app-muted)]">Kind of business</span><select className={input} value={f.category} onChange={(e) => set('category', e.target.value)}>{CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
          <label className="block text-sm sm:col-span-2"><span className="mb-1.5 block text-[var(--app-muted)]">One line that says what you do</span><input className={input} value={f.tagline} maxLength={120} placeholder="Fresh bread baked every morning in Kimironko" onChange={(e) => set('tagline', e.target.value)} /></label>
          <label className="block text-sm sm:col-span-2"><span className="mb-1.5 block text-[var(--app-muted)]">Tell customers about you</span><textarea className={input} rows={5} value={f.about} maxLength={1500} onChange={(e) => set('about', e.target.value)} /><span className="mt-1 block text-right text-xs text-[var(--app-faint)]">{f.about.length}/1500</span></label>
        </div>
        <p className="mb-2 mt-1 flex items-center gap-2 text-sm text-[var(--app-muted)]"><Palette size={15} />Page colour</p>
        <div className="flex flex-wrap gap-2.5">{Object.entries(THEMES).map(([id, t]) => <button key={id} type="button" aria-label={t.label} aria-pressed={f.theme === id} onClick={() => set('theme', id)} className={`flex h-11 w-11 items-center justify-center rounded-full border-2 ${f.theme === id ? 'border-[var(--app-text)]' : 'border-transparent'}`} style={{ background: t.accent }}>{f.theme === id && <Check size={18} style={{ color: t.on }} />}</button>)}</div>
      </div>
      <div className={card}><Title kind="public" hint="Only add what you want customers to see. Phone numbers with the country code, like 250788123456.">How customers reach you</Title>
        <div className="grid gap-4 sm:grid-cols-2">
          {([['whatsapp', 'WhatsApp number', '250788123456'], ['phone', 'Phone number to call', '250788123456'], ['email', 'Email', 'you@example.com'], ['address', 'Address', 'KG 11 Ave, Kimironko, Kigali'], ['mapUrl', 'Google Maps link (optional)', 'https://maps.app.goo.gl/…'], ['website', 'Website (optional)', 'https://'], ['instagram', 'Instagram (optional)', 'https://instagram.com/…'], ['facebook', 'Facebook (optional)', 'https://facebook.com/…']] as const).map(([k, l, p]) => (
            <label key={k} className="block text-sm"><span className="mb-1.5 block text-[var(--app-muted)]">{l}</span><input className={input} value={f[k]} placeholder={p} inputMode={k === 'whatsapp' || k === 'phone' ? 'tel' : undefined} onChange={(e) => set(k, e.target.value)} /></label>))}
        </div>
      </div>
      <div className={card}><Title kind="public" hint="Closed days are shown as closed. Leave a day empty to show nothing for it.">Opening hours</Title>
        <ul className="divide-y divide-[var(--app-line)]">{DAYS.map((d) => { const h = hourOf(d.id); return (
          <li key={d.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm"><span className="w-24 font-medium">{d.label}</span>
            <select aria-label={`${d.label} status`} className={`${input} !w-auto`} value={!h ? 'none' : h.closed ? 'closed' : 'open'} onChange={(e) => setHour(d.id, e.target.value === 'none' ? null : e.target.value === 'closed' ? { closed: true } : { closed: false })}><option value="none">Not set</option><option value="open">Open</option><option value="closed">Closed</option></select>
            {h && !h.closed && <><input type="time" aria-label={`${d.label} opens`} className={`${input} !w-auto`} value={h.open} onChange={(e) => setHour(d.id, { open: e.target.value })} /><span className="text-[var(--app-muted)]">to</span><input type="time" aria-label={`${d.label} closes`} className={`${input} !w-auto`} value={h.close} onChange={(e) => setHour(d.id, { close: e.target.value })} /></>}</li>); })}</ul>
        <button type="button" className={`${btnGhost} mt-3`} onClick={() => setHours(DAYS.map((d) => (d.id === 'sun' ? { day: d.id, open: '00:00', close: '00:00', closed: true } : { day: d.id, open: '08:00', close: '18:00' })))}>Fill: Monday to Saturday 08:00 to 18:00, Sunday closed</button>
      </div>
      <div className={card}><Title kind="public" hint="Optional. If you turn this on, visitors see your MTN MoMo Pay code and name with a Copy button. Bwenge never moves money.">How to pay</Title>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm"><span className="mb-1.5 block text-[var(--app-muted)]">MoMo Pay code</span><input className={`${input} font-mono`} value={f.momoCode} inputMode="numeric" placeholder="123456" onChange={(e) => set('momoCode', e.target.value.replace(/\D/g, ''))} /></label>
          <label className="block text-sm"><span className="mb-1.5 block text-[var(--app-muted)]">Name on the code</span><input className={input} value={f.momoName} maxLength={60} onChange={(e) => set('momoName', e.target.value)} /></label>
        </div>
        <label className="mt-4 flex items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5 accent-[var(--brand)]" checked={f.showPay && !!f.momoCode} disabled={!f.momoCode} onChange={(e) => set('showPay', e.target.checked)} />Show “How to pay” on my page</label>
      </div>
      <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--app-line)] bg-[var(--app-panel)]/95 p-3 backdrop-blur">
        <button type="button" disabled={!dirty || busy} onClick={() => void save()} className={btnPrimary}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}Save changes</button>
        <span className="text-sm text-[var(--app-muted)]">{dirty ? 'You have changes that are not saved.' : note?.ok ? 'Saved.' : 'Everything is saved.'}</span>{note && !note.ok && <span role="alert" className="text-sm text-rose-300">{note.text}</span>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ products */
function ProductsTab({ b, urls, onChange }: { b: Business; urls: Record<string, string>; onChange: () => void }) {
  const [draft, setDraft] = useState({ name: '', price: '', unit: '', description: '', mediaId: '' }); const [busy, setBusy] = useState(''); const [err, setErr] = useState('');
  const photos = b.media.filter((m) => m.kind === 'image');
  const run = async (key: string, fn: () => Promise<unknown>) => { setBusy(key); setErr(''); try { await fn(); onChange(); } catch (e) { setErr(msg(e)); } finally { setBusy(''); } };
  const add = (e: React.FormEvent) => { e.preventDefault(); if (!draft.name.trim()) return; void run('add', async () => { await ownerApi.addProduct(b.id, { name: draft.name, price: draft.price === '' ? null : Number(draft.price.replace(/[,\s]/g, '')), unit: draft.unit, description: draft.description, ...(draft.mediaId ? { mediaId: draft.mediaId } : {}) }); setDraft({ name: '', price: '', unit: '', description: '', mediaId: '' }); }); };
  return (
    <div className="space-y-5">
      <form onSubmit={add} className={card}><Title kind="public" hint="Price in whole RWF. Leave it empty to show “Ask for price”.">Add a product</Title>
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
          <input className={input} aria-label="Product name" placeholder="Name, for example Tomatoes" maxLength={80} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <input className={input} aria-label="Price in RWF" placeholder="Price (RWF)" inputMode="numeric" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value.replace(/[^\d,\s]/g, '') })} />
          <input className={input} aria-label="Unit" placeholder="per kg, per cup…" maxLength={20} value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} />
        </div>
        <input className={`${input} mt-3`} aria-label="Short description" placeholder="Short description (optional)" maxLength={400} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
        {photos.length > 0 && <div className="mt-3"><p className="mb-1.5 text-sm text-[var(--app-muted)]">Photo (optional)</p><div className="flex gap-2 overflow-x-auto pb-1">{photos.map((m) => <button key={m.id} type="button" aria-pressed={draft.mediaId === m.id} onClick={() => setDraft({ ...draft, mediaId: draft.mediaId === m.id ? '' : m.id })} className={`h-16 w-16 shrink-0 overflow-hidden rounded-xl border-2 ${draft.mediaId === m.id ? 'border-[var(--brand)]' : 'border-transparent'}`}>{urls[m.id] ? <img src={urls[m.id]} alt={m.caption || m.name} className="h-full w-full object-cover" /> : null}</button>)}</div></div>}
        <button type="submit" disabled={!draft.name.trim() || busy === 'add'} className={`${btnPrimary} mt-4`}>{busy === 'add' ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}Add product</button>
      </form>
      {err && <p role="alert" className="rounded-xl bg-rose-500/10 px-4 py-2.5 text-sm text-rose-300">{err}</p>}
      <div className={card}><Title kind="public">Your products ({b.products.length})</Title>
        {!b.products.length ? <p className="text-sm text-[var(--app-muted)]">No products yet. Add your first one above, or tell the assistant: “add tomatoes 1,200 per kg”.</p> : (
          <ul className="divide-y divide-[var(--app-line)]">{b.products.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-[var(--app-bg)]">{p.mediaId && urls[p.mediaId] ? <img src={urls[p.mediaId]} alt="" className="h-full w-full object-cover" /> : <Package className="m-3 text-[var(--app-faint)]" size={24} />}</div>
              <div className="min-w-0 flex-1"><p className="truncate font-medium">{p.name}{p.hidden && <span className="ml-2 rounded-full bg-[var(--app-panel-hover)] px-2 py-0.5 text-[11px] font-normal text-[var(--app-muted)]">Hidden</span>}</p><p className="text-sm text-[var(--app-muted)]">{rwf(p.price)}{p.unit && p.price !== null ? ` / ${p.unit}` : ''}{!p.available && ' · out of stock'}</p></div>
              <input aria-label={`Price of ${p.name}`} defaultValue={p.price ?? ''} inputMode="numeric" className={`${input} !w-28`} onBlur={(e) => { const v = e.target.value.replace(/[,\s]/g, ''); if (v !== String(p.price ?? '')) void run(p.id, () => ownerApi.updateProduct(b.id, p.id, { price: v === '' ? null : Number(v) })); }} />
              <button type="button" className={btnGhost} onClick={() => void run(p.id, () => ownerApi.updateProduct(b.id, p.id, { available: !p.available }))}>{p.available ? 'Mark out of stock' : 'Back in stock'}</button>
              <button type="button" className={btnGhost} aria-label={p.hidden ? `Show ${p.name}` : `Hide ${p.name}`} onClick={() => void run(p.id, () => ownerApi.updateProduct(b.id, p.id, { hidden: !p.hidden }))}>{p.hidden ? <Eye size={16} /> : <EyeOff size={16} />}</button>
              <button type="button" className={`${btnGhost} text-rose-300`} aria-label={`Delete ${p.name}`} onClick={() => { if (confirm(`Delete ${p.name}?`)) void run(p.id, () => ownerApi.removeProduct(b.id, p.id)); }}><Trash2 size={16} /></button>
            </li>))}</ul>)}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ photos and videos */
function GalleryTab({ b, urls, onChange, limits }: { b: Business; urls: Record<string, string>; onChange: () => void; limits: Mine['limits'] }) {
  const [jobs, setJobs] = useState<Array<{ name: string; progress: number; error?: string }>>([]); const [err, setErr] = useState(''); const fileRef = useRef<HTMLInputElement>(null);
  const used = b.media.reduce((a, m) => a + m.size, 0); const images = b.media.filter((m) => m.kind === 'image').length, videos = b.media.length - images;
  const upload = async (files: FileList | null) => {
    if (!files?.length) return; setErr('');
    for (const file of Array.from(files)) {
      const isVideo = file.type.startsWith('video/'); if (isVideo && file.size > 25 * 1048576) { setErr(`${file.name} is ${(file.size / 1048576).toFixed(0)} MB. A video can be up to 25 MB: record a shorter clip.`); continue; }
      const prepared = isVideo ? { blob: file as Blob, name: file.name } : await prepareImage(file); const idx = Date.now() + Math.random();
      setJobs((j) => [...j, { name: file.name, progress: 0, _id: idx } as any]);
      try { await ownerApi.upload(b.id, prepared.blob, prepared.name, (p) => setJobs((j) => j.map((x: any) => (x._id === idx ? { ...x, progress: p } : x)))); setJobs((j) => j.filter((x: any) => x._id !== idx)); onChange(); }
      catch (e) { setJobs((j) => j.map((x: any) => (x._id === idx ? { ...x, error: msg(e) } : x))); }
    }
    if (fileRef.current) fileRef.current.value = '';
  };
  const act = async (fn: () => Promise<unknown>) => { setErr(''); try { await fn(); onChange(); } catch (e) { setErr(msg(e)); } };
  return (
    <div className="space-y-5">
      <div className={card}><Title kind="public" hint={`Photos up to 6 MB, short videos up to 25 MB (about 30 seconds). ${images}/${limits.images} photos, ${videos}/${limits.videos} videos, ${(used / 1048576).toFixed(0)} of ${limits.totalMediaMb} MB used.`}>Add photos and videos</Title>
        <input ref={fileRef} type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm" className="sr-only" id="biz-upload" onChange={(e) => void upload(e.target.files)} />
        <label htmlFor="biz-upload" className={`${btnPrimary} cursor-pointer`}><Upload size={16} />Choose photos or videos</label>
        <p className="mt-2 text-xs text-[var(--app-faint)]">Big photos are shrunk on your phone before sending. iPhone photos in HEIC format are not accepted: use “Most Compatible” in the camera settings, or take a screenshot.</p>
        {jobs.map((j: any) => <div key={j._id} className="mt-3 text-sm"><div className="flex justify-between"><span className="truncate">{j.name}</span><span className={j.error ? 'text-rose-300' : 'text-[var(--app-muted)]'}>{j.error ? 'Failed' : `${Math.round(j.progress * 100)}%`}</span></div>{j.error ? <p role="alert" className="text-xs text-rose-300">{j.error}</p> : <div className="mt-1 h-1.5 rounded bg-[var(--app-bg)]"><div className="h-1.5 rounded bg-[var(--brand)]" style={{ width: `${j.progress * 100}%` }} /></div>}</div>)}
        {err && <p role="alert" className="mt-3 text-sm text-rose-300">{err}</p>}
      </div>
      <div className={card}><Title kind="public" hint="Hidden files stay in your studio. The cover is the big picture at the top of your page.">Your photos and videos ({b.media.length})</Title>
        {!b.media.length ? <p className="text-sm text-[var(--app-muted)]">Nothing yet. A good first photo: your shop front or your best product.</p> : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{b.media.map((m) => (
            <li key={m.id} className={`overflow-hidden rounded-2xl border border-[var(--app-line)] ${m.visible ? '' : 'opacity-60'}`}>
              <div className="relative aspect-square bg-[var(--app-bg)]">{m.kind === 'image' ? (urls[m.id] ? <img src={urls[m.id]} alt={m.caption || m.name} className="h-full w-full object-cover" /> : null) : (urls[m.id] ? <video src={`${urls[m.id]}#t=0.1`} preload="metadata" muted playsInline controls className="h-full w-full object-cover" /> : <Film className="m-auto text-[var(--app-faint)]" />)}
                <div className="absolute left-2 top-2 flex gap-1">{b.coverId === m.id && <span className="rounded-full bg-black/70 px-2 py-0.5 text-[11px] text-white">Cover</span>}{b.logoId === m.id && <span className="rounded-full bg-black/70 px-2 py-0.5 text-[11px] text-white">Logo</span>}{m.kind === 'video' && <span className="rounded-full bg-black/70 px-2 py-0.5 text-[11px] text-white">Video</span>}{!m.visible && <span className="rounded-full bg-black/70 px-2 py-0.5 text-[11px] text-white">Hidden</span>}</div></div>
              <div className="space-y-2 p-2.5">
                <input aria-label="Caption" defaultValue={m.caption ?? ''} placeholder="Caption (optional)" maxLength={120} className={`${input} !py-2 !text-[13px]`} onBlur={(e) => { if (e.target.value !== (m.caption ?? '')) void act(() => ownerApi.updateMedia(b.id, m.id, { caption: e.target.value })); }} />
                <div className="flex flex-wrap gap-1.5">
                  {m.kind === 'image' && b.coverId !== m.id && <button type="button" className={`${btnGhost} !min-h-9 !px-2.5 text-xs`} onClick={() => void act(() => ownerApi.update(b.id, { coverId: m.id }))}>Make cover</button>}
                  {m.kind === 'image' && b.logoId !== m.id && <button type="button" className={`${btnGhost} !min-h-9 !px-2.5 text-xs`} onClick={() => void act(() => ownerApi.update(b.id, { logoId: m.id }))}>Make logo</button>}
                  <button type="button" className={`${btnGhost} !min-h-9 !px-2.5 text-xs`} onClick={() => void act(() => ownerApi.updateMedia(b.id, m.id, { visible: !m.visible }))}>{m.visible ? 'Hide' : 'Show'}</button>
                  <button type="button" aria-label="Delete" className={`${btnGhost} !min-h-9 !px-2.5 text-rose-300`} onClick={() => { if (confirm('Delete this file for good?')) void act(() => ownerApi.removeMedia(b.id, m.id)); }}><Trash2 size={14} /></button>
                </div></div>
            </li>))}</ul>)}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ messages */
function MessagesTab({ b, onChange }: { b: Business; onChange: () => void }) {
  const [list, setList] = useState<Enquiry[] | null>(null); const [err, setErr] = useState('');
  const load = useCallback(() => { ownerApi.enquiries(b.id).then(setList).catch((e) => setErr(msg(e))); }, [b.id]);
  useEffect(load, [load]);
  const set = async (e: Enquiry, status: Enquiry['status']) => { try { await ownerApi.setEnquiry(b.id, e.id, status); load(); onChange(); } catch (x) { setErr(msg(x)); } };
  const reach = (c: string) => (c.includes('@') ? { href: `mailto:${c}`, label: c } : { href: `https://wa.me/${c}`, label: `+${c}` });
  return (
    <div className="space-y-5"><div className={card}><Title kind="private" hint="Messages sent from your page's form. Only you see them. Reply by WhatsApp or email.">Messages from visitors</Title>
      {err && <p role="alert" className="mb-3 text-sm text-rose-300">{err}</p>}
      {!list ? <Loader2 className="animate-spin text-[var(--brand)]" /> : !list.length ? <p className="text-sm text-[var(--app-muted)]">No messages yet. Share your link to get customers writing to you.</p> : (
        <ul className="space-y-3">{list.map((e) => { const r = reach(e.contact); const p = b.products.find((x) => x.id === e.productId); return (
          <li key={e.id} className={`rounded-xl border p-4 ${e.status === 'new' ? 'border-[var(--brand)]/60 bg-[var(--brand)]/5' : 'border-[var(--app-line)]'}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2"><p className="font-semibold">{e.name}{e.status === 'new' && <span className="ml-2 rounded-full bg-[var(--brand)] px-2 py-0.5 text-[11px] font-semibold text-[var(--brand-on)]">New</span>}</p><time className="text-xs text-[var(--app-faint)]">{new Date(e.at).toLocaleString()}</time></div>
            {p && <p className="text-xs text-[var(--app-muted)]">About: {p.name}</p>}
            <p className="mt-2 whitespace-pre-wrap text-[15px]">{e.message}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2"><a className={btnGhost} href={r.href} target="_blank" rel="noreferrer"><MessageCircle size={15} />{r.label}</a>
              {e.status !== 'done' && <button type="button" className={btnGhost} onClick={() => void set(e, 'done')}><Check size={15} />Mark done</button>}{e.status === 'new' && <button type="button" className={btnGhost} onClick={() => void set(e, 'seen')}>Mark seen</button>}</div>
          </li>); })}</ul>)}
    </div></div>
  );
}

/* ------------------------------------------------------------------ preview, settings, notebook */
function PreviewTab({ b, urls }: { b: Business; urls: Record<string, string> }) {
  const [p, setP] = useState<{ business: PublicBusiness; openNow: boolean | null } | null>(null); const [err, setErr] = useState('');
  useEffect(() => { ownerApi.preview(b.id).then(setP).catch((e) => setErr(msg(e))); }, [b.id, b.updatedAt]);
  return <div><Title kind="public" hint="Exactly what visitors see, also before you publish. Phone-size on a phone, wide on a computer.">Preview</Title>{err && <p role="alert" className="text-sm text-rose-300">{err}</p>}{!p ? <Loader2 className="animate-spin text-[var(--brand)]" /> : <div className="overflow-hidden rounded-2xl border border-[var(--app-line)]"><BizPage business={p.business} openNow={p.openNow} mediaSrc={(id) => urls[id] ?? ''} preview /></div>}</div>;
}
function SettingsTab({ b, onChange, onDeleted }: { b: Business; onChange: () => void; onDeleted: () => void }) {
  const [slug, setSlug] = useState(b.slug); const [notes, setNotes] = useState(b.notes); const [busy, setBusy] = useState(''); const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null); const [confirm, setConfirm] = useState('');
  useEffect(() => { setSlug(b.slug); setNotes(b.notes); }, [b.slug, b.notes]);
  const run = async (k: string, fn: () => Promise<unknown>, ok: string) => { setBusy(k); setNote(null); try { await fn(); setNote({ ok: true, text: ok }); onChange(); } catch (e) { setNote({ ok: false, text: msg(e) }); } finally { setBusy(''); } };
  return (
    <div className="space-y-5">
      <div className={card}><Title kind="public">Page name (your short link)</Title>
        <div className="flex flex-wrap items-center gap-2"><span className="text-sm text-[var(--app-muted)]">bwenge.space/b/</span><input className={`${input} !w-64 font-mono`} value={slug} maxLength={32} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} /><button type="button" className={btnPrimary} disabled={slug === b.slug || busy === 'slug'} onClick={() => void run('slug', () => ownerApi.update(b.id, { slug }), 'Page name changed.')}>Change</button></div>
        <p className="mt-2 text-xs text-[var(--app-faint)]">3 to 32 letters, numbers and dashes. If you change it, links you already shared stop working.</p></div>
      <div className={card}><Title kind="private" hint="For you: suppliers, ideas, reminders. Never shown on your page.">Private notes</Title>
        <textarea className={input} rows={5} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} /><button type="button" className={`${btnGhost} mt-3`} disabled={notes === b.notes || busy === 'notes'} onClick={() => void run('notes', () => ownerApi.update(b.id, { notes }), 'Notes saved.')}>Save notes</button></div>
      {note && <p role="status" className={`text-sm ${note.ok ? 'text-emerald-300' : 'text-rose-300'}`}>{note.text}</p>}
      <div className={`${card} border-rose-500/30`}><Title kind="private">Delete this business page</Title><p className="text-sm text-[var(--app-muted)]">This removes the page, its link, all photos and videos and all messages. It cannot be undone. Type <b>{b.name}</b> to confirm.</p>
        <div className="mt-3 flex flex-wrap gap-2"><input className={`${input} !w-64`} value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-label="Type the business name to confirm" /><button type="button" disabled={confirm.trim() !== b.name || busy === 'del'} className={`${btn} bg-rose-500 text-white`} onClick={() => void run('del', async () => { await ownerApi.remove(b.id); onDeleted(); }, 'Deleted.')}>Delete for good</button></div></div>
    </div>
  );
}
function NotebookTab() {
  return <div className={card}><Title kind="private">Notebook</Title><p className="max-w-xl text-[15px] leading-relaxed text-[var(--app-muted)]">Coming next: tell the assistant “today I made 45,000 and bought flour for 8,000”, or photograph your sales book, and Bwenge writes it into a private notebook with daily and weekly totals. Nothing in it is ever shown on your public page.</p></div>;
}

/* ------------------------------------------------------------------ the page */
export default function BizStudioPage({ onBack }: { onBack: () => void }) {
  const [mine, setMine] = useState<Mine | null>(null); const [error, setError] = useState(''); const [sel, setSel] = useState(''); const [tab, setTab] = useState<Tab>('overview'); const [urls, setUrls] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState({ name: '', category: 'shop' }); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { try { const m = await ownerApi.mine(); setMine(m); setSel((s) => (m.businesses.some((b) => b.id === s) ? s : m.businesses[0]?.id ?? '')); } catch (e) { setError(msg(e)); } }, []);
  useEffect(() => { document.title = 'My business · Bwenge'; void load(); }, [load]);
  const b = mine?.businesses.find((x) => x.id === sel) ?? null;
  useEffect(() => { if (b) void ownerApi.mediaUrls(b.id).then(setUrls).catch(() => undefined); else setUrls({}); }, [b?.id, b?.updatedAt]);   // eslint-disable-line react-hooks/exhaustive-deps
  const create = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); setError(''); try { const r = await ownerApi.create(creating); await load(); setSel(r.business.id); setTab('page'); } catch (x) { setError(msg(x)); } finally { setBusy(false); } };

  if (!mine && !error) return <div className="flex min-h-[100dvh] items-center justify-center bg-[var(--app-bg)]"><Loader2 className="animate-spin text-[var(--brand)]" /></div>;
  return (
    <div className="h-[100dvh] overflow-y-auto bg-[var(--app-bg)] text-[var(--app-text)]">
      <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-5 sm:px-6">
        <button type="button" onClick={onBack} className="mb-5 inline-flex items-center gap-2 text-sm text-[var(--app-muted)] hover:text-[var(--app-text)]"><ArrowLeft size={15} />Back to Bwenge</button>
        <header className="mb-6"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--brand)]">Bwenge4biz</p><h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">{b ? b.name : 'Your business page'}</h1>
          {mine && mine.businesses.length > 1 && <select aria-label="Choose business" className={`${input} mt-3 !w-auto`} value={sel} onChange={(e) => { setSel(e.target.value); setTab('overview'); }}>{mine.businesses.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>}</header>
        {error && <p role="alert" className="mb-4 rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</p>}

        {mine && !b && (
          <form onSubmit={create} className={`${card} max-w-xl`}><h2 className="font-display text-2xl font-semibold">Give your business a page</h2>
            <p className="mt-2 text-[15px] text-[var(--app-muted)]">Customers get one short link to your products, photos, hours and WhatsApp. It stays private until you publish it.</p>
            <label className="mt-5 block text-sm"><span className="mb-1.5 block text-[var(--app-muted)]">Business name</span><input autoFocus className={input} value={creating.name} maxLength={60} placeholder="Mama Grace Café" onChange={(e) => setCreating({ ...creating, name: e.target.value })} /></label>
            <label className="mt-4 block text-sm"><span className="mb-1.5 block text-[var(--app-muted)]">Kind of business</span><select className={input} value={creating.category} onChange={(e) => setCreating({ ...creating, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
            <button type="submit" disabled={!creating.name.trim() || busy} className={`${btnPrimary} mt-5`}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}Create my page</button>
            <p className="mt-4 text-xs text-[var(--app-faint)]">Or just tell the Bwenge assistant: “make a page for my shop”.</p></form>
        )}

        {b && mine && (<>
          <nav aria-label="Studio" className="-mx-4 mb-6 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
            {TABS.map((t) => { const Icon = t.icon; const on = tab === t.id; return (
              <button key={t.id} type="button" aria-current={on ? 'page' : undefined} onClick={() => setTab(t.id)} className={`flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors ${on ? 'bg-[var(--brand)] text-[var(--brand-on)]' : 'text-[var(--app-muted)] hover:bg-[var(--app-panel)] hover:text-[var(--app-text)]'}`}>
                <Icon size={16} />{t.label}{t.kind === 'private' && !on && <Lock size={11} className="opacity-60" />}</button>); })}
          </nav>
          {tab === 'overview' && <Overview b={b} go={setTab} onChange={() => void load()} urlBase={window.location.origin} />}
          {tab === 'page' && <PageTab b={b} onChange={() => void load()} />}
          {tab === 'products' && <ProductsTab b={b} urls={urls} onChange={() => void load()} />}
          {tab === 'gallery' && <GalleryTab b={b} urls={urls} onChange={() => void load()} limits={mine.limits} />}
          {tab === 'messages' && <MessagesTab b={b} onChange={() => void load()} />}
          {tab === 'preview' && <PreviewTab b={b} urls={urls} />}
          {tab === 'settings' && <SettingsTab b={b} onChange={() => void load()} onDeleted={() => { setTab('overview'); void load(); }} />}
          {tab === 'notebook' && <NotebookTab />}
          <p className="mt-10 text-center text-xs text-[var(--app-faint)]">{mine.plan} plan · {mine.limits.businesses} business page{mine.limits.businesses === 1 ? '' : 's'}, {mine.limits.products} products</p>
        </>)}
      </div>
    </div>
  );
}
