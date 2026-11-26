import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { VideoPlayer, frameFor } from './VideoPlayer';
import { Bookmark, Download, FileText, ChevronLeft, ChevronRight, Heart, Loader2, MessageCircle, Pin, Send, ShoppingBag } from 'lucide-react';
import { publicApi } from '../../biz/api';
import { rwf, type PublicBusiness, type PublicPost } from '../../biz/types';
import { useTx } from '../../biz/i18n';
import { VerifiedBadge } from '../VerifiedBadge';

/**
 * The public feed, laid out like Instagram: a header with the business, the photos or videos you swipe through (double-tap to love), then love,
 * comment, share and Order, the number of loves, the caption, the comments and the time. Anyone can love and comment (a name and a few words, no sign-in);
 * a post can carry an Order button for one product. In the owner's preview nothing is sent.
 */
const ago = (iso: string, tx: (s: string) => string = (x) => x) => { const rw = tx('Open now') !== 'Open now'; const s = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 1000)); if (rw) { if (s < 60) return 'NONEHA'; if (s < 3600) return `IMINOTA ${Math.round(s / 60)} ISHIZE`; if (s < 86400) return `AMASAHA ${Math.round(s / 3600)} ASHIZE`; if (s < 7 * 86400) return `IMINSI ${Math.round(s / 86400)} ISHIZE`; return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }).toUpperCase(); } if (s < 60) return 'JUST NOW'; if (s < 3600) return `${Math.round(s / 60)} MINUTES AGO`; if (s < 86400) return `${Math.round(s / 3600)} HOURS AGO`; if (s < 7 * 86400) return `${Math.round(s / 86400)} DAYS AGO`; return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }).toUpperCase(); };
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || 'B';
const remembered = () => { try { return localStorage.getItem('bz-visitor-name') ?? ''; } catch { return ''; } };

export function Carousel({ items, src, onOpen, onDoubleTap, fitMedia = false }: { items: PublicPost['media']; src: (id: string) => string; onOpen: (i: number) => void; onDoubleTap: () => void; fitMedia?: boolean }) {
  const tx = useTx();
  const ref = useRef<HTMLUListElement>(null); const [i, setI] = useState(0); const last = useRef(0);
  const active = items[fitMedia ? i : 0] ?? items[0];
  const video = active?.kind === 'video' ? active.video : undefined;
  const shape = fitMedia && video?.w && video.h ? video.w / video.h
    : active?.kind === 'video' ? frameFor(video?.w, video?.h).aspect : 1;
  const single = fitMedia && items.length === 1;
  const go = (n: number) => { const el = ref.current; if (el) el.scrollTo({ left: n * el.clientWidth, behavior: 'smooth' }); };
  if (!items.length) return null;
  return (
    <div className="group relative bg-[#F0F2F5]">
      <ul ref={ref} onScroll={(e) => { const el = e.currentTarget; setI(Math.round(el.scrollLeft / Math.max(1, el.clientWidth))); }} className="flex snap-x snap-mandatory overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        {items.map((m, k) => (
          <li key={m.id} className="relative w-full shrink-0 snap-center" style={single ? undefined : { aspectRatio: String(shape), maxHeight: '85dvh' }}>
            {m.kind === 'video' ? <VideoPlayer media={m} src={src} fill={!single} naturalAspect={fitMedia} />
              : <button type="button" aria-label={tx("Open photo")} className="block h-full w-full" onClick={() => { const t = Date.now(); if (t - last.current < 320) { onDoubleTap(); last.current = 0; } else { last.current = t; window.setTimeout(() => { if (last.current === t) onOpen(k); }, 330); } }}><img src={src(m.id)} alt={m.caption || ''} loading="lazy" draggable={false} className={single ? "max-h-[85dvh] w-full object-contain" : `h-full w-full ${fitMedia ? "object-contain" : "object-cover"}`} /></button>}
          </li>))}
      </ul>
      {items.length > 1 && <>
        <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-xs font-medium text-white">{i + 1}/{items.length}</span>
        {i > 0 && <button type="button" aria-label={tx("Previous")} onClick={() => go(i - 1)} className="absolute left-2 top-1/2 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 shadow sm:flex"><ChevronLeft size={18} /></button>}
        {i < items.length - 1 && <button type="button" aria-label={tx("Next")} onClick={() => go(i + 1)} className="absolute right-2 top-1/2 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 shadow sm:flex"><ChevronRight size={18} /></button>}
        <div className="pointer-events-none absolute inset-x-0 bottom-2.5 flex justify-center gap-1.5" aria-hidden="true">{items.map((m, k) => <span key={m.id} className={`h-1.5 w-1.5 rounded-full ${k === i ? 'bg-[var(--acc)]' : 'bg-white/70'}`} />)}</div></>}
    </div>
  );
}

