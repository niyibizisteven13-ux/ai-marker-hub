import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Clock, Copy, Download, Flag, Globe, Image as ImageIcon, Instagram, Facebook, Loader2, Mail, MapPin, MessageCircle, Minus, Phone, Play, Plus, QrCode, Send, Share2, ShoppingBag, Smartphone, X } from 'lucide-react';
import { publicApi } from '../../biz/api';
import { DAYS, THEMES, type Lang, pageUrl, rwf, CATEGORIES, type PublicBusiness, type PublicMedia, type PublicPost } from '../../biz/types';
import { presetFor } from './presets';
import Sections from './Sections';
import { TxContext, initialLang, localize, localizePosts, makeTx, useTx } from '../../biz/i18n';
import MapTile from './MapTile';
import FeedSection from './Feed';

/**
 * A business's public page (bwenge4biz). Phone first: a cover, the name and the buttons people tap (WhatsApp, Call, Directions, Share), then the
 * products, the photos and videos, the hours and a message form. The same component is the preview in the owner's studio (`preview`: nothing is
 * counted or sent). The business picks the accent colour; everything else is Bwenge's own clean, light style so every page is easy to read.
 */
const agoText = (iso: string) => { const sec = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 1000)); return sec < 3600 ? `${Math.max(1, Math.round(sec / 60))} min ago` : sec < 86400 ? `${Math.round(sec / 3600)} h ago` : new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); };
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || 'B';

function Lightbox({ items, index, src, onClose, onIndex }: { items: PublicMedia[]; index: number; src: (id: string) => string; onClose: () => void; onIndex: (i: number) => void }) {
  const tx = useTx();
  const m = items[index];
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); else if (e.key === 'ArrowRight') onIndex((index + 1) % items.length); else if (e.key === 'ArrowLeft') onIndex((index - 1 + items.length) % items.length); };
    window.addEventListener('keydown', key); const o = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', key); document.body.style.overflow = o; };
  }, [index, items.length, onClose, onIndex]);
  if (!m) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label="Photo viewer" className="fixed inset-0 z-[400] flex flex-col bg-black/95" onClick={onClose}>
      <div className="flex items-center justify-between px-4 py-3 text-white"><span className="text-sm text-white/70">{index + 1} / {items.length}</span><button type="button" aria-label={tx("Close")} onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10"><X size={22} /></button></div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2" onClick={(e) => e.stopPropagation()}>
        {m.kind === 'video' ? <video key={m.id} src={src(m.id)} controls autoPlay playsInline className="max-h-full max-w-full rounded-lg" /> : <img key={m.id} src={src(m.id)} alt={m.caption || 'Photo'} className="max-h-full max-w-full rounded-lg object-contain" />}
        {items.length > 1 && <>
          <button type="button" aria-label={tx("Previous")} onClick={() => onIndex((index - 1 + items.length) % items.length)} className="absolute left-2 flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"><ChevronLeft /></button>
          <button type="button" aria-label={tx("Next")} onClick={() => onIndex((index + 1) % items.length)} className="absolute right-2 flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"><ChevronRight /></button>
        </>}
      </div>
      {m.caption && <p className="px-5 py-4 text-center text-sm text-white/85">{m.caption}</p>}
    </div>
  );
}

function MessageForm({ slug, preview, products }: { slug: string; preview: boolean; products: PublicBusiness['products'] }) {
  const tx = useTx();
  const [f, setF] = useState({ name: '', contact: '', message: '', productId: '', website: '' });
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle'); const [error, setError] = useState('');
  const field = 'w-full rounded-xl border border-[#D5DBE3] bg-white px-3.5 py-3 text-[15px] text-[#0E1722] outline-none placeholder:text-[#8793A3] focus:border-[var(--acc)] focus:ring-2 focus:ring-[var(--acc)]/25';
  const send = async (e: React.FormEvent) => {
    e.preventDefault(); if (preview || state === 'sending') return; setState('sending'); setError('');
    try { await publicApi.enquiry(slug, { name: f.name, contact: f.contact, message: f.message, ...(f.productId ? { productId: f.productId } : {}), website: f.website }); setState('done'); }
    catch (x) { setError(x instanceof Error ? x.message : 'Your message could not be sent.'); setState('idle'); }
  };
  if (state === 'done') return <p role="status" className="flex items-center gap-2 rounded-xl bg-[#E8F6EE] px-4 py-3.5 text-[15px] text-[#14532D]"><Check size={18} />{tx("Message sent. The business will reply to you.")}</p>;
  return (
    <form onSubmit={send} className="space-y-3" noValidate>
      <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={tx("Your name")} aria-label={tx("Your name")} maxLength={60} className={field} autoComplete="name" />
      <input value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} placeholder={tx("Your phone number or email")} aria-label={tx("Your phone number or email")} maxLength={120} className={field} autoComplete="tel" inputMode="tel" />
      {products.length > 0 && <select value={f.productId} onChange={(e) => setF({ ...f, productId: e.target.value })} aria-label={tx("About which product")} className={field}><option value="">{tx("About: anything")}</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
      <textarea value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} placeholder={tx("What would you like to ask or order?")} aria-label={tx("Your message")} rows={4} maxLength={800} className={field} />
      <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', height: 0, overflow: 'hidden' }}><label>Website<input tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} /></label></div>
      {error && <p role="alert" className="rounded-lg bg-[#FEECEC] px-3 py-2 text-sm text-[#9B1C1C]">{error}</p>}
      <button type="submit" disabled={preview || state === 'sending' || !f.message.trim()} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--acc)] px-5 text-[15px] font-semibold text-[var(--on)] disabled:opacity-50">{state === 'sending' ? <Loader2 size={18} className="animate-spin" /> : <Send size={17} />}{preview ? `${tx('Send message')} (preview)` : tx('Send message')}</button>
    </form>
  );
}

