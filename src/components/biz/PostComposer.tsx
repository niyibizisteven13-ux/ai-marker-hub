import { tx } from '../../biz/studioI18n';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Copy, ImagePlus, Loader2, Share2, Trash2, Upload, X } from 'lucide-react';
import { ownerApi, prepareImage } from '../../biz/api';
import { pageUrl, type Business } from '../../biz/types';
import { btnGhost, btnPrimary, input, msg } from './ui';

/**
 * "Create new post", the way Instagram does it: 1 pick photos or short videos (drop them, or use the camera), 2 crop them (square, portrait or as taken)
 * and put them in order, 3 write the caption, tag a product for an Order button, and Share. Photos are cropped and shrunk on the phone before sending.
 */
type Ratio = 'square' | 'portrait' | 'original';
interface Item { id: string; file: File; kind: 'image' | 'video'; url: string }
const RATIO: Record<Ratio, { label: string; css: string; r: number | null }> = { square: { label: '1:1', css: '1 / 1', r: 1 }, portrait: { label: '4:5', css: '4 / 5', r: 4 / 5 }, original: { label: 'Original', css: '1 / 1', r: null } };
const MAX_ITEMS = 10, MAX_VIDEO_MB = 200, MAX_VIDEO = MAX_VIDEO_MB * 1048576;

