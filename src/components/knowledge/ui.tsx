import { useEffect, useState, type ReactNode } from 'react';
import {
  AlertTriangle, CheckCircle2, Clock, FileArchive, FileCode2, FileImage, FileSpreadsheet, FileText, FileType2, Folder, Loader2,
  Presentation, X,
} from 'lucide-react';
import { knowledgeApi, type IndexStatus } from '../../api/knowledge';

/** Shared pieces of the knowledge explorer, styled to match the admin console palette. */

export const kx = {
  panel: 'rounded-2xl border border-[#263052]/90 bg-[#0E1426]/90 shadow-xl shadow-black/30',
  btn: 'inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-xs sm:text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#3FA7E0] active:scale-[0.98] shrink-0',
  primary: 'bg-gradient-to-r from-[#3FA7E0] to-[#60C0F3] text-[#08101F] hover:from-[#48B3EC] hover:to-[#76C5EF] shadow-lg shadow-[#3FA7E0]/20',
  ghost: 'border border-[#2A3760] bg-[#18213D] text-[#E8EAF2] hover:bg-[#222E54] hover:border-[#3FA7E0]/40',
  danger: 'border border-[#E5586B]/40 bg-[#E5586B]/10 text-[#FF8798] hover:bg-[#E5586B]/20',
  input: 'w-full rounded-xl border border-[#2A3760] bg-[#0A0F1C] px-3.5 py-2.5 text-sm text-[#E8EAF2] placeholder-[#6C789E] focus:border-[#3FA7E0] focus:outline-none focus:ring-4 focus:ring-[#3FA7E0]/15',
  muted: 'text-[#9AA6C9]',
};

const EXT_ICON: Array<[RegExp, typeof FileText, string]> = [
  [/^(xlsx|xls|csv|tsv|ods)$/, FileSpreadsheet, 'text-[#3DB27A]'],
  [/^(pptx|ppt|key|odp)$/, Presentation, 'text-[#F28C38]'],
  [/^(pdf)$/, FileType2, 'text-[#FF6B6B]'],
  [/^(docx|doc|odt|rtf|txt|md|markdown)$/, FileText, 'text-[#5AA9F0]'],
  [/^(png|jpe?g|gif|webp|svg|tiff?|bmp)$/, FileImage, 'text-[#C08CF0]'],
  [/^(zip|rar|7z|tar|gz)$/, FileArchive, 'text-[#F2C230]'],
  [/^(json|ya?ml|xml|html?|css|js|ts|tsx|jsx|py|java|sql|sh|c|cpp|h|cs|go|rs|kt)$/, FileCode2, 'text-[#7CC4EE]'],
];

export function FileIcon({ extension, folder, size = 18 }: { extension?: string; folder?: boolean; size?: number }) {
  if (folder) return <Folder size={size} className="text-[#F2C230] fill-[#F2C230]/20 shrink-0" />;
  const hit = EXT_ICON.find(([re]) => re.test((extension ?? '').toLowerCase()));
  const Icon = hit?.[1] ?? FileText;
  return <Icon size={size} className={`${hit?.[2] ?? 'text-[#9AA6C9]'} shrink-0`} />;
}

const STATUS: Record<string, { label: string; tone: string; icon: ReactNode }> = {
  indexed: { label: 'Indexed', tone: 'bg-[#3DB27A]/12 text-[#6FD6A2] border-[#3DB27A]/35', icon: <CheckCircle2 size={12} /> },
  duplicate: { label: 'Duplicate', tone: 'bg-white/5 text-[#B7C1DE] border-white/10', icon: <CheckCircle2 size={12} /> },
  pending_embeddings: { label: 'Keyword only', tone: 'bg-[#F2C230]/12 text-[#F2C230] border-[#F2C230]/35', icon: <Clock size={12} /> },
  partial_failure: { label: 'Partly indexed', tone: 'bg-[#F2C230]/12 text-[#F2C230] border-[#F2C230]/35', icon: <AlertTriangle size={12} /> },
  failed: { label: 'Failed', tone: 'bg-[#E5586B]/12 text-[#FF8798] border-[#E5586B]/35', icon: <AlertTriangle size={12} /> },
  unsupported: { label: 'Stored only', tone: 'bg-white/5 text-[#9AA6C9] border-white/10', icon: null },
  excluded: { label: 'Excluded', tone: 'bg-white/5 text-[#9AA6C9] border-white/10', icon: null },
  uploaded: { label: 'Waiting', tone: 'bg-[#3FA7E0]/10 text-[#7CC4EE] border-[#3FA7E0]/30', icon: <Clock size={12} /> },
  queued: { label: 'Queued', tone: 'bg-[#3FA7E0]/10 text-[#7CC4EE] border-[#3FA7E0]/30', icon: <Clock size={12} /> },
};
export const ACTIVE_STATES = new Set(['uploaded', 'queued', 'extracting', 'chunking', 'embedding', 'indexing']);

export function StatusBadge({ status, error }: { status: IndexStatus; error?: string | null }) {
  const s = STATUS[status] ?? { label: status.charAt(0).toUpperCase() + status.slice(1), tone: 'bg-[#3FA7E0]/10 text-[#7CC4EE] border-[#3FA7E0]/30', icon: <Loader2 size={12} className="animate-spin" /> };
  return (
    <span title={error ?? undefined} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${s.tone}`}>
      {s.icon}{s.label}
    </span>
  );
}

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`${kx.panel} w-full ${wide ? 'sm:max-w-2xl' : 'sm:max-w-md'} max-h-[90vh] flex flex-col rounded-b-none sm:rounded-2xl bg-[#11172A]`}>
        <div className="flex items-center justify-between gap-3 border-b border-[#202945] px-5 py-4">
          <h3 className="text-base font-bold text-white truncate">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-[#9AA6C9] hover:bg-white/5 hover:text-white"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-[#202945] px-5 py-3.5">{footer}</div>}
      </div>
    </div>
  );
}

/** Text prompt dialog (new folder, rename). */
export function PromptDialog({ title, label, initial = '', confirm, onSubmit, onClose }: { title: string; label: string; initial?: string; confirm: string; onSubmit: (v: string) => Promise<void> | void; onClose: () => void }) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!value.trim()) return;
    setBusy(true); setError(null);
    try { await onSubmit(value.trim()); onClose(); } catch (e) { setError(e instanceof Error ? e.message : 'Failed.'); } finally { setBusy(false); }
  };
  return (
    <Modal title={title} onClose={onClose} footer={<>
      <button className={`${kx.btn} ${kx.ghost}`} onClick={onClose}>Cancel</button>
      <button className={`${kx.btn} ${kx.primary}`} disabled={busy || !value.trim()} onClick={submit}>{busy && <Loader2 size={14} className="animate-spin" />}{confirm}</button>
    </>}>
      <label className="block space-y-2">
        <span className="text-xs font-bold uppercase tracking-wider text-[#B7C1DE]">{label}</span>
        <input autoFocus className={kx.input} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} />
      </label>
      {error && <p className="mt-3 text-sm text-[#FF8798]">{error}</p>}
    </Modal>
  );
}

/** Object URL for a protected image (bearer-token auth cannot be used by a plain <img src>). */
export function useAuthedImage(path: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    let made: string | null = null;
    setUrl(null); setError(null);
    knowledgeApi.blob(path).then((b) => { if (!alive) return; made = URL.createObjectURL(b); setUrl(made); }).catch((e) => alive && setError(e.message));
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [path]);
  return { url, error };
}

export const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