function ReportDialog({ slug, onClose }: { slug: string; onClose: () => void }) {
  const tx = useTx();
  const [reason, setReason] = useState('scam'); const [detail, setDetail] = useState(''); const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle'); const [error, setError] = useState('');
  const send = async () => { setState('sending'); setError(''); try { await publicApi.report(slug, { reason, detail }); setState('done'); } catch (e) { setError(e instanceof Error ? e.message : 'Could not send the report.'); setState('idle'); } };
  return (
    <div role="dialog" aria-modal="true" aria-label={tx("Report this page")} className="fixed inset-0 z-[400] flex items-end justify-center bg-black/50 p-4 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 text-[#0E1722] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display text-lg font-semibold">{tx("Report this page")}</h3>
        {state === 'done' ? <p className="mt-3 text-[15px] text-[#14532D]">{tx("Thank you. Bwenge will look at this page.")}</p> : <>
          <p className="mt-1 text-sm text-[#5B6776]">Tell us what is wrong. We do not share your report with the business.</p>
          <select value={reason} onChange={(e) => setReason(e.target.value)} aria-label={tx("Reason")} className="mt-3 w-full rounded-xl border border-[#D5DBE3] px-3 py-3 text-[15px]"><option value="scam">{tx("It looks like a scam")}</option><option value="illegal">{tx("It sells something illegal")}</option><option value="offensive">{tx("It is offensive")}</option><option value="copied">{tx("It copies someone else")}</option><option value="other">{tx("Something else")}</option></select>
          <textarea value={detail} onChange={(e) => setDetail(e.target.value)} rows={3} maxLength={400} placeholder={tx("More detail (optional)")} aria-label="More detail" className="mt-3 w-full rounded-xl border border-[#D5DBE3] px-3 py-3 text-[15px]" />
          {error && <p role="alert" className="mt-2 text-sm text-[#9B1C1C]">{error}</p>}
        </>}
        <div className="mt-4 flex justify-end gap-2"><button type="button" onClick={onClose} className="min-h-11 rounded-xl px-4 text-sm text-[#5B6776] hover:bg-[#F0F2F5]">{state === 'done' ? 'Close' : 'Cancel'}</button>{state !== 'done' && <button type="button" onClick={() => void send()} disabled={state === 'sending'} className="min-h-11 rounded-xl bg-[#0E1722] px-5 text-sm font-semibold text-white disabled:opacity-60">{tx("Send report")}</button>}</div>
      </div>
    </div>
  );
}

type Cart = Record<string, number>;
const cartLines = (b: PublicBusiness, cart: Cart) => b.products.filter((p) => cart[p.id] > 0).map((p) => ({ p, qty: cart[p.id] }));
const phoneLike = (s?: string) => (s && /^250\d{9}$/.test(s) ? `0${s.slice(3)}` : '');

