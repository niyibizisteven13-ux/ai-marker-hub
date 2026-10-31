import { SandboxFrame } from './SandboxFrame';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { FileThumb, PreviewDialog, type PreviewSource } from './FilePreview';

const PdfViewer = lazy(() => import('./PdfViewer').then((m) => ({ default: m.PdfViewer })));
const SceneViewer = lazy(() => import('./scene3d/SceneViewer'));
import { Download, Eye, EyeOff, FileArchive, FileCode, FileImage, FileSpreadsheet, FileText, FileType2, LayoutDashboard, Loader2, Maximize2, Presentation, Sparkles, X } from 'lucide-react';
import type { AttachmentKind, AttachmentRef } from './types';
import { validateScene, type Scene } from '../lib/scene/spec';

/** Type label, icon and accent per generated file, decided by MIME type first (HTML reports have kind "document"). */
function fileStyle(a: AttachmentRef): { label: string; Icon: typeof FileText; tone: string } {
  const m = a.mime.split(';')[0];
  if (m === 'text/html') return { label: 'Interactive report', Icon: LayoutDashboard, tone: 'text-[#C3A6FF] bg-[#C3A6FF]/10 ring-[#C3A6FF]/25' };
  if (/spreadsheetml|ms-excel/.test(m) || a.kind === 'spreadsheet') return { label: 'Excel workbook', Icon: FileSpreadsheet, tone: 'text-[#5DCAA5] bg-[#5DCAA5]/10 ring-[#5DCAA5]/25' };
  if (/presentationml|powerpoint/.test(m) || a.kind === 'presentation') return { label: 'PowerPoint deck', Icon: Presentation, tone: 'text-[#F2A65A] bg-[#F2A65A]/10 ring-[#F2A65A]/25' };
  if (m === 'application/pdf' || a.kind === 'pdf') return { label: 'PDF', Icon: FileType2, tone: 'text-[#FF8A80] bg-[#FF8A80]/10 ring-[#FF8A80]/25' };
  if (/wordprocessingml|msword/.test(m)) return { label: 'Word document', Icon: FileText, tone: 'text-[#7DB7F5] bg-[#7DB7F5]/10 ring-[#7DB7F5]/25' };
  if (a.kind === 'model3d') return { label: '3D model', Icon: FileCode, tone: 'text-[#F2A65A] bg-[#F2A65A]/10 ring-[#F2A65A]/25' };
  if (a.kind === 'archive') return { label: 'ZIP archive', Icon: FileArchive, tone: 'text-[#E8C468] bg-[#E8C468]/10 ring-[#E8C468]/25' };
  if (a.kind === 'code' || m === 'application/json') return { label: m === 'application/json' ? 'JSON data' : 'Code file', Icon: FileCode, tone: 'text-[#9FD3F2] bg-[#9FD3F2]/10 ring-[#9FD3F2]/25' };
  const LABEL: Partial<Record<AttachmentKind, string>> = { text: 'Text file', image: 'Image', drawing: 'Drawing', chart: 'Chart', diagram: 'Diagram', document: 'Document' };
  return { label: LABEL[a.kind] ?? 'File', Icon: a.kind === 'image' ? FileImage : FileText, tone: 'text-stone-300 bg-stone-800 ring-stone-700' };
}

export function formatSize(n: number): string {
  return n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
}

const isVisual = (a: AttachmentRef) =>
  ['image', 'drawing', 'chart', 'diagram'].includes(a.kind) && (!!a.previewUrl || /^image\/(png|jpeg|svg\+xml|webp)/.test(a.mime));
const isExpired = (a: AttachmentRef) => Date.parse(a.expiresAt) < Date.now();
const isHtml = (a: AttachmentRef) => a.mime.startsWith('text/html');
const isText = (a: AttachmentRef) => /^(text\/(plain|csv|markdown)|application\/json)/.test(a.mime);
const isPdf = (a: AttachmentRef) => a.mime.startsWith('application/pdf') || a.kind === 'pdf';

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
}