const PdfPreview = lazy(() => import('../PdfViewer').then(({ PdfViewer }) => ({ default: PdfViewer })));

function DocumentAttachment({ document, url }: {
  document: NonNullable<PublicPost['media'][number]['document']>;
  url: string;
}) {
  const [preview, setPreview] = useState(false);
  return (
    <li className="rounded-xl border border-[#E7EAEE] p-3">
      <div className="flex flex-wrap items-center gap-3">
        <FileText size={20} aria-hidden="true" />
        <span className="min-w-0 flex-1 break-words text-sm font-medium">{document.name}<span className="block text-xs font-normal text-[#667085]">{Math.max(1, Math.round(document.size / 1024)).toLocaleString()} KB</span></span>
        {document.mime === 'application/pdf' && <button type="button" aria-expanded={preview} onClick={() => setPreview(!preview)} className="text-sm underline">{preview ? 'Hide preview' : 'Preview PDF'}</button>}
        <a href={url} download={document.name} className="inline-flex items-center gap-1.5 text-sm underline"><Download size={16} />Download original</a>
      </div>
      {preview && <div className="mt-3 rounded-lg bg-stone-900 p-2">
        <Suspense fallback={<p role="status" className="text-sm text-white">Loading PDF…</p>}>
          <PdfPreview url={url} name={document.name} />
        </Suspense>
      </div>}
    </li>
  );
}