/** Checkout: send the order (to the business, and to WhatsApp), or pay now with MTN / Airtel; the customer approves on their own phone. */
function Checkout({ b, cart, setCart, onClose, preview, startPay, waLink }: { b: PublicBusiness; cart: Cart; setCart: (c: Cart) => void; onClose: () => void; preview: boolean; startPay: boolean; waLink: (text: string) => string | null }) {
  const tx = useTx();
  const lines = cartLines(b, cart); const priced = lines.every((l) => l.p.price !== null); const total = lines.reduce((a, l) => a + (l.p.price ?? 0) * l.qty, 0);
  const canPay = !!b.payOnline && (lines.length ? priced && total >= 100 : b.payOnline.open);
  const [mode, setMode] = useState<'order' | 'pay'>(startPay && canPay ? 'pay' : 'order');
  const [f, setF] = useState({ name: '', contact: '', phone: phoneLike(b.contact.phone), note: '', amount: '', website: '' });
  const [step, setStep] = useState<'form' | 'sending' | 'waiting' | 'paid' | 'failed' | 'sent'>('form'); const [error, setError] = useState(''); const [payTotal, setPayTotal] = useState(0);
  const field = 'w-full rounded-xl border border-[#D5DBE3] bg-white px-3.5 py-3 text-[15px] text-[#0E1722] outline-none placeholder:text-[#8793A3] focus:border-[var(--acc)] focus:ring-2 focus:ring-[var(--acc)]/25';
  const summary = lines.map((l) => `${l.qty} × ${l.p.name}`).join(', ');
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  useEffect(() => { const o = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = o; }; }, []);
  const items = lines.map((l) => ({ productId: l.p.id, qty: l.qty }));
  const sendOrder = async (e: React.FormEvent) => {
    e.preventDefault(); if (preview) return; setStep('sending'); setError('');
    try {
      await publicApi.order(b.slug, { name: f.name, contact: f.contact, note: f.note, items, website: f.website });
      const wa = waLink(`Hello ${b.name}, I would like to order: ${summary}${priced && total ? ` (total ${total.toLocaleString('en-US')} RWF)` : ''}. Name: ${f.name}. ${f.note}`.trim());
      setStep('sent'); setCart({}); if (wa) window.open(wa, '_blank', 'noopener');
    } catch (x) { setError(x instanceof Error ? x.message : 'Your order could not be sent.'); setStep('form'); }
  };
  const pay = async (e: React.FormEvent) => {
    e.preventDefault(); if (preview) return; setStep('sending'); setError('');
    try {
      const r = await publicApi.pay(b.slug, { name: f.name, phone: f.phone, ...(lines.length ? { items } : { amount: Number(f.amount.replace(/[,\s]/g, '')) }), website: f.website }); setPayTotal(r.total); setStep('waiting');
      const started = Date.now();
      const poll = async (): Promise<void> => {
        if (Date.now() - started > 6 * 60_000) { setStep('failed'); return; }
        try { const s = await publicApi.payStatus(b.slug, r.ref); if (s.state === 'success') { setStep('paid'); setCart({}); return; } if (s.state === 'failed') { setStep('failed'); return; } } catch { /* keep asking */ }
        window.setTimeout(() => void poll(), 3000);
      };
      void poll();
    } catch (x) { setError(x instanceof Error ? x.message : 'The payment could not be started.'); setStep('form'); }
  };
  const honeypot = <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', height: 0, overflow: 'hidden' }}><label>Website<input tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => set('website', e.target.value)} /></label></div>;
  return (
    <div role="dialog" aria-modal="true" aria-label={tx("Your order")} className="fixed inset-0 z-[300] flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onClick={onClose}>
      <div className="max-h-[94dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 text-[#0E1722] shadow-2xl sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between"><h3 className="font-display text-xl font-semibold">{step === 'paid' ? 'Payment received' : mode === 'pay' ? 'Pay now' : 'Your order'}</h3><button type="button" aria-label={tx("Close")} onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-xl hover:bg-[#F0F2F5]"><X size={18} /></button></div>
        {step === 'sent' && <div className="py-6 text-center"><span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#E8F6EE] text-[#14532D]"><Check /></span><p className="mt-4 text-lg font-semibold">Order sent to {b.name}</p><p className="mt-1 text-sm text-[#5B6776]">They will contact you to confirm. WhatsApp opened with your order so you can follow up.</p><button type="button" onClick={onClose} className="mt-5 min-h-11 rounded-xl bg-[var(--acc)] px-6 text-sm font-semibold text-[var(--on)]">{tx("Done")}</button></div>}
        {step === 'waiting' && <div className="py-6 text-center"><Loader2 className="mx-auto animate-spin text-[var(--acc)]" size={34} /><p className="mt-4 text-lg font-semibold">{tx("Check your phone")}</p><p className="mt-1 text-sm text-[#5B6776]">Approve the payment of <b>{payTotal.toLocaleString('en-US')} RWF</b> by entering your PIN. This screen updates by itself.</p></div>}
        {step === 'paid' && <div className="py-6 text-center"><span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#E8F6EE] text-[#14532D]"><Check /></span><p className="mt-4 text-lg font-semibold">Thank you! {payTotal.toLocaleString('en-US')} RWF paid.</p><p className="mt-1 text-sm text-[#5B6776]">{b.name} has your payment.</p><button type="button" onClick={onClose} className="mt-5 min-h-11 rounded-xl bg-[var(--acc)] px-6 text-sm font-semibold text-[var(--on)]">{tx("Done")}</button></div>}
        {step === 'failed' && <div className="py-6 text-center"><p className="text-lg font-semibold">{tx("The payment was not completed")}</p><p className="mt-1 text-sm text-[#5B6776]">It was declined or not approved in time. You were not charged.</p><button type="button" onClick={() => setStep('form')} className="mt-5 min-h-11 rounded-xl bg-[var(--acc)] px-6 text-sm font-semibold text-[var(--on)]">{tx("Try again")}</button></div>}
        {(step === 'form' || step === 'sending') && (<>
          {lines.length > 0 && <ul className="mb-4 divide-y divide-[#EEF0F3] rounded-2xl border border-[#E7EAEE]">{lines.map(({ p, qty }) => <li key={p.id} className="flex items-center gap-3 px-3.5 py-2.5 text-sm"><span className="min-w-0 flex-1 truncate font-medium">{p.name}</span><span className="text-[#5B6776]">{p.price !== null ? (p.price * qty).toLocaleString('en-US') : 'ask'}</span>
            <span className="inline-flex items-center rounded-lg border border-[#D5DBE3]"><button type="button" aria-label={`Fewer ${p.name}`} className="flex h-9 w-9 items-center justify-center" onClick={() => setCart({ ...cart, [p.id]: Math.max(0, qty - 1) })}><Minus size={14} /></button><span className="w-6 text-center text-sm font-semibold">{qty}</span><button type="button" aria-label={`More ${p.name}`} className="flex h-9 w-9 items-center justify-center" onClick={() => setCart({ ...cart, [p.id]: Math.min(99, qty + 1) })}><Plus size={14} /></button></span></li>)}
            {priced && <li className="flex justify-between px-3.5 py-3 text-[15px] font-semibold"><span>{tx("Total")}</span><span>{total.toLocaleString('en-US')} RWF</span></li>}</ul>}
          {canPay && <div className="mb-4 inline-flex rounded-xl bg-[#F0F2F5] p-1" role="tablist">{([['order', 'Send order'], ['pay', 'Pay now']] as const).map(([id, l]) => <button key={id} type="button" role="tab" aria-selected={mode === id} onClick={() => setMode(id)} className={`rounded-lg px-4 py-2 text-sm font-semibold ${mode === id ? 'bg-white shadow-sm' : 'text-[#5B6776]'}`}>{l}</button>)}</div>}
          <form onSubmit={mode === 'pay' ? pay : sendOrder} className="relative space-y-3" noValidate>
            <input className={field} placeholder={tx("Your name")} aria-label={tx("Your name")} maxLength={60} value={f.name} onChange={(e) => set('name', e.target.value)} autoComplete="name" />
            {mode === 'pay' ? <>
              <input className={field} placeholder={tx("Your MTN or Airtel number, 0788 123 456")} aria-label={tx("Your mobile money number")} inputMode="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} autoComplete="tel" />
              {!lines.length && <input className={field} placeholder={tx("Amount in RWF")} aria-label={tx("Amount in RWF")} inputMode="numeric" value={f.amount} onChange={(e) => set('amount', e.target.value.replace(/[^\d,\s]/g, ''))} />}
              <p className="rounded-xl bg-[#F6F7F9] p-3 text-xs text-[#5B6776]">You will get a prompt on this phone to approve the payment with your PIN. The money goes straight to {b.name}.</p>
            </> : <>
              <input className={field} placeholder={tx("Your phone number or email")} aria-label={tx("Your phone number or email")} maxLength={120} value={f.contact} onChange={(e) => set('contact', e.target.value)} inputMode="tel" autoComplete="tel" />
              <textarea className={field} rows={2} placeholder={tx("Note (delivery place, time…)")} aria-label="Note" maxLength={120} value={f.note} onChange={(e) => set('note', e.target.value)} />
            </>}
            {honeypot}
            {error && <p role="alert" className="rounded-lg bg-[#FEECEC] px-3 py-2 text-sm text-[#9B1C1C]">{error}</p>}
            {preview && <p className="text-xs text-[#5B6776]">{tx("Preview: nothing is sent.")}</p>}
            <button type="submit" disabled={preview || step === 'sending' || !f.name.trim() || (mode === 'pay' ? !f.phone.trim() || (!lines.length && !f.amount) : !f.contact.trim() || !lines.length)} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--acc)] px-5 text-[15px] font-semibold text-[var(--on)] disabled:opacity-50">{step === 'sending' ? <Loader2 size={18} className="animate-spin" /> : mode === 'pay' ? <Smartphone size={18} /> : <Send size={18} />}{mode === 'pay' ? `Pay ${(lines.length ? total : Number(f.amount.replace(/[,\s]/g, '')) || 0).toLocaleString('en-US')} RWF` : 'Send order'}</button>
          </form>
        </>)}
      </div>
    </div>
  );
}

