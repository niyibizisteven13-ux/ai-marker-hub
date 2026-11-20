import { useEffect, useMemo, useState } from 'react';
import { Award, BadgeCheck, Briefcase, CalendarDays, Check, ExternalLink, FileText, GraduationCap, Grid3x3, HeartHandshake, Link2, Loader2, Mail, MapPin, MessageCircle, Play, QrCode, Route, Send, Share2, Sparkles, Trophy, X } from 'lucide-react';
import { VerifiedBadge } from '../VerifiedBadge';
import { VideoPlayer } from './VideoPlayer';
import FeedSection from './Feed';
import { publicApi } from '../../biz/api';
import { THEMES, type PublicBusiness, type PublicMedia, type PublicPost } from '../../biz/types';
import { useTx } from '../../biz/i18n';

/**
 * Bwenge4profile: a person's own page (a student or a professional). It answers "who is this and what have they done?" in one link that can go in an application
 * letter, an email or a WhatsApp message: a short line about them, their best videos first, what they studied, did and attended (with pictures and clips),
 * their skills, links and a way to get in touch. Phone first. The same component is the preview in the owner's studio (`preview`: nothing is counted or sent).
 */
type Item = NonNullable<PublicBusiness['profile']>['timeline'][number];
const KIND: Record<Item['kind'], { label: string; icon: typeof Award }> = {
  education: { label: 'Education', icon: GraduationCap }, experience: { label: 'Experience', icon: Briefcase }, project: { label: 'Project', icon: Sparkles },
  award: { label: 'Award', icon: Trophy }, event: { label: 'Attended', icon: CalendarDays }, volunteer: { label: 'Volunteering', icon: HeartHandshake }, certificate: { label: 'Certificate', icon: Award },
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const when = (v?: string) => { if (!v) return ''; if (v === 'present') return 'Present'; const [y, m] = v.split('-'); return m ? `${MONTHS[Number(m) - 1]} ${y}` : y; };
export const rangeText = (t: { from?: string; to?: string }) => { const a = when(t.from), z = when(t.to); return a && z && a !== z ? `${a} – ${z}` : a || z; };
/** Newest first: by the end date (present is newest), then the start date. */
export const sortTimeline = <T extends { from?: string; to?: string }>(items: T[]): T[] => { const key = (t: T) => `${t.to === 'present' ? '9999-99' : t.to ?? t.from ?? '0000'}|${t.from ?? '0000'}`; return [...items].sort((a, b) => key(b).localeCompare(key(a))); };
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || 'B';

function PhotoViewer({ items, i, src, onClose, onIndex }: { items: PublicMedia[]; i: number; src: (id: string) => string; onClose: () => void; onIndex: (i: number) => void }) {
  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); if (e.key === 'ArrowRight') onIndex((i + 1) % items.length); if (e.key === 'ArrowLeft') onIndex((i - 1 + items.length) % items.length); }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [i, items.length, onClose, onIndex]);
  const m = items[i]; if (!m) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label="Picture" className="fixed inset-0 z-[400] flex items-center justify-center bg-black/90 p-3" onClick={onClose}>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white"><X size={22} /></button>
      <div className="max-h-full w-full max-w-3xl" onClick={(e) => e.stopPropagation()}>
        {m.kind === 'video' ? <div className="overflow-hidden rounded-xl"><VideoPlayer media={m} src={src} startUnmuted /></div> : <img src={src(m.id)} alt={m.caption ?? ''} className="mx-auto max-h-[85vh] w-auto rounded-xl object-contain" />}
        {m.caption && <p className="mt-2 text-center text-sm text-white/85">{m.caption}</p>}
        {items.length > 1 && <div className="mt-3 flex justify-center gap-1.5">{items.map((x, k) => <button key={x.id} type="button" aria-label={`Show ${k + 1}`} onClick={() => onIndex(k)} className={`h-2 rounded-full ${k === i ? 'w-6 bg-white' : 'w-2 bg-white/40'}`} />)}</div>}
      </div>
    </div>
  );
}

