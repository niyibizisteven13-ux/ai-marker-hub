import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Table2, Megaphone, MapPin, Sparkles, Bot, ArrowLeft, BarChart3, Check, ExternalLink, Eye, EyeOff, Film, Globe, ImagePlus, Inbox, KeyRound, LayoutDashboard, Loader2, MessageCircle, MoreHorizontal, Package, Palette, Plus, Receipt, Settings, ShoppingBag, Store, Trash2, Upload, Users } from 'lucide-react';
import BizPage from '../components/biz/BizPage';
import MapTile, { parseCoords } from '../components/biz/MapTile';
import { SectionsEditor, TrackersView, CostsView, FeedView, LockedGate, AgentChatView, AgentView, DashboardView, NotebookView, CustomersView, ReportsView, SecretsView, EntrySheet, type EntryKind } from '../components/biz/Workspace';
import { btn, btnGhost, btnPrimary, card, input, msg, PaidNote, Tag, Title } from '../components/biz/ui';
import { BizApiError, ownerApi, prepareImage, type Mine } from '../biz/api';
import { CATEGORIES, DAYS, THEMES, rwf, type Business, type Enquiry, type Hours, type PublicBusiness, type SecretsStatus } from '../biz/types';

/**
 * The owner's studio (/biz). Public tabs change what visitors see; private tabs (Overview numbers, Messages, Settings, Notebook) are only ever shown here.
 * Everything the owner can do here the Bwenge assistant can also do by chat.
 */
/* ------------------------------------------------------------------ page */
function LocationEditor({ lat, lng, onChange }: { lat: string; lng: string; onChange: (lat: string, lng: string) => void }) {
  const [paste, setPaste] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const la = Number(lat), lo = Number(lng); const has = lat !== '' && lng !== '' && Number.isFinite(la) && Number.isFinite(lo);
  const here = () => { setNote(''); if (!navigator.geolocation) return setNote('This device cannot share its location. Paste a Google Maps link instead.'); setBusy(true); navigator.geolocation.getCurrentPosition((p) => { onChange(String(Math.round(p.coords.latitude * 1e6) / 1e6), String(Math.round(p.coords.longitude * 1e6) / 1e6)); setBusy(false); setNote(`Location found (about ${Math.round(p.coords.accuracy)} m accurate). Press Save changes.`); }, (e) => { setBusy(false); setNote(e.code === 1 ? 'Location is blocked. Allow it in your browser, or paste a Google Maps link.' : 'Could not find your location. Try outside, or paste a link.'); }, { enableHighAccuracy: true, timeout: 15000 }); };
  const apply = (text: string) => { setPaste(text); const c = parseCoords(text); if (c) { onChange(String(c.lat), String(c.lng)); setNote('Location read from the link. Press Save changes.'); } else if (text.trim()) setNote(/goo\.gl|maps\.app/.test(text) ? 'Short links hide the place. Open the link, copy the long address from the browser bar, or press “Use my current location”.' : 'No coordinates found in that.'); };
  return (
    <div className="space-y-3">
      {has && <div className="overflow-hidden rounded-2xl border border-[var(--app-line)]"><MapTile lat={la} lng={lo} height={180} /></div>}
      <div className="flex flex-wrap gap-2"><button type="button" className={btnPrimary} disabled={busy} onClick={here}>{busy ? <Loader2 size={16} className="animate-spin" /> : <MapPin size={16} />}Use my current location</button>{has && <button type="button" className={btnGhost} onClick={() => { onChange('', ''); setNote('Location removed. Press Save changes.'); }}>Remove</button>}</div>
      <input className={input} value={paste} placeholder="Or paste a Google Maps link, or coordinates like -1.9441, 30.0619" aria-label="Google Maps link or coordinates" onChange={(e) => apply(e.target.value)} />
      <div className="grid grid-cols-2 gap-3"><label className="block text-sm"><span className="mb-1 block text-[var(--app-muted)]">Latitude</span><input className={`${input} font-mono`} inputMode="decimal" value={lat} onChange={(e) => onChange(e.target.value, lng)} /></label><label className="block text-sm"><span className="mb-1 block text-[var(--app-muted)]">Longitude</span><input className={`${input} font-mono`} inputMode="decimal" value={lng} onChange={(e) => onChange(lat, e.target.value)} /></label></div>
      {note && <p role="status" className="text-sm text-[var(--app-muted)]">{note}</p>}
    </div>
  );
}