function BizPageInner({ business: b, base, lang, setLang, openNow, mediaSrc, preview = false }: { business: PublicBusiness; base: PublicBusiness; lang: Lang; setLang: (l: Lang) => void; openNow: boolean | null; mediaSrc: (id: string) => string; preview?: boolean }) {
  const tx = useTx();
  const theme = THEMES[b.theme] ?? THEMES.gold; const preset = presetFor(b.category);
  const [box, setBox] = useState<number | null>(null); const [report, setReport] = useState(false); const [toast, setToast] = useState(''); const [cart, setCart] = useState<Cart>({}); const [checkout, setCheckout] = useState<null | 'order' | 'pay'>(null);
  const [rawPosts, setPosts] = useState<PublicPost[]>([]); const posts = useMemo(() => localizePosts(rawPosts, base, lang), [rawPosts, base, lang]); const [postBox, setPostBox] = useState<{ items: PublicMedia[]; i: number } | null>(null); const [qr, setQr] = useState(''); const [installEvt, setInstallEvt] = useState<any>(null); const toastTimer = useRef<number | undefined>(undefined);
  const say = (t: string) => { setToast(t); window.clearTimeout(toastTimer.current); toastTimer.current = window.setTimeout(() => setToast(''), 2200); };
  const track = (k: 'whatsapp' | 'call' | 'share') => { if (!preview) publicApi.track(b.slug, k); };
  const todayKey = useMemo(() => new Date().toLocaleDateString('en-US', { weekday: 'short', timeZone: 'Africa/Kigali' }).toLowerCase().slice(0, 3), []);
  const c = b.contact; const category = CATEGORIES.find((x) => x.id === b.category)?.label ?? 'Business'; const media = b.gallery; const url = pageUrl(b.slug);
  const waBase = (text: string) => (c.whatsapp ? `https://wa.me/${c.whatsapp}?text=${encodeURIComponent(text)}` : null);
  const waLink = waBase(`Hello ${b.name}, I saw your page on Bwenge.`);
  const loc = b.location; const mapLink = loc ? `https://www.google.com/maps/dir/?api=1&destination=${loc.lat},${loc.lng}` : c.mapUrl || (c.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${b.name} ${c.address}`)}` : null);
  const lines = cartLines(b, cart); const count = lines.reduce((a, l) => a + l.qty, 0); const total = lines.reduce((a, l) => a + (l.p.price ?? 0) * l.qty, 0);
  const todayHours = b.hours.find((h) => h.day === todayKey);
  const sharePost = async (p: PublicPost) => { const u = `${url}?post=${p.id}#post-${p.id}`; track('share'); try { if (navigator.share) { await navigator.share({ title: b.name, text: p.text.slice(0, 120) || b.name, url: u }); return; } await navigator.clipboard.writeText(u); say('Link copied'); } catch { /* cancelled */ } };
  const share = async () => { track('share'); try { if (navigator.share) { await navigator.share({ title: b.name, text: b.tagline || b.name, url }); return; } await navigator.clipboard.writeText(url); say('Link copied'); } catch { /* cancelled */ } };
  const copy = async (text: string, what: string) => { try { await navigator.clipboard.writeText(text); say(`${what} copied`); } catch { say('Could not copy'); } };
  useEffect(() => { let alive = true; void import('qrcode').then((m: any) => (m.default ?? m).toDataURL(url, { margin: 1, width: 420, color: { dark: '#0E1722', light: '#FFFFFF' } })).then((d: string) => { if (alive) setQr(d); }).catch(() => undefined); return () => { alive = false; }; }, [url]);
  useEffect(() => { const h = (e: Event) => { e.preventDefault(); setInstallEvt(e); }; window.addEventListener('beforeinstallprompt', h); return () => window.removeEventListener('beforeinstallprompt', h); }, []);
  useEffect(() => { if (!preview && window.location.hash === '#pay' && b.payOnline) setCheckout('pay'); }, [preview, b.payOnline]);
  useEffect(() => { let alive = true; void publicApi.posts(b.slug, new URLSearchParams(window.location.search).get('post') ?? undefined).then((p) => { if (alive) setPosts(p); }).catch(() => undefined); return () => { alive = false; }; }, [b.slug, b.updatedAt]);
  useEffect(() => { if (!posts.length) return; const h = window.location.hash; if (h.startsWith('#post-') || h === '#updates') window.setTimeout(() => document.getElementById(h.slice(1))?.scrollIntoView({ block: 'start' }), 300); }, [posts.length]);
  const install = async () => { try { await installEvt.prompt(); } catch { /* dismissed */ } setInstallEvt(null); };
  const add = (id: string, d = 1) => setCart((x) => ({ ...x, [id]: Math.max(0, Math.min(99, (x[id] ?? 0) + d)) }));
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const tabs: Array<[string, string, boolean]> = [['top', 'Overview', true], ['items', preset.itemsTitle, b.products.length > 0], ['updates', 'Updates', posts.length > 0], ['gallery', 'Gallery', media.length > 0], ['about', 'About', true], ['contact', 'Contact', true]];
  const tile = 'flex flex-col items-center justify-center gap-2 rounded-2xl border border-[#E7EAEE] bg-white px-2 py-4 text-center text-[13px] font-semibold text-[#0E1722] shadow-sm transition hover:-translate-y-0.5 hover:shadow-md';
  const iconWrap = 'flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--acc)]/15 text-[#0E1722]';
  const panel = 'rounded-3xl border border-[#E7EAEE] bg-white p-5 shadow-sm';

  return (
    <div style={{ '--acc': theme.accent, '--on': theme.on } as React.CSSProperties} className={`${preview ? '' : 'h-[100dvh] overflow-y-auto overscroll-contain'} bg-[#EEF1F6] font-sans text-[#0E1722] antialiased`}>
      {preview && <p className="relative z-40 bg-[#0E1722] px-4 py-2 text-center text-xs text-white">Preview: this is how visitors see your page. Nothing is sent from here.</p>}
      <div className="mx-auto max-w-6xl sm:p-4 lg:p-6">
        <div className="overflow-hidden bg-white shadow-[0_8px_40px_rgba(14,23,34,0.08)] sm:rounded-[28px]">
          {/* hero */}
          <header id="top" className="relative">
            <div className="relative h-60 w-full overflow-hidden bg-[var(--acc)] sm:h-80">
              {b.cover ? <img src={mediaSrc(b.cover.id)} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.25),transparent_55%)] font-display text-8xl font-bold text-[var(--on)] opacity-30">{initials(b.name)}</div>}
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-black/10" />
            </div>
            <div className="absolute inset-x-0 bottom-0 flex items-end gap-4 p-4 sm:gap-5 sm:p-7">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border-[3px] border-white bg-[var(--acc)] shadow-lg sm:h-28 sm:w-28 sm:rounded-3xl">{b.logo ? <img src={mediaSrc(b.logo.id)} alt={`${b.name} logo`} className="h-full w-full object-cover" /> : <span className="font-display text-3xl font-bold text-[var(--on)] sm:text-4xl">{initials(b.name)}</span>}</div>
              <div className="min-w-0 flex-1 pb-0.5 text-white">
                <h1 className="font-display text-[26px] font-semibold leading-tight tracking-tight sm:text-4xl">{b.name}</h1>
                <p className="mt-1 text-[13px] text-white/85 sm:text-[15px]">{category}{b.tagline ? ` · ${b.tagline}` : ''}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px] sm:text-sm">
                  {openNow !== null && <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold ${openNow ? 'bg-emerald-400/90 text-emerald-950' : 'bg-white/25 text-white'}`}><Clock size={13} />{openNow ? tx('Open now') : tx('Closed now')}{openNow && todayHours && !todayHours.closed ? ` · ${lang === 'rw' ? 'ifunga saa' : 'closes'} ${todayHours.close}` : ''}</span>}
                  {c.address && <span className="inline-flex items-center gap-1 text-white/85"><MapPin size={13} />{c.address}</span>}
                </div>
              </div>
              <div className="hidden gap-2 sm:flex"><button type="button" onClick={() => void share()} aria-label={tx("Share")} className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-[#0E1722] shadow hover:bg-[#F6F7F9]"><Share2 size={18} /></button>
                {b.payOnline && <button type="button" onClick={() => setCheckout('pay')} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--acc)] px-4 text-sm font-semibold text-[var(--on)] shadow hover:opacity-90"><Smartphone size={17} />{tx("Pay now")}</button>}</div>
            </div>
          <div className="absolute right-3 top-3 z-10 inline-flex rounded-full bg-black/45 p-0.5 text-xs font-semibold text-white backdrop-blur" role="group" aria-label="Language">{(['en', 'rw'] as const).map((l) => <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)} className={`rounded-full px-3 py-1.5 ${lang === l ? 'bg-white text-[#0E1722]' : ''}`}>{l.toUpperCase()}</button>)}</div>
          </header>

          {/* tabs */}
          <nav aria-label={tx("Page sections")} className="sticky top-0 z-30 flex gap-1 overflow-x-auto border-b border-[#E7EAEE] bg-white/95 px-3 py-2.5 backdrop-blur sm:px-6">
            {tabs.filter((t) => t[2]).map(([id, label], i) => <button key={id} type="button" onClick={() => go(id)} className={`shrink-0 rounded-xl px-4 py-2 text-sm font-semibold ${i === 0 ? 'bg-[var(--acc)] text-[var(--on)]' : 'text-[#475467] hover:bg-[#F0F2F5]'}`}>{tx(label)}</button>)}
          </nav>

          <div className="grid gap-6 p-4 sm:p-6 lg:grid-cols-[1fr_340px]">
            <div className="min-w-0 space-y-6">
              {/* promo */}
              <section className="relative overflow-hidden rounded-3xl bg-[#0E1722] p-6 text-white sm:p-8" style={{ backgroundImage: `radial-gradient(circle at 85% 20%, ${theme.accent}55, transparent 55%)` }}>
                <p className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: theme.accent }}>{category}</p>
                <h2 className="mt-2 max-w-md font-display text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">{b.tagline || preset.promo}</h2>
                <p className="mt-3 max-w-md text-[15px] leading-relaxed text-white/75">{(b.about || '').split(/(?<=[.!?])\s/)[0] || preset.promo}</p>
                <div className="mt-5 flex flex-wrap gap-2.5">
                  <button type="button" onClick={() => (b.products.length ? go('items') : waLink ? window.open(waLink, '_blank') : go('contact'))} className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-[var(--acc)] px-6 text-[15px] font-semibold text-[var(--on)] hover:opacity-90"><ShoppingBag size={18} />{tx(preset.order)}</button>
                  {preset.second && c.whatsapp && <a href={waBase(preset.second.message(b.name))!} target="_blank" rel="noreferrer" onClick={() => track('whatsapp')} className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-white/25 px-5 text-[15px] font-semibold hover:bg-white/10"><MessageCircle size={18} />{tx(preset.second.label)}</a>}
                </div>
              </section>

              {/* quick actions */}
              <section aria-label={tx("Quick actions")} className="grid grid-cols-3 gap-3 sm:grid-cols-6">
                {b.products.length > 0 && <button type="button" onClick={() => go('items')} className={tile}><span className={iconWrap}><ShoppingBag size={20} /></span>{tx(preset.order.split(' ')[0])}</button>}
                {b.payOnline && <button type="button" onClick={() => setCheckout('pay')} className={tile}><span className={iconWrap}><Smartphone size={20} /></span>{tx("Pay online")}</button>}
                {c.whatsapp && <a href={waLink!} target="_blank" rel="noreferrer" onClick={() => track('whatsapp')} className={tile}><span className={iconWrap}><MessageCircle size={20} /></span>{tx("WhatsApp")}</a>}
                {c.phone && <a href={`tel:+${c.phone}`} onClick={() => track('call')} className={tile}><span className={iconWrap}><Phone size={20} /></span>{tx("Call")}</a>}
                {mapLink && <a href={mapLink} target="_blank" rel="noreferrer" className={tile}><span className={iconWrap}><MapPin size={20} /></span>{tx("Directions")}</a>}
                <button type="button" onClick={() => void share()} className={tile}><span className={iconWrap}><Share2 size={20} /></span>{tx("Share")}</button>
                {!b.products.length && <button type="button" onClick={() => go('contact')} className={tile}><span className={iconWrap}><Send size={20} /></span>{tx("Message")}</button>}
              </section>

              {/* products */}
              {b.products.length > 0 && (
                <section id="items" className="scroll-mt-20">
                  <div className="mb-4 flex items-end justify-between gap-3"><div><h2 className="font-display text-2xl font-semibold tracking-tight">{tx(preset.itemsTitle)}</h2><p className="text-sm text-[#667085]">{tx(preset.itemsHint)}</p></div></div>
                  <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
                    {b.products.map((p) => { const q = cart[p.id] ?? 0; return (
                      <li key={p.id} className={`overflow-hidden rounded-2xl border border-[#E7EAEE] bg-white shadow-sm ${p.available ? '' : 'opacity-60'}`}>
                        <div className="aspect-[4/3] bg-[#F0F2F5]">{p.media ? <img src={mediaSrc(p.media.id)} alt={p.name} loading="lazy" className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center bg-[var(--acc)]/10 font-display text-3xl font-bold text-[var(--acc)]">{initials(p.name)}</div>}</div>
                        <div className="p-3"><p className="truncate text-[15px] font-semibold">{p.name}</p>{p.description && <p className="mt-0.5 line-clamp-2 text-xs text-[#667085]">{p.description}</p>}
                          <p className="mt-1.5 text-[15px] font-bold">{rwf(p.price)}{p.unit && p.price !== null ? <span className="text-xs font-normal text-[#667085]"> / {p.unit}</span> : null}</p>
                          {!p.available ? <p className="mt-2 rounded-lg bg-[#F0F2F5] py-2 text-center text-xs font-semibold text-[#667085]">{tx("Out of stock")}</p> : q === 0 ? (
                            <button type="button" onClick={() => add(p.id)} className="mt-2 flex min-h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-[var(--acc)]/15 text-sm font-semibold hover:bg-[var(--acc)]/25"><Plus size={16} />{tx(preset.add)}</button>
                          ) : (
                            <div className="mt-2 flex items-center justify-between rounded-xl bg-[var(--acc)] text-[var(--on)]"><button type="button" aria-label={`Fewer ${p.name}`} onClick={() => add(p.id, -1)} className="flex h-10 w-11 items-center justify-center"><Minus size={16} /></button><span className="text-sm font-bold">{q}</span><button type="button" aria-label={`More ${p.name}`} onClick={() => add(p.id)} className="flex h-10 w-11 items-center justify-center"><Plus size={16} /></button></div>)}
                        </div>
                      </li>); })}
                  </ul>
                </section>)}

              {/* highlights */}
              <section className="grid grid-cols-3 gap-2 rounded-2xl bg-[#F6F7F9] p-3 text-center text-[12.5px] font-medium text-[#475467] sm:text-sm">{preset.highlights.map((h) => <span key={h} className="flex items-center justify-center gap-1.5 px-1 py-1.5"><Check size={14} className="shrink-0 text-emerald-600" />{tx(h)}</span>)}</section>

              {/* updates (the feed) */}
              {posts.length > 0 && <section id="updates" className="scroll-mt-20"><h2 className="mb-4 font-display text-2xl font-semibold tracking-tight">{tx("Updates")}</h2>
                <FeedSection b={b} posts={posts} mediaSrc={mediaSrc} preview={preview} onOrder={(pid) => { setCart((x) => ({ ...x, [pid]: Math.max(1, x[pid] ?? 0) })); setCheckout('order'); }} onOpen={(items, i) => setPostBox({ items, i })} onShare={(p) => void sharePost(p)} /></section>}

              {/* gallery */}
              {media.length > 0 && (
                <section id="gallery" className="scroll-mt-20"><h2 className="mb-4 font-display text-2xl font-semibold tracking-tight">{tx("Gallery")}</h2>
                  <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">{media.map((m, i) => (
                    <li key={m.id}><button type="button" onClick={() => setBox(i)} aria-label={m.caption || (m.kind === 'video' ? 'Play video' : 'Open photo')} className="group relative block aspect-square w-full overflow-hidden rounded-2xl bg-[#F0F2F5]">
                      {m.kind === 'image' ? <img src={mediaSrc(m.id)} alt={m.caption || ''} loading="lazy" className="h-full w-full object-cover transition group-hover:scale-105" /> : <><video src={`${mediaSrc(m.id)}#t=0.1`} preload="metadata" muted playsInline className="h-full w-full object-cover" /><span className="absolute inset-0 flex items-center justify-center bg-black/25"><span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90"><Play size={20} className="ml-0.5 text-[#0E1722]" /></span></span></>}
                    </button></li>))}</ul></section>)}

              <Sections b={b} preview={preview} />

              {/* about */}
              <section id="about" className="scroll-mt-20"><h2 className="mb-3 font-display text-2xl font-semibold tracking-tight">About {b.name}</h2>{b.about ? <p className="whitespace-pre-line text-[15.5px] leading-relaxed text-[#344054]">{b.about}</p> : <p className="text-[15px] text-[#667085]">{b.tagline || 'Welcome.'}</p>}</section>

              {/* contact */}
              <section id="contact" className="scroll-mt-20 rounded-3xl border border-[#E7EAEE] bg-[#F9FAFB] p-5 sm:p-6"><h2 className="font-display text-2xl font-semibold tracking-tight">{tx("Send us a message")}</h2><p className="mb-4 mt-1 text-sm text-[#667085]">{tx('Ask a question or place an order. Leave your phone number or email so the business can reply.')}</p><MessageForm slug={b.slug} preview={preview} products={b.products} /></section>
            </div>

            {/* sidebar */}
            <aside className="space-y-4">
              {(c.address || mapLink || loc) && <div className={panel}><h3 className="font-display text-lg font-semibold">{tx("Find us")}</h3>{loc ? <a href={mapLink!} target="_blank" rel="noreferrer" aria-label="Open in maps" className="mt-3 block overflow-hidden rounded-2xl"><MapTile lat={loc.lat} lng={loc.lng} height={150} /></a> : <div className="mt-3 flex h-28 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#E6EEF6,#F3F6FA)] text-[#98A2B3]"><MapPin size={34} /></div>}
                {c.address && <p className="mt-3 flex gap-2 text-[15px]"><MapPin size={17} className="mt-0.5 shrink-0 text-[#667085]" />{c.address}</p>}{mapLink && <a href={mapLink} target="_blank" rel="noreferrer" className="mt-3 flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#D5DBE3] text-sm font-semibold hover:bg-[#F6F7F9]"><MapPin size={16} />{tx("Open map")}</a>}</div>}
              {b.hours.length > 0 && <div id="hours" className={`${panel} scroll-mt-20`}><div className="flex items-center justify-between"><h3 className="font-display text-lg font-semibold">{tx("Opening hours")}</h3>{openNow !== null && <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${openNow ? 'bg-[#E8F6EE] text-[#14532D]' : 'bg-[#F0F2F5] text-[#475467]'}`}>{openNow ? tx('Open now') : tx('Closed')}</span>}</div>
                <ul className="mt-3 divide-y divide-[#EEF0F3] text-[14.5px]">{DAYS.map((d) => { const h = b.hours.find((x) => x.day === d.id); const today = d.id === todayKey; return <li key={d.id} className={`flex justify-between py-2 ${today ? 'font-semibold' : ''}`}><span>{tx(d.label)}</span><span className={h?.closed ? 'text-[#98A2B3]' : ''}>{!h ? '–' : h.closed ? tx('Closed') : `${h.open} – ${h.close}`}</span></li>; })}</ul></div>}
              <div className={panel}><h3 className="font-display text-lg font-semibold">{tx("Contact")}</h3>
                <ul className="mt-3 space-y-2.5 text-[14.5px]">
                  {c.phone && <li className="flex items-center gap-2.5"><Phone size={16} className="shrink-0 text-[#667085]" /><a href={`tel:+${c.phone}`} onClick={() => track('call')} className="flex-1 font-medium">+{c.phone}</a><button type="button" aria-label="Copy phone number" onClick={() => void copy(`+${c.phone}`, 'Number')} className="text-[#98A2B3] hover:text-[#0E1722]"><Copy size={15} /></button></li>}
                  {c.whatsapp && <li className="flex items-center gap-2.5"><MessageCircle size={16} className="shrink-0 text-[#667085]" /><a href={waLink!} target="_blank" rel="noreferrer" onClick={() => track('whatsapp')} className="flex-1 font-medium">WhatsApp +{c.whatsapp}</a></li>}
                  {c.email && <li className="flex items-center gap-2.5"><Mail size={16} className="shrink-0 text-[#667085]" /><a href={`mailto:${c.email}`} className="min-w-0 flex-1 truncate font-medium">{c.email}</a><button type="button" aria-label="Copy email" onClick={() => void copy(c.email!, 'Email')} className="text-[#98A2B3] hover:text-[#0E1722]"><Copy size={15} /></button></li>}
                  {c.website && <li className="flex items-center gap-2.5"><Globe size={16} className="shrink-0 text-[#667085]" /><a href={c.website} target="_blank" rel="noreferrer noopener" className="min-w-0 flex-1 truncate font-medium">{c.website.replace(/^https?:\/\//, '')}</a></li>}
                  {c.instagram && <li className="flex items-center gap-2.5"><Instagram size={16} className="shrink-0 text-[#667085]" /><a href={c.instagram} target="_blank" rel="noreferrer noopener" className="min-w-0 flex-1 truncate font-medium">Instagram</a></li>}
                  {c.facebook && <li className="flex items-center gap-2.5"><Facebook size={16} className="shrink-0 text-[#667085]" /><a href={c.facebook} target="_blank" rel="noreferrer noopener" className="min-w-0 flex-1 truncate font-medium">Facebook</a></li>}
                  {!c.phone && !c.whatsapp && !c.email && !c.website && <li className="text-[#667085]">Use the message form to reach {b.name}.</li>}
                </ul></div>
              {b.pay && <div className={panel}><h3 className="font-display text-lg font-semibold">{tx("How to pay")}</h3><div className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-[#F6F7F9] p-4"><div><p className="text-xs text-[#667085]">{tx("MTN MoMo Pay code")}</p><p className="font-mono text-2xl font-bold tracking-wider">{b.pay.momoCode}</p>{b.pay.momoName && <p className="text-sm text-[#475467]">{b.pay.momoName}</p>}</div><button type="button" onClick={() => void copy(b.pay!.momoCode, 'Code')} className="flex min-h-11 items-center gap-1.5 rounded-xl border border-[#D5DBE3] bg-white px-3 text-sm font-semibold"><Copy size={15} />{tx("Copy")}</button></div><p className="mt-2 text-xs text-[#667085]">{tx("Check the name on your phone before you pay.")}</p></div>}
              <div className={`${panel} text-center`}><h3 className="font-display text-lg font-semibold">{tx("Scan to open on your phone")}</h3>{qr ? <img src={qr} alt={`QR code for ${url}`} className="mx-auto mt-3 h-40 w-40 rounded-2xl border border-[#E7EAEE] p-1.5" /> : <div className="mx-auto mt-3 flex h-40 w-40 items-center justify-center rounded-2xl bg-[#F0F2F5] text-[#98A2B3]"><QrCode size={40} /></div>}
                <p className="mt-2 break-all font-mono text-xs text-[#667085]">{url.replace(/^https?:\/\//, '')}</p>
                <div className="mt-3 flex flex-wrap justify-center gap-2">{qr && <a href={qr} download={`${b.slug}-qr.png`} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-[#D5DBE3] px-3 text-sm font-semibold hover:bg-[#F6F7F9]"><Download size={15} />{tx("Save QR")}</a>}
                  {installEvt ? <button type="button" onClick={() => void install()} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-[var(--acc)] px-3 text-sm font-semibold text-[var(--on)]"><Smartphone size={15} />{tx("Install app")}</button> : <p className="w-full text-xs text-[#667085]">Tip: in your browser menu choose “Add to Home screen” to keep {b.name} as an app.</p>}</div></div>
            </aside>
          </div>

          <footer className="flex items-center justify-between gap-3 border-t border-[#E7EAEE] px-5 py-5 text-[13px] text-[#667085]"><a href="/" className="font-semibold text-[#0E1722]">{tx("Made with Bwenge4biz")}</a><button type="button" onClick={() => setReport(true)} className="inline-flex items-center gap-1.5 hover:text-[#0E1722]"><Flag size={14} />{tx("Report this page")}</button></footer>
        </div>
      </div>

      {/* cart bar */}
      {count > 0 && !checkout && <div className="fixed inset-x-0 bottom-0 z-40 p-3 sm:p-4"><button type="button" onClick={() => setCheckout('order')} className="mx-auto flex min-h-14 w-full max-w-xl items-center justify-between gap-3 rounded-2xl bg-[#0E1722] px-5 text-white shadow-2xl"><span className="inline-flex items-center gap-2.5 text-[15px] font-semibold"><span className="flex h-7 min-w-7 items-center justify-center rounded-full bg-[var(--acc)] px-1.5 text-sm text-[var(--on)]">{count}</span>{tx("View your order")}</span><b>{lines.every((l) => l.p.price !== null) ? `${total.toLocaleString('en-US')} RWF` : ''}</b></button></div>}
      {checkout && <Checkout b={b} cart={cart} setCart={setCart} preview={preview} startPay={checkout === 'pay'} waLink={waBase} onClose={() => setCheckout(null)} />}
      {postBox && <Lightbox items={postBox.items} index={postBox.i} src={mediaSrc} onClose={() => setPostBox(null)} onIndex={(i) => setPostBox({ ...postBox, i })} />}
      {box !== null && media.length > 0 && <Lightbox items={media} index={box} src={mediaSrc} onClose={() => setBox(null)} onIndex={setBox} />}
      {report && <ReportDialog slug={b.slug} onClose={() => setReport(false)} />}
      {toast && <p role="status" className="fixed bottom-24 left-1/2 z-[500] -translate-x-1/2 rounded-full bg-[#0E1722] px-4 py-2 text-sm text-white shadow-lg">{toast}</p>}
    </div>
  );
}

export default function BizPage(props: { business: PublicBusiness; openNow: boolean | null; mediaSrc: (id: string) => string; preview?: boolean }) {
  const base = props.business; const [lang, setLang] = useState<Lang>(() => initialLang(base)); const b = useMemo(() => localize(base, lang), [base, lang]); const tx = useMemo(() => makeTx(lang), [lang]);
  const change = (l: Lang) => { setLang(l); try { localStorage.setItem('bz-lang', l); } catch { /* optional */ } };
  return <TxContext.Provider value={tx}><BizPageInner {...props} business={b} base={base} lang={lang} setLang={change} /></TxContext.Provider>;
}
