import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, BookOpen, ChevronRight, Download, ExternalLink, FileSpreadsheet, FileText, Folder, Library, Loader2, MessageSquare, Search, Send, X } from 'lucide-react';
import { libraryApi, libraryQuestion, type LibraryDataset, type LibraryFile, type LibraryListing } from '../api/library';

/**
 * Public library: the folders and files admins upload in Datasets & Curations, open to every user. Browse,
 * search, open a file, or ask Bwenge about a dataset, a folder or a single file; the question goes to the
 * chat with a reference the assistant uses to read exactly that material.
 */

const size = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const TABLES = new Set(['csv', 'tsv', 'xlsx', 'xls', 'json']);
const VIEWABLE = new Set(['pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'txt', 'csv', 'md', 'json']);

type Target = { dataset: { id: string; name: string }; folder?: string; file?: LibraryFile; label: string };

export default function PublicLibrary({ onAsk }: { onAsk: (message: string) => void }) {
  const [datasets, setDatasets] = useState<LibraryDataset[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dataset, setDataset] = useState<LibraryDataset | null>(null);
  const [path, setPath] = useState('');
  const [listing, setListing] = useState<LibraryListing | null>(null);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [asking, setAsking] = useState<Target | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    libraryApi.datasets().then(setDatasets).catch((e) => { setError(e.message); setDatasets([]); });
  }, []);

  const load = useCallback(async () => {
    if (!dataset) return;
    setListing(null); setError(null);
    try { setListing(await libraryApi.browse(dataset.id, search ? { search } : { path })); } catch (e) { setError(e instanceof Error ? e.message : 'Could not open this folder.'); }
  }, [dataset, path, search]);
  useEffect(() => { void load(); }, [load]);

  const openDataset = (d: LibraryDataset) => { setDataset(d); setPath(''); setSearch(''); setQuery(''); };
  const openFile = async (f: LibraryFile, inline: boolean) => {
    setBusy(f.id);
    try {
      const blob = await libraryApi.blob(f.id, inline);
      const url = URL.createObjectURL(blob);
      if (inline) window.open(url, '_blank', 'noopener');
      else { const a = document.createElement('a'); a.href = url; a.download = f.name; a.click(); }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not open the file.'); } finally { setBusy(null); }
  };

  if (datasets === null) return <div className="flex h-60 items-center justify-center text-stone-500"><Loader2 className="h-5 w-5 animate-spin" aria-label="Loading" /></div>;

  // Shelf: every dataset in the library.
  if (!dataset) {
    return (
      <div className="flex-1 overflow-y-auto px-3 py-3 sm:px-5">
        {error && <p className="mb-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
        {error && !datasets.length ? null : !datasets.length ? (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <div className="rounded-2xl bg-stone-800/70 p-4 text-stone-400"><Library className="h-7 w-7" aria-hidden="true" /></div>
            <p className="font-medium text-stone-200">The library is empty</p>
            <p className="max-w-xs text-sm text-stone-400">Folders and files that admins add in Datasets & Curations appear here for everyone.</p>
          </div>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {datasets.map((d) => (
              <li key={d.id}>
                <button type="button" onClick={() => openDataset(d)} className="flex h-full w-full flex-col gap-2 rounded-2xl border border-stone-800 bg-stone-900/60 p-4 text-left transition hover:border-stone-700 hover:bg-stone-900">
                  <span className="flex items-center gap-2.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/25"><BookOpen className="h-4.5 w-4.5" aria-hidden="true" /></span>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-stone-100">{d.name}</span>
                    <ChevronRight className="h-4 w-4 text-stone-500" aria-hidden="true" />
                  </span>
                  {d.description && <span className="line-clamp-2 text-xs text-stone-400">{d.description}</span>}
                  <span className="text-xs text-stone-500">{d.files} file{d.files === 1 ? '' : 's'} · {size(d.totalBytes)}{d.folders.length ? ` · ${d.folders.slice(0, 3).join(', ')}${d.folders.length > 3 ? '…' : ''}` : ''}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const crumbs = path ? path.split('/') : [];
  const here: Target = path
    ? { dataset: { id: dataset.id, name: dataset.name }, folder: path, label: `folder “${crumbs.at(-1)}”` }
    : { dataset: { id: dataset.id, name: dataset.name }, label: `“${dataset.name}”` };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2.5 border-b border-stone-800 px-4 py-3 sm:px-6">
        <nav aria-label="Folder" className="flex flex-wrap items-center gap-1 text-sm">
          <button type="button" onClick={() => setDataset(null)} className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-stone-400 hover:bg-stone-800 hover:text-white"><ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />Library</button>
          <ChevronRight className="h-3.5 w-3.5 text-stone-600" aria-hidden="true" />
          <button type="button" onClick={() => { setPath(''); setSearch(''); }} className="rounded-lg px-1.5 py-1 font-medium text-stone-200 hover:bg-stone-800">{dataset.name}</button>
          {crumbs.map((c, i) => (
            <span key={i} className="inline-flex items-center gap-1">
              <ChevronRight className="h-3.5 w-3.5 text-stone-600" aria-hidden="true" />
              <button type="button" onClick={() => { setPath(crumbs.slice(0, i + 1).join('/')); setSearch(''); }} className="rounded-lg px-1.5 py-1 text-stone-200 hover:bg-stone-800">{c}</button>
            </span>
          ))}
        </nav>
        <div className="flex gap-2">
          <form className="relative min-w-0 flex-1" onSubmit={(e) => { e.preventDefault(); setSearch(query.trim()); }}>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-500" aria-hidden="true" />
            <input value={query} onChange={(e) => { setQuery(e.target.value); if (!e.target.value) setSearch(''); }} placeholder={`Find a file in ${dataset.name}…`} aria-label="Find a file"
              className="w-full rounded-xl border border-stone-700 bg-stone-900 py-2 pl-9 pr-3 text-sm text-stone-100 placeholder:text-stone-500 focus:border-amber-500/60 focus:outline-none focus:ring-2 focus:ring-amber-500/15" />
          </form>
          <button type="button" onClick={() => setAsking(here)} className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-amber-500 px-3 text-sm font-semibold text-stone-900 hover:bg-amber-400">
            <MessageSquare className="h-4 w-4" aria-hidden="true" /><span className="hidden sm:inline">Ask about this</span><span className="sm:hidden">Ask</span>
          </button>
        </div>
      </div>

      {asking && <AskBox target={asking} onCancel={() => setAsking(null)} onSend={(q) => { onAsk(libraryQuestion(q, asking)); setAsking(null); }} />}

      <div className="flex-1 overflow-y-auto px-3 py-3 sm:px-5">
        {error && <p className="mb-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
        {!listing ? <div className="flex h-40 items-center justify-center text-stone-500"><Loader2 className="h-5 w-5 animate-spin" aria-label="Loading" /></div> : (
          <>
            {search && <p className="mb-2 px-1 text-xs text-stone-400">{listing.totalFiles} file{listing.totalFiles === 1 ? '' : 's'} matching “{search}”</p>}
            {!listing.folders.length && !listing.files.length && <p className="px-2 py-10 text-center text-sm text-stone-400">{search ? 'No file names match. Ask about the dataset instead: Bwenge also searches inside the files.' : 'This folder is empty.'}</p>}
            <ul className="space-y-1.5">
              {listing.folders.map((d) => (
                <li key={d.path} className="flex items-center gap-2 rounded-xl border border-stone-800 bg-stone-900/50 pr-2 hover:border-stone-700">
                  <button type="button" onClick={() => setPath(d.path)} className="flex min-w-0 flex-1 items-center gap-3 p-2.5 text-left">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-300 ring-1 ring-amber-500/20"><Folder className="h-4 w-4" aria-hidden="true" /></span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-stone-100">{d.name}</span><span className="text-xs text-stone-500">{d.files} file{d.files === 1 ? '' : 's'}</span></span>
                  </button>
                  <button type="button" onClick={() => setAsking({ dataset: listing.repository, folder: d.path, label: `folder “${d.name}”` })} className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/10">Ask</button>
                </li>
              ))}
              {listing.files.map((f) => {
                const Icon = TABLES.has(f.type) ? FileSpreadsheet : FileText;
                return (
                  <li key={f.id} className="flex items-center gap-1 rounded-xl border border-stone-800 bg-stone-900/50 pr-1.5 hover:border-stone-700">
                    <button type="button" onClick={() => void openFile(f, VIEWABLE.has(f.type))} className="flex min-w-0 flex-1 items-center gap-3 p-2.5 text-left" title={VIEWABLE.has(f.type) ? 'Open' : 'Download'}>
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-300 ring-1 ring-sky-500/20">{busy === f.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" aria-hidden="true" />}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-stone-100">{f.name}</span>
                        <span className="block truncate text-xs text-stone-500">{search ? `${f.path} · ` : ''}{f.type.toUpperCase()} · {size(f.sizeBytes)}</span>
                      </span>
                    </button>
                    {VIEWABLE.has(f.type) && <button type="button" aria-label={`Download ${f.name}`} onClick={() => void openFile(f, false)} className="rounded-lg p-2 text-stone-400 hover:bg-stone-800 hover:text-white"><Download className="h-4 w-4" /></button>}
                    {!VIEWABLE.has(f.type) && <span className="sr-only">Opens as a download</span>}
                    <button type="button" onClick={() => setAsking({ dataset: listing.repository, file: f, label: `“${f.name}”` })} className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/10">Ask</button>
                  </li>
                );
              })}
            </ul>
            {listing.totalFiles > listing.files.length && <p className="mt-3 px-1 text-xs text-stone-500">Showing {listing.files.length} of {listing.totalFiles} files. Use “Find a file” to narrow down.</p>}
          </>
        )}
      </div>
    </div>
  );
}

const SUGGESTIONS: Record<'file' | 'folder', string[]> = {
  file: ['Summarise this file', 'What are the key points?', 'Make me revision notes from it'],
  folder: ['What is in here?', 'Which file covers this topic best?', 'Summarise everything in this folder'],
};

function AskBox({ target, onCancel, onSend }: { target: Target; onCancel: () => void; onSend: (q: string) => void }) {
  const [q, setQ] = useState('');
  const kind = target.file ? 'file' : 'folder';
  return (
    <div className="border-b border-stone-800 bg-amber-500/[0.06] px-4 py-3 sm:px-6">
      <div className="mb-2 flex items-center gap-2 text-xs text-amber-200">
        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">Ask Bwenge about {target.label}</span>
        <button type="button" onClick={onCancel} aria-label="Cancel" className="rounded p-1 text-stone-400 hover:text-white"><X className="h-3.5 w-3.5" /></button>
      </div>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (q.trim()) onSend(q); }}>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type your question…" aria-label="Your question"
          className="min-w-0 flex-1 rounded-xl border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-100 placeholder:text-stone-500 focus:border-amber-500/60 focus:outline-none" />
        <button type="submit" disabled={!q.trim()} aria-label="Send" className="inline-flex items-center rounded-xl bg-amber-500 px-3 text-stone-900 hover:bg-amber-400 disabled:opacity-40"><Send className="h-4 w-4" /></button>
      </form>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {SUGGESTIONS[kind].map((s) => <button key={s} type="button" onClick={() => onSend(s)} className="rounded-full border border-stone-700 px-2.5 py-1 text-xs text-stone-300 hover:bg-stone-800">{s}</button>)}
      </div>
    </div>
  );
}
