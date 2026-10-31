import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, FileText, Loader2 } from 'lucide-react';
import { authFetch } from '../utils/authFetch';
import { FileThumb, PreviewDialog, type PreviewSource } from './FilePreview';

/**
 * Every response to a form, one at a time (newest first, ← and → to move), each answer under its question.
 * Files people attached open in place, full screen, without downloading.
 */

type Question = { id: string; title?: string; label?: string; type?: string };
type Response = { id: string; submittedAt: string; answers: Record<string, unknown> };
type FileValue = { name?: string; size?: number; url?: string; type?: string };

const isFile = (v: unknown): v is FileValue => !!v && typeof v === 'object' && typeof (v as FileValue).url === 'string' && typeof (v as FileValue).name === 'string';
const mimeOf = (f: FileValue) => f.type || (/^data:([^;,]+)/.exec(f.url ?? '')?.[1] ?? '');
const show = (v: unknown): string => (v === null || v === undefined || v === '' ? '' : Array.isArray(v) ? v.map(show).filter(Boolean).join(', ') : typeof v === 'object' ? Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k}: ${show(x)}`).join(' · ') : String(v));

export default function FormResponses({ formId, questions }: { formId: string; questions: Question[] }) {
  const [rows, setRows] = useState<Response[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [i, setI] = useState(0);
  const [preview, setPreview] = useState<PreviewSource | null>(null);

  useEffect(() => {
    authFetch(`/api/forms/${encodeURIComponent(formId)}/responses`).then(async (r) => {
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b.error || 'Could not load the responses.');
      setRows(b.submissions ?? []);
    }).catch((e) => setError(e instanceof Error ? e.message : 'Could not load the responses.'));
  }, [formId]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (preview || (e.target as HTMLElement)?.closest?.('input, textarea, select')) return;
      if (e.key === 'ArrowRight') setI((x) => Math.min((rows?.length ?? 1) - 1, x + 1));
      if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [rows, preview]);

  const titleOf = useMemo(() => new Map(questions.map((q) => [q.id, q.title || q.label || q.id])), [questions]);
  if (error) return <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>;
  if (!rows) return <div className="flex justify-center py-8 text-[#5F6368]"><Loader2 className="animate-spin" /></div>;
  if (!rows.length) return null;
  const r = rows[Math.min(i, rows.length - 1)];
  const order = [...questions.map((q) => q.id), ...Object.keys(r.answers).filter((k) => !titleOf.has(k))];

  return (
    <section className="rounded-2xl border border-[#E0E0E0] bg-white p-5" aria-label="Individual responses">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex-1 font-semibold">Individual responses</h3>
        <button type="button" disabled={i === 0} onClick={() => setI(i - 1)} className="grid h-8 w-8 place-items-center rounded-lg border border-[#DADCE0] disabled:opacity-30" aria-label="Newer response"><ChevronLeft size={16} /></button>
        <span className="min-w-[5.5rem] text-center text-sm tabular-nums text-[#5F6368]">{i + 1} of {rows.length}</span>
        <button type="button" disabled={i >= rows.length - 1} onClick={() => setI(i + 1)} className="grid h-8 w-8 place-items-center rounded-lg border border-[#DADCE0] disabled:opacity-30" aria-label="Older response"><ChevronRight size={16} /></button>
      </div>
      <p className="mt-1 text-xs text-[#5F6368]">Sent {new Date(r.submittedAt).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
      <dl className="mt-4 space-y-3">
        {order.filter((id) => r.answers[id] !== undefined).map((id) => {
          const v = r.answers[id];
          const files = (Array.isArray(v) ? v : [v]).filter(isFile);
          return (
            <div key={id} className="rounded-xl border border-[#F1F3F4] bg-[#F8F9FA] px-4 py-3">
              <dt className="text-xs font-medium text-[#5F6368]">{titleOf.get(id) ?? id}</dt>
              {files.length ? (
                <dd className="mt-2 flex flex-wrap gap-2">
                  {files.map((f, k) => {
                    const stored = /^\/api\/files\/([0-9a-f-]{36})$/i.exec(f.url ?? '')?.[1];
                    const src: PreviewSource = stored ? { name: f.name ?? 'file', type: mimeOf(f), storedFileId: stored } : { name: f.name ?? 'file', type: mimeOf(f), url: f.url };
                    return (
                      <button key={k} type="button" onClick={() => setPreview(src)} className="w-28 overflow-hidden rounded-lg border border-[#DADCE0] bg-white text-left hover:border-[#D97757]" title={`Open ${src.name}`}>
                        <FileThumb src={src} className="h-20 w-full" />
                        <span className="flex items-center gap-1 truncate px-2 py-1 text-[11px] text-[#3C4043]"><FileText size={11} className="shrink-0" />{src.name}</span>
                      </button>
                    );
                  })}
                </dd>
              ) : <dd className="mt-1 whitespace-pre-wrap text-sm text-[#202124]">{show(v) || '—'}</dd>}
            </div>
          );
        })}
      </dl>
      {preview && <PreviewDialog src={preview} onClose={() => setPreview(null)} />}
    </section>
  );
}
