import { useEffect, useRef, useState } from 'react';
import { Download, FileArchive, FileCode, FileImage, FileSpreadsheet, FileText, Presentation, X } from 'lucide-react';
import type { AttachmentKind, AttachmentRef } from './types';

const LABEL: Record<AttachmentKind, string> = {
  document: 'Word document', spreadsheet: 'Excel workbook', presentation: 'PowerPoint', pdf: 'PDF', text: 'Text file',
  code: 'Code file', image: 'Image', drawing: 'Drawing', chart: 'Chart', diagram: 'Diagram', archive: 'ZIP archive',
};

function KindIcon({ kind }: { kind: AttachmentKind }) {
  const cls = 'h-5 w-5';
  switch (kind) {
    case 'spreadsheet': return <FileSpreadsheet className={cls} aria-hidden="true" />;
    case 'presentation': return <Presentation className={cls} aria-hidden="true" />;
    case 'archive': return <FileArchive className={cls} aria-hidden="true" />;
    case 'code': return <FileCode className={cls} aria-hidden="true" />;
    case 'image': case 'drawing': case 'chart': case 'diagram': return <FileImage className={cls} aria-hidden="true" />;
    default: return <FileText className={cls} aria-hidden="true" />;
  }
}

export function formatSize(n: number): string {
  return n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
}

const isVisual = (a: AttachmentRef) =>
  ['image', 'drawing', 'chart', 'diagram'].includes(a.kind) && (!!a.previewUrl || /^image\/(png|jpeg|svg\+xml|webp)/.test(a.mime));

const isExpired = (a: AttachmentRef) => Date.parse(a.expiresAt) < Date.now();

function Lightbox({ item, onClose }: { item: AttachmentRef; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={item.name} className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div className="relative max-h-full max-w-5xl" onClick={(e) => e.stopPropagation()}>
        <img src={item.previewUrl ?? item.url} alt={item.name} className="max-h-[80vh] max-w-full rounded-lg bg-white object-contain" />
        <div className="mt-2 flex items-center justify-between gap-3 text-sm text-stone-200">
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

/**
 * Shows files the AI created: drawings, charts and diagrams as image tiles (click to enlarge),
 * and documents, spreadsheets, slides, PDFs and archives as download cards.
 * Images are rendered with <img>, never inline, so generated SVG can never run scripts in the page.
 */
export function AttachmentCards({ attachments }: { attachments?: AttachmentRef[] }) {
  const [open, setOpen] = useState<AttachmentRef | null>(null);
  if (!attachments?.length) return null;
  const visuals = attachments.filter(isVisual);
  const files = attachments.filter((a) => !isVisual(a));
  const base = 'rounded-xl border border-stone-800 bg-stone-900/60';

  return (
    <div className="mt-3 space-y-3" data-testid="attachments">
      {visuals.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {visuals.map((a) => (
            <figure key={a.id} className={`group relative overflow-hidden ${base}`}>
              <button type="button" onClick={() => setOpen(a)} aria-label={`Open ${a.name}`} className="block w-full bg-white">
                <img src={a.previewUrl ?? a.url} alt={a.name} loading="lazy" className="max-h-72 w-full object-contain" />
              </button>
              <figcaption className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-stone-400">
                <span className="truncate">{a.name}</span>
                {isExpired(a)
                  ? <span className="shrink-0 text-stone-500">Expired</span>
                  : <a href={a.url} download={a.name} aria-label={`Download ${a.name}`} className="inline-flex shrink-0 items-center gap-1 text-stone-300 hover:text-white"><Download className="h-3.5 w-3.5" aria-hidden="true" />{formatSize(a.size)}</a>}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      {files.map((a) => (
        <div key={a.id} className={`flex items-center gap-3 p-3 ${base}`}>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-stone-800 text-stone-300"><KindIcon kind={a.kind} /></div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-stone-100">{a.name}</p>
            <p className="text-xs text-stone-500">{LABEL[a.kind]} · {formatSize(a.size)}</p>
          </div>
          {isExpired(a)
            ? <span className="rounded-lg px-3 py-1.5 text-xs text-stone-500">Expired</span>
            : <a href={a.url} download={a.name} className="inline-flex items-center gap-1.5 rounded-lg border border-stone-700 px-3 py-1.5 text-xs font-medium text-stone-200 transition hover:bg-stone-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60">
                <Download className="h-3.5 w-3.5" aria-hidden="true" /> Download
              </a>}
        </div>
      ))}
      {open && <Lightbox item={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
