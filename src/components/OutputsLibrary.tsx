import { SandboxFrame } from './SandboxFrame';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, BarChart3, Check, Copy, Download, FileSpreadsheet, FileText, FileType2, FolderOpen, GitBranch, LayoutDashboard, Link2, Link2Off,
  Library, Loader2, Presentation, RefreshCw, Search, Share2, Sigma, Trash2, Workflow, X,
} from 'lucide-react';
import { outputsApi, type Artifact } from '../api/outputs';
import PublicLibrary from './PublicLibrary';

/**
 * "My files": everything the AI produced for this user (charts, workbooks, reports, dashboards, analyses),
 * stored by the output engine with revisions. Open, download, share by link, retry or delete.
 * The "Public library" tab shows the folders and files admins publish for everyone, and asks the chat about them.
 */

const FILTERS: Array<{ id: string; label: string; match: (a: Artifact) => boolean }> = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'visual', label: 'Charts & diagrams', match: (a) => ['chart', 'diagram', 'map', 'image'].includes(a.kind) },
  { id: 'files', label: 'Documents', match: (a) => ['document', 'template'].includes(a.kind) },
  { id: 'reports', label: 'Reports', match: (a) => ['report', 'widget'].includes(a.kind) },
  { id: 'analysis', label: 'Analyses', match: (a) => a.kind === 'analysis' },
];

function look(a: Artifact): { Icon: typeof FileText; tone: string; label: string } {
  if (a.kind === 'analysis') return { Icon: Sigma, tone: 'text-[#9FD3F2] bg-[#9FD3F2]/10 ring-[#9FD3F2]/25', label: 'Analysis' };
  if (a.kind === 'diagram') return { Icon: Workflow, tone: 'text-[#C3A6FF] bg-[#C3A6FF]/10 ring-[#C3A6FF]/25', label: 'Diagram' };
  if (a.format === 'svg' || a.format === 'png') return { Icon: BarChart3, tone: 'text-[#7DB7F5] bg-[#7DB7F5]/10 ring-[#7DB7F5]/25', label: a.kind === 'map' ? 'Map' : 'Chart' };
  if (a.format === 'html') return { Icon: LayoutDashboard, tone: 'text-[#C3A6FF] bg-[#C3A6FF]/10 ring-[#C3A6FF]/25', label: a.kind === 'widget' ? 'Interactive view' : 'Report' };
  if (a.format === 'xlsx') return { Icon: FileSpreadsheet, tone: 'text-[#5DCAA5] bg-[#5DCAA5]/10 ring-[#5DCAA5]/25', label: 'Excel workbook' };
  if (a.format === 'pptx') return { Icon: Presentation, tone: 'text-[#F2A65A] bg-[#F2A65A]/10 ring-[#F2A65A]/25', label: 'PowerPoint deck' };
  if (a.format === 'pdf') return { Icon: FileType2, tone: 'text-[#FF8A80] bg-[#FF8A80]/10 ring-[#FF8A80]/25', label: 'PDF' };
  return { Icon: FileText, tone: 'text-[#7DB7F5] bg-[#7DB7F5]/10 ring-[#7DB7F5]/25', label: a.format === 'docx' ? 'Word document' : a.format.toUpperCase() };
}

