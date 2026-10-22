import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Brain, Check, Loader2, Lock, MessageSquareText, Pencil, Plus, Search, Sparkles, Trash2, UserRound, X } from 'lucide-react';
import { authFetch } from '../../utils/authFetch';

/**
 * Settings → Memory. Bwenge remembers facts, preferences and past topics across every chat (web and Telegram).
 * Free and GO plans see what memory does and an upgrade call to action; the switch only turns on with PRO
 * or Institution. Memories can always be reviewed and deleted.
 */

type Kind = 'fact' | 'preference' | 'note' | 'episode';
interface Item { id: string; content: string; kind: Kind; source: 'user' | 'auto' | 'assistant' | 'chat'; createdAt: string; updatedAt?: string }
interface MemoryData {
  available: boolean; enabled: boolean; plan: string; count: number; capacity: number;
  items: Item[]; total: number;
  pro: { priceUsd: number; listPriceUsd: number | null; priceRwf: number };
}

const KIND: Record<Kind, { label: string; tone: string }> = {
  fact: { label: 'Fact', tone: 'bg-sky-500/12 text-sky-400' },
  preference: { label: 'Preference', tone: 'bg-violet-500/12 text-violet-400' },
  note: { label: 'Note', tone: 'bg-amber-500/12 text-amber-400' },
  episode: { label: 'Conversation', tone: 'bg-emerald-500/12 text-emerald-400' },
};
const SOURCE: Record<Item['source'], string> = { user: 'You saved this', auto: 'Learned from a chat', assistant: 'Saved by Bwenge', chat: 'From a past chat' };
const FILTERS: Array<{ id: 'all' | Kind; label: string }> = [{ id: 'all', label: 'All' }, { id: 'fact', label: 'Facts' }, { id: 'preference', label: 'Preferences' }, { id: 'note', label: 'Notes' }, { id: 'episode', label: 'Conversations' }];