function ContactForm({ slug, preview, accent, onAccent }: { slug: string; preview: boolean; accent: string; onAccent: string }) {
  const tx = useTx(); const [f, setF] = useState({ name: '', contact: '', message: '', website: '' }); const [state, setState] = useState<'idle' | 'busy' | 'sent'>('idle'); const [err, setErr] = useState('');
  const field = 'w-full rounded-xl border border-[#D0D5DD] bg-white px-3.5 py-3 text-[15px] text-[#0E1722] outline-none focus:border-[#0E1722]';
  const submit = async (e: React.FormEvent) => { e.preventDefault(); if (preview) { setErr(tx('This is a preview: nothing is sent.')); return; } setState('busy'); setErr(''); try { await publicApi.enquiry(slug, f); setState('sent'); } catch (x) { setErr(x instanceof Error ? x.message : 'Something went wrong. Please try again.'); setState('idle'); } };
  if (state === 'sent') return <p role="status" className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-[15px] font-medium text-emerald-800"><Check size={18} />{tx('Thank you. Your message was sent.')}</p>;
  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block text-sm"><span className="mb-1 block text-[#475467]">{tx('Your name')}</span><input className={field} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={80} autoComplete="name" /></label>
      <label className="block text-sm"><span className="mb-1 block text-[#475467]">{tx('Your phone or email')}</span><input className={field} value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} required maxLength={120} autoComplete="email" /></label>
      <label className="block text-sm"><span className="mb-1 block text-[#475467]">{tx('Message')}</span><textarea className={`${field} min-h-24`} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} required maxLength={1000} /></label>
      <input type="text" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} />
      {err && <p role="alert" className="text-sm text-rose-600">{err}</p>}
      <button type="submit" disabled={state === 'busy'} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-5 text-[15px] font-semibold disabled:opacity-60" style={{ background: accent, color: onAccent }}>{state === 'busy' ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}{tx('Send message')}</button>
    </form>
  );
}

