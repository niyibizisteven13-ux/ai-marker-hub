import { useEffect, useState } from 'react';
import { FileText, Image as ImageIcon, Loader2, Mic, X } from 'lucide-react';
import { PdfViewer, loadPdfJs } from './PdfViewer';
import { authFetch } from '../utils/authFetch';

/**
 * Previews of a file before it is sent (a File on the device) or of a shared file (a URL): photos full size, PDFs
 * page by page, Word and text files as text. Used on the public submit page so a student sees exactly what they
 * attach.
 */

export interface PreviewSource {
  name: string; type: string;
  /** A file on this device. */ file?: File;
  /** A URL to the whole file. */ url?: string;
  /** A file the AI stored for the signed-in user (/api/files/:id). */ storedFileId?: string;
  /** Used when nothing else is available, e.g. a small thumbnail kept with a sent message. */ fallbackUrl?: string;
}

const isImage = (s: PreviewSource) => s.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|heic|heif)$/i.test(s.name);
const isPdf = (s: PreviewSource) => s.type === 'application/pdf' || /\.pdf$/i.test(s.name);
const isWord = (s: PreviewSource) => /wordprocessingml/.test(s.type) || /\.docx$/i.test(s.name);
const isText = (s: PreviewSource) => s.type.startsWith('text/') || /\.(txt|md|csv)$/i.test(s.name);
const isAudio = (s: PreviewSource) => s.type.startsWith('audio/') || /\.(webm|ogg|oga|m4a|mp3|wav|aac)$/i.test(s.name);
const isVideo = (s: PreviewSource) => s.type.startsWith('video/') || /\.(mp4|mov)$/i.test(s.name);

/** A URL for the source: the file on this device, the given URL, the stored copy, or the fallback thumbnail. */
function useSourceUrl(src: PreviewSource | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    if (!src) return;
    if (src.file) { const u = URL.createObjectURL(src.file); setUrl(u); return () => URL.revokeObjectURL(u); }
    if (src.url) { setUrl(src.url); return; }
    if (!src.storedFileId) { setUrl(src.fallbackUrl ?? null); return; }
    let live = true;
    let made: string | null = null;
    authFetch(`/api/files/${encodeURIComponent(src.storedFileId)}`).then((r) => (r.ok ? r.blob() : null)).then((b) => {
      if (!live) return;
      if (b) { made = URL.createObjectURL(b); setUrl(made); } else setUrl(src.fallbackUrl ?? null);
    }).catch(() => live && setUrl(src.fallbackUrl ?? null));
    return () => { live = false; if (made) URL.revokeObjectURL(made); };
  }, [src]);
  return url;
}

async function blobOf(src: PreviewSource): Promise<Blob> {
  if (src.file) return src.file;
  if (src.url) return (await fetch(src.url)).blob();
  if (src.storedFileId) { const r = await authFetch(`/api/files/${encodeURIComponent(src.storedFileId)}`); if (r.ok) return r.blob(); }
  if (src.fallbackUrl) return (await fetch(src.fallbackUrl)).blob();
  throw new Error('No copy of this file is available.');
}

/** A small picture of the first page: the photo itself, or page 1 of a PDF; null for other files. */
export function useThumbnail(src: PreviewSource): string | null {
  const [thumb, setThumb] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let objectUrl: string | null = null;
    if (isImage(src) && !src.file && !src.url && src.storedFileId) {
      // A stored photo: fetched with the sign-in, shown from memory.
      blobOf(src).then((b) => { if (!live) return; objectUrl = URL.createObjectURL(b); setThumb(objectUrl); }).catch(() => live && setThumb(src.fallbackUrl ?? null));
    } else if (isImage(src)) {
      objectUrl = src.file ? URL.createObjectURL(src.file) : null;
      setThumb(objectUrl ?? src.url ?? src.fallbackUrl ?? null);
    } else if (isPdf(src)) {
      (async () => {
        const lib = await loadPdfJs();
        const data = new Uint8Array(await (await blobOf(src)).arrayBuffer());
        const doc = await lib.getDocument({ data, isEvalSupported: false }).promise;
        const page = await doc.getPage(1);
        const base = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: 240 / base.width });
        const c = document.createElement('canvas');
        c.width = Math.floor(vp.width);
        c.height = Math.floor(vp.height);
        await page.render({ canvas: c, canvasContext: c.getContext('2d')!, viewport: vp }).promise;
        if (live) setThumb(c.toDataURL('image/jpeg', 0.8));
        void doc.destroy();
      })().catch(() => undefined);
    }
    return () => { live = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [src]);
  return thumb;
}

