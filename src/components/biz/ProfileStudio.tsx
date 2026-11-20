import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Check, CheckCircle2, Circle, Copy, Eye, Heart, ImagePlus, Loader2, MessageCircle, MousePointerClick, Pencil, Plus, QrCode, Trash2, Video as VideoIcon, Wallet } from 'lucide-react';
import { tx } from '../../biz/studioI18n';
import { ownerApi, prepareImage } from '../../biz/api';
import { pageUrl, rwf, type Business, type Dashboard, type TimelineItem, type TimelineKind } from '../../biz/types';
import { btnGhost, btnPrimary, card, input, msg, Tag } from './ui';
import { rangeText, sortTimeline } from './ProfilePage';

/** The owner's home screen for a content creator or a personal profile (Bwenge4profile): attention earned, what to do next, and the profile editor. */
const KINDS: Array<[TimelineKind, string]> = [['education', 'Education'], ['experience', 'Experience'], ['project', 'Project'], ['event', 'Event I attended'], ['award', 'Award'], ['certificate', 'Certificate'], ['volunteer', 'Volunteering']];
const pct = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 100) : null);
const hello = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };

function Stat({ icon: Icon, label, value, change, tint }: { icon: typeof Eye; label: string; value: string; change?: number | null; tint: string }) {
  return (
    <div className={`rounded-2xl border border-[var(--app-line)] p-4 ${tint}`}>
      <div className="flex items-center gap-2.5"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/80 shadow-sm"><Icon size={18} aria-hidden="true" /></span><p className="text-sm font-medium text-[var(--app-muted)]">{tx(label)}</p></div>
      <p className="mt-3 font-display text-[26px] font-semibold leading-none tracking-tight">{value}</p>
      <div className="mt-2 min-h-[18px]">{change === undefined ? null : change === null ? <span className="text-xs text-[var(--app-faint)]">{tx('no data before')}</span> : <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${change >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>{change >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{Math.abs(change)}% <span className="font-normal text-[var(--app-muted)]">{tx('than the week before')}</span></span>}</div>
    </div>
  );
}

function Bars({ series }: { series: Array<{ day: string; views: number; taps: number }> }) {
  const max = Math.max(1, ...series.map((s) => s.views)); const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short' });
  return (
    <div role="img" aria-label={tx('Views in the last 7 days')} className="flex h-36 items-end gap-2">
      {series.map((s) => <div key={s.day} className="flex min-w-0 flex-1 flex-col items-center gap-1.5"><div className="flex h-28 w-full items-end"><div title={`${s.views} ${tx('views')}, ${s.taps} ${tx('taps')}`} className="w-full rounded-t-md bg-[var(--brand)]" style={{ height: `${Math.max(4, (s.views / max) * 100)}%`, opacity: s.views ? 1 : 0.25 }} /></div><span className="text-[11px] text-[var(--app-muted)]">{day(s.day)}</span></div>)}
    </div>
  );
}

/** What makes a profile convincing, with where to fix each: a student sees at once what is missing. */
export function strength(b: Business) {
  const p = b.profile; const videos = b.media.some((m) => m.kind === 'video');
  const items: Array<{ ok: boolean; text: string; go: 'profile' | 'feed' | 'dashboard' }> = [
    { ok: !!b.logoId, text: 'A clear photo of you', go: 'profile' }, { ok: !!p?.headline, text: 'A one-line headline (what you study or do)', go: 'profile' }, { ok: (b.about ?? '').length >= 60, text: 'A short “about me” (a few sentences)', go: 'profile' },
    { ok: (p?.skills.length ?? 0) >= 3, text: 'At least 3 skills', go: 'profile' }, { ok: (p?.timeline.length ?? 0) >= 3, text: 'At least 3 things you have done (course, project, event…)', go: 'profile' },
    { ok: videos, text: 'One video of you (introduce yourself in 30 seconds)', go: 'profile' }, { ok: !!(b.whatsapp || b.email), text: 'A way to contact you', go: 'profile' }, { ok: !!(p?.links.length || p?.cvUrl), text: 'A link to your CV, LinkedIn or work', go: 'profile' }, { ok: b.published, text: 'Published, so the link works', go: 'dashboard' },
  ];
  return { items, score: Math.round((items.filter((i) => i.ok).length / items.length) * 100) };
}

export function AudienceDashboard({ b, kind, go, onChange }: { b: Business; kind: 'creator' | 'profile'; go: (v: string) => void; onChange: () => void }) {
  const [d, setD] = useState<Dashboard | null>(null); const [err, setErr] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const [qr, setQr] = useState(''); const [showQr, setShowQr] = useState(false);
  const url = pageUrl(b.slug, undefined, b.category);
  useEffect(() => { ownerApi.dashboard(b.id, 7).then(setD).catch((e) => setErr(msg(e))); }, [b.id, b.updatedAt]);
  useEffect(() => { if (!showQr || qr) return; let alive = true; void import('qrcode').then((m: any) => (m.default ?? m).toDataURL(url, { margin: 1, width: 400, color: { dark: '#0E1722', light: '#FFFFFF' } })).then((x: string) => { if (alive) setQr(x); }).catch(() => undefined); return () => { alive = false; }; }, [showQr, qr, url]);
  const a = d?.audience; const taps = (s?: { whatsapp: number; calls: number; shares: number }) => (s ? s.whatsapp + s.calls + s.shares : 0);
  const toggle = async () => { setBusy(true); setNote(''); try { await ownerApi.publish(b.id, !b.published); onChange(); } catch (e) { setNote(msg(e)); } finally { setBusy(false); } };
  const copy = async () => { try { await navigator.clipboard.writeText(url); setNote('Link copied'); } catch { setNote('Copy the link by hand'); } };
  const st = useMemo(() => strength(b), [b]);
  return (
    <div className="space-y-5">
      <div><h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">{tx(hello())} 👋</h1><p className="mt-1 text-[15px] text-[var(--app-muted)]">{kind === 'profile' ? tx('Here is how people are finding your profile.') : tx('Here is how your content is doing.')}</p></div>
      {err && <p role="alert" className="rounded-xl bg-rose-500/10 px-4 py-2.5 text-sm text-rose-600">{err}</p>}

      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0"><p className="text-sm font-semibold">{kind === 'profile' ? tx('Your profile link') : tx('Your page link')}</p><p className="mt-1 break-all font-mono text-[14px] text-[var(--app-muted)]">{url.replace(/^https?:\/\//, '')}</p>{kind === 'profile' && <p className="mt-1 text-xs text-[var(--app-muted)]">{tx('Put this link in your application letter, your email signature, your CV or a WhatsApp message.')}</p>}</div>
          <div className="flex flex-wrap gap-2"><button type="button" className={btnGhost} onClick={() => void copy()}><Copy size={15} />{tx('Copy link')}</button><button type="button" className={btnGhost} onClick={() => setShowQr((v) => !v)}><QrCode size={15} />{tx('QR code')}</button><button type="button" disabled={busy} onClick={() => void toggle()} className={b.published ? btnGhost : btnPrimary}>{busy && <Loader2 size={15} className="animate-spin" />}{b.published ? tx('Unpublish') : tx('Publish')}</button></div>
        </div>
        {showQr && (qr ? <img src={qr} alt="QR code" className="mt-4 h-40 w-40 rounded-xl border border-[var(--app-line)] bg-white p-2" /> : <Loader2 className="mt-4 animate-spin text-[var(--brand)]" />)}
        {note && <p role="status" className="mt-3 text-sm text-[var(--app-muted)]">{tx(note)}</p>}
        {!b.published && <p className="mt-3 rounded-xl bg-amber-500/10 px-3 py-2 text-xs">{tx('Not published yet: only you can see the page. Press Publish when you are happy with it.')}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={Eye} label="Views (7 days)" value={a ? String(a.week.views) : '…'} change={a ? pct(a.week.views, a.before.views) : undefined} tint="bg-gradient-to-br from-sky-50 to-white" />
        <Stat icon={MousePointerClick} label="Taps (WhatsApp, call, share)" value={a ? String(taps(a.week)) : '…'} change={a ? pct(taps(a.week), taps(a.before)) : undefined} tint="bg-gradient-to-br from-violet-50 to-white" />
        {kind === 'creator'
          ? <Stat icon={Wallet} label="Earnings (7 days)" value={d ? rwf(d.range.sales) : '…'} tint="bg-gradient-to-br from-emerald-50 to-white" />
          : <Stat icon={MessageCircle} label="New messages" value={d ? String(d.newMessages) : '…'} tint="bg-gradient-to-br from-emerald-50 to-white" />}
        <Stat icon={Heart} label="Loves and comments" value={a ? String(a.likes + a.comments) : '…'} tint="bg-gradient-to-br from-rose-50 to-white" />
      </div>

      {kind === 'profile' && (
        <div className={card}>
          <div className="flex items-center justify-between gap-3"><h2 className="font-display text-lg font-semibold">{tx('Profile strength')}</h2><span className="font-display text-2xl font-semibold">{st.score}%</span></div>
          <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-[var(--app-bg)]"><div className="h-full rounded-full bg-[var(--brand)] transition-all" style={{ width: `${st.score}%` }} /></div>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">{st.items.map((i) => <li key={i.text}><button type="button" onClick={() => !i.ok && go(i.go)} disabled={i.ok} className={`flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm ${i.ok ? 'text-[var(--app-muted)]' : 'border border-[var(--app-line)] font-medium hover:bg-[var(--app-panel-hover)]'}`}>{i.ok ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600" /> : <Circle size={18} className="mt-0.5 shrink-0 text-[var(--app-faint)]" />}<span>{tx(i.text)}</span></button></li>)}</ul>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className={card}><h2 className="mb-3 font-display text-lg font-semibold">{tx('Views in the last 7 days')}</h2>{a ? <Bars series={a.series} /> : <Loader2 className="animate-spin text-[var(--brand)]" />}</div>
        <div className={card}>
          <h2 className="mb-3 font-display text-lg font-semibold">{kind === 'creator' ? tx('Your best content') : tx('Your best posts')}</h2>
          {!a ? <Loader2 className="animate-spin text-[var(--brand)]" /> : !a.top.length ? <div className="py-4 text-center"><ImagePlus size={34} className="mx-auto text-[var(--app-muted)]" /><p className="mt-2 text-sm text-[var(--app-muted)]">{tx('No posts yet. Share a video or a photo and it shows here.')}</p><button type="button" className={`${btnPrimary} mt-3`} onClick={() => go('feed')}><Plus size={16} />{tx('Make a post')}</button></div>
            : <ul className="space-y-2.5">{a.top.map((t) => <li key={t.id} className="flex items-center gap-3 rounded-xl bg-[var(--app-bg)] px-3 py-2.5 text-sm">{t.video && <VideoIcon size={16} className="shrink-0 text-[var(--app-muted)]" />}<span className="min-w-0 flex-1 truncate">{t.text || tx('(no text)')}</span><span className="shrink-0 text-xs text-[var(--app-muted)]">{t.likes} ♥ · {t.comments} 💬</span></li>)}</ul>}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ the profile editor */
const blank = (): Partial<TimelineItem> => ({ kind: 'education', title: '', org: '', place: '', from: '', to: '', text: '', url: '', mediaIds: [] });

export function ProfileEditor({ b, onChange }: { b: Business; onChange: () => void }) {
  const p = b.profile ?? { skills: [], timeline: [], links: [], featured: [] };
  const [f, setF] = useState({ headline: p.headline ?? '', school: p.school ?? '', field: p.field ?? '', location: p.location ?? '', openTo: p.openTo ?? '', about: b.about ?? '', whatsapp: b.whatsapp ?? '', email: b.email ?? '', phone: b.phone ?? '', cvUrl: p.cvUrl ?? '', skills: p.skills.join(', '), links: p.links.map((l) => `${l.label} | ${l.url}`).join('\n') });
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null); const [busy, setBusy] = useState(''); const [urls, setUrls] = useState<Record<string, string>>({}); const [edit, setEdit] = useState<Partial<TimelineItem> | null>(null);
  const photoRef = useRef<HTMLInputElement>(null); const itemFiles = useRef<HTMLInputElement>(null); const featRef = useRef<HTMLInputElement>(null);
  const loadUrls = useCallback(() => { void ownerApi.mediaUrls(b.id).then(setUrls).catch(() => undefined); }, [b.id]);
  useEffect(() => { loadUrls(); }, [loadUrls, b.updatedAt]);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const preparing = b.media.some((m) => m.video?.state === 'processing');
  const run = async (what: string, fn: () => Promise<void>, done?: string) => { setBusy(what); setNote(null); try { await fn(); if (done) setNote({ ok: true, text: done }); onChange(); } catch (e) { setNote({ ok: false, text: msg(e) }); } finally { setBusy(''); } };
  const send = async (file: File): Promise<string> => { const prep = file.type.startsWith('image/') ? await prepareImage(file) : { blob: file as Blob, name: file.name }; return (await ownerApi.upload(b.id, prep.blob, prep.name, () => undefined, 'timeline')).id; };
  const saveBasics = () => run('basics', async () => {
    const links = f.links.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [a, ...rest] = l.includes('|') ? l.split('|') : ['', l]; return { label: a.trim(), url: rest.join('|').trim() }; });
    await ownerApi.update(b.id, { about: f.about, whatsapp: f.whatsapp, email: f.email, phone: f.phone, profile: { headline: f.headline, school: f.school, field: f.field, location: f.location, openTo: f.openTo, cvUrl: f.cvUrl, skills: f.skills.split(',').map((s) => s.trim()).filter(Boolean), links } });
  }, tx('Saved'));
  const setPhoto = (kind: 'logoId' | 'coverId') => async (e: React.ChangeEvent<HTMLInputElement>) => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; await run('photo', async () => { const id = await send(file); await ownerApi.update(b.id, { [kind]: id }); }, tx('Photo saved')); };
  const saveItem = () => run('item', async () => { if (!edit?.title?.trim()) throw new Error(tx('Write what you did (a title).')); const list = p.timeline.some((x) => x.id === edit.id) ? p.timeline.map((x) => (x.id === edit.id ? (edit as TimelineItem) : x)) : [...p.timeline, edit as TimelineItem]; await ownerApi.update(b.id, { profile: { timeline: list } }); setEdit(null); }, tx('Saved'));
  const removeItem = (id: string) => run('item', async () => { await ownerApi.update(b.id, { profile: { timeline: p.timeline.filter((x) => x.id !== id) } }); }, tx('Removed'));
  const addToItem = async (e: React.ChangeEvent<HTMLInputElement>) => { const files = [...(e.target.files ?? [])].slice(0, 6); e.target.value = ''; if (!files.length || !edit) return; await run('item-media', async () => { const ids: string[] = []; for (const file of files) ids.push(await send(file)); setEdit((x) => ({ ...x, mediaIds: [...(x?.mediaIds ?? []), ...ids].slice(0, 6) })); }); loadUrls(); };
  const addFeatured = async (e: React.ChangeEvent<HTMLInputElement>) => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; await run('feat', async () => { const id = await send(file); await ownerApi.update(b.id, { profile: { featured: [...p.featured, id] } }); }, tx('Video added. It is being prepared so it plays smoothly.')); };
  const unfeature = (id: string) => run('feat', async () => { await ownerApi.update(b.id, { profile: { featured: p.featured.filter((x) => x !== id) } }); });
  const thumb = (id: string) => { const m = b.media.find((x) => x.id === id); if (!m) return null; return m.kind === 'video' ? (urls[`${id}:poster`] ? <img src={urls[`${id}:poster`]} alt="" className="h-full w-full object-cover" /> : <VideoIcon size={20} className="m-auto text-[var(--app-muted)]" />) : urls[id] ? <img src={urls[id]} alt="" className="h-full w-full object-cover" /> : null; };
  const label = 'block text-sm'; const lt = 'mb-1.5 block text-[var(--app-muted)]';
  const timeline = sortTimeline(p.timeline);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="font-display text-2xl font-semibold tracking-tight">{tx('My profile')}</h1><Tag kind="public" /></div></div>
      {note && <p role={note.ok ? 'status' : 'alert'} className={`rounded-xl px-4 py-2.5 text-sm ${note.ok ? 'bg-emerald-500/10 text-emerald-800' : 'bg-rose-500/10 text-rose-700'}`}>{note.text}</p>}
      {preparing && <p role="status" className="rounded-xl bg-sky-500/10 px-4 py-2.5 text-sm text-sky-800">{tx('A video is being prepared so it plays smoothly. This takes a minute or two.')}</p>}

      <section className={card}>
        <h2 className="font-display text-lg font-semibold">{tx('You')}</h2>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border border-[var(--app-line)] bg-[var(--app-bg)]">{b.logoId ? thumb(b.logoId) : <Camera />}</div>
          <div className="flex flex-wrap gap-2"><input ref={photoRef} type="file" accept="image/*" className="hidden" onChange={(e) => void setPhoto('logoId')(e)} /><button type="button" className={btnGhost} disabled={busy === 'photo'} onClick={() => photoRef.current?.click()}>{busy === 'photo' ? <Loader2 size={15} className="animate-spin" /> : <ImagePlus size={15} />}{tx(b.logoId ? 'Change photo' : 'Add your photo')}</button>
            <label className={`${btnGhost} cursor-pointer`}><ImagePlus size={15} />{tx(b.coverId ? 'Change banner' : 'Add a banner')}<input type="file" accept="image/*" className="hidden" onChange={(e) => void setPhoto('coverId')(e)} /></label></div>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className={`${label} sm:col-span-2`}><span className={lt}>{tx('Headline (what you study or do)')}</span><input className={input} value={f.headline} maxLength={90} placeholder="Computer science student · mobile apps" onChange={(e) => set('headline', e.target.value)} /></label>
          <label className={label}><span className={lt}>{tx('School or company')}</span><input className={input} value={f.school} maxLength={100} placeholder="University of Rwanda" onChange={(e) => set('school', e.target.value)} /></label>
          <label className={label}><span className={lt}>{tx('Field or position')}</span><input className={input} value={f.field} maxLength={100} placeholder="Information Technology" onChange={(e) => set('field', e.target.value)} /></label>
          <label className={label}><span className={lt}>{tx('Where you are')}</span><input className={input} value={f.location} maxLength={80} placeholder="Kigali, Rwanda" onChange={(e) => set('location', e.target.value)} /></label>
          <label className={label}><span className={lt}>{tx('Open to (shown in green)')}</span><input className={input} value={f.openTo} maxLength={160} placeholder="Internships and graduate jobs" onChange={(e) => set('openTo', e.target.value)} /></label>
          <label className={`${label} sm:col-span-2`}><span className={lt}>{tx('About me')}</span><textarea className={`${input} min-h-28`} value={f.about} maxLength={1500} placeholder="Who you are, what you care about, what you are looking for." onChange={(e) => set('about', e.target.value)} /></label>
          <label className={`${label} sm:col-span-2`}><span className={lt}>{tx('Skills (separated by commas)')}</span><input className={input} value={f.skills} placeholder="Public speaking, Excel, React, Teamwork" onChange={(e) => set('skills', e.target.value)} /></label>
          <label className={label}><span className={lt}>WhatsApp</span><input className={input} inputMode="tel" value={f.whatsapp} placeholder="0788 123 456" onChange={(e) => set('whatsapp', e.target.value)} /></label>
          <label className={label}><span className={lt}>Email</span><input className={input} type="email" value={f.email} placeholder="you@example.com" onChange={(e) => set('email', e.target.value)} /></label>
          <label className={`${label} sm:col-span-2`}><span className={lt}>{tx('Link to your CV (https://…, Google Drive works)')}</span><input className={input} value={f.cvUrl} placeholder="https://drive.google.com/…" onChange={(e) => set('cvUrl', e.target.value)} /></label>
          <label className={`${label} sm:col-span-2`}><span className={lt}>{tx('Other links, one per line: name | link')}</span><textarea className={`${input} min-h-20 font-mono`} value={f.links} placeholder={'LinkedIn | https://www.linkedin.com/in/your-name\nGitHub | https://github.com/you'} onChange={(e) => set('links', e.target.value)} /></label>
        </div>
        <button type="button" className={`${btnPrimary} mt-4`} disabled={busy === 'basics'} onClick={() => void saveBasics()}>{busy === 'basics' ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}{tx('Save')}</button>
      </section>

      <section className={card}>
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-display text-lg font-semibold">{tx('Watch me (your best videos)')}</h2><p className="text-sm text-[var(--app-muted)]">{tx('Shown first on your page. A short introduction video makes a big difference.')}</p></div>
          <div><input ref={featRef} type="file" accept="video/mp4,video/webm,video/quicktime" className="hidden" onChange={(e) => void addFeatured(e)} /><button type="button" className={btnGhost} disabled={p.featured.length >= 6 || busy === 'feat'} onClick={() => featRef.current?.click()}>{busy === 'feat' ? <Loader2 size={15} className="animate-spin" /> : <VideoIcon size={15} />}{tx('Add a video')}</button></div></div>
        {p.featured.length > 0 && <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">{p.featured.map((id) => <li key={id} className="relative"><div className="flex aspect-video items-center justify-center overflow-hidden rounded-xl bg-[var(--app-bg)]">{thumb(id)}</div><button type="button" aria-label={tx('Remove')} onClick={() => void unfeature(id)} className="absolute right-1.5 top-1.5 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white"><Trash2 size={14} /></button>{b.media.find((m) => m.id === id)?.video?.state === 'processing' && <span className="mt-1 block text-xs text-[var(--app-muted)]">{tx('Preparing…')}</span>}</li>)}</ul>}
      </section>

      <section className={card}>
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-display text-lg font-semibold">{tx('My journey')}</h2><p className="text-sm text-[var(--app-muted)]">{tx('What you studied, did and attended, with pictures and videos. Newest first.')}</p></div><button type="button" className={btnPrimary} onClick={() => setEdit(blank())}><Plus size={16} />{tx('Add something I did')}</button></div>
        {!timeline.length && !edit && <p className="mt-4 rounded-xl bg-[var(--app-bg)] px-4 py-5 text-center text-sm text-[var(--app-muted)]">{tx('Nothing here yet. Add your studies, a project, a workshop you attended, an internship or an award.')}</p>}
        <ul className="mt-4 space-y-3">{timeline.map((t) => <li key={t.id} className="flex items-start gap-3 rounded-2xl border border-[var(--app-line)] p-3.5">
          <div className="min-w-0 flex-1"><p className="text-xs font-semibold uppercase tracking-wider text-[var(--app-muted)]">{tx(KINDS.find((k) => k[0] === t.kind)?.[1] ?? 'Event I attended')}{rangeText(t) ? ` · ${rangeText(t)}` : ''}</p><p className="mt-0.5 font-semibold">{t.title}</p>{(t.org || t.place) && <p className="text-sm text-[var(--app-muted)]">{[t.org, t.place].filter(Boolean).join(' · ')}</p>}
            {(t.mediaIds?.length ?? 0) > 0 && <div className="mt-2 flex gap-1.5">{t.mediaIds!.slice(0, 6).map((id) => <span key={id} className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg bg-[var(--app-bg)]">{thumb(id)}</span>)}</div>}</div>
          <div className="flex shrink-0 gap-1.5"><button type="button" aria-label={tx('Edit')} className={`${btnGhost} !min-h-10 !px-3`} onClick={() => setEdit({ ...t })}><Pencil size={15} /></button><button type="button" aria-label={tx('Remove')} className={`${btnGhost} !min-h-10 !px-3`} onClick={() => void removeItem(t.id)}><Trash2 size={15} /></button></div></li>)}</ul>
      </section>

      {edit && (
        <div role="dialog" aria-modal="true" aria-label={tx('Add something I did')} className="fixed inset-0 z-[200] flex items-end justify-center bg-black/45 sm:items-center" onClick={() => setEdit(null)}>
          <div className="max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-[var(--app-panel)] p-5 sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-xl font-semibold">{edit.id ? tx('Edit') : tx('Add something I did')}</h3>
            <div className="mt-4 grid gap-3.5 sm:grid-cols-2">
              <label className={`${label} sm:col-span-2`}><span className={lt}>{tx('What is it?')}</span><select className={input} value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value as TimelineKind })}>{KINDS.map(([k, l]) => <option key={k} value={k}>{tx(l)}</option>)}</select></label>
              <label className={`${label} sm:col-span-2`}><span className={lt}>{tx('Title')}</span><input className={input} autoFocus maxLength={120} value={edit.title ?? ''} placeholder="Attended the Youth Connekt summit" onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></label>
              <label className={label}><span className={lt}>{tx('School, company or organiser')}</span><input className={input} maxLength={100} value={edit.org ?? ''} onChange={(e) => setEdit({ ...edit, org: e.target.value })} /></label>
              <label className={label}><span className={lt}>{tx('Place')}</span><input className={input} maxLength={80} value={edit.place ?? ''} onChange={(e) => setEdit({ ...edit, place: e.target.value })} /></label>
              <label className={label}><span className={lt}>{tx('From (2023-09 or 2023)')}</span><input className={input} value={edit.from ?? ''} maxLength={7} placeholder="2023-09" onChange={(e) => setEdit({ ...edit, from: e.target.value })} /></label>
              <label className={label}><span className={lt}>{tx('To (empty for one day, or “present”)')}</span><input className={input} value={edit.to ?? ''} maxLength={7} placeholder="2024-06" onChange={(e) => setEdit({ ...edit, to: e.target.value })} /></label>
              <label className={`${label} sm:col-span-2`}><span className={lt}>{tx('What you did or learned')}</span><textarea className={`${input} min-h-24`} maxLength={600} value={edit.text ?? ''} onChange={(e) => setEdit({ ...edit, text: e.target.value })} /></label>
              <label className={`${label} sm:col-span-2`}><span className={lt}>{tx('Link (certificate, project, article), optional')}</span><input className={input} value={edit.url ?? ''} placeholder="https://" onChange={(e) => setEdit({ ...edit, url: e.target.value })} /></label>
            </div>
            <div className="mt-4"><span className={lt}>{tx('Pictures and videos')}</span>
              <div className="flex flex-wrap gap-2">{(edit.mediaIds ?? []).map((id) => <span key={id} className="relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-xl bg-[var(--app-bg)]">{thumb(id) ?? <Loader2 size={16} className="animate-spin" />}<button type="button" aria-label={tx('Remove')} onClick={() => setEdit({ ...edit, mediaIds: (edit.mediaIds ?? []).filter((x) => x !== id) })} className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/65 text-white"><Trash2 size={11} /></button></span>)}
                {(edit.mediaIds?.length ?? 0) < 6 && <><input ref={itemFiles} type="file" multiple accept="image/*,video/mp4,video/webm,video/quicktime" className="hidden" onChange={(e) => void addToItem(e)} /><button type="button" onClick={() => itemFiles.current?.click()} disabled={busy === 'item-media'} className="flex h-16 w-16 items-center justify-center rounded-xl border border-dashed border-[var(--app-line)] text-[var(--app-muted)]">{busy === 'item-media' ? <Loader2 size={18} className="animate-spin" /> : <ImagePlus size={20} />}</button></>}</div></div>
            {note && !note.ok && <p role="alert" className="mt-3 text-sm text-rose-600">{note.text}</p>}
            <div className="mt-5 flex gap-2"><button type="button" className={btnPrimary} disabled={busy === 'item'} onClick={() => void saveItem()}>{busy === 'item' ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}{tx('Save')}</button><button type="button" className={btnGhost} onClick={() => setEdit(null)}>{tx('Cancel')}</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
function Camera() { return <ImagePlus size={26} className="text-[var(--app-muted)]" aria-hidden="true" />; }