function LanguageCard({ b, onChange, onAsk }: { b: Business; onChange: () => void; onAsk: () => void }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const rw = b.translations?.rw; const done = rw ? [rw.tagline && 'tagline', rw.about && 'about', rw.products && `${Object.keys(rw.products).length} products`, rw.sections && `${Object.keys(rw.sections).length} sections`, rw.posts && `${Object.keys(rw.posts).length} posts`].filter(Boolean) : [];
  const set = async (l: 'en' | 'rw') => { setBusy(true); setErr(''); try { await ownerApi.setLang(b.id, l); onChange(); } catch (e) { setErr(msg(e)); } finally { setBusy(false); } };
  return (
    <div className={card}><Title kind="public" hint="Visitors can switch between English and Kinyarwanda at the top of your page. The labels are translated for you; your own words (description, products, posts) are translated by the agent.">Language</Title>
      <div className="flex flex-wrap items-center gap-3"><span className="text-sm text-[var(--app-muted)]">Page opens in</span><div className="inline-flex rounded-xl bg-[var(--app-bg)] p-1" role="group">{(['en', 'rw'] as const).map((l) => <button key={l} type="button" disabled={busy} aria-pressed={(b.lang ?? 'en') === l} onClick={() => void set(l)} className={`rounded-lg px-4 py-2 text-sm font-semibold ${(b.lang ?? 'en') === l ? 'bg-[var(--brand)] text-[var(--brand-on)]' : 'text-[var(--app-muted)]'}`}>{l === 'en' ? 'English' : 'Kinyarwanda'}</button>)}</div></div>
      <p className="mt-3 text-sm text-[var(--app-muted)]">Kinyarwanda version: {done.length ? <b className="text-[var(--app-text)]">{done.join(', ')}</b> : 'not made yet'}.</p>
      <button type="button" className={`${btnGhost} mt-3`} onClick={() => { try { sessionStorage.setItem(`bz-seed-${b.id}`, 'Translate my business page into Kinyarwanda: the tagline, description, products and my sections.'); } catch { /* optional */ } onAsk(); }}><Sparkles size={15} />{done.length ? 'Update the translation with the agent' : 'Translate my page into Kinyarwanda'}</button>
      {err && <p role="alert" className="mt-2 text-sm text-rose-600">{err}</p>}</div>
  );
}

