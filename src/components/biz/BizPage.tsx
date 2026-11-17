import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, Check, ChevronLeft, ChevronRight, Clock, Copy, Flag, Image as ImageIcon, Loader2, MapPin, MessageCircle, Phone, Play, Send, Share2, X } from 'lucide-react';
import { publicApi } from '../../biz/api';
import { DAYS, THEMES, pageUrl, rwf, CATEGORIES, type PublicBusiness, type PublicMedia } from '../../biz/types';

/**
 * A business's public page (bwenge4biz). Phone first: a cover, the name and the buttons people tap (WhatsApp, Call, Directions, Share), then the
 * products, the photos and videos, the hours and a message form. The same component is the preview in the owner's studio (`preview`: nothing is
 * counted or sent). The business picks the accent colour; everything else is Bwenge's own clean, light style so every page is easy to read.
 */
const SECTION = 'scroll-mt-20 border-t border-[#E7EAEE] px-5 py-7';
const H2 = 'font-display text-xl font-semibold tracking-tight text-[#0E1722]';
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || 'B';

function Lightbox({ items, index, src, onClose, onIndex }: { items: PublicMedia[]; index: number; src: (id: string) => string; onClose: () => void; onIndex: (i: number) => void }) {
  const m = items[index];
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); else if (e.key === 'ArrowRight') onIndex((index + 1) % items.length); else if (e.key === 'ArrowLeft') onIndex((index - 1 + items.length) % items.length); };
    window.addEventListener('keydown', key); const o = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', key); document.body.style.overflow = o; };
  }, [index, items.length, onClose, onIndex]);
  if (!m) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label="Photo viewer" className="fixed inset-0 z-[400] flex flex-col bg-black/95" onClick={onClose}>
      <div className="flex items-center justify-between px-4 py-3 text-white"><span className="text-sm text-white/70">{index + 1} / {items.length}</span><button type="button" aria-label="Close" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10"><X size={22} /></button></div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2" onClick={(e) => e.stopPropagation()}>
        {m.kind === 'video' ? <video key={m.id} src={src(m.id)} controls autoPlay playsInline className="max-h-full max-w-full rounded-lg" /> : <img key={m.id} src={src(m.id)} alt={m.caption || 'Photo'} className="max-h-full max-w-full rounded-lg object-contain" />}
        {items.length > 1 && <>
          <button type="button" aria-label="Previous" onClick={() => onIndex((index - 1 + items.length) % items.length)} className="absolute left-2 flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"><ChevronLeft /></button>
          <button type="button" aria-label="Next" onClick={() => onIndex((index + 1) % items.length)} className="absolute right-2 flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"><ChevronRight /></button>
        </>}
      </div>
      {m.caption && <p className="px-5 py-4 text-center text-sm text-white/85">{m.caption}</p>}
    </div>
  );
}

function MessageForm({ slug, preview, products }: { slug: string; preview: boolean; products: PublicBusiness['products'] }) {
  const [f, setF] = useState({ name: '', contact: '', message: '', productId: '', website: '' });
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle'); const [error, setError] = useState('');
  const field = 'w-full rounded-xl border border-[#D5DBE3] bg-white px-3.5 py-3 text-[15px] text-[#0E1722] outline-none placeholder:text-[#8793A3] focus:border-[var(--acc)] focus:ring-2 focus:ring-[var(--acc)]/25';
  const send = async (e: React.FormEvent) => {
    e.preventDefault(); if (preview || state === 'sending') return; setState('sending'); setError('');
    try { await publicApi.enquiry(slug, { name: f.name, contact: f.contact, message: f.message, ...(f.productId ? { productId: f.productId } : {}), website: f.website }); setState('done'); }
    catch (x) { setError(x instanceof Error ? x.message : 'Your message could not be sent.'); setState('idle'); }
  };
  if (state === 'done') return <p role="status" className="flex items-center gap-2 rounded-xl bg-[#E8F6EE] px-4 py-3.5 text-[15px] text-[#14532D]"><Check size={18} />Message sent. The business will reply to you.</p>;
  return (
    <form onSubmit={send} className="space-y-3" noValidate>
      <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Your name" aria-label="Your name" maxLength={60} className={field} autoComplete="name" />
      <input value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} placeholder="Your phone number or email" aria-label="Your phone number or email" maxLength={120} className={field} autoComplete="tel" inputMode="tel" />
      {products.length > 0 && <select value={f.productId} onChange={(e) => setF({ ...f, productId: e.target.value })} aria-label="About which product" className={field}><option value="">About: anything</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
      <textarea value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} placeholder="What would you like to ask or order?" aria-label="Your message" rows={4} maxLength={800} className={field} />
      <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', height: 0, overflow: 'hidden' }}><label>Website<input tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} /></label></div>
      {error && <p role="alert" className="rounded-lg bg-[#FEECEC] px-3 py-2 text-sm text-[#9B1C1C]">{error}</p>}
      <button type="submit" disabled={preview || state === 'sending' || !f.message.trim()} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--acc)] px-5 text-[15px] font-semibold text-[var(--on)] disabled:opacity-50">{state === 'sending' ? <Loader2 size={18} className="animate-spin" /> : <Send size={17} />}{preview ? 'Send message (preview)' : 'Send message'}</button>
    </form>
  );
}