function Lightbox({ item, onClose }: { item: AttachmentRef; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEscape(onClose);
  useEffect(() => { closeRef.current?.focus(); }, []);
  return (
    <div role="dialog" aria-modal="true" aria-label={item.name} className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="relative max-h-full max-w-5xl" onClick={(e) => e.stopPropagation()}>
        <img src={item.previewUrl ?? item.url} alt={item.name} className="max-h-[80vh] max-w-full rounded-xl bg-white object-contain shadow-2xl" />
        <div className="mt-3 flex items-center justify-between gap-3 text-sm text-stone-200">
          <span className="truncate">{item.name}</span>
          <a href={item.url} download={item.name} className="inline-flex items-center gap-1.5 rounded-lg bg-stone-800 px-3 py-1.5 hover:bg-stone-700">
            <Download className="h-4 w-4" aria-hidden="true" /> Download
          </a>
        </div>
      </div>
      <button ref={closeRef} type="button" onClick={onClose} aria-label="Close preview" className="absolute right-4 top-4 rounded-full bg-stone-800 p-2 text-stone-200 hover:bg-stone-700">
        <X className="h-5 w-5" aria-hidden="true" />
      </button>
    </div>
  );
}

/** Generated HTML runs in a sandbox without same-origin access: its scripts work, but it cannot reach the app, cookies or network. */
function HtmlFrame({ html, title, tall }: { html: string; title: string; tall?: boolean }) {
  return <SandboxFrame title={title} html={html} className={`w-full rounded-lg bg-white ${tall ? 'h-[85vh]' : 'h-[460px]'}`} />;
}

function FullScreenHtml({ item, html, onClose }: { item: AttachmentRef; html: string; onClose: () => void }) {
  useEscape(onClose);
  return (
    <div role="dialog" aria-modal="true" aria-label={item.name} className="fixed inset-0 z-[100] flex flex-col bg-black/85 p-3 sm:p-6 backdrop-blur-sm">
      <div className="mb-3 flex items-center justify-between gap-3 text-sm text-stone-200">
        <span className="truncate font-medium">{item.name}</span>
        <div className="flex gap-2">
          <a href={item.url} download={item.name} className="inline-flex items-center gap-1.5 rounded-lg bg-stone-800 px-3 py-1.5 hover:bg-stone-700"><Download className="h-4 w-4" aria-hidden="true" /> Download</a>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg bg-stone-800 p-1.5 hover:bg-stone-700"><X className="h-5 w-5" aria-hidden="true" /></button>
        </div>
      </div>
      <HtmlFrame html={html} title={item.name} tall />
    </div>
  );
}

function FileCard({ a }: { a: AttachmentRef }) {
  const { label, Icon, tone } = fileStyle(a);
  const expired = isExpired(a);
  const previewable = !expired;
  const [open, setOpen] = useState(false);
  const [viewer, setViewer] = useState(false);
  const source = useMemo<PreviewSource>(() => ({ name: a.name, type: a.mime.split(';')[0], url: a.url, size: a.size }), [a]);
  const [full, setFull] = useState(false);
  const [body, setBody] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    if (!isHtml(a)) { setViewer(true); return; }
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (body !== null || isPdf(a)) return;
    try {
      const res = await fetch(a.url, { credentials: 'include' });
      if (!res.ok) throw new Error(res.status === 410 ? 'This link has expired.' : `Could not load the file (${res.status}).`);
      setBody(await res.text());
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load the file.'); }
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-stone-800 bg-stone-900/70 transition hover:border-stone-700">
      <div className="flex items-center gap-3 p-3">
        {expired || isHtml(a)
          ? <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1 ${tone}`}><Icon className="h-5 w-5" aria-hidden="true" /></div>
          : <button type="button" onClick={() => setViewer(true)} aria-label={`Preview ${a.name}`} className="h-14 w-12 shrink-0 overflow-hidden rounded-lg ring-1 ring-white/10 transition hover:ring-white/30"><FileThumb src={source} tone="dark" badge={false} className="h-full w-full" /></button>}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-stone-100" title={a.name}>{a.name}</p>
          <p className="text-xs text-stone-500">{label} · {formatSize(a.size)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {previewable && (
            <button type="button" onClick={toggle} aria-expanded={open} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-stone-300 transition hover:bg-stone-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60">
              {open ? <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> : <Eye className="h-3.5 w-3.5" aria-hidden="true" />}<span className="hidden sm:inline">{open ? 'Hide' : isHtml(a) ? 'Open' : 'Preview'}</span>
            </button>
          )}
          {expired
            ? <span className="rounded-lg px-3 py-1.5 text-xs text-stone-500">Link expired</span>
            : <a href={a.url} download={a.name} aria-label={`Download ${a.name}`} className="inline-flex items-center gap-1.5 rounded-lg bg-stone-100 px-3 py-1.5 text-xs font-semibold text-stone-900 transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60">
                <Download className="h-3.5 w-3.5" aria-hidden="true" /><span className="hidden sm:inline">Download</span>
              </a>}
        </div>
      </div>
      {open && (
        <div className="border-t border-stone-800 bg-stone-950/60 p-2.5">
          {isPdf(a) ? <Suspense fallback={<div className="flex h-40 items-center justify-center text-stone-500"><Loader2 className="h-5 w-5 animate-spin" aria-label="Loading" /></div>}><PdfViewer url={a.url} name={a.name} /></Suspense>
            : error ? <p className="p-3 text-sm text-red-300">{error}</p>
            : body === null ? <div className="flex h-40 items-center justify-center text-stone-500"><Loader2 className="h-5 w-5 animate-spin" aria-label="Loading" /></div>
              : isHtml(a) ? (
                <div className="space-y-2">
                  <HtmlFrame html={body} title={a.name} />
                  <button type="button" onClick={() => setFull(true)} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-stone-400 hover:text-white"><Maximize2 className="h-3.5 w-3.5" aria-hidden="true" /> Full screen</button>
                </div>
              ) : <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words p-2 font-mono text-[12.5px] leading-relaxed text-stone-300">{body.slice(0, 200_000)}</pre>}
        </div>
      )}
      {full && body !== null && <FullScreenHtml item={a} html={body} onClose={() => setFull(false)} />}
      {viewer && <PreviewDialog src={source} onClose={() => setViewer(false)} />}
    </div>
  );
}

/** Interactive 3D model: loads the scene JSON (validated again in the browser) and shows the viewer inline. */
function SceneCard({ a }: { a: AttachmentRef }) {
  const [scene, setScene] = useState<Scene | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (isExpired(a)) { setError('This model link has expired.'); return; }
    let live = true;
    fetch(a.url, { credentials: 'include' })
      .then((r) => { if (!r.ok) throw new Error(r.status === 410 ? 'This model link has expired.' : `Could not load the model (${r.status}).`); return r.json(); })
      .then((j) => { if (live) setScene(validateScene(j)); })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : 'Could not load the model.'); });
    return () => { live = false; };
  }, [a]);
  const loading = <div className="flex h-[420px] items-center justify-center rounded-2xl border border-stone-800 bg-[#0c0f15] text-stone-500"><Loader2 className="h-5 w-5 animate-spin" aria-label="Loading 3D model" /></div>;
  if (error) return <div className="rounded-2xl border border-stone-800 bg-stone-900/70 p-4 text-sm text-stone-400">{error}</div>;
  if (!scene) return loading;
  return <Suspense fallback={loading}><SceneViewer scene={scene} fileName={a.name} /></Suspense>;
}

/**
 * Files the AI created in this reply: charts, diagrams and drawings as image tiles (click to enlarge),
 * and workbooks, documents, decks, PDFs, interactive reports and archives as cards with preview and download.
 * Images are rendered with <img>, never inline, so generated SVG can never run scripts in the page.
 */
export function AttachmentCards({ attachments }: { attachments?: AttachmentRef[] }) {
  const [open, setOpen] = useState<AttachmentRef | null>(null);
  if (!attachments?.length) return null;
  const visuals = attachments.filter(isVisual);
  const scenes = attachments.filter((a) => a.kind === 'model3d');
  const files = attachments.filter((a) => !isVisual(a) && a.kind !== 'model3d');

  return (
    <div className="mt-4 space-y-3 animate-[bw-rise_.25s_ease-out]" data-testid="attachments">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-stone-500">
        <Sparkles className="h-3.5 w-3.5 text-amber-400/80" aria-hidden="true" /> Created for you · {attachments.length} {attachments.length === 1 ? 'file' : 'files'}
      </p>
      {visuals.length > 0 && (
        <div className={`grid gap-3 ${visuals.length > 1 ? 'sm:grid-cols-2' : ''}`}>
          {visuals.map((a) => {
            const { label } = fileStyle(a);
            return (
              <figure key={a.id} className="group overflow-hidden rounded-2xl border border-stone-800 bg-stone-900/70 transition hover:border-stone-700">
                <button type="button" onClick={() => setOpen(a)} aria-label={`Enlarge ${a.name}`} className="relative block w-full bg-white">
                  <img src={a.previewUrl ?? a.url} alt={a.name} loading="lazy" className={`w-full object-contain ${visuals.length > 1 ? 'max-h-64' : 'max-h-[420px]'}`} />
                  <span className="absolute right-2 top-2 rounded-lg bg-black/60 p-1.5 text-white opacity-0 transition group-hover:opacity-100"><Maximize2 className="h-4 w-4" aria-hidden="true" /></span>
                </button>
                <figcaption className="flex items-center justify-between gap-2 px-3 py-2.5 text-xs">
                  <span className="min-w-0"><span className="block truncate font-medium text-stone-200">{a.name}</span><span className="text-stone-500">{label} · {formatSize(a.size)}</span></span>
                  {isExpired(a)
                    ? <span className="shrink-0 text-stone-500">Link expired</span>
                    : <a href={a.url} download={a.name} aria-label={`Download ${a.name}`} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-stone-100 px-3 py-1.5 font-semibold text-stone-900 hover:bg-white"><Download className="h-3.5 w-3.5" aria-hidden="true" /><span className="hidden sm:inline">Download</span></a>}
                </figcaption>
              </figure>
            );
          })}
        </div>
      )}
      {scenes.map((a) => <SceneCard key={a.id} a={a} />)}
      {files.length > 0 && <div className="space-y-2.5">{files.map((a) => <FileCard key={a.id} a={a} />)}</div>}
      {open && <Lightbox item={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