function PageTab({ b, onChange }: { b: Business; onChange: () => void }) {
  const init = useMemo(() => ({ name: b.name, category: b.category, theme: b.theme, tagline: b.tagline, about: b.about, whatsapp: b.whatsapp ?? '', phone: b.phone ?? '', email: b.email ?? '', address: b.address ?? '', mapUrl: b.mapUrl ?? '', lat: b.lat === undefined ? '' : String(b.lat), lng: b.lng === undefined ? '' : String(b.lng), website: b.website ?? '', instagram: b.instagram ?? '', facebook: b.facebook ?? '', momoCode: b.momoCode ?? '', momoName: b.momoName ?? '', showPay: b.showPay }), [b]);
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
      <div className={card}><Title kind="public" hint="Visitors see a small map with a Directions button. Stand at your shop and press the button, or paste a Google Maps link.">Location on the map</Title>
        <LocationEditor lat={f.lat} lng={f.lng} onChange={(la, lo) => setF((x) => ({ ...x, lat: la, lng: lo }))} /></div>
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
        <span className="text-sm text-[var(--app-muted)]">{dirty ? 'You have changes that are not saved.' : note?.ok ? 'Saved.' : 'Everything is saved.'}</span>{note && !note.ok && <span role="alert" className="text-sm text-rose-600">{note.text}</span>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ products */
function ProductsTab({ b, urls, onChange }: { b: Business; urls: Record<string, string>; onChange: () => void }) {
  const [draft, setDraft] = useState({ name: '', price: '', unit: '', description: '', mediaId: '', stock: '' }); const [busy, setBusy] = useState(''); const [err, setErr] = useState('');
  const photos = b.media.filter((m) => m.kind === 'image');
  const run = async (key: string, fn: () => Promise<unknown>) => { setBusy(key); setErr(''); try { await fn(); onChange(); } catch (e) { setErr(msg(e)); } finally { setBusy(''); } };
  const add = (e: React.FormEvent) => { e.preventDefault(); if (!draft.name.trim()) return; void run('add', async () => { await ownerApi.addProduct(b.id, { name: draft.name, price: draft.price === '' ? null : Number(draft.price.replace(/[,\s]/g, '')), unit: draft.unit, description: draft.description, ...(draft.mediaId ? { mediaId: draft.mediaId } : {}), ...(draft.stock !== '' ? { stock: Number(draft.stock) } : {}) }); setDraft({ name: '', price: '', unit: '', description: '', mediaId: '', stock: '' }); }); };
  return (
    <div className="space-y-5">
      <form onSubmit={add} className={card}><Title kind="public" hint="Price in whole RWF. Leave it empty to show “Ask for price”.">Add a product</Title>
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
          <input className={input} aria-label="Product name" placeholder="Name, for example Tomatoes" maxLength={80} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <input className={input} aria-label="Price in RWF" placeholder="Price (RWF)" inputMode="numeric" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value.replace(/[^\d,\s]/g, '') })} />
          <input className={input} aria-label="Unit" placeholder="per kg, per cup…" maxLength={20} value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} />
        </div>
        <input className={`${input} mt-3`} aria-label="Stock count" inputMode="decimal" placeholder="In stock now (optional, private: gives low-stock alerts)" value={draft.stock} onChange={(e) => setDraft({ ...draft, stock: e.target.value.replace(/[^\d.]/g, '') })} />
        <input className={`${input} mt-3`} aria-label="Short description" placeholder="Short description (optional)" maxLength={400} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
        {photos.length > 0 && <div className="mt-3"><p className="mb-1.5 text-sm text-[var(--app-muted)]">Photo (optional)</p><div className="flex gap-2 overflow-x-auto pb-1">{photos.map((m) => <button key={m.id} type="button" aria-pressed={draft.mediaId === m.id} onClick={() => setDraft({ ...draft, mediaId: draft.mediaId === m.id ? '' : m.id })} className={`h-16 w-16 shrink-0 overflow-hidden rounded-xl border-2 ${draft.mediaId === m.id ? 'border-[var(--brand)]' : 'border-transparent'}`}>{urls[m.id] ? <img src={urls[m.id]} alt={m.caption || m.name} className="h-full w-full object-cover" /> : null}</button>)}</div></div>}
        <button type="submit" disabled={!draft.name.trim() || busy === 'add'} className={`${btnPrimary} mt-4`}>{busy === 'add' ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}Add product</button>
      </form>
      {err && <p role="alert" className="rounded-xl bg-rose-500/10 px-4 py-2.5 text-sm text-rose-600">{err}</p>}
      <div className={card}><Title kind="public">Your products ({b.products.length})</Title>
        {!b.products.length ? <p className="text-sm text-[var(--app-muted)]">No products yet. Add your first one above, or tell the assistant: “add tomatoes 1,200 per kg”.</p> : (
          <ul className="divide-y divide-[var(--app-line)]">{b.products.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-[var(--app-bg)]">{p.mediaId && urls[p.mediaId] ? <img src={urls[p.mediaId]} alt="" className="h-full w-full object-cover" /> : <Package className="m-3 text-[var(--app-faint)]" size={24} />}</div>
              <div className="min-w-0 flex-1"><p className="truncate font-medium">{p.name}{p.hidden && <span className="ml-2 rounded-full bg-[var(--app-panel-hover)] px-2 py-0.5 text-[11px] font-normal text-[var(--app-muted)]">Hidden</span>}</p><p className="text-sm text-[var(--app-muted)]">{rwf(p.price)}{p.unit && p.price !== null ? ` / ${p.unit}` : ''}{!p.available && ' · out of stock'}{typeof p.stock === 'number' && p.stock <= (p.lowAt ?? 5) && p.available ? ' · low stock' : ''}</p></div>
              <label className="flex items-center gap-1.5 text-xs text-[var(--app-muted)]">Stock<input aria-label={`Stock of ${p.name}`} defaultValue={p.stock ?? ''} placeholder="–" inputMode="decimal" className={`${input} !w-20`} onBlur={(e) => { const v = e.target.value.trim(); if (v !== String(p.stock ?? '')) void run(p.id, () => ownerApi.updateProduct(b.id, p.id, { stock: v === '' ? null : Number(v) } as any)); }} /></label>
              <input aria-label={`Price of ${p.name}`} defaultValue={p.price ?? ''} inputMode="numeric" className={`${input} !w-28`} onBlur={(e) => { const v = e.target.value.replace(/[,\s]/g, ''); if (v !== String(p.price ?? '')) void run(p.id, () => ownerApi.updateProduct(b.id, p.id, { price: v === '' ? null : Number(v) })); }} />
              <button type="button" className={btnGhost} onClick={() => void run(p.id, () => ownerApi.updateProduct(b.id, p.id, { available: !p.available }))}>{p.available ? 'Mark out of stock' : 'Back in stock'}</button>
              <button type="button" className={btnGhost} aria-label={p.hidden ? `Show ${p.name}` : `Hide ${p.name}`} onClick={() => void run(p.id, () => ownerApi.updateProduct(b.id, p.id, { hidden: !p.hidden }))}>{p.hidden ? <Eye size={16} /> : <EyeOff size={16} />}</button>
              <button type="button" className={`${btnGhost} text-rose-600`} aria-label={`Delete ${p.name}`} onClick={() => { if (confirm(`Delete ${p.name}?`)) void run(p.id, () => ownerApi.removeProduct(b.id, p.id)); }}><Trash2 size={16} /></button>
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
      const isVideo = file.type.startsWith('video/'); if (isVideo && limits.videos === 0) { setErr('Videos are for paid plans. Photos are free. See plans to add videos.'); continue; } if (isVideo && file.size > 25 * 1048576) { setErr(`${file.name} is ${(file.size / 1048576).toFixed(0)} MB. A video can be up to 25 MB: record a shorter clip.`); continue; }
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
      <div className={card}><Title kind="public" hint={limits.videos > 0 ? `Photos up to 6 MB, short videos up to 25 MB (about 30 seconds). ${images}/${limits.images} photos, ${videos}/${limits.videos} videos, ${(used / 1048576).toFixed(0)} of ${limits.totalMediaMb} MB used.` : `Photos up to 6 MB. ${images}/${limits.images} photos, ${(used / 1048576).toFixed(0)} of ${limits.totalMediaMb} MB used.`}>{limits.videos > 0 ? 'Add photos and videos' : 'Add photos'}</Title>
        {limits.videos === 0 && <div className="mb-3"><PaidNote what="Videos" /></div>}
        <input ref={fileRef} type="file" multiple accept={limits.videos > 0 ? 'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm' : 'image/jpeg,image/png,image/webp,image/gif'} className="sr-only" id="biz-upload" onChange={(e) => void upload(e.target.files)} />
        <label htmlFor="biz-upload" className={`${btnPrimary} cursor-pointer`}><Upload size={16} />{limits.videos > 0 ? 'Choose photos or videos' : 'Choose photos'}</label>
        <p className="mt-2 text-xs text-[var(--app-faint)]">Big photos are shrunk on your phone before sending. iPhone photos in HEIC format are not accepted: use “Most Compatible” in the camera settings, or take a screenshot.</p>
        {jobs.map((j: any) => <div key={j._id} className="mt-3 text-sm"><div className="flex justify-between"><span className="truncate">{j.name}</span><span className={j.error ? 'text-rose-600' : 'text-[var(--app-muted)]'}>{j.error ? 'Failed' : `${Math.round(j.progress * 100)}%`}</span></div>{j.error ? <p role="alert" className="text-xs text-rose-600">{j.error}</p> : <div className="mt-1 h-1.5 rounded bg-[var(--app-bg)]"><div className="h-1.5 rounded bg-[var(--brand)]" style={{ width: `${j.progress * 100}%` }} /></div>}</div>)}
        {err && <p role="alert" className="mt-3 text-sm text-rose-600">{err}</p>}
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
                  <button type="button" aria-label="Delete" className={`${btnGhost} !min-h-9 !px-2.5 text-rose-600`} onClick={() => { if (confirm('Delete this file for good?')) void act(() => ownerApi.removeMedia(b.id, m.id)); }}><Trash2 size={14} /></button>
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
      {err && <p role="alert" className="mb-3 text-sm text-rose-600">{err}</p>}
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
  return <div><Title kind="public" hint="Exactly what visitors see, also before you publish. Phone-size on a phone, wide on a computer.">Preview</Title>{err && <p role="alert" className="text-sm text-rose-600">{err}</p>}{!p ? <Loader2 className="animate-spin text-[var(--brand)]" /> : <div className="overflow-hidden rounded-2xl border border-[var(--app-line)]"><BizPage business={p.business} openNow={p.openNow} mediaSrc={(id) => urls[id] ?? ''} preview /></div>}</div>;
}
function SettingsTab({ b, onChange, onDeleted }: { b: Business; onChange: () => void; onDeleted: () => void }) {
  const [slug, setSlug] = useState(b.slug); const [notes, setNotes] = useState(b.notes); const [busy, setBusy] = useState(''); const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null); const [confirm, setConfirm] = useState('');
  useEffect(() => { setSlug(b.slug); setNotes(b.notes); }, [b.slug, b.notes]);
  const run = async (k: string, fn: () => Promise<unknown>, ok: string) => { setBusy(k); setNote(null); try { await fn(); setNote({ ok: true, text: ok }); onChange(); } catch (e) { setNote({ ok: false, text: msg(e) }); } finally { setBusy(''); } };
  return (
    <div className="space-y-5">
      <div className={card}><Title kind="public">Page name (your short link)</Title>
        <div className="flex flex-wrap items-center gap-2"><span className="text-sm text-[var(--app-muted)]">{window.location.host}/b/</span><input className={`${input} !w-64 font-mono`} value={slug} maxLength={32} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} /><button type="button" className={btnPrimary} disabled={slug === b.slug || busy === 'slug'} onClick={() => void run('slug', () => ownerApi.update(b.id, { slug }), 'Page name changed.')}>Change</button></div>
        <p className="mt-2 text-xs text-[var(--app-faint)]">3 to 32 letters, numbers and dashes. If you change it, links you already shared stop working.</p></div>
      <div className={card}><Title kind="private" hint="For you: suppliers, ideas, reminders. Never shown on your page.">Private notes</Title>
        <textarea className={input} rows={5} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} /><button type="button" className={`${btnGhost} mt-3`} disabled={notes === b.notes || busy === 'notes'} onClick={() => void run('notes', () => ownerApi.update(b.id, { notes }), 'Notes saved.')}>Save notes</button></div>
      {note && <p role="status" className={`text-sm ${note.ok ? 'text-emerald-700' : 'text-rose-600'}`}>{note.text}</p>}
      <div className={`${card} border-rose-500/30`}><Title kind="private">Delete this business page</Title><p className="text-sm text-[var(--app-muted)]">This removes the page, its link, all photos and videos and all messages. It cannot be undone. Type <b>{b.name}</b> to confirm.</p>
        <div className="mt-3 flex flex-wrap gap-2"><input className={`${input} !w-64`} value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-label="Type the business name to confirm" /><button type="button" disabled={confirm.trim() !== b.name || busy === 'del'} className={`${btn} bg-rose-500 text-white`} onClick={() => void run('del', async () => { await ownerApi.remove(b.id); onDeleted(); }, 'Deleted.')}>Delete for good</button></div></div>
    </div>
  );
}