export default function MemorySection() {
  const [data, setData] = useState<MemoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<'all' | Kind>('all');
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await authFetch('/api/memory?limit=500');
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not load memory.');
      setData(body);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load memory.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const call = async (url: string, init: RequestInit) => {
    setBusy(true);
    try {
      const res = await authFetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
      const body = await res.json().catch(() => ({}));
      if (res.status === 402) { window.location.href = body.upgrade?.url ?? '/upgrade?reason=memory'; return false; }
      if (!res.ok) throw new Error(body.error || 'Something went wrong.');
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.items ?? []).filter((i) => (filter === 'all' || i.kind === filter) && (!q || i.content.toLowerCase().includes(q)));
  }, [data, filter, query]);

  if (loading) return <div className="flex items-center justify-center gap-2 py-12 text-sm text-[var(--muted)]"><Loader2 size={18} className="animate-spin text-[var(--accent)]" /> Loading memory…</div>;
  if (!data) return <div className="space-y-3"><h2 className="text-xl text-[var(--text)]">Memory</h2><p role="alert" className="text-sm text-[var(--danger)]">{error}</p></div>;

  const locked = !data.available;
  const pct = data.capacity ? Math.min(100, (data.count / data.capacity) * 100) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-['Georgia',serif] text-xl font-normal text-[var(--text)]">Memory</h2>
        <p className="mt-0.5 text-xs text-[var(--muted)]">Bwenge remembers who you are, how you like answers and what you worked on, across all your chats on the web and in Telegram.</p>
      </div>

      {/* Switch */}
      <div className={`rounded-2xl border p-5 shadow-sm ${locked ? 'border-[var(--accent)]/30 bg-[var(--accent)]/[0.05]' : 'border-[var(--line)] bg-[var(--surface)]'}`}>
        <div className="flex items-start gap-4">
          <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${locked ? 'bg-[var(--accent)]/15 text-[var(--accent)]' : 'bg-violet-500/12 text-violet-400'}`}><Brain size={20} /></span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
                  Memory across all chats
                  {locked && <span className="inline-flex items-center gap-1 rounded-full bg-[var(--accent)]/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--accent)]"><Lock size={10} /> PRO</span>}
                </div>
                <p className="mt-0.5 text-xs text-[var(--muted)]">
                  {locked ? 'Upgrade to PRO to turn memory on.' : data.enabled ? 'On. New chats use what Bwenge remembers.' : 'Off. Bwenge does not save or use memories.'}
                </p>
              </div>
              <button
                type="button" role="switch" aria-checked={data.enabled} aria-label="Memory across all chats" disabled={busy}
                onClick={() => (locked ? (window.location.href = '/upgrade?reason=memory') : void call('/api/memory/settings', { method: 'PATCH', body: JSON.stringify({ enabled: !data.enabled }) }))}
                title={locked ? 'Upgrade to PRO to turn memory on' : undefined}
                className={`relative h-7 w-12 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${data.enabled ? 'bg-violet-500' : 'bg-[var(--line)]'} ${locked ? 'opacity-70' : ''}`}
              >
                <span className={`absolute top-1 grid h-5 w-5 place-items-center rounded-full bg-white shadow transition-all ${data.enabled ? 'left-6' : 'left-1'}`}>{locked && <Lock size={10} className="text-neutral-500" />}</span>
              </button>
            </div>

            {locked && (
              <div className="mt-4 space-y-4">
                <ul className="grid grid-cols-1 gap-2 text-xs text-[var(--text)] sm:grid-cols-2">
                  {[
                    'Remembers your name, role, school and subjects',
                    'Keeps your preferred language and answer style',
                    'Recalls past topics: "as we discussed last week"',
                    'Works on the web and in Telegram, up to 2,000 memories',
                  ].map((t) => <li key={t} className="flex items-start gap-2"><Check size={14} className="mt-0.5 shrink-0 text-[var(--teal)]" /> {t}</li>)}
                </ul>
                <a href="/upgrade?reason=memory" className="inline-flex items-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[var(--on-accent)] hover:opacity-90">
                  <Sparkles size={15} /> Upgrade to PRO
                  <span className="font-normal opacity-90">{data.pro.listPriceUsd ? <span className="line-through">${data.pro.listPriceUsd}</span> : null} ${data.pro.priceUsd}/month · ≈ {data.pro.priceRwf.toLocaleString('en-US')} RWF</span>
                  <ArrowUpRight size={15} />
                </a>
              </div>
            )}

            {!locked && (
              <div className="mt-4">
                <div className="mb-1 flex justify-between text-[11px] text-[var(--muted)]"><span>{data.count.toLocaleString('en-US')} of {data.capacity.toLocaleString('en-US')} memories</span><span>Oldest conversation notes are replaced first</span></div>
                <div className="h-1.5 overflow-hidden rounded-full bg-[var(--bg)]"><div className="h-full rounded-full bg-violet-500" style={{ width: `${Math.max(pct, data.count ? 1 : 0)}%` }} /></div>
              </div>
            )}
          </div>
        </div>
      </div>

      {error && <p role="alert" className="rounded-xl border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-3 py-2 text-xs text-[var(--danger)]">{error}</p>}

      {/* Add */}
      {!locked && (
        <form
          className="flex flex-col gap-2 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 shadow-sm sm:flex-row"
          onSubmit={(e) => { e.preventDefault(); if (draft.trim().length >= 3) void call('/api/memory', { method: 'POST', body: JSON.stringify({ content: draft.trim() }) }).then((ok) => ok && setDraft('')); }}
        >
          <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={500} placeholder='Add a memory, e.g. "I teach S3 physics at Lycée de Kigali"' aria-label="New memory"
            className="min-w-0 flex-1 rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 py-2.5 text-sm text-[var(--text)] placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:outline-none" />
          <button type="submit" disabled={busy || draft.trim().length < 3} className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[var(--on-accent)] disabled:opacity-50"><Plus size={15} /> Remember</button>
        </form>
      )}

      {/* List */}
      {(data.total > 0 || !locked) && (
        <div className="space-y-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Memory type">
              {FILTERS.map((f) => (
                <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} onClick={() => setFilter(f.id)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${filter === f.id ? 'bg-[var(--text)] text-[var(--bg)]' : 'bg-[var(--bg)] text-[var(--muted)] hover:text-[var(--text)]'}`}>{f.label}</button>
              ))}
            </div>
            <label className="flex h-9 items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 text-[var(--muted)] focus-within:border-[var(--accent)]">
              <Search size={14} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search memories" aria-label="Search memories" className="w-full min-w-0 bg-transparent text-xs text-[var(--text)] focus:outline-none sm:w-44" />
            </label>
          </div>

          {items.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--line)] px-4 py-8 text-center">
              <MessageSquareText size={20} className="mx-auto mb-2 text-[var(--muted)]" />
              <p className="text-sm text-[var(--text)]">{data.total ? 'No memories match.' : 'No memories yet'}</p>
              {!data.total && <p className="mt-1 text-xs text-[var(--muted)]">Chat as usual, or say "Remember that…". Bwenge saves what will help in future chats.</p>}
            </div>
          ) : (
            <ul className="divide-y divide-[var(--line)] overflow-hidden rounded-xl border border-[var(--line)]">
              {items.map((m) => (
                <li key={m.id} className="group flex items-start gap-3 bg-[var(--surface)] p-3">
                  <span className={`mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${KIND[m.kind].tone}`}>{KIND[m.kind].label}</span>
                  <div className="min-w-0 flex-1">
                    {editing?.id === m.id ? (
                      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void call(`/api/memory/${m.id}`, { method: 'PATCH', body: JSON.stringify({ content: editing.text }) }).then((ok) => ok && setEditing(null)); }}>
                        <input autoFocus value={editing.text} onChange={(e) => setEditing({ id: m.id, text: e.target.value })} maxLength={500} aria-label="Edit memory"
                          className="min-w-0 flex-1 rounded-lg border border-[var(--accent)] bg-[var(--bg)] px-2 py-1.5 text-sm text-[var(--text)] focus:outline-none" />
                        <button type="submit" aria-label="Save" className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--accent)] text-[var(--on-accent)]"><Check size={14} /></button>
                        <button type="button" aria-label="Cancel" onClick={() => setEditing(null)} className="grid h-8 w-8 place-items-center rounded-lg border border-[var(--line)] text-[var(--muted)]"><X size={14} /></button>
                      </form>
                    ) : (
                      <p className="break-words text-sm text-[var(--text)]">{m.content}</p>
                    )}
                    <p className="mt-1 flex items-center gap-1.5 text-[11px] text-[var(--muted)]">
                      <UserRound size={11} /> {SOURCE[m.source] ?? 'Saved'} · {new Date(m.updatedAt ?? m.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                  </div>
                  {editing?.id !== m.id && (
                    <div className="flex shrink-0 gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                      {!locked && <button type="button" aria-label="Edit memory" onClick={() => setEditing({ id: m.id, text: m.content })} className="grid h-8 w-8 place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"><Pencil size={14} /></button>}
                      <button type="button" aria-label="Delete memory" onClick={() => void call(`/api/memory/${m.id}`, { method: 'DELETE' })} className="grid h-8 w-8 place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--danger)]/10 hover:text-[var(--danger)]"><Trash2 size={14} /></button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {data.total > 0 && (
            <div className="flex justify-end">
              {confirmClear ? (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-[var(--muted)]">Delete all {data.total} memories?</span>
                  <button type="button" onClick={() => void call('/api/memory', { method: 'DELETE' }).then(() => setConfirmClear(false))} className="rounded-lg bg-[var(--danger)] px-3 py-1.5 font-semibold text-white">Delete all</button>
                  <button type="button" onClick={() => setConfirmClear(false)} className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-[var(--text)]">Cancel</button>
                </div>
              ) : (
                <button type="button" onClick={() => setConfirmClear(true)} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-[var(--danger)] hover:bg-[var(--danger)]/10"><Trash2 size={13} /> Delete all memories</button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