function ReportDialog({ slug, onClose }: { slug: string; onClose: () => void }) {
  const [reason, setReason] = useState('scam'); const [detail, setDetail] = useState(''); const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle'); const [error, setError] = useState('');
  const send = async () => { setState('sending'); setError(''); try { await publicApi.report(slug, { reason, detail }); setState('done'); } catch (e) { setError(e instanceof Error ? e.message : 'Could not send the report.'); setState('idle'); } };
  return (
    <div role="dialog" aria-modal="true" aria-label="Report this page" className="fixed inset-0 z-[400] flex items-end justify-center bg-black/50 p-4 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 text-[#0E1722] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display text-lg font-semibold">Report this page</h3>
        {state === 'done' ? <p className="mt-3 text-[15px] text-[#14532D]">Thank you. Bwenge will look at this page.</p> : <>
          <p className="mt-1 text-sm text-[#5B6776]">Tell us what is wrong. We do not share your report with the business.</p>
          <select value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason" className="mt-3 w-full rounded-xl border border-[#D5DBE3] px-3 py-3 text-[15px]"><option value="scam">It looks like a scam</option><option value="illegal">It sells something illegal</option><option value="offensive">It is offensive</option><option value="copied">It copies someone else</option><option value="other">Something else</option></select>
          <textarea value={detail} onChange={(e) => setDetail(e.target.value)} rows={3} maxLength={400} placeholder="More detail (optional)" aria-label="More detail" className="mt-3 w-full rounded-xl border border-[#D5DBE3] px-3 py-3 text-[15px]" />
          {error && <p role="alert" className="mt-2 text-sm text-[#9B1C1C]">{error}</p>}
        </>}
        <div className="mt-4 flex justify-end gap-2"><button type="button" onClick={onClose} className="min-h-11 rounded-xl px-4 text-sm text-[#5B6776] hover:bg-[#F0F2F5]">{state === 'done' ? 'Close' : 'Cancel'}</button>{state !== 'done' && <button type="button" onClick={() => void send()} disabled={state === 'sending'} className="min-h-11 rounded-xl bg-[#0E1722] px-5 text-sm font-semibold text-white disabled:opacity-60">Send report</button>}</div>
      </div>
    </div>
  );
}

export default function BizPage({ business: b, openNow, mediaSrc, preview = false }: { business: PublicBusiness; openNow: boolean | null; mediaSrc: (id: string) => string; preview?: boolean }) {
  const theme = THEMES[b.theme] ?? THEMES.gold;
  const [box, setBox] = useState<number | null>(null); const [report, setReport] = useState(false); const [toast, setToast] = useState('');
  const toastTimer = useRef<number | undefined>(undefined);
  const say = (t: string) => { setToast(t); window.clearTimeout(toastTimer.current); toastTimer.current = window.setTimeout(() => setToast(''), 2200); };
  const track = (k: 'whatsapp' | 'call' | 'share') => { if (!preview) publicApi.track(b.slug, k); };
  const todayKey = useMemo(() => new Date().toLocaleDateString('en-US', { weekday: 'short', timeZone: 'Africa/Kigali' }).toLowerCase().slice(0, 3), []);
  const c = b.contact; const category = CATEGORIES.find((x) => x.id === b.category)?.label ?? 'Business';
  const media = b.gallery; const url = pageUrl(b.slug);
  const waLink = c.whatsapp ? `https://wa.me/${c.whatsapp}?text=${encodeURIComponent(`Hello ${b.name}, I saw your page on Bwenge.`)}` : null;
  const mapLink = c.mapUrl || (c.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${b.name} ${c.address}`)}` : null);
  const share = async () => { track('share'); try { if (navigator.share) { await navigator.share({ title: b.name, text: b.tagline || b.name, url }); return; } await navigator.clipboard.writeText(url); say('Link copied'); } catch { /* cancelled */ } };
  const copy = async (text: string, what: string) => { try { await navigator.clipboard.writeText(text); say(`${what} copied`); } catch { say('Could not copy'); } };

  const action = 'flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-[#D5DBE3] bg-white px-3 text-[14.5px] font-semibold text-[#0E1722] hover:bg-[#F6F7F9]';
  const primary = 'flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--acc)] px-3 text-[14.5px] font-semibold text-[var(--on)] hover:opacity-90';
  const nav: Array<[string, string, boolean]> = [['products', 'Products', b.products.length > 0], ['gallery', 'Photos', media.length > 0], ['hours', 'Hours', b.hours.length > 0 || !!c.address], ['contact', 'Message', true]];

  return (
    <div style={{ '--acc': theme.accent, '--on': theme.on } as React.CSSProperties} className="min-h-[100dvh] bg-[#EEF0F3] font-sans text-[#0E1722] antialiased">
      <div className="mx-auto min-h-[100dvh] max-w-3xl bg-white pb-28 shadow-[0_0_0_1px_#E7EAEE] sm:pb-10">
        {preview && <p className="sticky top-0 z-30 bg-[#0E1722] px-4 py-2 text-center text-xs text-white">Preview: this is how visitors see your page. Buttons do nothing here.</p>}
        <div className="relative h-52 w-full overflow-hidden bg-[var(--acc)] sm:h-72">
          {b.cover ? <img src={mediaSrc(b.cover.id)} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center font-display text-7xl font-bold text-[var(--on)] opacity-25">{initials(b.name)}</div>}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/35 to-transparent" />
        </div>

        <div className="px-5">
          <div className="relative z-10 -mt-11 flex items-end gap-4">
            <div className="flex h-[88px] w-[88px] shrink-0 items-center justify-center overflow-hidden rounded-2xl border-4 border-white bg-[var(--acc)] shadow-md">
              {b.logo ? <img src={mediaSrc(b.logo.id)} alt={`${b.name} logo`} className="h-full w-full object-cover" /> : <span className="font-display text-3xl font-bold text-[var(--on)]">{initials(b.name)}</span>}
            </div>
          </div>
          <h1 className="mt-3 font-display text-[28px] font-bold leading-tight tracking-tight sm:text-4xl">{b.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
            <span className="rounded-full bg-[#F0F2F5] px-3 py-1 font-medium text-[#3B4757]">{category}</span>
            {openNow !== null && <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-medium ${openNow ? 'bg-[#E3F5EA] text-[#14532D]' : 'bg-[#F3E9E9] text-[#7F1D1D]'}`}><Clock size={13} />{openNow ? 'Open now' : 'Closed now'}</span>}
          </div>
          {b.tagline && <p className="mt-3 text-[17px] leading-snug text-[#3B4757]">{b.tagline}</p>}

          <div className="mt-5 grid grid-cols-2 gap-2.5 sm:flex">
            {waLink && <a href={waLink} target="_blank" rel="noreferrer" onClick={() => track('whatsapp')} className={primary}><MessageCircle size={18} />WhatsApp</a>}
            {c.phone && <a href={`tel:+${c.phone}`} onClick={() => track('call')} className={waLink ? action : primary}><Phone size={17} />Call</a>}
            {mapLink && <a href={mapLink} target="_blank" rel="noreferrer" className={action}><MapPin size={17} />Directions</a>}
            <button type="button" onClick={() => void share()} className={action}><Share2 size={17} />Share</button>
          </div>

          <nav aria-label="On this page" className="mt-5 flex gap-2 overflow-x-auto pb-1 text-[13.5px]">
            {nav.filter((n) => n[2]).map(([id, label]) => <a key={id} href={`#${id}`} className="shrink-0 rounded-full border border-[#E1E5EA] px-3.5 py-1.5 font-medium text-[#3B4757] hover:bg-[#F6F7F9]">{label}</a>)}
          </nav>
        </div>

        {b.about && <section id="about" className={`${SECTION} mt-6`}><h2 className={H2}>About</h2><p className="mt-3 whitespace-pre-line text-[15.5px] leading-[1.7] text-[#2B3644]">{b.about}</p></section>}

        {b.products.length > 0 && (
          <section id="products" className={SECTION}>
            <h2 className={H2}>Products</h2>
            <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {b.products.map((p) => (
                <li key={p.id} className={`overflow-hidden rounded-2xl border border-[#E7EAEE] bg-white ${p.available ? '' : 'opacity-60'}`}>
                  {p.media ? <img src={mediaSrc(p.media.id)} alt={p.name} loading="lazy" className="aspect-square w-full object-cover" /> : <div className="flex aspect-square w-full items-center justify-center bg-[#F3F5F8] text-[#9AA5B3]"><ImageIcon size={28} /></div>}
                  <div className="p-3"><p className="text-[15px] font-semibold leading-snug">{p.name}</p>
                    <p className="mt-0.5 text-[14px] font-semibold text-[#0E1722]">{rwf(p.price)}{p.unit && p.price !== null ? <span className="font-normal text-[#5B6776]"> / {p.unit}</span> : null}</p>
                    {p.description && <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-[#5B6776]">{p.description}</p>}
                    {!p.available && <p className="mt-1.5 text-[12px] font-semibold text-[#9B1C1C]">Out of stock</p>}</div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {media.length > 0 && (
          <section id="gallery" className={SECTION}>
            <h2 className={H2}>Photos and videos</h2>
            <ul className="mt-4 grid grid-cols-3 gap-1.5 sm:gap-2">
              {media.map((m, i) => (
                <li key={m.id} className="relative aspect-square overflow-hidden rounded-xl bg-[#F3F5F8]">
                  <button type="button" onClick={() => setBox(i)} aria-label={m.caption ? `Open: ${m.caption}` : m.kind === 'video' ? 'Play video' : 'Open photo'} className="absolute inset-0 h-full w-full">
                    {m.kind === 'video' ? <video src={`${mediaSrc(m.id)}#t=0.1`} preload="metadata" muted playsInline className="h-full w-full object-cover" /> : <img src={mediaSrc(m.id)} alt={m.caption || ''} loading="lazy" className="h-full w-full object-cover" />}
                    {m.kind === 'video' && <span className="absolute inset-0 flex items-center justify-center bg-black/25"><span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-[#0E1722]"><Play size={20} className="ml-0.5" /></span></span>}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {(b.hours.length > 0 || c.address) && (
          <section id="hours" className={SECTION}>
            <h2 className={H2}>Hours and place</h2>
            {b.hours.length > 0 && (
              <ul className="mt-4 divide-y divide-[#EEF0F3] rounded-2xl border border-[#E7EAEE]">
                {DAYS.map((d) => { const h = b.hours.find((x) => x.day === d.id); const today = d.id === todayKey; return (
                  <li key={d.id} className={`flex items-center justify-between px-4 py-3 text-[14.5px] ${today ? 'bg-[var(--acc)]/10 font-semibold' : ''}`}><span className="flex items-center gap-2">{today && <CalendarClock size={15} />}{d.label}</span><span className={h && !h.closed ? '' : 'text-[#7B8696]'}>{h ? (h.closed ? 'Closed' : `${h.open} – ${h.close}`) : '—'}</span></li>
                ); })}
              </ul>
            )}
            {c.address && <p className="mt-4 flex items-start gap-2 text-[15px] text-[#2B3644]"><MapPin size={18} className="mt-0.5 shrink-0 text-[#5B6776]" /><span>{c.address}{mapLink && <> · <a className="font-semibold underline decoration-[var(--acc)] decoration-2 underline-offset-4" href={mapLink} target="_blank" rel="noreferrer">Open map</a></>}</span></p>}
          </section>
        )}

        {b.pay && (
          <section id="pay" className={SECTION}>
            <h2 className={H2}>How to pay</h2>
            <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-[#E7EAEE] bg-[#F8F9FB] p-4">
              <div><p className="text-[13px] text-[#5B6776]">MTN MoMo Pay code</p><p className="font-mono text-2xl font-semibold tracking-wider">{b.pay.momoCode}</p>{b.pay.momoName && <p className="text-[13.5px] text-[#3B4757]">{b.pay.momoName}</p>}</div>
              <button type="button" onClick={() => void copy(b.pay!.momoCode, 'Code')} className="flex min-h-11 items-center gap-1.5 rounded-xl border border-[#D5DBE3] bg-white px-3.5 text-sm font-semibold"><Copy size={15} />Copy</button>
            </div>
            <p className="mt-2 text-[12.5px] text-[#7B8696]">Check the name on your phone before you pay.</p>
          </section>
        )}

        <section id="contact" className={SECTION}>
          <h2 className={H2}>Send a message</h2>
          <p className="mb-4 mt-1 text-[14px] text-[#5B6776]">Ask a question or place an order. Leave your phone number or email so {b.name} can reply.</p>
          <MessageForm slug={b.slug} preview={preview} products={b.products} />
          {(c.website || c.instagram || c.facebook || c.email) && <p className="mt-5 flex flex-wrap gap-x-5 gap-y-1 text-[14px]">{[['Website', c.website], ['Instagram', c.instagram], ['Facebook', c.facebook]].filter((x) => x[1]).map(([l, u]) => <a key={l as string} href={u as string} target="_blank" rel="noreferrer noopener" className="font-semibold underline decoration-[var(--acc)] decoration-2 underline-offset-4">{l}</a>)}{c.email && <a href={`mailto:${c.email}`} className="font-semibold underline decoration-[var(--acc)] decoration-2 underline-offset-4">{c.email}</a>}</p>}
        </section>

        <footer className="border-t border-[#E7EAEE] px-5 py-6 text-[12.5px] text-[#7B8696]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <a href="/" className="font-semibold text-[#3B4757] hover:underline">Made with Bwenge4biz</a>
            {!preview && <button type="button" onClick={() => setReport(true)} className="inline-flex items-center gap-1.5 rounded-md hover:text-[#0E1722]"><Flag size={13} />Report this page</button>}
          </div>
        </footer>

        {(waLink || c.phone) && <div className="fixed inset-x-0 bottom-0 z-20 border-t border-[#E7EAEE] bg-white/95 p-3 backdrop-blur sm:hidden"><div className="mx-auto flex max-w-3xl gap-2.5">
          {waLink && <a href={waLink} target="_blank" rel="noreferrer" onClick={() => track('whatsapp')} className={primary}><MessageCircle size={18} />WhatsApp</a>}
          {c.phone && <a href={`tel:+${c.phone}`} onClick={() => track('call')} className={waLink ? action : primary}><Phone size={17} />Call</a>}
        </div></div>}
      </div>
      {box !== null && <Lightbox items={media} index={box} src={mediaSrc} onClose={() => setBox(null)} onIndex={setBox} />}
      {report && <ReportDialog slug={b.slug} onClose={() => setReport(false)} />}
      {toast && <div role="status" className="fixed bottom-24 left-1/2 z-[500] -translate-x-1/2 rounded-full bg-[#0E1722] px-4 py-2 text-sm text-white shadow-lg sm:bottom-8">{toast}</div>}
    </div>
  );
}