/* ------------------------------------------------------------------ the workspace */
type View = 'trackers' | 'feed' | 'chat' | 'agent' | 'dashboard' | 'sales' | 'expenses' | 'products' | 'customers' | 'reports' | 'messages' | 'public' | 'secrets' | 'settings';
const NAV: Array<{ id: View; label: string; icon: typeof Globe; group?: string }> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard }, { id: 'chat', label: 'Ask the agent', icon: Sparkles }, { id: 'sales', label: 'Sales and orders', icon: ShoppingBag }, { id: 'expenses', label: 'Costs and spending', icon: Receipt },
  { id: 'products', label: 'Products and stock', icon: Package }, { id: 'customers', label: 'Customers', icon: Users }, { id: 'reports', label: 'Reports', icon: BarChart3 },
  { id: 'messages', label: 'Messages', icon: Inbox }, { id: 'public', label: 'Public page', icon: Globe }, { id: 'feed', label: 'Feed', icon: Megaphone }, { id: 'trackers', label: 'Trackers', icon: Table2 }, { id: 'agent', label: 'Business agent', icon: Bot }, { id: 'secrets', label: 'Secrets and payments', icon: KeyRound }, { id: 'settings', label: 'Settings', icon: Settings },
];
/** The studio opens in a light surface whatever the app theme is: the same tokens the screens use, redefined here. */
const LIGHT = { '--app-bg': '#F2F5FA', '--app-panel': '#FFFFFF', '--app-panel-hover': '#F1F4F9', '--app-line': '#E3E8F0', '--app-text': '#0E1722', '--app-muted': '#5B6776', '--app-faint': '#8A94A3' } as React.CSSProperties;

