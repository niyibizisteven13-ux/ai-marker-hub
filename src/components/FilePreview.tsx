import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowLeft, Download, FileArchive, FileAudio, FileCode, FileSpreadsheet, FileText, FileVideo, Folder, Image as ImageIcon, Loader2, Presentation, X } from 'lucide-react';
import { PdfViewer } from './PdfViewer';
import { SandboxFrame } from './SandboxFrame';
import { authFetch } from '../utils/authFetch';
import {
  badgeOf, browserCanShowImage, formatBytes, keyOf, kindOf, readCsv, readDeck, readText, readWordHtml, readWorkbook, readZip, thumbnailFor,
  type FileKind, type Sheet, type Slide, type Thumb, type ZipEntry,
} from '../utils/fileKinds';

/**
 * Every attached file can be looked at in place, like in Claude: a thumbnail card that shows what is inside (page 1,
 * the first lines, the first rows, a video frame, the sound wave) and a full viewer for photos, PDFs, Word, Excel,
 * CSV, PowerPoint, web pages, code and text, audio, video and ZIP folders. Nothing has to be downloaded first.
 */

export interface PreviewSource {
  name: string; type: string;
  /** A file on this device. */ file?: File;
  /** A URL to the whole file. */ url?: string;
  /** A file the AI stored for the signed-in user (/api/files/:id). */ storedFileId?: string;
  /** Used when nothing else is available, e.g. a small thumbnail kept with a sent message. */ fallbackUrl?: string;
  /** Size in bytes, when known. */ size?: number;
  /** A thumbnail worked out when the file was sent, kept with the message so it still shows after a reload. */ thumb?: Thumb;
}

/** A URL for the source: the file on this device, the given URL, the stored copy, or the fallback thumbnail. */
function useSourceUrl(src: PreviewSource | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    if (!src) return;
    if (src.file) { const u = URL.createObjectURL(src.file); setUrl(u); return () => URL.revokeObjectURL(u); }
    if (src.url && !src.url.startsWith('blob:')) { setUrl(src.url); return; }
    let live = true;
    let made: string | null = null;
    blobOf(src).then((b) => { if (!live) return; made = URL.createObjectURL(b); setUrl(made); })
      .catch(() => live && setUrl(src.fallbackUrl ?? ''));
    return () => { live = false; if (made) URL.revokeObjectURL(made); };
  }, [src]);
  return url;
}

/** The file's bytes, trying each copy in turn (a blob link from this visit may be gone after a reload). */
export async function blobOf(src: PreviewSource): Promise<Blob> {
  if (src.file) return src.file;
  const tries: Array<() => Promise<Response>> = [];
  if (src.url) tries.push(() => fetch(src.url!, { credentials: 'include' }));
  if (src.storedFileId) tries.push(() => authFetch(`/api/files/${encodeURIComponent(src.storedFileId!)}`));
  // A kept picture only stands in for photos; it is not the PDF or document itself.
  if (src.fallbackUrl && (kindOf(src) === 'image' || !src.fallbackUrl.startsWith('data:image'))) tries.push(() => fetch(src.fallbackUrl!));
  for (const t of tries) {
    try { const r = await t(); if (r.ok) return await r.blob(); } catch { /* next copy */ }
  }
  throw new Error('No copy of this file is available.');
}