const size = (n: number | null) => (n == null ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const when = (s: string) => {
  const d = (Date.now() - Date.parse(s)) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
  return new Date(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

export default function OutputsLibrary({ onClose, onAsk, initialTab = 'mine' }: { onClose: () => void; onAsk?: (message: string) => void; initialTab?: 'mine' | 'library' }) {
  const [tab, setTab] = useState<'mine' | 'library'>(initialTab);
  const [items, setItems] = useState<Artifact[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Artifact | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setItems(await outputsApi.list()); setError(null); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load your files.'); setItems((v) => v ?? []); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const pending = items?.some((a) => a.status === 'queued' || a.status === 'generating');
  useEffect(() => {
    if (!pending) return;
    const t = window.setInterval(() => void load(), 2500);
    return () => window.clearInterval(t);
  }, [pending, load]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !open) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, open]);

  const notify = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 2500); };
  const shown = useMemo(() => {
    const f = FILTERS.find((x) => x.id === filter) ?? FILTERS[0];
    const q = query.trim().toLowerCase();
    // One row per lineage: the newest revision represents the artifact.
    const latest = new Map<string, Artifact>();
    for (const a of items ?? []) { const cur = latest.get(a.rootId); if (!cur || a.revision > cur.revision) latest.set(a.rootId, a); }
    return [...latest.values()].filter((a) => f.match(a) && (!q || a.title.toLowerCase().includes(q))).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }, [items, filter, query]);
  const revisionsOf = (a: Artifact) => (items ?? []).filter((x) => x.rootId === a.rootId).sort((x, y) => y.revision - x.revision);

  return (
    <div className="fixed inset-0 z-[90] flex justify-end bg-black/50 backdrop-blur-[2px]" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside role="dialog" aria-modal="true" aria-label="My files" className="flex h-full w-full flex-col border-l border-stone-800 bg-[#1F1E1C] text-stone-100 shadow-2xl sm:w-[min(760px,94vw)] animate-[slideIn_.22s_ease-out]">
        <header className="flex items-center gap-3 border-b border-stone-800 px-4 py-4 sm:px-6">
          <div className="rounded-xl bg-amber-500/10 p-2.5 text-amber-400 ring-1 ring-amber-500/20">{tab === 'library' ? <Library className="h-5 w-5" aria-hidden="true" /> : <FolderOpen className="h-5 w-5" aria-hidden="true" />}</div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold tracking-tight">{tab === 'library' ? 'Public library' : 'My files'}</h2>
            <p className="text-xs text-stone-400">{tab === 'library' ? 'Folders and files shared with everyone. Open them or ask Bwenge about them.' : 'Charts, workbooks, reports and analyses Bwenge created for you'}</p>
          </div>
          {tab === 'mine' && <button type="button" onClick={() => void load()} aria-label="Refresh" className="rounded-lg p-2 text-stone-400 hover:bg-stone-800 hover:text-white"><RefreshCw className="h-4 w-4" aria-hidden="true" /></button>}
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-2 text-stone-400 hover:bg-stone-800 hover:text-white"><X className="h-5 w-5" aria-hidden="true" /></button>
        </header>

        <div className="flex gap-1 border-b border-stone-800 px-4 pt-2 sm:px-6" role="tablist" aria-label="Files">
          {([['mine', 'My files', FolderOpen], ['library', 'Public library', Library]] as const).map(([id, label, Icon]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
              className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 pb-2.5 pt-1.5 text-sm font-medium transition ${tab === id ? 'border-amber-400 text-stone-100' : 'border-transparent text-stone-400 hover:text-stone-200'}`}>
              <Icon className="h-4 w-4" aria-hidden="true" />{label}
            </button>
          ))}
        </div>

        {tab === 'library' ? <PublicLibrary onAsk={(m) => { onAsk?.(m); onClose(); }} /> : <>
        <div className="space-y-3 border-b border-stone-800 px-4 py-3 sm:px-6">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-500" aria-hidden="true" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by title…" aria-label="Search files"
              className="w-full rounded-xl border border-stone-700 bg-stone-900 py-2 pl-9 pr-3 text-sm text-stone-100 placeholder:text-stone-500 focus:border-amber-500/60 focus:outline-none focus:ring-2 focus:ring-amber-500/15" />
          </div>
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5" role="tablist" aria-label="Filter">
            {FILTERS.map((f) => (
              <button key={f.id} role="tab" aria-selected={filter === f.id} onClick={() => setFilter(f.id)}
                className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition ${filter === f.id ? 'bg-stone-100 text-stone-900' : 'bg-stone-800/70 text-stone-300 hover:bg-stone-800'}`}>{f.label}</button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3 sm:px-5">
          {items === null ? (
            <div className="flex h-60 items-center justify-center text-stone-500"><Loader2 className="h-5 w-5 animate-spin" aria-label="Loading" /></div>
          ) : error && !items.length ? (
            <p className="m-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">{error}</p>
          ) : !shown.length ? (
            <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
              <div className="rounded-2xl bg-stone-800/70 p-4 text-stone-400"><FolderOpen className="h-7 w-7" aria-hidden="true" /></div>
              <p className="font-medium text-stone-200">{items.length ? 'Nothing matches' : 'No files yet'}</p>
              <p className="max-w-xs text-sm text-stone-400">{items.length ? 'Try another filter or search.' : 'Ask Bwenge for a chart, an Excel file, a report or a statistical analysis. Everything it makes is kept here.'}</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {shown.map((a) => {
                const { Icon, tone, label } = look(a);
                const revs = revisionsOf(a).length;
                return (
                  <li key={a.id}>
                    <button type="button" onClick={() => setOpen(a)} className="group flex w-full items-center gap-3 rounded-2xl border border-stone-800 bg-stone-900/60 p-3 text-left transition hover:border-stone-700 hover:bg-stone-900">
                      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1 ${tone}`}><Icon className="h-5 w-5" aria-hidden="true" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-stone-100">{a.title}</span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-stone-400">
                          <span>{label}</span>
                          {a.sizeBytes != null && <><span aria-hidden="true">·</span><span>{size(a.sizeBytes)}</span></>}
                          <span aria-hidden="true">·</span><span>{when(a.updatedAt)}</span>
                          {revs > 1 && <span className="inline-flex items-center gap-1 rounded-full bg-stone-800 px-2 py-0.5 text-[11px]"><GitBranch className="h-3 w-3" aria-hidden="true" />v{a.revision}</span>}
                          {a.share.mode === 'link' && <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2 py-0.5 text-[11px] text-sky-300"><Link2 className="h-3 w-3" aria-hidden="true" />Shared</span>}
                        </span>
                      </span>
                      <StatusPill a={a} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        </>}
        {toast && <div role="status" className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-stone-100 px-4 py-2 text-sm font-medium text-stone-900 shadow-xl">{toast}</div>}
      </aside>
      {open && <ArtifactViewer artifact={open} revisions={revisionsOf(open)} onSelect={setOpen} onClose={() => setOpen(null)} onChanged={load} notify={notify} />}
    </div>
  );
}

function StatusPill({ a }: { a: Artifact }) {
  if (a.status === 'ready') return null;
  if (a.status === 'failed') return <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-500/10 px-2.5 py-1 text-[11px] font-semibold text-red-300"><AlertTriangle className="h-3 w-3" aria-hidden="true" />Failed</span>;
  return <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-300"><Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />{a.status === 'queued' ? 'Queued' : 'Generating'}</span>;
}

function ArtifactViewer({ artifact: a, revisions, onSelect, onClose, onChanged, notify }: { artifact: Artifact; revisions: Artifact[]; onSelect: (a: Artifact) => void; onClose: () => void; onChanged: () => Promise<void>; notify: (m: string) => void }) {
  const [content, setContent] = useState<{ url?: string; html?: string; text?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { Icon, tone, label } = look(a);
  const viewable = a.status === 'ready' && ['svg', 'png', 'html', 'json', 'pdf'].includes(a.format);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Per-file UI state resets only when another file is opened (share/retry update the same file in place).
  useEffect(() => { setShareUrl(null); setConfirmDelete(false); }, [a.id]);
  useEffect(() => {
    setContent(null); setError(null);
    if (!viewable) return;
    let made: string | null = null;
    let alive = true;
    outputsApi.blob(a, true).then(async (b) => {
      if (!alive) return;
      if (a.format === 'html') setContent({ html: await b.text() });
      else if (a.format === 'json') { const t = await b.text(); try { setContent({ text: JSON.stringify(JSON.parse(t), null, 2) }); } catch { setContent({ text: t }); } }
      else { made = URL.createObjectURL(b); setContent({ url: made }); }
    }).catch((e) => alive && setError(e.message));
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.id, a.status, viewable]);

  const act = async (name: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(name);
    try { await fn(); if (done) notify(done); } catch (e) { notify(e instanceof Error ? e.message : 'Action failed.'); } finally { setBusy(null); }
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-stretch justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={a.title} className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden border border-stone-800 bg-[#1F1E1C] text-stone-100 shadow-2xl sm:rounded-2xl">
        <header className="flex flex-wrap items-center gap-3 border-b border-stone-800 px-4 py-3.5 sm:flex-nowrap sm:px-5">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ${tone}`}><Icon className="h-5 w-5" aria-hidden="true" /></span>
          <div className="min-w-0 flex-1 basis-[calc(100%-7.5rem)] sm:basis-auto">
            <h3 className="truncate text-base font-semibold">{a.title}</h3>
            <p className="truncate text-xs text-stone-400">{label} · {a.format.toUpperCase()}{a.sizeBytes != null ? ` · ${size(a.sizeBytes)}` : ''} · {when(a.updatedAt)}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-2 text-stone-400 hover:bg-stone-800 hover:text-white sm:order-last"><X className="h-5 w-5" aria-hidden="true" /></button>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            {a.status === 'failed' && <button type="button" disabled={!!busy} onClick={() => act('retry', async () => { onSelect(await outputsApi.retry(a.id)); await onChanged(); }, 'Generating again')} className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-stone-900 hover:bg-amber-400 disabled:opacity-50">{busy === 'retry' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}Try again</button>}
            {a.status === 'ready' && <button type="button" disabled={!!busy} onClick={() => act('download', () => outputsApi.download(a))} className="inline-flex items-center gap-1.5 rounded-lg bg-stone-100 px-3 py-1.5 text-xs font-semibold text-stone-900 hover:bg-white disabled:opacity-50">{busy === 'download' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}Download</button>}
            {a.status === 'ready' && (a.share.mode === 'link'
              ? <button type="button" disabled={!!busy} onClick={() => act('unshare', async () => { await outputsApi.share(a.id, 'private'); setShareUrl(null); await onChanged(); onSelect({ ...a, share: { mode: 'private', expiresAt: null } }); }, 'Link sharing stopped')} className="inline-flex items-center gap-1.5 rounded-lg border border-stone-700 px-3 py-1.5 text-xs font-medium text-stone-200 hover:bg-stone-800 disabled:opacity-50"><Link2Off className="h-3.5 w-3.5" />Stop sharing</button>
              : <button type="button" disabled={!!busy} onClick={() => act('share', async () => { const r = await outputsApi.share(a.id, 'link'); if (r.sharePath) setShareUrl(`${window.location.origin}${r.sharePath}?view=1`); await onChanged(); onSelect(r.artifact as Artifact); })} className="inline-flex items-center gap-1.5 rounded-lg border border-stone-700 px-3 py-1.5 text-xs font-medium text-stone-200 hover:bg-stone-800 disabled:opacity-50">{busy === 'share' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Share2 className="h-3.5 w-3.5" />}Share link</button>)}
            <button type="button" disabled={!!busy} onClick={() => setConfirmDelete(true)} aria-label="Delete" className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 px-2.5 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/10 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        </header>

        {confirmDelete && (
          <div className="flex flex-wrap items-center gap-3 border-b border-red-500/20 bg-red-500/10 px-5 py-3 text-sm">
            <span className="flex-1 text-red-200">Delete “{a.title}”{revisions.length > 1 ? ' (this revision)' : ''}? Shared links stop working.</span>
            <button type="button" onClick={() => setConfirmDelete(false)} className="rounded-lg px-3 py-1.5 text-xs text-stone-300 hover:bg-stone-800">Cancel</button>
            <button type="button" onClick={() => act('delete', async () => { await outputsApi.remove(a.id); await onChanged(); onClose(); }, 'Deleted')} className="rounded-lg bg-red-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-400">Delete</button>
          </div>
        )}
        {shareUrl && <ShareBox url={shareUrl} expiresAt={a.share.expiresAt} notify={notify} />}
        {a.share.mode === 'link' && !shareUrl && <p className="border-b border-stone-800 bg-sky-500/5 px-5 py-2 text-xs text-sky-200">Shared by link{a.share.expiresAt ? ` until ${new Date(a.share.expiresAt).toLocaleString()}` : ''}. The link was shown when it was created; stop and share again for a new one.</p>}
        {!!a.warnings?.length && <div className="border-b border-amber-500/20 bg-amber-500/10 px-5 py-2.5 text-xs text-amber-200">{a.warnings.map((w, i) => <p key={i}>{w}</p>)}</div>}

        <div className="min-h-[40vh] flex-1 overflow-auto bg-stone-950/40 p-3 sm:p-5">
          {a.status === 'failed' ? <p className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{a.error || 'This file could not be generated.'}</p>
            : a.status !== 'ready' ? <div className="flex h-60 flex-col items-center justify-center gap-2 text-stone-400"><Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" /><p className="text-sm">Generating…</p></div>
              : !viewable ? (
                <div className="flex h-60 flex-col items-center justify-center gap-3 text-center">
                  <span className={`flex h-14 w-14 items-center justify-center rounded-2xl ring-1 ${tone}`}><Icon className="h-7 w-7" aria-hidden="true" /></span>
                  <p className="max-w-sm text-sm text-stone-300">{label} files open in their own app. Download it to view and edit.</p>
                  <button type="button" onClick={() => act('download', () => outputsApi.download(a))} className="inline-flex items-center gap-1.5 rounded-lg bg-stone-100 px-4 py-2 text-sm font-semibold text-stone-900 hover:bg-white"><Download className="h-4 w-4" />Download {a.format.toUpperCase()}</button>
                </div>
              ) : error ? <p className="text-sm text-red-300">{error}</p>
                : !content ? <div className="flex h-60 items-center justify-center text-stone-500"><Loader2 className="h-5 w-5 animate-spin" aria-label="Loading" /></div>
                  : content.html !== undefined ? <SandboxFrame title={a.title} html={content.html} className="h-[70vh] w-full rounded-xl bg-white" />
                    : content.text !== undefined ? <pre className="whitespace-pre-wrap break-words rounded-xl bg-stone-950 p-4 font-mono text-[12.5px] leading-relaxed text-stone-300">{content.text}</pre>
                      : a.format === 'pdf' ? <iframe title={a.title} src={content.url} className="h-[70vh] w-full rounded-xl bg-white" />
                        : <img src={content.url} alt={a.title} className="mx-auto max-h-[70vh] max-w-full rounded-xl bg-white object-contain" />}
        </div>

        {revisions.length > 1 && (
          <footer className="flex items-center gap-2 overflow-x-auto border-t border-stone-800 px-4 py-2.5 sm:px-5">
            <span className="shrink-0 text-xs text-stone-500">Revisions</span>
            {revisions.map((r) => (
              <button key={r.id} type="button" onClick={() => onSelect(r)} aria-current={r.id === a.id} className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${r.id === a.id ? 'bg-stone-100 text-stone-900' : 'bg-stone-800 text-stone-300 hover:bg-stone-700'}`}>v{r.revision}</button>
            ))}
          </footer>
        )}
      </div>
    </div>
  );
}

function ShareBox({ url, expiresAt, notify }: { url: string; expiresAt: string | null; notify: (m: string) => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="border-b border-stone-800 bg-sky-500/5 px-5 py-3">
      <p className="mb-2 text-xs text-sky-200">Anyone with this link can view the file{expiresAt ? ` until ${new Date(expiresAt).toLocaleDateString()}` : ''}. Copy it now: it is not shown again.</p>
      <div className="flex gap-2">
        <input readOnly value={url} onFocus={(e) => e.target.select()} aria-label="Share link" className="min-w-0 flex-1 rounded-lg border border-stone-700 bg-stone-900 px-3 py-1.5 font-mono text-xs text-stone-200" />
        <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(url); setCopied(true); notify('Link copied'); } catch { notify('Select the link and copy it'); } }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-stone-100 px-3 py-1.5 text-xs font-semibold text-stone-900 hover:bg-white">{copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{copied ? 'Copied' : 'Copy'}</button>
      </div>
    </div>
  );
}
