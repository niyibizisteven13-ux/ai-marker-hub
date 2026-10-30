import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDownAZ, CheckSquare, ChevronDown, ChevronRight, Database, Download, Eye, FolderInput, FolderOpen, FolderPlus, FolderTree,
  HardDrive, LayoutGrid, List, Loader2, MoreVertical, Pencil, Plus, RefreshCw, Search, Sparkles, Square, Trash2, Upload, UploadCloud, X,
} from 'lucide-react';
import {
  filesFromDrop, formatBytes, knowledgeApi, type Contents, type RepoDirectory, type RepoFile, type RepoTree, type Repository, type SearchResults, type UploadSummary, setKnowledgeViewOnly } from '../../api/knowledge';
import FilePreview from './FilePreview';
import { ACTIVE_STATES, FileIcon, Modal, PromptDialog, StatusBadge, fmtDate, kx } from './ui';

/**
 * Knowledge repositories as a file explorer: repositories → folders → files, with folder upload that keeps
 * the folder structure, live indexing status, previews, and move / rename / delete. Uploaded files are
 * indexed into the repository's knowledge base so the AI can search and cite them.
 */

type Notify = (msg: string, bad?: boolean) => void;
type Sel = { kind: 'file'; item: RepoFile } | { kind: 'folder'; item: RepoDirectory };
type UploadJob = { id: number; label: string; count: number; progress: number; state: 'uploading' | 'done' | 'failed'; result?: UploadSummary; error?: string };

const LAST_REPO = 'bwenge.knowledge.repo';
const remember = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };
const recall = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };

/**
 * `readOnly`: the view-only Datasets & Curations page for any signed-in user (published datasets only, served by
 * the GET-only /api/curation endpoints): browse, search, preview and download, but no upload, edit or delete.
 */