/** What the thumbnail shows. Photos are shown directly; other files are read once and remembered. */
export function useThumbnail(src: PreviewSource): Thumb | null {
  const key = keyOf(src);
  const kind = kindOf(src);
  const [thumb, setThumb] = useState<Thumb | null>(null);
  useEffect(() => {
    let live = true;
    let objectUrl: string | null = null;
    setThumb(null);
    if (src.thumb && (src.thumb.image || src.thumb.text || src.thumb.table)) { setThumb(src.thumb); return; }
    if (kind === 'image') {
      if (!browserCanShowImage(src)) { setThumb({}); return; }
      if (src.file) { objectUrl = URL.createObjectURL(src.file); setThumb({ image: objectUrl }); }
      else if (src.url && !src.url.startsWith('blob:')) setThumb({ image: src.url });
      else blobOf(src).then((b) => { if (!live) return; objectUrl = URL.createObjectURL(b); setThumb({ image: objectUrl }); }).catch(() => live && setThumb({ image: src.fallbackUrl }));
    } else if (kind !== 'other') {
      thumbnailFor(key, src, () => blobOf(src)).then((t) => live && setThumb(t));
    } else setThumb({});
    return () => { live = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
    // The key stands for the file; a new object for the same file must not redo the work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, kind]);
  return thumb;
}

const ICONS: Record<FileKind, typeof FileText> = {
  image: ImageIcon, pdf: FileText, word: FileText, sheet: FileSpreadsheet, csv: FileSpreadsheet, slides: Presentation, html: FileCode,
  code: FileCode, text: FileText, audio: FileAudio, video: FileVideo, zip: FileArchive, other: FileText,
};
/** Badge colours per kind, like file icons in an office suite. */
const TONE: Record<FileKind, string> = {
  image: 'bg-sky-600', pdf: 'bg-rose-600', word: 'bg-blue-600', sheet: 'bg-emerald-600', csv: 'bg-emerald-600', slides: 'bg-orange-600',
  html: 'bg-violet-600', code: 'bg-slate-600', text: 'bg-neutral-600', audio: 'bg-[#D97757]', video: 'bg-fuchsia-600', zip: 'bg-amber-600', other: 'bg-neutral-600',
};

function MiniTable({ rows, dark }: { rows: string[][]; dark?: boolean }) {
  return (
    <table className={`w-full table-fixed border-collapse text-[7.5px] leading-[11px] ${dark ? 'text-neutral-300' : 'text-neutral-700'}`}>
      <tbody>
        {rows.slice(0, 8).map((r, i) => (
          <tr key={i} className={i === 0 ? 'font-semibold' : ''}>
            {r.slice(0, 5).map((c, j) => <td key={j} className={`truncate border px-0.5 ${dark ? 'border-white/10' : 'border-neutral-200'}`}>{c}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Thumbnail area: the picture, the first rows or lines, or an icon. Fills whatever box it is given. */
export function FileThumb({ src, className = '', tone = 'light', badge = true }: { src: PreviewSource; className?: string; tone?: 'light' | 'dark'; badge?: boolean }) {
  const thumb = useThumbnail(src);
  const kind = kindOf(src);
  const [broken, setBroken] = useState(false);
  const Icon = ICONS[kind];
  const dark = tone === 'dark';
  const pictureBg = kind === 'audio' ? (dark ? 'bg-[#1f1f1d]' : 'bg-[#FBF3EF]') : kind === 'video' ? 'bg-black' : 'bg-white';
  let body: ReactNode;
  if (thumb?.image && !broken) {
    body = <img src={thumb.image} alt="" draggable={false} onError={() => setBroken(true)} className={`h-full w-full ${kind === 'audio' ? 'object-contain px-2' : 'object-cover object-top'} ${pictureBg}`} />;
  } else if (thumb?.table?.length) {
    body = <span className={`block h-full w-full overflow-hidden p-1.5 ${dark ? 'bg-[#1f1f1d]' : 'bg-white'}`}><MiniTable rows={thumb.table} dark={dark} /></span>;
  } else if (thumb?.text) {
    body = <span className={`block h-full w-full overflow-hidden whitespace-pre-wrap break-words p-2 text-left ${kind === 'code' || kind === 'html' ? 'font-mono' : 'font-serif'} text-[7.5px] leading-[10px] ${dark ? 'bg-[#1f1f1d] text-neutral-400' : 'bg-white text-neutral-600'}`}>{thumb.text}</span>;
  } else if (!thumb) {
    body = <span className={`grid h-full w-full place-items-center ${dark ? 'bg-white/[0.03] text-neutral-500' : 'bg-neutral-50 text-neutral-400'}`}><Loader2 size={16} className="animate-spin" /></span>;
  } else {
    body = <span className={`flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-center text-[10.5px] ${dark ? 'bg-white/[0.03] text-neutral-400' : 'bg-neutral-50 text-neutral-600'}`}><Icon size={22} className="text-[#D97757]" /><span className="line-clamp-2 break-all">{src.name}</span></span>;
  }
  return (
    <span className={`relative flex overflow-hidden ${className}`}>
      {body}
      {badge && kind !== 'image' && <span className={`absolute bottom-1 left-1 rounded px-1 text-[9px] font-bold leading-[14px] tracking-wide text-white shadow ${TONE[kind]}`}>{badgeOf(src)}</span>}
    </span>
  );
}

/**
 * Claude-style attachment card: a square showing what is inside, the name and a short detail ("12 pages",
 * "48 lines"), and the file type. Opens the viewer; an optional remove button for files not sent yet.
 */
export function AttachmentCard({ src, onOpen, onRemove, size = 120 }: { src: PreviewSource; onOpen: () => void; onRemove?: () => void; size?: number }) {
  const thumb = useThumbnail(src);
  const kind = kindOf(src);
  const picture = kind === 'image' || !!thumb?.image;
  const Icon = ICONS[kind];
  const detail = [thumb?.meta, formatBytes(src.size)].filter(Boolean).join(' · ');
  return (
    <div className="group relative shrink-0" style={{ width: size }}>
      <button type="button" onClick={onOpen} aria-label={`Preview ${src.name}`} title={src.name}
        className="relative block overflow-hidden rounded-xl border border-white/10 bg-[#1f1f1d] text-left shadow-sm transition hover:border-white/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D97757]/60" style={{ width: size, height: size }}>
        {picture ? (
          <>
            <FileThumb src={src} tone="dark" badge={false} className="absolute inset-0" />
            {kind !== 'image' && (
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/60 to-transparent px-2 pb-1.5 pt-5">
                <span className="block truncate text-[11px] font-medium text-white">{src.name}</span>
                {detail && <span className="block truncate text-[9.5px] text-neutral-300">{detail}</span>}
              </span>
            )}
          </>
        ) : (
          <span className="flex h-full flex-col p-2.5">
            <span className="line-clamp-2 break-words text-[11.5px] font-semibold leading-tight text-[#FAF9F5]">{src.name}</span>
            {detail && <span className="mt-0.5 truncate text-[10px] text-neutral-500">{detail}</span>}
            {thumb && !thumb.text && !thumb.table
              ? <span className="grid min-h-0 flex-1 place-items-center"><Icon size={26} className="text-neutral-500" /></span>
              : <FileThumb src={src} tone="dark" badge={false} className="mt-1.5 min-h-0 flex-1 rounded-md [mask-image:linear-gradient(to_bottom,black_55%,transparent)]" />}
          </span>
        )}
        {kind !== 'image' && <span className={`absolute bottom-1.5 ${picture ? 'right-1.5' : 'left-1.5'} rounded px-1 text-[9px] font-bold leading-[14px] tracking-wide text-white ${TONE[kind]}`}>{badgeOf(src)}</span>}
      </button>
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`Remove ${src.name}`}
          className="absolute -right-1.5 -top-1.5 grid h-6 w-6 place-items-center rounded-full border border-white/15 bg-[#30302E] text-neutral-200 shadow hover:bg-rose-500 hover:text-white sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100"><X size={12} /></button>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- viewers ----------------------------------------------------------------- */

type Loaded =
  | { kind: 'text'; text: string; code: boolean }
  | { kind: 'word'; html: string }
  | { kind: 'html'; html: string }
  | { kind: 'sheets'; sheets: Sheet[] }
  | { kind: 'slides'; slides: Slide[]; thumbnail: string | null }
  | { kind: 'zip'; entries: ZipEntry[]; open: (p: string) => Promise<File> }
  | { kind: 'none' };

const colName = (i: number) => { let s = ''; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

function TableView({ rows, header = false }: { rows: string[][]; header?: boolean }) {
  const cols = Math.max(0, ...rows.map((r) => r.length));
  if (!rows.length) return <p className="p-6 text-center text-[13px] text-neutral-500">This sheet is empty.</p>;
  return (
    <div className="h-full overflow-auto rounded-lg border border-white/10 bg-white">
      <table className="min-w-full border-collapse text-[12.5px] text-neutral-800">
        <thead className="sticky top-0 z-10 bg-neutral-100 text-[11px] text-neutral-500">
          <tr><th className="w-10 border border-neutral-200" />{Array.from({ length: cols }, (_, i) => <th key={i} className="border border-neutral-200 px-2 py-1 font-medium">{colName(i)}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={header && i === 0 ? 'bg-neutral-50 font-semibold' : ''}>
              <td className="border border-neutral-200 bg-neutral-100 px-1.5 text-right text-[11px] text-neutral-500">{i + 1}</td>
              {Array.from({ length: cols }, (_, j) => <td key={j} className="max-w-[280px] truncate border border-neutral-200 px-2 py-1" title={r[j]}>{r[j]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SheetsView({ sheets }: { sheets: Sheet[] }) {
  const [i, setI] = useState(0);
  const s = sheets[i];
  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col gap-2">
      <div className="min-h-0 flex-1">{s ? <TableView rows={s.rows} header /> : <p className="text-white/70">No sheets.</p>}</div>
      {s && (s.rowCount > s.rows.length || s.colCount > 40) && <p className="text-[11.5px] text-neutral-500">Showing the first {s.rows.length} rows{s.colCount > 40 ? ' and 40 columns' : ''} of {s.rowCount}. Download to see everything.</p>}
      {sheets.length > 1 && (
        <div className="flex gap-1 overflow-x-auto" role="tablist">
          {sheets.map((sh, k) => <button key={k} type="button" role="tab" aria-selected={k === i} onClick={() => setI(k)} className={`shrink-0 rounded-md px-3 py-1.5 text-[12px] ${k === i ? 'bg-white text-neutral-900' : 'bg-white/10 text-neutral-300 hover:bg-white/15'}`}>{sh.name}</button>)}
        </div>
      )}
    </div>
  );
}

function SlidesView({ slides, thumbnail }: { slides: Slide[]; thumbnail: string | null }) {
  if (!slides.length) return <p className="mt-16 text-center text-white/70">This deck has no slides.</p>;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {thumbnail && <img src={thumbnail} alt="First slide" className="mx-auto w-full rounded-lg bg-white shadow" />}
      {slides.map((s) => (
        <section key={s.n} className="relative aspect-video overflow-hidden rounded-lg bg-white p-6 text-neutral-900 shadow sm:p-10">
          <span className="absolute right-3 top-2 text-[11px] text-neutral-400">{s.n} / {slides.length}</span>
          <h3 className="text-[18px] font-semibold leading-snug sm:text-[24px]">{s.title || <span className="text-neutral-400">Slide {s.n}</span>}</h3>
          <ul className="mt-3 space-y-1.5 text-[13px] leading-relaxed text-neutral-700 sm:text-[15px]">{s.lines.slice(0, 14).map((l, k) => <li key={k} className="flex gap-2"><span className="text-[#D97757]">•</span><span>{l}</span></li>)}</ul>
        </section>
      ))}
    </div>
  );
}

function ZipView({ entries, onOpen }: { entries: ZipEntry[]; onOpen: (path: string) => void }) {
  const files = entries.filter((e) => !e.dir);
  return (
    <div className="mx-auto max-w-2xl overflow-hidden rounded-xl border border-white/10 bg-[#16171b]">
      <p className="border-b border-white/10 px-4 py-2.5 text-[12px] text-neutral-400">{files.length} file{files.length === 1 ? '' : 's'} inside. Tap one to open it.</p>
      <ul className="divide-y divide-white/[0.06]">
        {entries.map((e) => {
          const depth = e.path.replace(/\/$/, '').split('/').length - 1;
          const name = e.path.replace(/\/$/, '').split('/').pop();
          const Icon = e.dir ? Folder : ICONS[kindOf({ name: e.path, type: '' })];
          return (
            <li key={e.path}>
              {e.dir ? <span className="flex items-center gap-2 px-4 py-2 text-[13px] text-neutral-400" style={{ paddingLeft: 16 + depth * 16 }}><Icon size={15} />{name}</span>
                : <button type="button" onClick={() => onOpen(e.path)} className="flex w-full items-center gap-2 px-4 py-2 text-left text-[13px] text-neutral-200 hover:bg-white/[0.05]" style={{ paddingLeft: 16 + depth * 16 }}>
                    <Icon size={15} className="shrink-0 text-[#F0A586]" /><span className="min-w-0 flex-1 truncate">{name}</span><span className="shrink-0 text-[11px] text-neutral-500">{formatBytes(e.size)}</span>
                  </button>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CodeView({ text, code }: { text: string; code: boolean }) {
  const lines = text.split('\n');
  if (!code) return <div className="mx-auto max-w-3xl whitespace-pre-wrap break-words rounded-lg bg-[#FBFAF6] px-5 py-5 font-serif text-[15px] leading-relaxed text-neutral-900 sm:px-8">{text}</div>;
  return (
    <div className="mx-auto max-w-5xl overflow-auto rounded-lg border border-white/10 bg-[#16171b] py-3 font-mono text-[12.5px] leading-[20px] text-neutral-200">
      <table className="border-collapse"><tbody>
        {lines.slice(0, 20000).map((l, i) => <tr key={i}><td className="select-none pl-4 pr-4 text-right align-top text-neutral-600">{i + 1}</td><td className="whitespace-pre pr-6">{l || ' '}</td></tr>)}
      </tbody></table>
    </div>
  );
}

function Unsupported({ src, url }: { src: PreviewSource; url: string | null }) {
  const Icon = ICONS[kindOf(src)];
  return (
    <div className="mx-auto mt-16 max-w-sm rounded-2xl border border-white/10 bg-[#16171b] p-6 text-center">
      <Icon className="mx-auto text-[#F0A586]" size={30} />
      <p className="mt-2 break-words text-[14px] font-medium text-white">{src.name}</p>
      <p className="mt-1 text-[12.5px] text-neutral-400">{badgeOf(src)} file{src.size ? ` · ${formatBytes(src.size)}` : ''}. This type can't be shown in the browser, but it is kept and sent as it is.</p>
      {url && <a href={url} download={src.name} className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-[13px] font-semibold text-neutral-900 hover:bg-neutral-200"><Download size={14} /> Download</a>}
    </div>
  );
}

/** Full-screen viewer for any file; closes on Escape or the close button. */
export function PreviewDialog({ src: initial, onClose, footer }: { src: PreviewSource; onClose: () => void; footer?: ReactNode }) {
  // Opening a file inside a ZIP pushes it here; Back returns to the folder.
  const [stack, setStack] = useState<PreviewSource[]>([initial]);
  useEffect(() => setStack([initial]), [initial]);
  const src = stack[stack.length - 1];
  const kind = kindOf(src);
  const url = useSourceUrl(src);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);
  const [showSource, setShowSource] = useState(false);

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (stack.length > 1) setStack((s) => s.slice(0, -1)); else onClose(); } };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose, stack.length]);
  useEffect(() => {
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = overflow; };
  }, []);

  useEffect(() => {
    setLoaded(null); setError(null); setBroken(false); setShowSource(false);
    if (['image', 'pdf', 'audio', 'video'].includes(kind)) return;
    if (kind === 'other') { setLoaded({ kind: 'none' }); return; }
    let live = true;
    (async (): Promise<Loaded> => {
      const blob = await blobOf(src);
      switch (kind) {
        case 'word': return { kind: 'word', html: await readWordHtml(blob) };
        case 'sheet': return { kind: 'sheets', sheets: await readWorkbook(blob) };
        case 'csv': return { kind: 'sheets', sheets: [{ name: src.name, rows: await readCsv(blob, src.name), rowCount: 0, colCount: 0 }] };
        case 'slides': return { kind: 'slides', ...(await readDeck(blob)) };
        case 'zip': return { kind: 'zip', ...(await readZip(blob)) };
        case 'html': return { kind: 'html', html: await blob.text() };
        default: return { kind: 'text', text: await readText(blob, src.name), code: kind === 'code' };
      }
    })().then((l) => live && setLoaded(l)).catch((e) => live && setError(e instanceof Error && /copy/.test(e.message) ? e.message : 'This file could not be opened. It may be damaged or in an older format.'));
    return () => { live = false; };
  }, [src, kind]);

  const openInner = async (path: string) => {
    if (loaded?.kind !== 'zip') return;
    const file = await loaded.open(path);
    setStack((s) => [...s, { name: file.name, type: file.type, file, size: file.size }]);
  };

  const spinner = <div className="flex h-full items-center justify-center text-white/60"><Loader2 className="animate-spin" /></div>;
  let content: ReactNode;
  if (error) content = (
    <div className="mx-auto mt-10 max-w-md text-center">
      {src.thumb?.image && <img src={src.thumb.image} alt="" className="mx-auto mb-4 max-h-[50vh] rounded-lg bg-white shadow" />}
      <p className="text-[14px] text-white/70">{error}</p>
    </div>
  );
  else if (kind === 'image') content = !url ? spinner : !broken && browserCanShowImage(src)
    ? <img src={url} alt={src.name} onError={() => setBroken(true)} className="mx-auto max-h-full w-auto max-w-full bg-white object-contain" />
    : <Unsupported src={src} url={url} />;
  else if (url === '') content = (
    <div className="mx-auto mt-10 max-w-md text-center">
      {src.thumb?.image && <img src={src.thumb.image} alt="" className="mx-auto mb-4 max-h-[50vh] rounded-lg bg-white shadow" />}
      <p className="text-[14px] text-white/70">The full file is no longer available in this browser. Attach it again to open every page.</p>
    </div>
  );
  else if (kind === 'pdf') content = !url ? spinner : <div className="mx-auto h-full max-w-3xl"><PdfViewer url={url} name={src.name} tall /></div>;
  else if (kind === 'audio') content = !url ? spinner : <AudioView src={src} url={url} />;
  else if (kind === 'video') content = !url ? spinner : <video controls playsInline src={url} className="mx-auto max-h-full max-w-full rounded-lg" />;
  else if (!loaded) content = spinner;
  else if (loaded.kind === 'word') content = loaded.html ? <article className="doc-preview mx-auto max-w-3xl rounded-lg bg-white px-6 py-8 text-[15px] leading-relaxed text-neutral-900 shadow sm:px-12 sm:py-12" dangerouslySetInnerHTML={{ __html: loaded.html }} /> : <p className="mt-16 text-center text-white/70">This document is empty.</p>;
  else if (loaded.kind === 'sheets') content = <SheetsView sheets={loaded.sheets} />;
  else if (loaded.kind === 'slides') content = <SlidesView slides={loaded.slides} thumbnail={loaded.thumbnail} />;
  else if (loaded.kind === 'zip') content = <ZipView entries={loaded.entries} onOpen={(p) => void openInner(p)} />;
  else if (loaded.kind === 'html') content = showSource ? <CodeView text={loaded.html} code /> : <SandboxFrame title={src.name} html={loaded.html} className="mx-auto h-full w-full max-w-5xl rounded-lg bg-white" />;
  else if (loaded.kind === 'text') content = loaded.text.trim() ? <CodeView text={loaded.text} code={loaded.code} /> : <p className="mt-16 text-center text-white/70">This file is empty.</p>;
  else content = <Unsupported src={src} url={url} />;

  const Icon = ICONS[kind];
  return (
    <div role="dialog" aria-modal="true" aria-label={`Preview of ${src.name}`} className="fixed inset-0 z-[100] flex flex-col bg-neutral-950/95 backdrop-blur-sm">
      <div className="flex items-center gap-2 px-3 py-2.5 text-white sm:px-5">
        {stack.length > 1 && <button type="button" onClick={() => setStack((s) => s.slice(0, -1))} aria-label="Back to the folder" className="rounded-full bg-white/10 p-2 hover:bg-white/20"><ArrowLeft size={16} /></button>}
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white ${TONE[kind]}`}><Icon size={16} /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium">{src.name}</span>
          <span className="block truncate text-[11.5px] text-neutral-400">{[badgeOf(src), formatBytes(src.size ?? src.file?.size)].filter(Boolean).join(' · ')}</span>
        </span>
        {loaded?.kind === 'html' && <button type="button" onClick={() => setShowSource((v) => !v)} className="hidden rounded-lg bg-white/10 px-3 py-1.5 text-[12.5px] hover:bg-white/20 sm:block">{showSource ? 'Page' : 'Source'}</button>}
        {url && <a href={url} download={src.name} aria-label={`Download ${src.name}`} title="Download" className="rounded-full bg-white/10 p-2 hover:bg-white/20"><Download size={17} /></a>}
        <button type="button" onClick={onClose} aria-label="Close preview" className="rounded-full bg-white/10 p-2 hover:bg-white/20"><X size={18} /></button>
      </div>
      <div className="scroll-area min-h-0 flex-1 overflow-auto px-2 pb-3 sm:px-6">{content}</div>
      {footer && <div className="border-t border-white/10 px-3 py-2.5 sm:px-5">{footer}</div>}
    </div>
  );
}

function AudioView({ src, url }: { src: PreviewSource; url: string }) {
  const thumb = useThumbnail(src);
  return (
    <div className="mx-auto mt-16 max-w-lg rounded-2xl border border-white/10 bg-[#16171b] p-6 text-center">
      {thumb?.image ? <img src={thumb.image} alt="" className="mx-auto h-24 w-full object-contain" /> : <FileAudio className="mx-auto text-[#F0A586]" size={28} />}
      <p className="mt-2 break-words text-[13.5px] text-neutral-300">{src.name}{thumb?.meta ? ` · ${thumb.meta}` : ''}</p>
      <audio controls autoPlay src={url} className="mt-4 w-full" />
    </div>
  );
}

/** How a chat attachment (staged, or in a sent message) opens: the file itself, its full copy, or its thumbnail. */
export function attachmentSource(item: File | { name?: string; fileName?: string; mimeType?: string; type?: string; url?: string; localUrl?: string; previewUrl?: string; storedFileId?: string; size?: number | string; bytes?: number; thumb?: Thumb }): PreviewSource {
  if (item instanceof File) return { name: item.name, type: item.type, file: item, size: item.size };
  const full = item.localUrl || (item.url && !item.url.startsWith('data:') ? item.url : undefined);
  const size = typeof item.size === 'number' ? item.size : item.bytes;
  // A data URL that is the whole file (small files) is a full copy, not just a thumbnail.
  const dataFull = !full && item.url?.startsWith('data:') && !item.url.startsWith('data:image') ? item.url : undefined;
  return { name: item.name || item.fileName || 'Attachment', type: item.mimeType || item.type || '', url: full ?? dataFull, storedFileId: item.storedFileId, fallbackUrl: item.previewUrl || item.url, size, thumb: item.thumb };
}

/** Memoised source for a list item, so a redraw doesn't create a new object each time. */
export function useAttachmentSources<T>(items: T[]): PreviewSource[] {
  return useMemo(() => items.map((i) => attachmentSource(i as any)), [items]);
}
