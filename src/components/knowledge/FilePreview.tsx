import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, FileArchive, Loader2, RefreshCw, X } from 'lucide-react';
import { formatBytes, knowledgeApi, type Preview, type RepoFile } from '../../api/knowledge';
import MarkdownRenderer from '../MarkdownRenderer';
import { FileIcon, StatusBadge, fmtDate, kx, useAuthedImage } from './ui';

/**
 * Slide-over preview for one repository file. Every format is rendered from the server's bounded,
 * sanitised preview data: HTML and Word documents go into a script-less sandboxed frame, images and PDF
 * pages are fetched with the bearer token.
 */
export default function FilePreview({ file, onClose, onReindex, onExtracted }: { file: RepoFile; onClose: () => void; onReindex: (f: RepoFile) => void; onExtracted: () => void }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (q: { page?: number; sheet?: string; offset?: number } = {}) => {
    setLoading(true); setError(null);
    try { setPreview(await knowledgeApi.preview(file.id, q)); } catch (e) { setError(e instanceof Error ? e.message : 'Preview failed.'); } finally { setLoading(false); }
  }, [file.id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const f = preview?.file ?? file;
  return (
    <div className="fixed inset-0 z-[70] flex justify-end bg-black/50 backdrop-blur-[2px]" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside role="dialog" aria-label={`Preview ${f.name}`} className="flex h-full w-full sm:w-[min(880px,92vw)] flex-col border-l border-[#263052] bg-[#0B1020] shadow-2xl animate-[slideIn_.22s_ease-out]">
        <header className="flex flex-wrap items-start gap-3 border-b border-[#202945] px-4 sm:flex-nowrap sm:px-6 py-4">
          <div className="mt-0.5 rounded-xl border border-[#263052] bg-[#11172A] p-2.5"><FileIcon extension={f.extension} size={22} /></div>
          <div className="min-w-0 flex-1 basis-[calc(100%-7rem)] sm:basis-auto">
            <h3 className="truncate text-base sm:text-lg font-bold text-white" title={f.name}>{f.name}</h3>
            <p className="truncate text-xs text-[#7C8CB8]" title={f.path}>{f.path}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[#9AA6C9]">
              <StatusBadge status={f.indexing.status} error={f.indexing.error} />
              <span>{formatBytes(f.sizeBytes)}</span><span aria-hidden>·</span>
              <span>v{f.version}</span><span aria-hidden>·</span>
              <span>Updated {fmtDate(f.updatedAt)}</span>
              {f.indexing.chunks ? <><span aria-hidden>·</span><span>{f.indexing.chunks} {f.indexing.chunks === 1 ? 'passage' : 'passages'} searchable</span></> : null}
            </div>
            {f.indexing.error && (f.indexing.searchable
              ? <p className="mt-2 rounded-lg border border-[#F2C230]/30 bg-[#F2C230]/10 px-3 py-2 text-xs text-[#F2C230]">{f.indexing.error}</p>
              : <p className="mt-2 rounded-lg border border-[#E5586B]/30 bg-[#E5586B]/10 px-3 py-2 text-xs text-[#FF8798]">{f.indexing.error}</p>)}
          </div>
          <button className="shrink-0 rounded-lg p-2 text-[#9AA6C9] hover:bg-white/5 hover:text-white sm:order-last" onClick={onClose} aria-label="Close preview"><X size={20} /></button>
          <div className="flex w-full gap-2 sm:w-auto sm:shrink-0">
            <button className={`${kx.btn} ${kx.ghost} flex-1 sm:flex-none`} onClick={() => onReindex(f)} title="Index again"><RefreshCw size={15} /> Re-index</button>
            <button className={`${kx.btn} ${kx.ghost} flex-1 sm:flex-none`} onClick={() => void knowledgeApi.download(f)} title="Download"><Download size={15} /> Download</button>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5">
          {loading && !preview && <div className="flex h-60 items-center justify-center text-[#9AA6C9]"><Loader2 className="animate-spin" /></div>}
          {error && <p className="rounded-xl border border-[#E5586B]/30 bg-[#E5586B]/10 p-4 text-sm text-[#FF8798]">{error}</p>}
          {preview && <Body preview={preview} loading={loading} load={load} busy={busy} onExtract={async () => {
            setBusy(true);
            try { await knowledgeApi.extractArchive(file.id, file.directoryId); onExtracted(); onClose(); } catch (e) { setError(e instanceof Error ? e.message : 'Extraction failed.'); } finally { setBusy(false); }
          }} />}
        </div>
      </aside>
    </div>
  );
}

function Pager({ label, onPrev, onNext, prevDisabled, nextDisabled }: { label: string; onPrev: () => void; onNext: () => void; prevDisabled: boolean; nextDisabled: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-[#202945] bg-[#0E1426] px-3 py-2 text-sm text-[#B7C1DE]">
      <button className={`${kx.btn} ${kx.ghost} !px-2.5`} disabled={prevDisabled} onClick={onPrev} aria-label="Previous"><ChevronLeft size={16} /></button>
      <span className="tabular-nums">{label}</span>
      <button className={`${kx.btn} ${kx.ghost} !px-2.5`} disabled={nextDisabled} onClick={onNext} aria-label="Next"><ChevronRight size={16} /></button>
    </div>
  );
}

const frameDoc = (html: string) => `<!doctype html><html><head><meta charset="utf-8"><style>body{font:15px/1.6 Inter,system-ui,sans-serif;color:#1d2433;margin:24px;max-width:780px}table{border-collapse:collapse}td,th{border:1px solid #d5dae6;padding:4px 8px}img{max-width:100%}</style></head><body>${html}</body></html>`;

function Body({ preview: p, loading, load, onExtract, busy }: { preview: Preview; loading: boolean; load: (q?: { page?: number; sheet?: string; offset?: number }) => void; onExtract: () => void; busy: boolean }) {
  switch (p.kind) {
    case 'markdown':
      return <div className="rounded-xl border border-[#202945] bg-[#0E1426] p-5 text-[#E8EAF2]"><MarkdownRenderer content={p.text} /></div>;
    case 'text':
    case 'json':
      return (
        <div className="space-y-3">
          <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words rounded-xl border border-[#202945] bg-[#070B14] p-4 font-mono text-[13px] leading-relaxed text-[#D6DCF0]">{p.text}</pre>
          {(p.offset > 0 || p.nextOffset !== null) && (
            <Pager label={`${formatBytes(p.offset)} – ${formatBytes(p.nextOffset ?? p.totalBytes)} of ${formatBytes(p.totalBytes)}`} prevDisabled={p.offset === 0 || loading} nextDisabled={p.nextOffset === null || loading}
              onPrev={() => load({ offset: Math.max(0, p.offset - 64 * 1024) })} onNext={() => load({ offset: p.nextOffset ?? 0 })} />
          )}
        </div>
      );
    case 'table':
      return (
        <div className="space-y-3">
          {p.sheets.length > 1 && (
            <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist">
              {p.sheets.map((s) => (
                <button key={s.name} role="tab" aria-selected={s.name === p.sheet} onClick={() => load({ sheet: s.name })}
                  className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold ${s.name === p.sheet ? 'bg-[#3FA7E0] text-[#08101F]' : 'bg-[#18213D] text-[#B7C1DE] hover:bg-[#222E54]'}`}>{s.name}</button>
              ))}
            </div>
          )}
          <div className="max-h-[65vh] overflow-auto rounded-xl border border-[#202945]">
            <table className="min-w-full text-left text-[13px]">
              <thead className="sticky top-0 bg-[#18203B] text-[#B7C1DE]">
                <tr><th className="px-3 py-2 text-right text-[11px] text-[#6C789E]">#</th>{p.columns.map((c, i) => <th key={i} className="whitespace-nowrap px-3 py-2 font-semibold">{c || `Column ${i + 1}`}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-[#1A2240] text-[#E1E6F5]">
                {p.rows.map((r, i) => (
                  <tr key={i} className="hover:bg-white/[0.03]">
                    <td className="px-3 py-1.5 text-right text-[11px] text-[#6C789E] tabular-nums">{p.offset + i + 1}</td>
                    {p.columns.map((_, j) => <td key={j} className="max-w-[320px] truncate px-3 py-1.5" title={r[j]}>{r[j]}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager label={`Rows ${p.rows.length ? p.offset + 1 : 0}–${p.offset + p.rows.length} of ${p.totalRows}`} prevDisabled={p.offset === 0 || loading} nextDisabled={p.nextOffset === null || loading}
            onPrev={() => load({ sheet: p.sheet, offset: Math.max(0, p.offset - 100) })} onNext={() => load({ sheet: p.sheet, offset: p.nextOffset ?? 0 })} />
        </div>
      );
    case 'pdf':
      return <PdfPage p={p} loading={loading} load={load} />;
    case 'document':
    case 'html':
      return (
        <div className="space-y-2">
          {p.note && <p className="text-xs text-[#7C8CB8]">{p.note}</p>}
          <iframe title="Document preview" sandbox="" srcDoc={frameDoc(p.html)} className="h-[72vh] w-full rounded-xl border border-[#202945] bg-white" />
        </div>
      );
    case 'slides':
      return (
        <ol className="space-y-3">
          {p.slides.map((s) => (
            <li key={s.slide} className="rounded-xl border border-[#202945] bg-[#0E1426] p-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[#F28C38]">Slide {s.slide}</p>
              <p className="mt-1.5 whitespace-pre-wrap text-sm text-[#E8EAF2]">{s.text || <span className="text-[#6C789E]">No text on this slide</span>}</p>
              {s.notes && <p className="mt-2 border-t border-[#202945] pt-2 text-xs text-[#9AA6C9]"><span className="font-semibold">Notes: </span>{s.notes}</p>}
            </li>
          ))}
        </ol>
      );
    case 'image':
      return <ImageView src={p.image} ocrText={p.ocrText} />;
    case 'archive':
      return (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-[#B7C1DE]">{p.totalEntries} entries</p>
            <button className={`${kx.btn} ${kx.primary}`} disabled={busy || p.entries.some((e) => e.problem)} onClick={onExtract}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <FileArchive size={15} />} Extract into this folder
            </button>
          </div>
          <ul className="max-h-[65vh] divide-y divide-[#1A2240] overflow-auto rounded-xl border border-[#202945] text-[13px]">
            {p.entries.map((e) => (
              <li key={e.path} className="flex items-center gap-2 px-3 py-1.5">
                <FileIcon folder={e.directory} extension={e.path.split('.').pop()} size={15} />
                <span className="flex-1 truncate text-[#E1E6F5]">{e.path}</span>
                {e.problem ? <span className="text-xs text-[#FF8798]">{e.problem}</span> : !e.directory && e.sizeBytes !== null && <span className="text-xs text-[#7C8CB8] tabular-nums">{formatBytes(e.sizeBytes)}</span>}
              </li>
            ))}
          </ul>
        </div>
      );
    default:
      return (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-[#2A3760] p-10 text-center">
          <FileIcon extension={p.file.extension} size={36} />
          <p className="max-w-sm text-sm text-[#B7C1DE]">{p.reason}</p>
          <button className={`${kx.btn} ${kx.primary}`} onClick={() => void knowledgeApi.download(p.file)}><Download size={15} /> Download</button>
        </div>
      );
  }
}

function PdfPage({ p, loading, load }: { p: Extract<Preview, { kind: 'pdf' }>; loading: boolean; load: (q: { page: number }) => void }) {
  const { url, error } = useAuthedImage(p.pageImage);
  const [showText, setShowText] = useState(false);
  return (
    <div className="space-y-3">
      <Pager label={`Page ${p.page} of ${p.pages}`} prevDisabled={p.page <= 1 || loading} nextDisabled={p.page >= p.pages || loading} onPrev={() => load({ page: p.page - 1 })} onNext={() => load({ page: p.page + 1 })} />
      <div className="flex min-h-[50vh] items-center justify-center rounded-xl border border-[#202945] bg-[#0E1426] p-2">
        {url ? <img src={url} alt={`Page ${p.page}`} className="max-h-[75vh] w-auto rounded-lg bg-white shadow-lg" /> : error ? <p className="text-sm text-[#FF8798]">{error}</p> : <Loader2 className="animate-spin text-[#9AA6C9]" />}
      </div>
      <button className="text-xs font-semibold text-[#7CC4EE] hover:underline" onClick={() => setShowText((v) => !v)}>{showText ? 'Hide' : 'Show'} extracted text{!p.hasTextLayer && ' (scanned page, OCR used when indexing)'}</button>
      {showText && <pre className="whitespace-pre-wrap rounded-xl border border-[#202945] bg-[#070B14] p-4 text-[13px] text-[#D6DCF0]">{p.text || 'No text layer on this page.'}</pre>}
    </div>
  );
}

function ImageView({ src, ocrText }: { src: string; ocrText: string | null }) {
  const { url, error } = useAuthedImage(src);
  return (
    <div className="space-y-3">
      <div className="flex min-h-[50vh] items-center justify-center rounded-xl border border-[#202945] bg-[repeating-conic-gradient(#11172A_0%_25%,#0B1020_0%_50%)] bg-[length:24px_24px] p-3">
        {url ? <img src={url} alt="Preview" className="max-h-[72vh] max-w-full rounded-lg shadow-lg" /> : error ? <p className="text-sm text-[#FF8798]">{error}</p> : <Loader2 className="animate-spin text-[#9AA6C9]" />}
      </div>
      {ocrText && <details className="rounded-xl border border-[#202945] bg-[#0E1426] p-4 text-sm text-[#D6DCF0]"><summary className="cursor-pointer font-semibold text-[#B7C1DE]">Text found in the image (OCR)</summary><p className="mt-2 whitespace-pre-wrap">{ocrText}</p></details>}
    </div>
  );
}
