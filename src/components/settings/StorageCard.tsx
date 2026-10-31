import { useEffect, useState } from 'react';
import { ArrowUpRight, FileText, HardDrive, Image as ImageIcon, Loader2, Trash2 } from 'lucide-react';
import { authFetch } from '../../utils/authFetch';

/**
 * Settings → Usage → Storage: how much of the plan's storage is used, the largest files, and deleting what is no
 * longer needed. Files a task still shows are freed from Tasks (removing a hand-in or the task).
 */

interface StoredFile { id: string; name: string; mime: string; size: number; createdAt: string; inTask: boolean }
interface Storage { usedMb: number; usedBytes?: number; limitMb: number; fileCount: number; files: StoredFile[] }

const label = (mb: number) => (mb >= 1024 ? `${Math.round((mb / 1024) * 10) / 10} GB` : `${Math.round(mb * 10) / 10} MB`);
const size = (b: number) => (b < 1048576 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1048576).toFixed(1)} MB`);

export default function StorageCard({ canUpgrade }: { canUpgrade: boolean }) {
  const [data, setData] = useState<Storage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = async () => {
    try {
      const r = await authFetch('/api/storage');
      const b = await r.json();
      if (!r.ok) throw new Error(b.error || 'Could not read your storage.');
      setData(b);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not read your storage.'); }
  };
  useEffect(() => { void load(); }, []);

  const remove = async (f: StoredFile) => {
    if (!window.confirm(`Delete ${f.name}? It can't be brought back.`)) return;
    setBusy(f.id);
    try {
      const r = await authFetch(`/api/storage/files/${f.id}`, { method: 'DELETE' });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b.error || 'Could not delete the file.');
      setData((d) => d && { ...d, usedMb: b.usedMb, usedBytes: b.usedBytes, fileCount: b.files, files: d.files.filter((x) => x.id !== f.id) });
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not delete the file.'); }
    finally { setBusy(null); }
  };

  const pct = data && data.limitMb ? Math.min(100, (data.usedMb / data.limitMb) * 100) : 0;
  const tone = pct >= 100 ? 'bg-[var(--danger)]' : pct >= 80 ? 'bg-[var(--accent)]' : 'bg-[var(--teal)]';
  const list = data ? (showAll ? data.files : data.files.slice(0, 6)) : [];

  return (
    <div className="space-y-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex flex-1 items-center gap-2 text-sm font-medium text-[var(--text)]"><HardDrive size={15} className="text-[var(--accent)]" />Storage</h3>
        {canUpgrade && <a href="/upgrade?reason=storage" className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:underline">Get more storage<ArrowUpRight size={13} /></a>}
      </div>
      {!data ? (error ? <p className="text-xs text-[var(--danger)]">{error}</p> : <div className="flex justify-center py-4 text-[var(--muted)]"><Loader2 size={16} className="animate-spin" /></div>) : (
        <>
          <div>
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="text-[var(--text)]"><span className="text-base font-semibold tabular-nums">{data.usedBytes !== undefined && data.usedBytes < 1048576 ? (data.usedBytes ? size(data.usedBytes) : '0 KB') : label(data.usedMb)}</span> <span className="text-[var(--muted)]">of {label(data.limitMb)} used</span></span>
              <span className="text-[var(--muted)] tabular-nums">{data.fileCount.toLocaleString('en-US')} file{data.fileCount === 1 ? '' : 's'}</span>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[var(--bg)]" role="progressbar" aria-label="Storage used" aria-valuemin={0} aria-valuemax={data.limitMb} aria-valuenow={data.usedMb}>
              <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(pct, data.usedMb > 0 ? 2 : 0)}%` }} />
            </div>
            <p className="mt-2 text-[11.5px] text-[var(--muted)]">Your uploads, the files you share in tasks and everything students hand in count here.{pct >= 100 ? ' Storage is full: new files are refused until you delete some or move to a bigger plan.' : ''}</p>
          </div>
          {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
          {data.files.length > 0 && (
            <div>
              <p className="mb-1.5 text-[11.5px] font-medium uppercase tracking-wide text-[var(--muted)]">Largest files</p>
              <ul className="divide-y divide-[var(--line)] overflow-hidden rounded-xl border border-[var(--line)]">
                {list.map((f) => (
                  <li key={f.id} className="flex items-center gap-3 px-3 py-2 text-xs">
                    {f.mime.startsWith('image/') ? <ImageIcon size={15} className="shrink-0 text-[var(--muted)]" /> : <FileText size={15} className="shrink-0 text-[var(--muted)]" />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-[var(--text)]">{f.name}</span>
                      <span className="text-[var(--muted)]">{size(f.size)} · {new Date(f.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}{f.inTask ? ' · in a task' : ''}</span>
                    </span>
                    {f.inTask ? <a href="/tasks" className="shrink-0 rounded-lg px-2 py-1 text-[var(--accent)] hover:bg-[var(--surface-2)]">Open Tasks</a>
                      : <button type="button" onClick={() => void remove(f)} disabled={busy === f.id} aria-label={`Delete ${f.name}`} className="shrink-0 rounded-lg p-1.5 text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--danger)] disabled:opacity-40">{busy === f.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}</button>}
                  </li>
                ))}
              </ul>
              {data.files.length > 6 && <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-2 text-xs font-medium text-[var(--accent)] hover:underline">{showAll ? 'Show fewer' : `Show ${data.files.length - 6} more`}</button>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