export default function BizStudioPage({ onBack }: { onBack: () => void }) {
  const [mine, setMine] = useState<Mine | null>(null); const [error, setError] = useState(''); const [sel, setSel] = useState(''); const [view, setView] = useState<View>(() => { const v = new URLSearchParams(window.location.search).get('view'); return (['trackers', 'feed', 'chat', 'agent', 'sales', 'expenses', 'products', 'customers', 'reports', 'messages', 'public', 'secrets', 'settings'] as string[]).includes(v ?? '') ? (v as View) : 'dashboard'; }); const [sub, setSub] = useState<'page' | 'gallery' | 'preview'>('page');
  const [urls, setUrls] = useState<Record<string, string>>({}); const [secrets, setSecrets] = useState<SecretsStatus | null>(null); const [sheet, setSheet] = useState<EntryKind | null>(null); const [more, setMore] = useState(false);
  const [creating, setCreating] = useState({ name: '', category: 'shop', whatsapp: '', lat: '', lng: '' }); const [busy, setBusy] = useState(false); const [tick, setTick] = useState(0);
  const load = useCallback(async () => { try { const m = await ownerApi.mine(); setMine(m); setSel((s) => (m.businesses.some((b) => b.id === s) ? s : m.businesses[0]?.id ?? '')); } catch (e) { setError(msg(e)); } }, []);
  useEffect(() => { document.title = 'Ventures · Bwenge'; void load(); }, [load]);
  const b = mine?.locked ? null : mine?.businesses.find((x) => x.id === sel) ?? null;
  useEffect(() => { if (b) void ownerApi.mediaUrls(b.id).then(setUrls).catch(() => undefined); else setUrls({}); }, [b?.id, b?.updatedAt]);   // eslint-disable-line react-hooks/exhaustive-deps
  const loadSecrets = useCallback(() => { if (b) void ownerApi.secrets(b.id).then(setSecrets).catch(() => undefined); }, [b?.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadSecrets(); }, [loadSecrets, b?.updatedAt]);
  const reload = () => { void load(); setTick((t) => t + 1); };
  const go = (v: string) => { setView(v as View); setMore(false); window.scrollTo?.(0, 0); };
  const create = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); setError(''); try { const r = await ownerApi.create({ name: creating.name, category: creating.category }); const extra: Record<string, unknown> = {}; if (creating.whatsapp.trim()) extra.whatsapp = creating.whatsapp; if (creating.lat && creating.lng) { extra.lat = creating.lat; extra.lng = creating.lng; } if (Object.keys(extra).length) await ownerApi.update(r.business.id, extra).catch(() => undefined); await load(); setSel(r.business.id); setView('dashboard'); } catch (x) { setError(msg(x)); } finally { setBusy(false); } };

  if (!mine && !error) return <div className="flex min-h-[100dvh] items-center justify-center bg-[#F2F5FA]"><Loader2 className="animate-spin text-[var(--brand)]" /></div>;
  const phoneNav: View[] = ['dashboard', 'chat', 'sales', 'products']; const item = (n: (typeof NAV)[number]) => NAV.find((x) => x.id === n.id)!;
  void item;
  return (
    <div style={LIGHT} className="flex h-[100dvh] bg-[var(--app-bg)] text-[var(--app-text)]">
      {/* sidebar (computers) */}
      <aside className="hidden w-64 shrink-0 flex-col bg-[#0B1424] p-4 text-white lg:flex">
        <button type="button" onClick={onBack} className="mb-5 flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-left hover:bg-white/5"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--brand)] text-[var(--brand-on)]"><Store size={18} /></span><span><span className="block font-display text-[15px] font-semibold leading-tight">Bwenge4biz</span><span className="block text-[11px] text-white/55">Small business hub</span></span></button>
        {mine && mine.businesses.length > 1 && <select aria-label="Choose business" className="mb-3 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white" value={sel} onChange={(e) => { setSel(e.target.value); setView('dashboard'); }}>{mine.businesses.map((x) => <option key={x.id} value={x.id} className="text-black">{x.name}</option>)}</select>}
        <nav aria-label="Business" className="flex-1 space-y-0.5 overflow-y-auto">{b && NAV.map((n) => { const Icon = n.icon; const on = view === n.id; return (
          <button key={n.id} type="button" aria-current={on ? 'page' : undefined} onClick={() => go(n.id)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] font-medium transition-colors ${on ? 'bg-[var(--brand)] text-[var(--brand-on)] shadow-sm' : 'text-white/70 hover:bg-white/8 hover:text-white'}`}><Icon size={17} aria-hidden="true" />{n.label}</button>); })}</nav>
        {mine && <div className="mt-3 rounded-2xl bg-white/5 p-3.5 text-xs"><p className="font-semibold text-white">{mine.plan} plan</p><p className="mt-0.5 text-white/55">{mine.limits.products} products · {mine.limits.images} photos · {mine.limits.videos} videos</p>{mine.plan === 'Free' && <a href="/upgrade" className="mt-2.5 block rounded-lg bg-[var(--brand)] px-3 py-2 text-center text-xs font-semibold text-[var(--brand-on)]">Upgrade</a>}</div>}
        <button type="button" onClick={onBack} className="mt-3 flex items-center gap-2 px-2 py-1 text-xs text-white/55 hover:text-white"><ArrowLeft size={13} />Back to Bwenge</button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* top bar */}
        <header className="flex items-center gap-3 border-b border-[var(--app-line)] bg-[var(--app-panel)] px-4 py-3 sm:px-6">
          <button type="button" onClick={onBack} aria-label="Back to Bwenge" className="flex h-10 w-10 items-center justify-center rounded-xl hover:bg-[var(--app-panel-hover)] lg:hidden"><ArrowLeft size={18} /></button>
          <div className="min-w-0 flex-1"><p className="truncate font-display text-[17px] font-semibold">{b?.name ?? 'Your business'}</p><p className="hidden text-xs text-[var(--app-muted)] sm:block">{b ? `${CATEGORIES.find((c) => c.id === b.category)?.label ?? 'Business'} · ${window.location.host}/b/${b.slug}` : 'Create your page'}</p></div>
          {b && <><button type="button" onClick={() => setSheet('sale')} className={`${btnPrimary} !min-h-10 !px-3.5`}><Plus size={16} /><span className="hidden sm:inline">New sale</span></button>
            <a href={b.published ? `/b/${b.slug}` : undefined} onClick={b.published ? undefined : (e) => { e.preventDefault(); go('public'); setSub('preview'); }} target={b.published ? '_blank' : undefined} rel="noreferrer" className={`${btnGhost} !min-h-10 !px-3.5`}><ExternalLink size={16} /><span className="hidden sm:inline">{b.published ? 'Open page' : 'Preview'}</span></a></>}
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-28 pt-5 sm:px-6 lg:pb-10">
          <div className="mx-auto w-full max-w-6xl">
            {error && <p role="alert" className="mb-4 rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-600">{error}</p>}
            {mine?.locked && <LockedGate mine={mine} onRefresh={() => void load()} />}
            {mine && !b && !mine.locked && (
              <form onSubmit={create} className={`${card} mx-auto max-w-xl`}><p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--brand-strong,var(--brand))]">Bwenge Ventures</p><h2 className="mt-1 font-display text-2xl font-semibold">Give your business a page and a notebook</h2>
                <p className="mt-2 text-[15px] text-[var(--app-muted)]">Customers get one short link to your products, photos, hours and WhatsApp. You get a private dashboard for sales, expenses and stock, and an assistant that writes it all down when you talk to it.</p>
                <label className="mt-5 block text-sm"><span className="mb-1.5 block text-[var(--app-muted)]">Business name</span><input autoFocus className={input} value={creating.name} maxLength={60} placeholder="Mama Grace Café" onChange={(e) => setCreating({ ...creating, name: e.target.value })} /></label>
                <label className="mt-4 block text-sm"><span className="mb-1.5 block text-[var(--app-muted)]">Kind of business</span><select className={input} value={creating.category} onChange={(e) => setCreating({ ...creating, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
                <label className="mt-4 block text-sm"><span className="mb-1.5 block text-[var(--app-muted)]">WhatsApp number customers will use (optional)</span><input className={input} inputMode="tel" value={creating.whatsapp} placeholder="0788 123 456" onChange={(e) => setCreating({ ...creating, whatsapp: e.target.value })} /></label>
                <div className="mt-4"><span className="mb-1.5 block text-sm text-[var(--app-muted)]">Where are you? (optional, shown as a map)</span><LocationEditor lat={creating.lat} lng={creating.lng} onChange={(la, lo) => setCreating((c) => ({ ...c, lat: la, lng: lo }))} /></div>
                <button type="submit" disabled={!creating.name.trim() || busy} className={`${btnPrimary} mt-5`}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}Create my page</button>
                <p className="mt-4 text-xs text-[var(--app-faint)]">Or just tell the Bwenge assistant: “make a page for my shop”.</p></form>)}

            {b && mine && (<>
              {view === 'dashboard' && <DashboardView key={tick} b={b} go={go} onChange={reload} secrets={secrets} open={setSheet} />}
              {view === 'sales' && <NotebookView key={tick} b={b} type="sale" open={setSheet} onChange={reload} />}
              {view === 'expenses' && <CostsView key={tick} b={b} open={setSheet} onChange={reload} />}
              {view === 'customers' && <CustomersView b={b} />}
              {view === 'reports' && <ReportsView b={b} />}
              {view === 'products' && <><h1 className="mb-4 font-display text-2xl font-semibold tracking-tight">Products and stock</h1><ProductsTab b={b} urls={urls} onChange={reload} /></>}
              {view === 'messages' && <><h1 className="mb-4 font-display text-2xl font-semibold tracking-tight">Messages</h1><MessagesTab b={b} onChange={reload} /></>}
              {view === 'trackers' && <TrackersView b={b} onChange={reload} />}
              {view === 'feed' && <FeedView b={b} onChange={reload} canVideo={mine.limits.videos > 0} />}
              {view === 'chat' && <AgentChatView b={b} onChange={reload} />}
              {view === 'agent' && <AgentView b={b} paid={mine.paid !== false} />}
              {view === 'secrets' && <SecretsView b={b} secrets={secrets} paid={mine.paid !== false} reload={() => { loadSecrets(); void load(); }} />}
              {view === 'settings' && <><h1 className="mb-4 font-display text-2xl font-semibold tracking-tight">Settings</h1><SettingsTab b={b} onChange={reload} onDeleted={() => { setView('dashboard'); void load(); }} /></>}
              {view === 'public' && (<>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h1 className="font-display text-2xl font-semibold tracking-tight">Public page</h1><Tag kind="public" /></div>
                  <div className="inline-flex rounded-xl border border-[var(--app-line)] bg-[var(--app-panel)] p-1" role="tablist">{([['page', 'Details'], ['gallery', 'Photos and videos'], ['preview', 'Preview']] as const).map(([id, l]) => <button key={id} type="button" role="tab" aria-selected={sub === id} onClick={() => setSub(id)} className={`rounded-lg px-3.5 py-2 text-sm font-semibold ${sub === id ? 'bg-[var(--brand)] text-[var(--brand-on)]' : 'text-[var(--app-muted)]'}`}>{l}</button>)}</div></div>
                {sub === 'page' && <><PageTab b={b} onChange={reload} /><div className="mt-5 space-y-5"><LanguageCard b={b} onChange={reload} onAsk={() => setView('chat')} /><SectionsEditor b={b} onChange={reload} /></div></>}
                {sub === 'gallery' && <GalleryTab b={b} urls={urls} onChange={reload} limits={mine.limits} />}
                {sub === 'preview' && <PreviewTab b={b} urls={urls} />}
              </>)}
            </>)}
          </div>
        </main>

        {/* bottom bar (phones) */}
        {b && <nav aria-label="Business" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-[var(--app-line)] bg-[var(--app-panel)]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
          {phoneNav.map((id) => { const n = NAV.find((x) => x.id === id)!; const Icon = n.icon; const on = view === id; return <button key={id} type="button" aria-current={on ? 'page' : undefined} onClick={() => go(id)} className={`flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium ${on ? 'text-[var(--brand-strong,var(--brand))]' : 'text-[var(--app-muted)]'}`}><Icon size={20} aria-hidden="true" />{n.label.split(' ')[0]}</button>; })}
          <button type="button" onClick={() => setMore(true)} className={`flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium ${!phoneNav.includes(view) ? 'text-[var(--brand-strong,var(--brand))]' : 'text-[var(--app-muted)]'}`}><MoreHorizontal size={20} aria-hidden="true" />More</button>
        </nav>}
        {more && b && <div className="fixed inset-0 z-[150] flex items-end bg-black/45 lg:hidden" onClick={() => setMore(false)}><div className="w-full rounded-t-3xl bg-[var(--app-panel)] p-4 pb-8" onClick={(e) => e.stopPropagation()}><div className="grid grid-cols-3 gap-3">{NAV.filter((n) => !phoneNav.includes(n.id)).map((n) => { const Icon = n.icon; return <button key={n.id} type="button" onClick={() => go(n.id)} className="flex flex-col items-center gap-2 rounded-2xl border border-[var(--app-line)] bg-[var(--app-bg)] px-2 py-4 text-center text-xs font-semibold"><Icon size={22} className="text-[var(--brand-strong,var(--brand))]" aria-hidden="true" />{n.label}</button>; })}</div></div></div>}
      </div>
      {sheet && b && <EntrySheet b={b} kind={sheet} secrets={secrets} onClose={() => setSheet(null)} onDone={reload} />}
    </div>
  );
}