export default function KnowledgeExplorer({ notify, readOnly = false }: { notify: Notify; readOnly?: boolean }) {
  setKnowledgeViewOnly(readOnly);
  const [repos, setRepos] = useState<Repository[] | null>(null);
  const [repoId, setRepoId] = useState<string | null>(null);
  const [tree, setTree] = useState<RepoTree | null>(null);
  const [dirId, setDirId] = useState<string | null>(null);
  const [contents, setContents] = useState<Contents | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [sort, setSort] = useState<{ by: 'name' | 'size' | 'modified' | 'status'; order: 'asc' | 'desc' }>({ by: 'name', order: 'asc' });
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<RepoFile | null>(null);
  const [dialog, setDialog] = useState<ReactNode>(null);
  const [uploads, setUploads] = useState<UploadJob[]>([]);
  const [dragging, setDragging] = useState(false);
  const [showTree, setShowTree] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  const repo = repos?.find((r) => r.id === repoId) ?? null;

  // ── Loading ────────────────────────────────────────────────────────────
  const loadRepos = useCallback(async (select?: string) => {
    try {
      const list = await knowledgeApi.listRepositories();
      setRepos(list);
      setRepoId((cur) => {
        const want = select ?? cur ?? recall(LAST_REPO);
        return list.find((r) => r.id === want)?.id ?? list[0]?.id ?? null;
      });
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load repositories.'); setRepos([]); }
  }, []);
  useEffect(() => { void loadRepos(); }, [loadRepos]);

  const refresh = useCallback(async (opts: { quiet?: boolean } = {}) => {
    if (!repoId) return;
    if (!opts.quiet) setLoading(true);
    try {
      const [t, c, stats] = await Promise.all([
        knowledgeApi.tree(repoId),
        knowledgeApi.contents(repoId, { directoryId: dirId, sort: sort.by, order: sort.order, limit: 500 }),
        knowledgeApi.statistics(repoId),
      ]);
      setTree(t); setContents(c); setError(null);
      setRepos((rs) => rs?.map((r) => (r.id === repoId ? { ...r, statistics: stats } : r)) ?? rs);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not load the folder.';
      // The folder may have been deleted elsewhere: fall back to the root.
      if (dirId && /not found/i.test(msg)) setDirId(null); else setError(msg);
    } finally { if (!opts.quiet) setLoading(false); }
  }, [repoId, dirId, sort]);

  useEffect(() => { if (repoId) remember(LAST_REPO, repoId); setSelected(new Set()); setResults(null); setQuery(''); }, [repoId]);
  useEffect(() => { void refresh(); setSelected(new Set()); }, [refresh]);

  // Live indexing status: poll while anything is waiting or being indexed.
  const active = (contents?.files ?? []).some((f) => ACTIVE_STATES.has(f.indexing.status)) || (repo?.statistics.awaitingIndexing ?? 0) + (repo?.statistics.indexing ?? 0) > 0;
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => { void refresh({ quiet: true }); }, 3000);
    return () => window.clearInterval(t);
  }, [active, refresh]);

  // Debounced search across the repository (names and content).
  useEffect(() => {
    if (!repoId || query.trim().length < 2) { setResults(null); return; }
    const t = window.setTimeout(() => {
      knowledgeApi.search(repoId, query.trim()).then(setResults).catch((e) => notify(e.message, true));
    }, 350);
    return () => window.clearTimeout(t);
  }, [query, repoId, notify]);

  // ── Folder tree ────────────────────────────────────────────────────────
  const children = useMemo(() => {
    const m = new Map<string | null, RepoTree['directories']>();
    for (const d of tree?.directories ?? []) m.set(d.parentId, [...(m.get(d.parentId) ?? []), d]);
    for (const list of m.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return m;
  }, [tree]);
  const countOf = useMemo(() => new Map((tree?.directories ?? []).map((d) => [d.id, d])), [tree]);

  const open = (id: string | null) => { setDirId(id); setQuery(''); setResults(null); setShowTree(false); };

  // ── Uploads ────────────────────────────────────────────────────────────
  const upload = useCallback(async (files: Array<{ file: File; relativePath?: string }>, folder: boolean, emptyFolders: string[] = []) => {
    if (!repoId || (!files.length && !emptyFolders.length)) return;
    const id = Date.now() + Math.random();
    const root = folder ? (files[0]?.relativePath ?? emptyFolders[0] ?? '').split('/')[0] : '';
    const label = folder && root ? `Folder “${root}”` : files.length === 1 ? files[0].file.name : `${files.length} files`;
    setUploads((u) => [{ id, label, count: files.length, progress: 0, state: 'uploading' as const }, ...u].slice(0, 6));
    try {
      // Large folders go up in batches so one request stays within the server's per-upload limits.
      const batches: typeof files[] = [];
      for (let i = 0; i < files.length; i += 200) batches.push(files.slice(i, i + 200));
      if (!batches.length) batches.push([]);
      const total = files.reduce((a, f) => a + f.file.size, 0) || 1;
      let sent = 0;
      const merged: UploadSummary = { results: [], indexJobId: null, summary: {} };
      for (const [i, batch] of batches.entries()) {
        const size = batch.reduce((a, f) => a + f.file.size, 0);
        const r = await knowledgeApi.upload(repoId, { files: batch, directoryId: dirId, folder, emptyFolders: i === 0 ? emptyFolders : [] },
          (frac) => setUploads((u) => u.map((j) => (j.id === id ? { ...j, progress: (sent + frac * size) / total } : j))));
        sent += size;
        merged.results.push(...r.results);
        for (const [k, v] of Object.entries(r.summary)) merged.summary[k] = (merged.summary[k] ?? 0) + v;
      }
      setUploads((u) => u.map((j) => (j.id === id ? { ...j, progress: 1, state: 'done', result: merged } : j)));
      const s = merged.summary;
      const okCount = (s.created ?? 0) + (s.replaced ?? 0) + (s.renamed ?? 0);
      notify(s.rejected ? `${okCount} uploaded, ${s.rejected} rejected` : `${okCount} file${okCount === 1 ? '' : 's'} uploaded — indexing started`, !!s.rejected && !okCount);
      await refresh({ quiet: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Upload failed.';
      setUploads((u) => u.map((j) => (j.id === id ? { ...j, state: 'failed', error: msg } : j)));
      notify(msg, true);
    }
  }, [repoId, dirId, notify, refresh]);

  const onPickFiles = (list: FileList | null, folder: boolean) => {
    if (!list?.length) return;
    const files = [...list].map((f) => ({ file: f, relativePath: folder ? (f as any).webkitRelativePath || f.name : f.name }));
    void upload(files, folder);
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (!repoId) return;
    const { files, emptyFolders, hasFolders } = await filesFromDrop(e.dataTransfer);
    void upload(files, hasFolders, emptyFolders);
  };

  // ── Actions ────────────────────────────────────────────────────────────
  const run = async (fn: () => Promise<unknown>, done: string) => {
    try { await fn(); notify(done); await refresh({ quiet: true }); } catch (e) { notify(e instanceof Error ? e.message : 'Action failed.', true); }
  };

  const rename = (s: Sel) => setDialog(
    <PromptDialog title={`Rename ${s.kind}`} label="New name" initial={s.item.name} confirm="Rename" onClose={() => setDialog(null)}
      onSubmit={async (name) => {
        if (s.kind === 'file') await knowledgeApi.updateFile(s.item.id, { name }); else await knowledgeApi.updateDirectory(s.item.id, { name });
        notify('Renamed'); await refresh({ quiet: true });
      }} />,
  );

  const newFolder = () => repoId && setDialog(
    <PromptDialog title="New folder" label="Folder name" confirm="Create" onClose={() => setDialog(null)}
      onSubmit={async (name) => { await knowledgeApi.createDirectory(repoId, name, dirId); notify(`Folder “${name}” created`); await refresh({ quiet: true }); }} />,
  );

  const remove = (items: Sel[]) => setDialog(
    <ConfirmDialog
      title={items.length === 1 ? `Delete “${items[0].item.name}”?` : `Delete ${items.length} items?`}
      body={items.some((i) => i.kind === 'folder') ? 'Folders are deleted with everything inside them. Their indexed content is removed from the AI knowledge base.' : 'The files and their indexed content are removed from the AI knowledge base.'}
      confirm="Delete" danger onClose={() => setDialog(null)}
      onConfirm={() => run(async () => {
        const files = items.filter((i) => i.kind === 'file').map((i) => i.item.id);
        if (files.length && repoId) await knowledgeApi.bulk(repoId, 'delete', files);
        for (const f of items.filter((i) => i.kind === 'folder')) await knowledgeApi.deleteDirectory(f.item.id, true);
        setSelected(new Set());
      }, 'Deleted')} />,
  );

  const move = (items: Sel[]) => tree && setDialog(
    <MoveDialog tree={tree} childrenOf={children} exclude={new Set(items.filter((i) => i.kind === 'folder').map((i) => i.item.id))} onClose={() => setDialog(null)}
      onMove={(target) => run(async () => {
        const files = items.filter((i) => i.kind === 'file').map((i) => i.item.id);
        if (files.length && repoId) {
          const r = await knowledgeApi.bulk(repoId, 'move', files, target);
          const failed = r.results.filter((x) => !x.ok);
          if (failed.length) throw new Error(failed[0].error ?? 'Some files could not be moved.');
        }
        for (const f of items.filter((i) => i.kind === 'folder')) await knowledgeApi.updateDirectory(f.item.id, { parentId: target });
        setSelected(new Set());
      }, 'Moved')} />,
  );

  const reindex = (files: RepoFile[]) => run(async () => {
    if (files.length === 1) await knowledgeApi.reindexFile(files[0].id);
    else if (repoId) await knowledgeApi.bulk(repoId, 'reindex', files.map((f) => f.id));
  }, 'Indexing started');

  const createRepo = () => setDialog(
    <PromptDialog title="New repository" label="Repository name" confirm="Create" onClose={() => setDialog(null)}
      onSubmit={async (name) => { const r = await knowledgeApi.createRepository({ name }); notify(`Repository “${name}” created`); await loadRepos(r.id); setDirId(null); }} />,
  );

  const deleteRepo = () => repo && setDialog(
    <ConfirmDialog title={`Delete repository “${repo.name}”?`} confirm="Delete repository" danger requireText={repo.name} onClose={() => setDialog(null)}
      body={`All ${repo.statistics.folders} folders and ${repo.statistics.files} files are deleted and removed from the AI knowledge base. This cannot be undone.`}
      onConfirm={async () => {
        try { await knowledgeApi.deleteRepository(repo.id); notify('Repository deleted'); setDirId(null); setRepoId(null); await loadRepos(); } catch (e) { notify(e instanceof Error ? e.message : 'Delete failed.', true); }
      }} />,
  );

  // ── Derived listing ────────────────────────────────────────────────────
  const files = contents?.files ?? [];
  const folders = contents?.folders ?? [];
  const selectedItems: Sel[] = [
    ...folders.filter((d) => selected.has(d.id)).map((item) => ({ kind: 'folder' as const, item })),
    ...files.filter((f) => selected.has(f.id)).map((item) => ({ kind: 'file' as const, item })),
  ];
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allIds = [...folders.map((d) => d.id), ...files.map((f) => f.id)];
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));

  // ── Render ─────────────────────────────────────────────────────────────
  if (repos === null) return <div className={`${kx.panel} flex h-64 items-center justify-center`}><Loader2 className="animate-spin text-[#9AA6C9]" /></div>;

  if (!repos.length) return (
    <div className={`${kx.panel} flex flex-col items-center gap-4 p-10 sm:p-14 text-center`}>
      <div className="rounded-2xl border border-[#3FA7E0]/30 bg-[#3FA7E0]/10 p-4 text-[#3FA7E0]"><FolderTree size={30} /></div>
      <div className="max-w-md space-y-1.5">
        <h3 className="text-lg font-bold text-white">{readOnly ? 'No published datasets yet' : 'Create your first knowledge repository'}</h3>
        <p className="text-sm text-[#9AA6C9]">{readOnly ? 'Datasets appear here once an administrator publishes them to Bwenge AI.' : 'Upload whole folders of reports, curricula, spreadsheets and slides. Bwenge keeps the folder structure, previews every file, and indexes it so the AI can answer from it with citations.'}</p>
      </div>
      {error && <p className="text-sm text-[#FF8798]">{error}</p>}
      {!readOnly && <button className={`${kx.btn} ${kx.primary}`} onClick={createRepo}><Plus size={16} /> New repository</button>}
      {dialog}
    </div>
  );

  const stats = repo?.statistics;
  const quotaPct = stats ? Math.min(100, (stats.totalBytes / Math.max(1, stats.quotaBytes)) * 100) : 0;

  return (
    <div className="space-y-4 min-w-0">
      {/* Repository bar */}
      <div className={`${kx.panel} p-4 sm:p-5`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="rounded-xl border border-[#3DB27A]/30 bg-[#3DB27A]/10 p-2.5 text-[#6FD6A2]"><Database size={20} /></div>
            <div className="min-w-0 flex-1">
              <label className="sr-only" htmlFor="kx-repo">Repository</label>
              <div className="relative">
                <select id="kx-repo" value={repoId ?? ''} onChange={(e) => { setRepoId(e.target.value); setDirId(null); }}
                  className="w-full max-w-full appearance-none truncate rounded-lg bg-transparent pr-7 text-base sm:text-lg font-bold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3FA7E0] cursor-pointer">
                  {repos.map((r) => <option key={r.id} value={r.id} className="bg-[#11172A] text-sm">{r.name}</option>)}
                </select>
                <ChevronDown size={16} className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-[#9AA6C9]" />
              </div>
              {stats && (
                <p className="text-xs text-[#9AA6C9]">
                  {stats.folders} folders · {stats.files} files · {formatBytes(stats.totalBytes)}
                  {!stats.embeddingsAvailable && <span className="ml-2 text-[#F2C230]">· semantic search off (keyword only)</span>}
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {stats && <StatPill tone="green" label="Searchable by AI" value={['indexed', 'pending_embeddings', 'partial_failure', 'duplicate'].reduce((a, k) => a + (stats.byStatus[k] ?? 0), 0)} />}
            {stats && stats.awaitingIndexing + stats.indexing > 0 && <StatPill tone="blue" label="Indexing" value={stats.awaitingIndexing + stats.indexing} spin />}
            {stats && stats.failed > 0 && <StatPill tone="red" label="Failed" value={stats.failed} onClick={readOnly ? undefined : () => repoId && run(() => knowledgeApi.reindexRepository(repoId, true), 'Retrying failed files')} title={readOnly ? undefined : 'Retry failed files'} />}
            {readOnly && repo?.settings?.assistant === true && <span className="inline-flex items-center gap-1.5 rounded-full border border-[#3DB27A]/35 bg-[#3DB27A]/10 px-3 py-1 text-xs font-semibold text-[#6FD6A2]">Published to Bwenge AI</span>}
            {readOnly && <span className="inline-flex items-center gap-1.5 rounded-full border border-[#2A3760] px-3 py-1 text-xs font-semibold text-[#9AA6C9]"><Eye size={12} /> View only</span>}
            {!readOnly && repo && (
              <AssistantSwitch on={repo.settings?.assistant === true} onChange={(on) => run(async () => {
                await knowledgeApi.updateRepository(repo.id, { settings: { assistant: on } });
                await loadRepos(repo.id);
              }, on ? 'Bwenge AI can now use this dataset for every user' : 'This dataset is hidden from Bwenge AI')} />
            )}
            {!readOnly && <button className={`${kx.btn} ${kx.ghost}`} onClick={createRepo}><Plus size={15} /> New repository</button>}
            {!readOnly && <RepoMenu onReindex={() => repoId && run(() => knowledgeApi.reindexRepository(repoId), 'Re-indexing the repository')} onRename={() => repo && setDialog(
              <PromptDialog title="Rename repository" label="Name" initial={repo.name} confirm="Save" onClose={() => setDialog(null)}
                onSubmit={async (name) => { await knowledgeApi.updateRepository(repo.id, { name }); await loadRepos(repo.id); }} />,
            )} onDelete={deleteRepo} />}
          </div>
        </div>
        {stats && !readOnly && (
          <div className="mt-4" title={`${formatBytes(stats.totalBytes)} of ${formatBytes(stats.quotaBytes)} used`}>
            <div className="h-1.5 overflow-hidden rounded-full bg-[#1A2240]"><div className={`h-full rounded-full ${quotaPct > 90 ? 'bg-[#E5586B]' : 'bg-gradient-to-r from-[#3FA7E0] to-[#3DB27A]'}`} style={{ width: `${Math.max(quotaPct, 0.5)}%` }} /></div>
            <p className="mt-1 flex items-center gap-1 text-[11px] text-[#6C789E]"><HardDrive size={11} /> {formatBytes(stats.totalBytes)} of {formatBytes(stats.quotaBytes)}</p>
          </div>
        )}
      </div>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        {/* Folder tree */}
        <nav aria-label="Folders" className={`${kx.panel} ${showTree ? 'block' : 'hidden'} lg:block max-h-[70vh] overflow-auto p-2.5 lg:sticky lg:top-4 self-start`}>
          <TreeRow depth={0} name={tree?.repository.name ?? repo?.name ?? ''} count={tree?.root.files} active={dirId === null} hasChildren={!!children.get(null)?.length} expanded onClick={() => open(null)} root />
          <TreeLevel parent={null} depth={1} childrenOf={children} current={dirId} onOpen={open} ancestors={contents?.breadcrumbs.map((b) => b.id) ?? []} />
        </nav>

        {/* Main pane */}
        <section
          className={`${kx.panel} relative min-w-0 overflow-hidden`}
          onDragEnter={(e) => { if (!readOnly && e.dataTransfer.types.includes('Files')) { dragDepth.current++; setDragging(true); } }}
          onDragOver={(e) => { if (!readOnly && e.dataTransfer.types.includes('Files')) e.preventDefault(); }}
          onDragLeave={() => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); }}
          onDrop={readOnly ? undefined : onDrop}
        >
          {/* Toolbar: location and actions, then search, sort and view */}
          <div className="flex flex-col gap-3 border-b border-[#202945] p-3 sm:p-4">
            <div className="flex min-w-0 items-center gap-2">
              <button className={`${kx.btn} ${kx.ghost} lg:hidden !px-2.5`} onClick={() => setShowTree((v) => !v)} aria-expanded={showTree} aria-label="Show folders"><FolderTree size={15} /></button>
              <Breadcrumbs crumbs={contents?.breadcrumbs ?? []} onOpen={open} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {!readOnly && <div className="flex flex-wrap items-center gap-2 sm:order-2 sm:ml-auto">
                <button className={`${kx.btn} ${kx.ghost}`} onClick={newFolder} title="New folder"><FolderPlus size={15} /><span className="hidden 2xl:inline">New folder</span></button>
                <button className={`${kx.btn} ${kx.ghost}`} onClick={() => fileInput.current?.click()} title="Upload files"><Upload size={15} /><span className="hidden 2xl:inline">Upload files</span></button>
                <button className={`${kx.btn} ${kx.primary}`} onClick={() => folderInput.current?.click()}><FolderInput size={15} /> Upload folder</button>
              </div>}
              <input ref={fileInput} type="file" multiple hidden onChange={(e) => { onPickFiles(e.target.files, false); e.target.value = ''; }} />
              <input ref={folderInput} type="file" multiple hidden {...({ webkitdirectory: '', directory: '' } as any)} onChange={(e) => { onPickFiles(e.target.files, true); e.target.value = ''; }} />
            <div className="flex w-full min-w-0 items-center gap-2 sm:order-1 sm:w-auto sm:min-w-[260px] sm:flex-1">
              <div className="relative min-w-0 flex-1">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#6C789E]" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search names and file contents…" className={`${kx.input} !py-2 pl-9 pr-8`} aria-label="Search repository" />
                {query && <button onClick={() => setQuery('')} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[#6C789E] hover:text-white"><X size={14} /></button>}
              </div>
              <SortControl sort={sort} onChange={setSort} />
              <div className="hidden sm:flex rounded-xl border border-[#2A3760] bg-[#18213D] p-0.5" role="group" aria-label="View">
                <button onClick={() => setView('list')} aria-pressed={view === 'list'} className={`rounded-lg p-1.5 ${view === 'list' ? 'bg-[#2A3760] text-white' : 'text-[#9AA6C9]'}`} title="List view"><List size={16} /></button>
                <button onClick={() => setView('grid')} aria-pressed={view === 'grid'} className={`rounded-lg p-1.5 ${view === 'grid' ? 'bg-[#2A3760] text-white' : 'text-[#9AA6C9]'}`} title="Grid view"><LayoutGrid size={16} /></button>
              </div>
            </div>
            </div>
          </div>

          {/* Bulk actions */}
          {!readOnly && selectedItems.length > 0 && !results && (
            <div className="flex flex-wrap items-center gap-2 border-b border-[#202945] bg-[#3FA7E0]/[0.06] px-3 sm:px-4 py-2.5">
              <span className="text-sm font-semibold text-[#7CC4EE]">{selectedItems.length} selected</span>
              <div className="ml-auto flex flex-wrap gap-2">
                <button className={`${kx.btn} ${kx.ghost} !py-1.5`} onClick={() => move(selectedItems)}><FolderInput size={14} /> Move</button>
                {selectedItems.some((s) => s.kind === 'file') && <button className={`${kx.btn} ${kx.ghost} !py-1.5`} onClick={() => reindex(selectedItems.filter((s): s is Extract<Sel, { kind: 'file' }> => s.kind === 'file').map((s) => s.item))}><RefreshCw size={14} /> Re-index</button>}
                <button className={`${kx.btn} ${kx.danger} !py-1.5`} onClick={() => remove(selectedItems)}><Trash2 size={14} /> Delete</button>
                <button className={`${kx.btn} ${kx.ghost} !py-1.5`} onClick={() => setSelected(new Set())}>Clear</button>
              </div>
            </div>
          )}

          {/* Body */}
          <div className="min-h-[360px]">
            {error && <p className="m-4 rounded-xl border border-[#E5586B]/30 bg-[#E5586B]/10 p-4 text-sm text-[#FF8798]">{error}</p>}
            {results ? (
              <SearchView results={results} onOpenFile={setPreview} onOpenFolder={(d) => open(d.id)} />
            ) : loading && !contents ? (
              <div className="flex h-72 items-center justify-center"><Loader2 className="animate-spin text-[#9AA6C9]" /></div>
            ) : !folders.length && !files.length ? (
              <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
                <div className="rounded-2xl border border-dashed border-[#3FA7E0]/40 bg-[#3FA7E0]/5 p-5 text-[#3FA7E0]"><UploadCloud size={34} /></div>
                <p className="text-base font-semibold text-white">This folder is empty</p>
                {!readOnly && <p className="max-w-sm text-sm text-[#9AA6C9]">Drag files or whole folders here, or use <b>Upload folder</b> to bring in a directory with all its sub-folders.</p>}
                {!readOnly && <div className="flex flex-wrap justify-center gap-2 pt-1">
                  <button className={`${kx.btn} ${kx.primary}`} onClick={() => folderInput.current?.click()}><FolderInput size={15} /> Upload folder</button>
                  <button className={`${kx.btn} ${kx.ghost}`} onClick={() => fileInput.current?.click()}><Upload size={15} /> Upload files</button>
                </div>}
              </div>
            ) : view === 'list' ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-[11px] uppercase tracking-wider text-[#6C789E]">
                    <tr className="border-b border-[#1A2240]">
                      <th className="w-10 px-3 py-2.5">{!readOnly && <button aria-label={allSelected ? 'Clear selection' : 'Select all'} onClick={() => setSelected(allSelected ? new Set() : new Set(allIds))} className="text-[#9AA6C9] hover:text-white">{allSelected ? <CheckSquare size={16} /> : <Square size={16} />}</button>}</th>
                      <th className="px-2 py-2.5 font-semibold">Name</th>
                      <th className="hidden sm:table-cell w-24 px-2 py-2.5 text-right font-semibold">Size</th>
                      <th className="hidden md:table-cell w-44 px-2 py-2.5 font-semibold">Modified</th>
                      <th className="hidden sm:table-cell w-36 px-2 py-2.5 font-semibold">AI status</th>
                      <th className="w-12 px-2 py-2.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#151C33]">
                    {folders.map((d) => {
                      const c = countOf.get(d.id);
                      return (
                        <tr key={d.id} className={`group cursor-pointer hover:bg-white/[0.03] ${selected.has(d.id) ? 'bg-[#3FA7E0]/[0.07]' : ''}`} onDoubleClick={() => open(d.id)}>
                          <td className="px-3 py-2.5">{readOnly ? <span className="block w-4" /> : <Check checked={selected.has(d.id)} onChange={() => toggle(d.id)} label={d.name} />}</td>
                          <td className="max-w-0 px-2 py-2.5"><button className="flex w-full min-w-0 items-center gap-2.5 text-left font-medium text-[#E8EAF2] hover:text-white" onClick={() => open(d.id)}><FileIcon folder /><span className="truncate">{d.name}</span></button></td>
                          <td className="hidden sm:table-cell px-2 py-2.5 text-right text-xs text-[#7C8CB8] tabular-nums">{c ? `${c.files} file${c.files === 1 ? '' : 's'}` : ''}</td>
                          <td className="hidden md:table-cell px-2 py-2.5 text-xs text-[#7C8CB8]">{fmtDate(d.updatedAt)}</td>
                          <td className="hidden sm:table-cell px-2 py-2.5" />
                          <td className="px-2 py-2.5"><RowMenu items={[
                            { label: 'Open', icon: <FolderOpen size={14} />, run: () => open(d.id) },
                            ...(readOnly ? [] : [
                              { label: 'Rename', icon: <Pencil size={14} />, run: () => rename({ kind: 'folder', item: d }) },
                              { label: 'Move to…', icon: <FolderInput size={14} />, run: () => move([{ kind: 'folder', item: d }]) },
                              { label: 'Delete', icon: <Trash2 size={14} />, run: () => remove([{ kind: 'folder', item: d }]), danger: true },
                            ]),
                          ]} /></td>
                        </tr>
                      );
                    })}
                    {files.map((f) => (
                      <tr key={f.id} className={`group cursor-pointer hover:bg-white/[0.03] ${selected.has(f.id) ? 'bg-[#3FA7E0]/[0.07]' : ''}`} onDoubleClick={() => setPreview(f)}>
                        <td className="px-3 py-2.5">{readOnly ? <span className="block w-4" /> : <Check checked={selected.has(f.id)} onChange={() => toggle(f.id)} label={f.name} />}</td>
                        <td className="max-w-0 px-2 py-2.5">
                          <button className="flex w-full min-w-0 items-center gap-2.5 text-left text-[#E1E6F5] hover:text-white" onClick={() => setPreview(f)} title={f.name}>
                            <FileIcon extension={f.extension} />
                            <span className="min-w-0">
                              <span className="block truncate">{f.name}</span>
                              <span className="mt-0.5 flex items-center gap-2 text-[11px] text-[#7C8CB8] sm:hidden">{formatBytes(f.sizeBytes)}<StatusBadge status={f.indexing.status} error={f.indexing.error} /></span>
                            </span>
                          </button>
                        </td>
                        <td className="hidden sm:table-cell px-2 py-2.5 text-right text-xs text-[#9AA6C9] tabular-nums">{formatBytes(f.sizeBytes)}</td>
                        <td className="hidden md:table-cell px-2 py-2.5 text-xs text-[#7C8CB8]">{fmtDate(f.updatedAt)}</td>
                        <td className="hidden sm:table-cell px-2 py-2.5"><StatusBadge status={f.indexing.status} error={f.indexing.error} /></td>
                        <td className="px-2 py-2.5"><RowMenu items={fileMenu(f)} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {contents?.hasMore && <p className="px-4 py-3 text-xs text-[#7C8CB8]">Showing the first {files.length} of {contents.total} files. Use search to find others.</p>}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 sm:p-4 xl:grid-cols-5">
                {folders.map((d) => (
                  <Tile key={d.id} selected={selected.has(d.id)} onSelect={() => toggle(d.id)} onOpen={() => open(d.id)} icon={<FileIcon folder size={34} />} name={d.name} meta={`${countOf.get(d.id)?.files ?? 0} files`} />
                ))}
                {files.map((f) => (
                  <Tile key={f.id} selected={selected.has(f.id)} onSelect={() => toggle(f.id)} onOpen={() => setPreview(f)} icon={<FileIcon extension={f.extension} size={34} />} name={f.name} meta={formatBytes(f.sizeBytes)} badge={<StatusBadge status={f.indexing.status} error={f.indexing.error} />} />
                ))}
              </div>
            )}
          </div>

          {dragging && (
            <div className="pointer-events-none absolute inset-2 z-10 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[#3FA7E0] bg-[#0B1020]/90 text-center">
              <UploadCloud size={38} className="text-[#3FA7E0]" />
              <p className="text-base font-bold text-white">Drop files or folders</p>
              <p className="text-sm text-[#9AA6C9]">They will be added to <b>{contents?.breadcrumbs.at(-1)?.name ?? repo?.name}</b> with their folder structure.</p>
            </div>
          )}
        </section>
      </div>

      <UploadTray jobs={uploads} onDismiss={(id) => setUploads((u) => u.filter((j) => j.id !== id))} />
      {preview && <FilePreview file={preview} readOnly={readOnly} onClose={() => setPreview(null)} onReindex={(f) => void reindex([f])} onExtracted={() => void refresh({ quiet: true })} />}
      {dialog}
    </div>
  );

  function fileMenu(f: RepoFile) {
    type Item = { label: string; icon: ReactNode; run: () => void; danger?: boolean };
    return ([
      { label: 'Preview', icon: <Eye size={14} />, run: () => setPreview(f) },
      { label: 'Download', icon: <Download size={14} />, run: () => void knowledgeApi.download(f).catch((e) => notify(e.message, true)) },
    ] as Item[]).concat(readOnly ? [] : [
      { label: 'Rename', icon: <Pencil size={14} />, run: () => rename({ kind: 'file', item: f }) },
      { label: 'Move to…', icon: <FolderInput size={14} />, run: () => move([{ kind: 'file', item: f }]) },
      { label: 'Re-index', icon: <RefreshCw size={14} />, run: () => void reindex([f]) },
      { label: 'Delete', icon: <Trash2 size={14} />, run: () => remove([{ kind: 'file', item: f }]), danger: true },
    ]);
  }
}

// ── Pieces ───────────────────────────────────────────────────────────────

function StatPill({ tone, label, value, spin, onClick, title }: { tone: 'green' | 'blue' | 'red'; label: string; value: number; spin?: boolean; onClick?: () => void; title?: string }) {
  const c = { green: 'border-[#3DB27A]/35 bg-[#3DB27A]/10 text-[#6FD6A2]', blue: 'border-[#3FA7E0]/35 bg-[#3FA7E0]/10 text-[#7CC4EE]', red: 'border-[#E5586B]/35 bg-[#E5586B]/10 text-[#FF8798]' }[tone];
  const Tag = onClick ? 'button' : 'span';
  return (
    <Tag onClick={onClick} title={title} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${c} ${onClick ? 'hover:brightness-125 cursor-pointer' : ''}`}>
      {spin && <Loader2 size={12} className="animate-spin" />}<span className="tabular-nums">{value}</span> {label}
    </Tag>
  );
}

function Breadcrumbs({ crumbs, onOpen }: { crumbs: Contents['breadcrumbs']; onOpen: (id: string | null) => void }) {
  // Long paths keep the root and the last two folders visible; the middle collapses into "…" (full path on hover).
  const shown: Array<Contents['breadcrumbs'][number] | null> = crumbs.length > 3 ? [crumbs[0], null, ...crumbs.slice(-2)] : crumbs;
  const hidden = crumbs.length > 3 ? crumbs.slice(1, -2).map((c) => c.name).join(' / ') : '';
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden text-sm">
      {shown.map((c, i) => (
        <span key={c ? `${c.id}-${i}` : 'gap'} className={`flex items-center gap-0.5 ${i === shown.length - 1 ? 'max-w-[55%] shrink-0' : c ? 'min-w-0' : 'shrink-0'}`}>
          {i > 0 && <ChevronRight size={14} className="shrink-0 text-[#4A5680]" />}
          {!c ? <span className="px-1 text-[#6C789E]" title={hidden}>…</span>
            : i === shown.length - 1
              ? <span className="truncate rounded-lg px-1.5 py-1 font-semibold text-white" aria-current="page" title={c.path || c.name}>{c.name}</span>
              : <button className="min-w-0 max-w-[9rem] truncate rounded-lg px-1.5 py-1 text-[#9AA6C9] hover:bg-white/5 hover:text-white" onClick={() => onOpen(c.id)} title={c.path || c.name}>{c.name}</button>}
        </span>
      ))}
    </nav>
  );
}

function TreeRow({ depth, name, count, active, hasChildren, expanded, onClick, onToggle, root }: { depth: number; name: string; count?: number; active: boolean; hasChildren: boolean; expanded: boolean; onClick: () => void; onToggle?: () => void; root?: boolean }) {
  return (
    <div className={`group flex items-center gap-1 rounded-lg pr-2 text-sm ${active ? 'bg-[#3FA7E0]/15 text-white' : 'text-[#B7C1DE] hover:bg-white/[0.04]'}`} style={{ paddingLeft: depth * 14 + 4 }}>
      <button onClick={onToggle} aria-label={expanded ? 'Collapse' : 'Expand'} className={`rounded p-0.5 text-[#6C789E] hover:text-white ${hasChildren && onToggle ? '' : 'invisible'}`}>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      <button onClick={onClick} className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left" aria-current={active ? 'true' : undefined}>
        {root ? <Database size={15} className="shrink-0 text-[#6FD6A2]" /> : <FileIcon folder size={15} />}
        <span className={`truncate ${root ? 'font-semibold' : ''}`}>{name}</span>
      </button>
      {!!count && <span className="text-[11px] tabular-nums text-[#6C789E]">{count}</span>}
    </div>
  );
}

function TreeLevel({ parent, depth, childrenOf, current, onOpen, ancestors }: { parent: string | null; depth: number; childrenOf: Map<string | null, RepoTree['directories']>; current: string | null; onOpen: (id: string) => void; ancestors: Array<string | null> }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const list = childrenOf.get(parent) ?? [];
  return (
    <>
      {list.map((d) => {
        const expanded = open[d.id] ?? ancestors.includes(d.id);
        const kids = !!childrenOf.get(d.id)?.length;
        return (
          <div key={d.id}>
            <TreeRow depth={depth} name={d.name} count={d.files} active={current === d.id} hasChildren={kids} expanded={expanded} onClick={() => onOpen(d.id)} onToggle={() => setOpen((o) => ({ ...o, [d.id]: !expanded }))} />
            {expanded && kids && <TreeLevel parent={d.id} depth={depth + 1} childrenOf={childrenOf} current={current} onOpen={onOpen} ancestors={ancestors} />}
          </div>
        );
      })}
    </>
  );
}

function SortControl({ sort, onChange }: { sort: { by: 'name' | 'size' | 'modified' | 'status'; order: 'asc' | 'desc' }; onChange: (s: { by: 'name' | 'size' | 'modified' | 'status'; order: 'asc' | 'desc' }) => void }) {
  return (
    <div className="flex items-center gap-1 rounded-xl border border-[#2A3760] bg-[#18213D] pl-2.5">
      <ArrowDownAZ size={15} className="text-[#9AA6C9]" />
      <select aria-label="Sort by" value={sort.by} onChange={(e) => onChange({ ...sort, by: e.target.value as typeof sort.by })} className="cursor-pointer bg-transparent py-2 text-xs font-semibold text-[#E8EAF2] focus:outline-none">
        <option value="name" className="bg-[#11172A]">Name</option><option value="modified" className="bg-[#11172A]">Modified</option>
        <option value="size" className="bg-[#11172A]">Size</option><option value="status" className="bg-[#11172A]">AI status</option>
      </select>
      <button onClick={() => onChange({ ...sort, order: sort.order === 'asc' ? 'desc' : 'asc' })} className="rounded-r-xl px-2 py-2 text-xs font-bold text-[#9AA6C9] hover:text-white" title="Reverse order">{sort.order === 'asc' ? '↑' : '↓'}</button>
    </div>
  );
}

function Check({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return <button role="checkbox" aria-checked={checked} aria-label={`Select ${label}`} onClick={(e) => { e.stopPropagation(); onChange(); }} className={checked ? 'text-[#3FA7E0]' : 'text-[#4A5680] group-hover:text-[#9AA6C9]'}>{checked ? <CheckSquare size={16} /> : <Square size={16} />}</button>;
}

function Tile({ icon, name, meta, badge, selected, onSelect, onOpen }: { icon: ReactNode; name: string; meta: string; badge?: ReactNode; selected: boolean; onSelect: () => void; onOpen: () => void }) {
  return (
    <div className={`group relative flex flex-col items-center gap-2 rounded-xl border p-3 pt-5 text-center transition ${selected ? 'border-[#3FA7E0]/60 bg-[#3FA7E0]/[0.08]' : 'border-[#1E2747] bg-[#0B1020] hover:border-[#2E3A63] hover:bg-[#11172A]'}`}>
      <div className="absolute left-2 top-2"><Check checked={selected} onChange={onSelect} label={name} /></div>
      <button onClick={onOpen} className="flex w-full flex-col items-center gap-2">
        <div className="rounded-xl bg-[#11172A] p-3">{icon}</div>
        <span className="line-clamp-2 w-full break-words text-xs font-medium text-[#E1E6F5]" title={name}>{name}</span>
      </button>
      <span className="text-[11px] text-[#6C789E]">{meta}</span>
      {badge}
    </div>
  );
}

type MenuItem = { label: string; icon: ReactNode; run: () => void; danger?: boolean };
function RowMenu({ items }: { items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div ref={ref} className="relative flex justify-end">
      <button aria-label="Actions" aria-haspopup="menu" aria-expanded={open} onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }} className="rounded-lg p-1.5 text-[#6C789E] hover:bg-white/5 hover:text-white"><MoreVertical size={16} /></button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-30 mt-1 w-44 overflow-hidden rounded-xl border border-[#2A3760] bg-[#141B33] py-1 shadow-2xl">
          {items.map((it) => (
            <button key={it.label} role="menuitem" onClick={(e) => { e.stopPropagation(); setOpen(false); it.run(); }} className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm ${it.danger ? 'text-[#FF8798] hover:bg-[#E5586B]/10' : 'text-[#D6DCF0] hover:bg-white/5'}`}>{it.icon}{it.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Publishes the repository to Bwenge AI: every user's assistant can search, browse, read and analyse it. */
function AssistantSwitch({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)}
      title={on ? 'In the public library: every user can browse it and Bwenge AI answers everyone from it. Folders and files switched off for AI stay hidden.' : 'Private: only you can use this dataset. Turn on to add it to the public library.'}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3FA7E0] ${on ? 'border-[#B48CFF]/40 bg-[#B48CFF]/12 text-[#D6C2FF]' : 'border-[#2A3760] bg-[#18213D] text-[#9AA6C9] hover:text-white'}`}>
      <Sparkles size={13} />
      {on ? 'Public library: on' : 'Public library: off'}
      <span aria-hidden="true" className={`relative h-4 w-7 rounded-full transition-colors ${on ? 'bg-[#8E63F0]' : 'bg-[#2A3760]'}`}>
        <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${on ? 'left-3.5' : 'left-0.5'}`} />
      </span>
    </button>
  );
}

function RepoMenu({ onReindex, onRename, onDelete }: { onReindex: () => void; onRename: () => void; onDelete: () => void }) {
  return <div className="rounded-xl border border-[#2A3760] bg-[#18213D]"><RowMenu items={[
    { label: 'Re-index all', icon: <RefreshCw size={14} />, run: onReindex },
    { label: 'Rename', icon: <Pencil size={14} />, run: onRename },
    { label: 'Delete repository', icon: <Trash2 size={14} />, run: onDelete, danger: true },
  ]} /></div>;
}

function SearchView({ results, onOpenFile, onOpenFolder }: { results: SearchResults; onOpenFile: (f: RepoFile) => void; onOpenFolder: (d: RepoDirectory) => void }) {
  const none = !results.folders?.length && !results.files?.length && !results.content?.length;
  return (
    <div className="space-y-5 p-4">
      {none && <p className="py-10 text-center text-sm text-[#9AA6C9]">Nothing matches “{results.query}”.</p>}
      {!!(results.folders?.length || results.files?.length) && (
        <div>
          <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-[#6C789E]">Names</h4>
          <ul className="divide-y divide-[#151C33] rounded-xl border border-[#1E2747]">
            {results.folders?.map((d) => <li key={d.id}><button onClick={() => onOpenFolder(d)} className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-[#E1E6F5] hover:bg-white/[0.03]"><FileIcon folder /><span className="truncate">{d.path}</span></button></li>)}
            {results.files?.map((f) => <li key={f.id}><button onClick={() => onOpenFile(f)} className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-[#E1E6F5] hover:bg-white/[0.03]"><FileIcon extension={f.extension} /><span className="flex-1 truncate">{f.path}</span><StatusBadge status={f.indexing.status} /></button></li>)}
          </ul>
        </div>
      )}
      {!!results.content?.length && (
        <div>
          <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-[#6C789E]">Inside files {results.method === 'hybrid' ? '(semantic + keyword)' : '(keyword)'}</h4>
          <ul className="space-y-2">
            {results.content.map((c, i) => (
              <li key={`${c.fileId}-${i}`} className="rounded-xl border border-[#1E2747] bg-[#0B1020] p-3">
                <p className="flex items-center gap-2 text-xs font-semibold text-[#7CC4EE]"><FileIcon extension={c.name?.split('.').pop()} size={14} /><span className="truncate">{c.path}</span>{c.page && <span className="text-[#6C789E]">p. {c.page}</span>}{c.slide && <span className="text-[#6C789E]">slide {c.slide}</span>}{c.sheet && <span className="text-[#6C789E]">{c.sheet}</span>}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-[#D6DCF0]">{c.excerpt}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function UploadTray({ jobs, onDismiss }: { jobs: UploadJob[]; onDismiss: (id: number) => void }) {
  if (!jobs.length) return null;
  return (
    <div className="fixed bottom-4 right-4 z-[60] w-[min(380px,calc(100vw-2rem))] space-y-2" aria-live="polite">
      {jobs.map((j) => {
        const rejected = j.result?.results.filter((r) => r.status === 'rejected') ?? [];
        return (
          <div key={j.id} className={`${kx.panel} bg-[#11172A] p-3.5`}>
            <div className="flex items-start gap-2.5">
              {j.state === 'uploading' ? <Loader2 size={18} className="mt-0.5 animate-spin text-[#3FA7E0]" /> : j.state === 'done' ? <UploadCloud size={18} className="mt-0.5 text-[#6FD6A2]" /> : <X size={18} className="mt-0.5 text-[#FF8798]" />}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-white">{j.label}</p>
                <p className="text-xs text-[#9AA6C9]">
                  {j.state === 'uploading' ? `Uploading ${j.count} file${j.count === 1 ? '' : 's'} · ${Math.round(j.progress * 100)}%`
                    : j.state === 'failed' ? j.error
                      : Object.entries(j.result?.summary ?? {}).filter(([, v]) => v).map(([k, v]) => `${v} ${k}`).join(' · ') || 'Done'}
                </p>
              </div>
              {j.state !== 'uploading' && <button onClick={() => onDismiss(j.id)} aria-label="Dismiss" className="rounded p-1 text-[#6C789E] hover:text-white"><X size={14} /></button>}
            </div>
            {j.state === 'uploading' && <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-[#1A2240]"><div className="h-full rounded-full bg-gradient-to-r from-[#3FA7E0] to-[#60C0F3] transition-[width] duration-200" style={{ width: `${Math.max(2, j.progress * 100)}%` }} /></div>}
            {!!rejected.length && (
              <details className="mt-2 text-xs text-[#FF8798]"><summary className="cursor-pointer">{rejected.length} rejected — see why</summary>
                <ul className="mt-1.5 max-h-32 space-y-1 overflow-auto">{rejected.map((r) => <li key={r.path}><span className="text-[#D6DCF0]">{r.path}</span>: {r.reason}</li>)}</ul>
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ConfirmDialog({ title, body, confirm, danger, requireText, onConfirm, onClose }: { title: string; body: string; confirm: string; danger?: boolean; requireText?: string; onConfirm: () => Promise<void> | void; onClose: () => void }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose} footer={<>
      <button className={`${kx.btn} ${kx.ghost}`} onClick={onClose}>Cancel</button>
      <button className={`${kx.btn} ${danger ? 'bg-[#E5586B] text-white hover:bg-[#F06A7C]' : kx.primary}`} disabled={busy || (!!requireText && typed !== requireText)}
        onClick={async () => { setBusy(true); try { await onConfirm(); onClose(); } finally { setBusy(false); } }}>{busy && <Loader2 size={14} className="animate-spin" />}{confirm}</button>
    </>}>
      <p className="text-sm leading-relaxed text-[#B7C1DE]">{body}</p>
      {requireText && (
        <label className="mt-4 block space-y-2">
          <span className="text-xs text-[#9AA6C9]">Type <b className="text-white">{requireText}</b> to confirm</span>
          <input className={kx.input} value={typed} onChange={(e) => setTyped(e.target.value)} />
        </label>
      )}
    </Modal>
  );
}

function MoveDialog({ tree, childrenOf, exclude, onMove, onClose }: { tree: RepoTree; childrenOf: Map<string | null, RepoTree['directories']>; exclude: Set<string>; onMove: (target: string | null) => Promise<void> | void; onClose: () => void }) {
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const Level = ({ parent, depth }: { parent: string | null; depth: number }) => (
    <>
      {(childrenOf.get(parent) ?? []).filter((d) => !exclude.has(d.id)).map((d) => (
        <div key={d.id}>
          <button onClick={() => setTarget(d.id)} className={`flex w-full items-center gap-2 rounded-lg py-1.5 pr-2 text-left text-sm ${target === d.id ? 'bg-[#3FA7E0]/15 text-white' : 'text-[#B7C1DE] hover:bg-white/[0.04]'}`} style={{ paddingLeft: depth * 16 + 8 }}>
            <FileIcon folder size={15} /><span className="truncate">{d.name}</span>
          </button>
          <Level parent={d.id} depth={depth + 1} />
        </div>
      ))}
    </>
  );
  return (
    <Modal title="Move to folder" onClose={onClose} footer={<>
      <button className={`${kx.btn} ${kx.ghost}`} onClick={onClose}>Cancel</button>
      <button className={`${kx.btn} ${kx.primary}`} disabled={busy} onClick={async () => { setBusy(true); try { await onMove(target); onClose(); } finally { setBusy(false); } }}>{busy && <Loader2 size={14} className="animate-spin" />}Move here</button>
    </>}>
      <div className="max-h-[50vh] overflow-auto rounded-xl border border-[#1E2747] p-1.5">
        <button onClick={() => setTarget(null)} className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm font-semibold ${target === null ? 'bg-[#3FA7E0]/15 text-white' : 'text-[#B7C1DE] hover:bg-white/[0.04]'}`}>
          <Database size={15} className="text-[#6FD6A2]" />{tree.repository.name} (top level)
        </button>
        <Level parent={null} depth={1} />
      </div>
    </Modal>
  );
}