/** Thumbnail tile: first page, or an icon with the file type. */
export function FileThumb({ src, className = '' }: { src: PreviewSource; className?: string }) {
  const thumb = useThumbnail(src);
  const [broken, setBroken] = useState(false);
  const ext = (/\.([a-z0-9]+)$/i.exec(src.name)?.[1] ?? 'file').slice(0, 4).toUpperCase();
  return (
    <span className={`relative flex items-center justify-center overflow-hidden bg-neutral-50 ${className}`}>
      {thumb && !broken ? <img src={thumb} alt="" onError={() => setBroken(true)} className="h-full w-full object-cover object-top" />
        : <span className="flex flex-col items-center gap-1 p-2 text-center text-[11px] text-neutral-600">{isImage(src) ? <ImageIcon size={20} /> : isAudio(src) ? <Mic size={20} className="text-[#D97757]" /> : <FileText size={20} className="text-[#D97757]" />}<span className="line-clamp-2 break-all">{src.name}</span></span>}
      {!isImage(src) && <span className="absolute inset-x-0 bottom-0 bg-black/55 text-center text-[9.5px] font-semibold leading-[15px] text-white">{ext}</span>}
    </span>
  );
}

/** Full-screen preview; closes on Escape or the close button. */
export function PreviewDialog({ src, onClose, footer }: { src: PreviewSource; onClose: () => void; footer?: React.ReactNode }) {
  const url = useSourceUrl(src);
  const [text, setText] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', key); document.body.style.overflow = overflow; };
  }, [onClose]);
  useEffect(() => {
    if (isImage(src) || isPdf(src) || isAudio(src) || isVideo(src)) return;
    let live = true;
    setText(null);
    (async () => {
      const blob = await blobOf(src);
      if (isWord(src)) {
        const mammoth = (await import('mammoth')).default;
        const out = await mammoth.extractRawText({ arrayBuffer: await blob.arrayBuffer() });
        if (live) setText(out.value.trim());
      } else if (isText(src)) {
        const t = await blob.text();
        if (live) setText(t.slice(0, 200_000));
      } else if (live) setText('');
    })().catch(() => live && setText(''));
    return () => { live = false; };
  }, [src]);

  return (
    <div role="dialog" aria-modal="true" aria-label={`Preview of ${src.name}`} className="fixed inset-0 z-[100] flex flex-col bg-neutral-950">
      <div className="flex items-center gap-2 px-3 py-2.5 text-white sm:px-5">
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{src.name}</span>
        <button type="button" onClick={onClose} aria-label="Close preview" className="rounded-full bg-white/10 p-2 hover:bg-white/20"><X size={18} /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-3 sm:px-6">
        {!url ? <div className="flex h-full items-center justify-center text-white/60"><Loader2 className="animate-spin" /></div>
          : isImage(src) && !broken ? <img src={url} alt={src.name} onError={() => setBroken(true)} className="mx-auto max-h-full w-auto max-w-full bg-white object-contain" />
            : isImage(src) ? <p className="mt-16 text-center text-[14px] text-white/70">This photo format can't be shown in this browser, but it will be sent as it is.</p>
              : isPdf(src) ? <div className="mx-auto h-full max-w-3xl"><PdfViewer url={url} name={src.name} tall /></div>
                : isAudio(src) ? <div className="mx-auto mt-16 max-w-lg rounded-2xl border border-white/10 bg-[#16171b] p-6 text-center"><Mic className="mx-auto text-[#F0A586]" size={28} /><p className="mt-2 text-[13.5px] text-neutral-300">{src.name}</p><audio controls autoPlay src={url} className="mt-4 w-full" /></div>
                  : isVideo(src) ? <video controls src={url} className="mx-auto max-h-full max-w-full" />
                : text === null ? <div className="flex h-full items-center justify-center text-white/60"><Loader2 className="animate-spin" /></div>
                  : text ? <div className="mx-auto max-w-3xl whitespace-pre-wrap rounded-lg bg-[#FBFAF6] px-5 py-5 font-serif text-[15px] leading-relaxed text-neutral-900 sm:px-8">{text}</div>
                    : <p className="mt-16 text-center text-[14px] text-white/70">No preview for this file type. It will be sent as it is.</p>}
      </div>
      {footer && <div className="border-t border-white/10 px-3 py-2.5 sm:px-5">{footer}</div>}
    </div>
  );
}

/** How a chat attachment (staged, or in a sent message) opens: the file itself, its full copy, or its thumbnail. */
export function attachmentSource(item: File | { name?: string; mimeType?: string; type?: string; url?: string; localUrl?: string; previewUrl?: string; storedFileId?: string }): PreviewSource {
  if (item instanceof File) return { name: item.name, type: item.type, file: item };
  const full = item.localUrl || (item.url && !item.url.startsWith('data:') ? item.url : undefined);
  return { name: item.name || 'Attachment', type: item.mimeType || item.type || '', url: full, storedFileId: item.storedFileId, fallbackUrl: item.previewUrl || item.url };
}