function PostCard({ b, p, mediaSrc, preview, onOrder, onOpen, onShare }: { b: PublicBusiness; p: PublicPost; mediaSrc: (id: string) => string; preview: boolean; onOrder: (productId: string) => void; onOpen: (items: PublicPost['media'], i: number) => void; onShare: (p: PublicPost) => void }) {
  const tx = useTx();
  const [liked, setLiked] = useState(p.liked); const [likes, setLikes] = useState(p.likes); const [burst, setBurst] = useState(false); const [open, setOpen] = useState(false); const [more, setMore] = useState(false);
  const [comments, setComments] = useState<Array<{ id: string; name: string; text: string; at: string; owner?: boolean }> | null>(null); const [count, setCount] = useState(p.comments);
  const [name, setName] = useState(remembered); const [text, setText] = useState(''); const [hp, setHp] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const input = useRef<HTMLInputElement>(null);
  const visualMedia = p.media.filter((m) => m.kind !== 'document');
  const documents = p.media.filter((m) => m.kind === 'document');
  const product = p.productId ? b.products.find((x) => x.id === p.productId) : undefined;
  const love = async (force?: boolean) => {
    if (force && liked) { setBurst(true); window.setTimeout(() => setBurst(false), 700); return; }
    const next = !liked; setLiked(next); setLikes((n) => Math.max(0, n + (next ? 1 : -1))); if (next) { setBurst(true); window.setTimeout(() => setBurst(false), 700); }
    if (preview) return; try { const r = await publicApi.like(b.slug, p.id); setLiked(r.liked); setLikes(r.likes); } catch { setLiked(!next); setLikes((n) => Math.max(0, n + (next ? -1 : 1))); }
  };
  const loadComments = async () => { if (preview) { setComments([]); return; } try { setComments(await publicApi.comments(b.slug, p.id)); } catch { setComments([]); } };
  const toggle = () => { const o = !open; setOpen(o); if (o && comments === null) void loadComments(); if (o) window.setTimeout(() => input.current?.focus(), 80); };
  const send = async (e: React.FormEvent) => {
    e.preventDefault(); if (preview || busy || !text.trim()) return; setBusy(true); setErr('');
    try { const c = await publicApi.comment(b.slug, p.id, { name, text, website: hp }); try { localStorage.setItem('bz-visitor-name', name); } catch { /* optional */ } setComments((l) => [...(l ?? []), c]); setCount((n) => n + 1); setText(''); }
    catch (x) { setErr(x instanceof Error ? x.message : 'Your comment could not be sent.'); } finally { setBusy(false); }
  };
  const savedKey = `bz-saved:${b.slug}`; const [saved, setSaved] = useState(() => { try { return (JSON.parse(localStorage.getItem(savedKey) ?? '[]') as string[]).includes(p.id); } catch { return false; } });
  const toggleSaved = () => { const next = !saved; setSaved(next); try { const cur = (JSON.parse(localStorage.getItem(savedKey) ?? '[]') as string[]).filter((x) => x !== p.id); localStorage.setItem(savedKey, JSON.stringify(next ? [...cur, p.id] : cur)); } catch { /* optional */ } };
  const long = p.text.length > 140 && !more;
  return (
    <li id={`post-${p.id}`} className="scroll-mt-20 overflow-hidden bg-white sm:rounded-2xl sm:border sm:border-[#E7EAEE] sm:shadow-sm">
      <div className="flex items-center gap-3 px-3 py-2.5 sm:px-3.5 sm:py-3">
        <span className="rounded-full bg-gradient-to-tr from-[var(--acc)] to-[#DB4F8E] p-[2.5px]"><span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border-2 border-white bg-[var(--acc)] text-xs font-bold text-[var(--on)]">{b.logo ? <img src={mediaSrc(b.logo.id)} alt="" className="h-full w-full object-cover" /> : initials(b.name)}</span></span>
        <div className="min-w-0 flex-1 leading-tight"><p className="truncate text-sm font-semibold">{b.name}{b.verified && <VerifiedBadge size={15} className="ml-1" />}</p>{product && <p className="truncate text-xs text-[#667085]">{product.name}</p>}</div>
        {p.pinned && <span className="inline-flex items-center gap-1 text-xs text-[#667085]"><Pin size={13} />{tx("Pinned")}</span>}
      </div>
      <div className="relative">
        <Carousel fitMedia={b.category === 'profile'} items={visualMedia} src={mediaSrc} onOpen={(k) => onOpen(visualMedia, k)} onDoubleTap={() => void love(true)} />
        {burst && <Heart aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 fill-white text-white drop-shadow-lg" size={96} style={{ animation: 'bzpop 0.7s ease-out forwards' }} />}
      </div>
      {documents.length > 0 && <ul className="space-y-2 px-3 pb-2">{documents.map((m) => m.document && <DocumentAttachment key={m.id} document={m.document} url={mediaSrc(m.id)} />)}</ul>}
      <div className="flex items-center gap-1 px-2 pt-2">
        <button type="button" aria-label={liked ? 'Remove love' : 'Love'} aria-pressed={liked} onClick={() => void love()} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-[#F6F7F9]"><Heart size={25} className={liked ? 'fill-[#E11D48] text-[#E11D48]' : 'text-[#0E1722]'} /></button>
        <button type="button" aria-label={tx("Comments")} onClick={toggle} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-[#F6F7F9]"><MessageCircle size={24} /></button>
        <button type="button" aria-label={tx("Share")} onClick={() => onShare(p)} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-[#F6F7F9]"><Send size={23} /></button>
        {product && product.available && <button type="button" onClick={() => onOrder(product.id)} className="ml-auto inline-flex min-h-10 items-center gap-2 rounded-xl bg-[var(--acc)] px-4 text-sm font-semibold text-[var(--on)] hover:opacity-90"><ShoppingBag size={16} />Order{product.price !== null ? ` · ${rwf(product.price)}` : ''}</button>}
        {product && !product.available && <span className="ml-auto pr-2 text-xs font-medium text-[#667085]">{tx("Out of stock")}</span>}
        {!product && <button type="button" aria-label={saved ? tx("Remove from saved") : tx("Save")} aria-pressed={saved} onClick={toggleSaved} className="ml-auto flex h-10 w-10 items-center justify-center rounded-full hover:bg-[#F6F7F9]"><Bookmark size={24} className={saved ? 'fill-[#0E1722] text-[#0E1722]' : 'text-[#0E1722]'} /></button>}
      </div>
      <div className="px-3 pb-3.5 sm:px-3.5">
        {likes > 0 && <p className="text-sm font-semibold">{likes.toLocaleString('en-US')} {tx(likes === 1 ? 'love' : 'loves')}</p>}
        {p.text && <p className="mt-1 whitespace-pre-wrap text-[15px] leading-snug"><b className="mr-1.5">{b.name}{b.verified && <VerifiedBadge size={15} className="ml-1" />}</b>{long ? <>{p.text.slice(0, 140)}… <button type="button" onClick={() => setMore(true)} className="text-[#667085]">{tx("more")}</button></> : p.text}</p>}
        {count > 0 && !open && <button type="button" onClick={toggle} className="mt-1.5 text-sm text-[#667085]">{tx('View all')} {count} {tx(count === 1 ? 'comment' : 'comments')}</button>}
        {open && (
          <div className="mt-2.5 space-y-2">
            {comments === null ? <Loader2 size={16} className="animate-spin text-[#667085]" /> : comments.map((c) => <p key={c.id} className="text-sm leading-snug"><b className="mr-1.5">{c.name}</b>{c.owner && <span className="mr-1.5 rounded bg-[var(--acc)]/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase">{tx("Business")}</span>}{c.text}</p>)}
            <form onSubmit={send} className="space-y-2 pt-1" noValidate>
              {!remembered() && <input value={name} onChange={(e) => setName(e.target.value)} placeholder={tx("Your name")} aria-label={tx("Your name")} maxLength={40} className="w-full rounded-xl border border-[#D5DBE3] px-3 py-2.5 text-sm outline-none focus:border-[var(--acc)]" />}
              <div className="flex items-center gap-2"><input ref={input} value={text} onChange={(e) => setText(e.target.value)} placeholder={tx("Add a comment…")} aria-label={tx("Add a comment")} maxLength={300} className="min-w-0 flex-1 rounded-xl border border-[#D5DBE3] px-3 py-2.5 text-sm outline-none focus:border-[var(--acc)]" />
                <button type="submit" disabled={preview || busy || !text.trim() || !name.trim()} className="min-h-10 rounded-xl px-3 text-sm font-semibold text-[var(--acc)] disabled:opacity-40" style={{ color: 'var(--acc)' }}>{busy ? <Loader2 size={16} className="animate-spin" /> : 'Post'}</button></div>
              <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', height: 0, overflow: 'hidden' }}><label>Website<input tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} /></label></div>
              {err && <p role="alert" className="text-xs text-[#9B1C1C]">{err}</p>}
            </form>
          </div>)}
        <p className="mt-2 text-[10.5px] font-medium tracking-wide text-[#98A2B3]">{ago(p.at, tx)}</p>
      </div>
    </li>
  );
}

export default function FeedSection({ b, posts, mediaSrc, preview, onOrder, onOpen, onShare }: { b: PublicBusiness; posts: PublicPost[]; mediaSrc: (id: string) => string; preview: boolean; onOrder: (productId: string) => void; onOpen: (items: PublicPost['media'], i: number) => void; onShare: (p: PublicPost) => void }) {
  useEffect(() => { if (document.getElementById('bz-keyframes')) return; const s = document.createElement('style'); s.id = 'bz-keyframes'; s.textContent = '@keyframes bzpop{0%{opacity:0;transform:translate(-50%,-50%) scale(.4)}25%{opacity:1;transform:translate(-50%,-50%) scale(1.15)}60%{opacity:1;transform:translate(-50%,-50%) scale(1)}100%{opacity:0;transform:translate(-50%,-50%) scale(1)}}'; document.head.appendChild(s); }, []);
  if (!posts.length) return null;
  return <ul className="mx-auto max-w-[520px] lg:max-w-[640px] divide-y divide-[#EEF0F3] border-y border-[#EEF0F3] sm:space-y-5 sm:divide-y-0 sm:border-y-0">{posts.map((p) => <PostCard key={p.id} b={b} p={p} mediaSrc={mediaSrc} preview={preview} onOrder={onOrder} onOpen={onOpen} onShare={onShare} />)}</ul>;
}