export default function ProfilePage({ business: b, mediaSrc, preview = false }: { business: PublicBusiness; mediaSrc: (id: string) => string; preview?: boolean }) {
  const tx = useTx(); const theme = THEMES[b.theme] ?? THEMES.gold; const p = b.profile ?? { skills: [], links: [], featured: [], timeline: [] };
  const [posts, setPosts] = useState<PublicPost[]>([]); const [view, setView] = useState<{ items: PublicMedia[]; i: number } | null>(null); const [toast, setToast] = useState(''); const [qr, setQr] = useState(''); const [showQr, setShowQr] = useState(false);
  const url = `${typeof window !== 'undefined' ? window.location.origin : 'https://www.bwenge.space'}/p/${b.slug}`; const c = b.contact;
  useEffect(() => { let alive = true; void publicApi.posts(b.slug).then((x) => { if (alive) setPosts(x); }).catch(() => undefined); return () => { alive = false; }; }, [b.slug, b.updatedAt]);
  useEffect(() => { if (!showQr || qr) return; let alive = true; void import('qrcode').then((m: any) => (m.default ?? m).toDataURL(url, { margin: 1, width: 420, color: { dark: '#0E1722', light: '#FFFFFF' } })).then((d: string) => { if (alive) setQr(d); }).catch(() => undefined); return () => { alive = false; }; }, [showQr, qr, url]);
  const say = (t: string) => { setToast(t); window.setTimeout(() => setToast(''), 2200); };
  const track = (k: 'whatsapp' | 'call' | 'share') => { if (!preview) publicApi.track(b.slug, k); };
  const share = async () => { track('share'); try { if (navigator.share) { await navigator.share({ title: b.name, text: p.headline || b.name, url }); return; } await navigator.clipboard.writeText(url); say(tx('Link copied')); } catch { /* cancelled */ } };
  const copy = async () => { try { await navigator.clipboard.writeText(url); say(tx('Link copied')); } catch { say(tx('Copy the link by hand')); } };
  const timeline = useMemo(() => sortTimeline(p.timeline), [p.timeline]);
  const featured = useMemo(() => (p.featured.length ? p.featured : b.gallery.filter((m) => m.kind === 'video').slice(0, 2)), [p.featured, b.gallery]);
  const wa = c.whatsapp ? `https://wa.me/${c.whatsapp}?text=${encodeURIComponent(`Hello ${b.name}, I saw your profile on Bwenge.`)}` : null;
  const photos = b.gallery.filter((m) => m.kind === 'image' && !featured.some((f) => f.id === m.id)); const hasContact = !!(wa || c.email || c.phone);
  const h2 = 'font-display text-2xl font-semibold tracking-tight text-[#0E1722]'; const panel = '-mx-4 border-y border-[#E7EAEE] bg-white p-5 sm:mx-0 sm:rounded-3xl sm:border sm:p-6 sm:shadow-sm';
  const meta = [p.school, p.field].filter(Boolean).join(' · ');

  const videoCount = useMemo(() => new Set([...featured, ...b.gallery, ...timeline.flatMap((t) => t.media ?? [])].filter((m) => m.kind === 'video').map((m) => m.id)).size, [featured, b.gallery, timeline]);
  const highlights = ([['watch', 'Watch', Play, featured.length > 0], ['journey', 'Journey', Route, timeline.length > 0], ['skills', 'Skills', Sparkles, p.skills.length > 0], ['updates', 'Posts', Grid3x3, posts.length > 0], ['links', 'Links', Link2, p.links.length > 0], ['contact', 'Contact', MessageCircle, true]] as const).filter((h) => h[3]).map((h) => [h[0], h[1], h[2]] as const);
  const actions = (<>
    {hasContact && <a href="#contact" className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-5 text-[15px] font-semibold sm:flex-none" style={{ background: theme.accent, color: theme.on }}><MessageCircle size={18} />{tx('Get in touch')}</a>}
    {p.cvUrl && <a href={p.cvUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#D0D5DD] bg-white px-4 text-[15px] font-semibold"><FileText size={18} />{tx('View CV')}</a>}
    <button type="button" onClick={() => void share()} aria-label={tx('Share')} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#D0D5DD] bg-white px-4 text-[15px] font-semibold"><Share2 size={18} /><span className="hidden sm:inline">{tx('Share')}</span></button>
  </>);

  return (
    <div className="min-h-[100dvh] bg-[#EEF0F3] font-sans text-[#0E1722]" style={{ ['--acc' as string]: theme.accent }}>
      <div className="mx-auto max-w-3xl pb-28 sm:pb-10">
        <header className="bg-white sm:mt-4 sm:overflow-hidden sm:rounded-3xl sm:shadow-sm">
          <div className="relative h-32 w-full overflow-hidden sm:h-52" style={{ background: `linear-gradient(135deg, ${theme.accent}, #0E1722)` }}>
            {b.cover && <img src={mediaSrc(b.cover.id)} alt="" className="h-full w-full object-cover" />}
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
          </div>
          <div className="relative px-4 pb-4 sm:px-8 sm:pb-6">
            <div className="-mt-12 flex items-end justify-between gap-3 sm:-mt-14">
              <span className="rounded-full bg-gradient-to-tr from-[var(--acc)] via-[#DB4F8E] to-[#F59E0B] p-[3px] shadow-lg">
                <span className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border-[4px] border-white text-3xl font-bold sm:h-28 sm:w-28" style={{ background: theme.accent, color: theme.on }}>{b.logo ? <img src={mediaSrc(b.logo.id)} alt={b.name} className="h-full w-full object-cover" /> : initials(b.name)}</span>
              </span>
              <div className="hidden gap-2 pb-1 sm:flex">{actions}</div>
            </div>
            <h1 className="mt-3 flex flex-wrap items-center gap-2 font-display text-[26px] font-semibold leading-tight tracking-tight sm:text-3xl">{b.name}{b.verified && <VerifiedBadge size={22} />}</h1>
            {p.headline && <p className="mt-1 text-[16px] font-medium leading-snug text-[#344054] sm:text-[17px]">{p.headline}</p>}
            {(meta || p.location) && <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[14px] text-[#667085]">{meta && <span className="inline-flex items-center gap-1.5"><GraduationCap size={15} />{meta}</span>}{p.location && <span className="inline-flex items-center gap-1.5"><MapPin size={15} />{p.location}</span>}</p>}
            {p.openTo && <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-[13px] font-semibold text-emerald-800"><span className="h-2 w-2 rounded-full bg-emerald-500" />{p.openTo}</p>}
            <dl className="mt-4 grid grid-cols-3 divide-x divide-[#EEF0F3] rounded-2xl border border-[#EEF0F3] bg-[#FAFBFC] py-3 text-center">
              {[[videoCount, 'Videos'], [timeline.length, 'Journey'], [posts.length, 'Posts']].map(([n, l]) => <div key={l as string}><dt className="sr-only">{tx(l as string)}</dt><dd className="font-display text-[22px] font-semibold leading-none">{n as number}</dd><p className="mt-1 text-[12px] font-medium text-[#667085]" aria-hidden="true">{tx(l as string)}</p></div>)}
            </dl>
            <div className="mt-3 flex gap-2 sm:hidden">{actions}</div>
          </div>
          <nav aria-label={tx('Sections')} className="flex gap-4 overflow-x-auto border-t border-[#EEF0F3] px-4 py-3.5 sm:px-8" style={{ scrollbarWidth: 'none' }}>
            {highlights.map(([id, label, Icon]) => <a key={id} href={`#${id}`} className="flex w-[68px] shrink-0 flex-col items-center gap-1.5 text-center"><span className="rounded-full bg-gradient-to-tr from-[var(--acc)] to-[#DB4F8E] p-[2px]"><span className="flex h-[58px] w-[58px] items-center justify-center rounded-full border-2 border-white bg-[#F4F6F8] text-[#0E1722]"><Icon size={22} aria-hidden="true" /></span></span><span className="text-[11.5px] font-medium text-[#344054]">{tx(label)}</span></a>)}
          </nav>
        </header>

        <main className="space-y-2.5 px-4 pt-2.5 sm:space-y-4 sm:px-0 sm:pt-4">
          {featured.length > 0 && <section id="watch" aria-label={tx('Featured videos')} className="-mx-4 scroll-mt-4 space-y-3 sm:mx-0"><h2 className={`${h2} px-4 sm:px-0`}>{tx('Watch me')}</h2><div className="grid gap-px bg-[#EEF0F3] sm:gap-3 sm:bg-transparent sm:grid-cols-2">{featured.map((m, k) => <div key={m.id} className="overflow-hidden bg-black sm:rounded-2xl sm:shadow-sm">{m.kind === 'video' ? <VideoPlayer media={m} src={mediaSrc} /> : <button type="button" onClick={() => setView({ items: featured, i: k })} className="block w-full"><img src={mediaSrc(m.id)} alt={m.caption ?? ''} className="w-full object-cover" /></button>}{m.caption && <p className="bg-white px-3.5 py-2.5 text-[14px] text-[#344054]">{m.caption}</p>}</div>)}</div></section>}

          {b.about && <section className={panel}><h2 className={h2}>{tx('About me')}</h2><p className="mt-3 whitespace-pre-line text-[16px] leading-relaxed text-[#344054]">{b.about}</p></section>}

          {p.skills.length > 0 && <section id="skills" className={`${panel} scroll-mt-4`}><h2 className={h2}>{tx('Skills')}</h2><ul className="mt-3 flex flex-wrap gap-2">{p.skills.map((s) => <li key={s} className="rounded-full px-3.5 py-1.5 text-[14px] font-medium" style={{ background: `${theme.accent}22`, color: '#0E1722' }}>{s}</li>)}</ul></section>}

          {timeline.length > 0 && <section id="journey" className={`${panel} scroll-mt-4`} aria-label={tx('My journey')}><h2 className={h2}>{tx('My journey')}</h2>
            <ol className="relative mt-5 space-y-7 border-l-2 border-[#E7EAEE] pl-6">{timeline.map((t) => { const K = KIND[t.kind] ?? KIND.event; const Icon = K.icon; const all = t.media ?? []; return (
              <li key={t.id} className="relative">
                <span className="absolute -left-[37px] flex h-8 w-8 items-center justify-center rounded-full border-2 border-white" style={{ background: theme.accent, color: theme.on }}><Icon size={15} /></span>
                <p className="text-[12px] font-semibold uppercase tracking-wider text-[#667085]">{tx(K.label)}{rangeText(t) ? ` · ${rangeText(t)}` : ''}</p>
                <h3 className="mt-0.5 text-[18px] font-semibold leading-snug">{t.title}</h3>
                {(t.org || t.place) && <p className="text-[14.5px] text-[#475467]">{[t.org, t.place].filter(Boolean).join(' · ')}</p>}
                {t.text && <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed text-[#344054]">{t.text}</p>}
                {t.url && <a href={t.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-[14px] font-semibold text-[#2F6FED]"><ExternalLink size={14} />{tx('Open the link')}</a>}
                {all.length > 0 && <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">{all.map((m, i) => m.kind === 'video' && all.length === 1 ? <div key={m.id} className="col-span-2 overflow-hidden rounded-xl sm:col-span-3"><VideoPlayer media={m} src={mediaSrc} /></div> : (
                  <button key={m.id} type="button" onClick={() => setView({ items: all, i })} className="relative aspect-square overflow-hidden rounded-xl bg-[#EEF0F3]" aria-label={m.kind === 'video' ? tx('Play') : tx('Open the picture')}>
                    <img src={m.kind === 'video' ? `${mediaSrc(m.id)}/poster${m.video?.rev ? `?r=${m.video.rev}` : ''}` : mediaSrc(m.id)} alt={m.caption ?? ''} loading="lazy" className="h-full w-full object-cover" />
                    {m.kind === 'video' && <span className="absolute inset-0 flex items-center justify-center bg-black/25 text-white"><span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-xl">▶</span></span>}
                  </button>))}</div>}
              </li>); })}</ol></section>}

          {photos.length > 0 && <section className={panel}><h2 className={h2}>{tx('Photos')}</h2><div className="mt-3 grid grid-cols-3 gap-2">{photos.map((m, i) => <button key={m.id} type="button" onClick={() => setView({ items: photos, i })} className="aspect-square overflow-hidden rounded-xl bg-[#EEF0F3]" aria-label={tx('Open the picture')}><img src={mediaSrc(m.id)} alt={m.caption ?? ''} loading="lazy" className="h-full w-full object-cover" /></button>)}</div></section>}

          {posts.length > 0 && <section id="updates" className="-mx-4 scroll-mt-4 space-y-3 sm:mx-0"><h2 className={`${h2} px-4 sm:px-1`}>{tx('Latest')}</h2>
            <FeedSection b={b} posts={posts} mediaSrc={mediaSrc} preview={preview} onOrder={() => undefined} onOpen={(items, i) => setView({ items, i })} onShare={(post) => { const u = `${url}?post=${post.id}#post-${post.id}`; track('share'); void (navigator.share ? navigator.share({ title: b.name, url: u }).catch(() => undefined) : navigator.clipboard.writeText(u).then(() => say(tx('Link copied')))); }} /></section>}

          {p.links.length > 0 && <section id="links" className={`${panel} scroll-mt-4`}><h2 className={h2}>{tx('Find me online')}</h2><ul className="mt-3 grid gap-2 sm:grid-cols-2">{p.links.map((l) => <li key={l.id}><a href={l.url} target="_blank" rel="noreferrer noopener" className="flex min-h-12 items-center gap-3 rounded-xl border border-[#E7EAEE] px-4 text-[15px] font-semibold hover:bg-[#F9FAFB]"><Link2 size={17} className="shrink-0 text-[#667085]" /><span className="truncate">{l.label}</span><ExternalLink size={14} className="ml-auto shrink-0 text-[#98A2B3]" /></a></li>)}</ul></section>}

          <section id="contact" className={`${panel} scroll-mt-20`}><h2 className={h2}>{tx('Get in touch')}</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {wa && <a href={wa} target="_blank" rel="noreferrer" onClick={() => track('whatsapp')} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#16A34A] px-4 text-[15px] font-semibold text-white"><MessageCircle size={18} />WhatsApp</a>}
              {c.email && <a href={`mailto:${c.email}`} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#D0D5DD] bg-white px-4 text-[15px] font-semibold"><Mail size={18} />{c.email}</a>}
              {c.phone && <a href={`tel:${c.phone}`} onClick={() => track('call')} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#D0D5DD] bg-white px-4 text-[15px] font-semibold">{tx('Call')} +{c.phone}</a>}
            </div>
            <div className="mt-4"><ContactForm slug={b.slug} preview={preview} accent={theme.accent} onAccent={theme.on} /></div>
          </section>

          <section className="rounded-3xl bg-[#0E1722] p-5 text-white sm:p-6">
            <p className="text-sm text-white/70">{tx('My profile link')}</p>
            <p className="mt-1 break-all font-mono text-[15px]">{url}</p>
            <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => void copy()} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-4 text-[15px] font-semibold text-[#0E1722]"><Link2 size={17} />{tx('Copy link')}</button><button type="button" onClick={() => setShowQr((v) => !v)} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/30 px-4 text-[15px] font-semibold"><QrCode size={17} />{tx('QR code')}</button></div>
            {showQr && (qr ? <img src={qr} alt="QR code" className="mt-4 h-44 w-44 rounded-xl bg-white p-2" /> : <Loader2 className="mt-4 animate-spin" />)}
          </section>
          <p className="flex items-center justify-center gap-1.5 pb-4 pt-1 text-[13px] text-[#667085]"><BadgeCheck size={14} />{tx('Made with')} <a href="/" className="font-semibold text-[#0E1722] underline">Bwenge4profile</a></p>
        </main>
      </div>

      {hasContact && <div className="fixed inset-x-0 bottom-0 z-30 flex gap-2 border-t border-[#E7EAEE] bg-white/95 p-3 backdrop-blur sm:hidden"><a href="#contact" className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl text-[15px] font-semibold" style={{ background: theme.accent, color: theme.on }}><MessageCircle size={18} />{tx('Get in touch')}</a><button type="button" onClick={() => void share()} aria-label={tx('Share')} className="flex h-12 w-12 items-center justify-center rounded-xl border border-[#D0D5DD]"><Share2 size={19} /></button></div>}
      {view && <PhotoViewer items={view.items} i={view.i} src={mediaSrc} onClose={() => setView(null)} onIndex={(i) => setView({ ...view, i })} />}
      {toast && <p role="status" className="fixed bottom-24 left-1/2 z-[500] -translate-x-1/2 rounded-full bg-[#0E1722] px-4 py-2 text-sm text-white shadow-lg">{toast}</p>}
    </div>
  );
}