/** Centre-crops a photo to a ratio (null: keep it as it is) and shrinks it to 1440 px, as a JPEG. */
async function cropImage(file: File, r: number | null): Promise<{ blob: Blob; name: string }> {
  if (r === null) return prepareImage(file);
  try {
    const bmp = await createImageBitmap(file); let sw = bmp.width, sh = bmp.height;
    if (sw / sh > r) sw = Math.round(sh * r); else sh = Math.round(sw / r);
    const sx = Math.round((bmp.width - sw) / 2), sy = Math.round((bmp.height - sh) / 2); const scale = Math.min(1, 1440 / Math.max(sw, sh));
    const c = document.createElement('canvas'); c.width = Math.round(sw * scale); c.height = Math.round(sh * scale); c.getContext('2d')!.drawImage(bmp, sx, sy, sw, sh, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', 0.86)); if (blob) return { blob, name: file.name.replace(/\.[a-z0-9]+$/i, '') + '.jpg' };
  } catch { /* fall back to the original */ }
  return prepareImage(file);
}

export default function PostComposer({ b, onClose, onPosted, canVideo }: { b: Business; onClose: () => void; onPosted: () => void; canVideo: boolean }) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1); const [items, setItems] = useState<Item[]>([]); const [ratio, setRatio] = useState<Ratio>('square'); const [cur, setCur] = useState(0);
  const [caption, setCaption] = useState(''); const [productId, setProductId] = useState(''); const [busy, setBusy] = useState(''); const [err, setErr] = useState(''); const [drag, setDrag] = useState(false); const fileRef = useRef<HTMLInputElement>(null);
  const urls = useRef<string[]>([]); useEffect(() => () => { urls.current.forEach((u) => URL.revokeObjectURL(u)); }, []);
  useEffect(() => { const o = document.body.style.overflow; document.body.style.overflow = 'hidden'; const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); }; window.addEventListener('keydown', k); return () => { document.body.style.overflow = o; window.removeEventListener('keydown', k); }; }, [busy, onClose]);
  const add = (list: FileList | File[] | null) => {
    if (!list) return; setErr(''); const next = [...items];
    for (const f of Array.from(list)) {
      if (next.length >= MAX_ITEMS) { setErr(`A post can have up to ${MAX_ITEMS} photos or videos.`); break; }
      const kind = f.type.startsWith('video/') ? 'video' : f.type.startsWith('image/') ? 'image' : null; if (!kind) { setErr(canVideo ? 'Choose photos or videos.' : 'Choose photos.'); continue; }
      if (kind === 'video' && !canVideo) { setErr('Videos are for paid plans. Photos are free.'); continue; }
      if (kind === 'video' && f.size > MAX_VIDEO) { setErr(`${f.name} is ${(f.size / 1048576).toFixed(0)} MB. A video can be up to ${MAX_VIDEO_MB} MB (about a minute at 1080p): record a shorter clip or a lower quality.`); continue; }
      const url = URL.createObjectURL(f); urls.current.push(url); next.push({ id: `${Date.now()}-${Math.random()}`, file: f, kind, url });
    }
    setItems(next); if (next.length && step === 1) { setStep(2); setCur(0); }
  };
  const move = (i: number, d: number) => setItems((l) => { const n = [...l]; const j = i + d; if (j < 0 || j >= n.length) return l; [n[i], n[j]] = [n[j], n[i]]; setCur(j); return n; });
  const remove = (i: number) => { setItems((l) => l.filter((_, k) => k !== i)); setCur((c) => Math.max(0, Math.min(c, items.length - 2))); if (items.length === 1) setStep(1); };
  const share = async () => {
    setErr(''); try {
      const ids: string[] = [];
      for (const [k, it] of items.entries()) { setBusy(`Uploading ${k + 1} of ${items.length}…`); const p = it.kind === 'image' ? await cropImage(it.file, RATIO[ratio].r) : { blob: it.file as Blob, name: it.file.name }; ids.push((await ownerApi.upload(b.id, p.blob, p.name, () => undefined, 'feed')).id); }
      setBusy('Sharing…'); await ownerApi.addPost(b.id, { text: caption, mediaIds: ids, ...(productId ? { productId } : {}) }); onPosted(); setStep(4);
    } catch (e) { setErr(msg(e)); } finally { setBusy(''); }
  };
  const it = items[cur]; const css = RATIO[ratio].css; const link = `${pageUrl(b.slug)}#updates`;
  const stage = useMemo(() => (it ? (
    <div className="relative mx-auto w-full overflow-hidden bg-black" style={{ aspectRatio: ratio === 'original' ? undefined : css, maxHeight: '60dvh' }}>
      {it.kind === 'video' ? <video src={it.url} controls playsInline className="h-full w-full object-contain" /> : <img src={it.url} alt="" className={`h-full w-full ${ratio === 'original' ? 'max-h-[60dvh] object-contain' : 'object-cover'}`} />}
      {items.length > 1 && <><button type="button" aria-label={tx("Previous")} disabled={cur === 0} onClick={() => setCur(cur - 1)} className="absolute left-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 shadow disabled:opacity-30"><ChevronLeft size={18} /></button><button type="button" aria-label={tx("Next")} disabled={cur === items.length - 1} onClick={() => setCur(cur + 1)} className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 shadow disabled:opacity-30"><ChevronRight size={18} /></button><span className="absolute right-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-xs text-white">{cur + 1}/{items.length}</span></>}
    </div>) : null), [it, ratio, css, cur, items.length]);
  const title = step === 1 ? 'Create new post' : step === 2 ? 'Crop' : step === 3 ? 'New post' : 'Post shared';
  return (
    <div className="fixed inset-0 z-[300] flex items-end justify-center bg-black/60 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={tx("Create new post")} onClick={() => { if (!busy) onClose(); }}>
      <div className="flex max-h-[96dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl bg-[var(--app-panel)] shadow-2xl sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--app-line)] px-4 py-3">
          <div className="w-24">{(step === 2 || step === 3) && <button type="button" disabled={!!busy} aria-label={tx("Back")} onClick={() => setStep((step - 1) as 1 | 2 | 3)} className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-[var(--app-panel-hover)]"><ArrowLeft size={18} /></button>}</div>
          <h2 className="font-display text-base font-semibold">{title}</h2>
          <div className="flex w-24 justify-end">{step === 2 && <button type="button" onClick={() => setStep(3)} className="px-2 text-sm font-semibold text-[var(--brand-strong,var(--brand))]">{tx("Next")}</button>}{step === 3 && <button type="button" disabled={!!busy || (!items.length && !caption.trim())} onClick={() => void share()} className="px-2 text-sm font-semibold text-[var(--brand-strong,var(--brand))] disabled:opacity-40">{busy ? <Loader2 size={16} className="animate-spin" /> : 'Share'}</button>}{(step === 1 || step === 4) && <button type="button" aria-label={tx("Close")} onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-[var(--app-panel-hover)]"><X size={18} /></button>}</div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {step === 1 && (
            <div className={`m-4 flex min-h-[320px] flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed p-8 text-center transition ${drag ? 'border-[var(--brand)] bg-[var(--brand)]/10' : 'border-[var(--app-line)]'}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); }}>
              <ImagePlus size={54} className="text-[var(--app-muted)]" aria-hidden="true" /><p className="font-display text-lg font-semibold">{canVideo ? 'Drag photos and videos here' : 'Drag photos here'}</p>
              <input ref={fileRef} type="file" multiple accept={canVideo ? 'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm' : 'image/jpeg,image/png,image/webp,image/gif'} className="sr-only" id="bz-post-files" onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
              <label htmlFor="bz-post-files" className={`${btnPrimary} cursor-pointer`}><Upload size={16} />{tx("Select from this device")}</label>
              <p className="max-w-xs text-xs text-[var(--app-faint)]">Up to {MAX_ITEMS} {canVideo ? `photos or videos (videos up to ${MAX_VIDEO_MB} MB, about a minute)` : 'photos'}. On a phone this opens your camera roll or the camera.{!canVideo && <> <a href="/upgrade" className="underline">{tx("Videos are for paid plans.")}</a></>}</p>
              {err && <p role="alert" className="text-sm text-rose-600">{err}</p>}
            </div>)}
          {step === 2 && it && (<div>{stage}
            <div className="flex items-center justify-between gap-2 border-b border-[var(--app-line)] px-4 py-3"><div className="inline-flex rounded-xl bg-[var(--app-bg)] p-1" role="tablist" aria-label={tx("Crop")}>{(Object.keys(RATIO) as Ratio[]).map((r) => <button key={r} type="button" role="tab" aria-selected={ratio === r} onClick={() => setRatio(r)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${ratio === r ? 'bg-[var(--brand)] text-[var(--brand-on)]' : 'text-[var(--app-muted)]'}`}>{RATIO[r].label}</button>)}</div>
              <div className="flex gap-1"><button type="button" aria-label="Move earlier" disabled={cur === 0} onClick={() => move(cur, -1)} className={`${btnGhost} !min-h-9 !px-2.5 disabled:opacity-30`}><ChevronLeft size={16} /></button><button type="button" aria-label="Move later" disabled={cur === items.length - 1} onClick={() => move(cur, 1)} className={`${btnGhost} !min-h-9 !px-2.5 disabled:opacity-30`}><ChevronRight size={16} /></button><button type="button" aria-label={tx("Remove")} onClick={() => remove(cur)} className={`${btnGhost} !min-h-9 !px-2.5 text-rose-600`}><Trash2 size={15} /></button></div></div>
            <div className="flex gap-2 overflow-x-auto px-4 py-3">{items.map((x, k) => <button key={x.id} type="button" aria-label={`Photo ${k + 1}`} onClick={() => setCur(k)} className={`relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border-2 ${k === cur ? 'border-[var(--brand)]' : 'border-transparent'}`}>{x.kind === 'video' ? <video src={x.url} className="h-full w-full object-cover" /> : <img src={x.url} alt="" className="h-full w-full object-cover" />}</button>)}
              {items.length < MAX_ITEMS && <label htmlFor="bz-post-files" className="flex h-16 w-16 shrink-0 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-[var(--app-line)] text-[var(--app-muted)]" aria-label="Add more"><ImagePlus size={20} /><input id="bz-post-files" type="file" multiple accept={canVideo ? 'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm' : 'image/jpeg,image/png,image/webp,image/gif'} className="sr-only" onChange={(e) => { add(e.target.files); e.target.value = ''; }} /></label>}</div>
            {err && <p role="alert" className="px-4 pb-3 text-sm text-rose-600">{err}</p>}
          </div>)}
          {step === 3 && (<div className="grid gap-0 sm:grid-cols-[1fr_1fr]">
            <div className="bg-black">{it ? stage : <div className="flex h-48 items-center justify-center bg-[var(--app-bg)] text-sm text-[var(--app-muted)]">{tx("Text only")}</div>}</div>
            <div className="space-y-4 p-4">
              <label className="block"><span className="sr-only">{tx("Caption")}</span><textarea className={`${input} min-h-[140px]`} rows={6} maxLength={1500} value={caption} placeholder={tx("Write a caption…")} aria-label={tx("Caption")} onChange={(e) => setCaption(e.target.value)} /><span className="mt-1 block text-right text-xs text-[var(--app-faint)]">{caption.length}/1500</span></label>
              {b.products.length > 0 && <label className="block text-sm"><span className="mb-1.5 block font-medium">{tx("Tag a product (gives the post an Order button)")}</span><select className={input} value={productId} onChange={(e) => setProductId(e.target.value)}><option value="">None</option>{b.products.filter((p) => !p.hidden).map((p) => <option key={p.id} value={p.id}>{p.name}{p.price !== null ? ` · ${p.price.toLocaleString('en-US')} RWF` : ''}</option>)}</select></label>}
              {!b.published && <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-xs">Your page is not published yet. This post will show once you publish it.</p>}
              {err && <p role="alert" className="text-sm text-rose-600">{err}</p>}
              {busy && <p className="flex items-center gap-2 text-sm text-[var(--app-muted)]"><Loader2 size={15} className="animate-spin" />{busy}</p>}
              <button type="button" disabled={!!busy || (!items.length && !caption.trim())} onClick={() => void share()} className={`${btnPrimary} w-full`}>{tx("Share post")}</button>
            </div></div>)}
          {step === 4 && (<div className="px-6 py-10 text-center"><span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-700"><Check size={30} /></span><p className="mt-4 font-display text-xl font-semibold">{tx("Your post has been shared")}</p><p className="mt-1 break-all font-mono text-xs text-[var(--app-muted)]">{link.replace(/^https?:\/\//, '')}</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2"><a className={btnPrimary} target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(`${b.name}: ${caption.slice(0, 120)}\n${link}`)}`}><Share2 size={16} />{tx("Share on WhatsApp")}</a><button type="button" className={btnGhost} onClick={() => void navigator.clipboard?.writeText(link)}><Copy size={16} />{tx("Copy link")}</button><button type="button" className={btnGhost} onClick={onClose}>{tx("Done")}</button></div></div>)}
        </div>
      </div>
    </div>
  );
}
