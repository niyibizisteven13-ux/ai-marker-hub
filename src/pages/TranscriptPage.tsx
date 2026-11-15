import { useEffect, useState } from 'react';
import { Check, ExternalLink, Loader2, Lock, Printer } from 'lucide-react';
import { getApiUrl } from '../utils/authFetch';
import logoUrl from '../assets/bwenge-logo.svg';

/** A student's private transcript (the link is the key; no account). Prints cleanly, so "Save as PDF" gives a proper document. */
interface Row { kind: 'task' | 'quiz'; title: string; status: 'released' | 'pending' | 'handed_in' | 'none'; percent: number | null; label: string; link: string | null }
interface Data { className: string; student: { name: string; studentId: string | null }; rows: Row[]; average: number | null; releasedCount: number; generatedAt: string }

const band = (p: number) => (p >= 70 ? 'text-emerald-700' : p >= 50 ? 'text-amber-700' : 'text-rose-700');

export default function TranscriptPage({ token }: { token: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    document.title = 'Transcript · Bwenge';
    fetch(getApiUrl(`/api/transcripts/public/${encodeURIComponent(token)}`))
      .then(async (r) => { const b = await r.json().catch(() => ({})); if (!r.ok) throw new Error(b.error || 'This transcript link is not valid.'); setData(b); })
      .catch((e) => setError(e instanceof Error ? e.message : 'This transcript link is not valid.'));
  }, [token]);

  if (error) return (
    <div className="grid min-h-[100dvh] place-items-center bg-slate-50 px-4">
      <div className="max-w-sm rounded-2xl bg-white p-6 text-center shadow-sm"><Lock className="mx-auto text-slate-400" /><p className="mt-3 font-semibold text-slate-900">This link does not work</p><p className="mt-1 text-sm text-slate-500">{error} Ask your lecturer for your link again.</p></div>
    </div>
  );
  if (!data) return <div className="grid min-h-[100dvh] place-items-center bg-slate-50 text-slate-400"><Loader2 className="animate-spin" /></div>;

  const date = new Date(data.generatedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  return (
    <div className="min-h-[100dvh] bg-slate-50 px-3 py-6 text-slate-900 print:bg-white print:p-0">
      <main className="mx-auto max-w-3xl rounded-2xl bg-white p-5 shadow-sm sm:p-8 print:max-w-none print:rounded-none print:p-0 print:shadow-none">
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
          <div className="flex items-center gap-3">
            <img src={logoUrl} alt="" className="h-10 w-10 rounded-lg object-contain" />
            <div><p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Bwenge</p><h1 className="text-xl font-bold leading-tight sm:text-2xl">Student transcript</h1></div>
          </div>
          <button type="button" onClick={() => window.print()} className="flex min-h-10 items-center gap-2 rounded-xl border border-slate-300 px-3.5 text-sm font-semibold hover:bg-slate-50 print:hidden"><Printer size={15} />Print or save as PDF</button>
        </header>

        <section className="grid gap-x-8 gap-y-1 py-4 text-sm sm:grid-cols-2">
          <p><span className="text-slate-500">Student: </span><b>{data.student.name}</b></p>
          <p><span className="text-slate-500">Registration number: </span><b>{data.student.studentId ?? 'not given'}</b></p>
          <p><span className="text-slate-500">Class: </span><b>{data.className}</b></p>
          <p><span className="text-slate-500">Date: </span><b>{date}</b></p>
        </section>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead><tr className="border-y border-slate-300 bg-slate-50 text-xs uppercase tracking-wide text-slate-500 print:bg-transparent"><th className="py-2 pr-3">Test or task</th><th className="py-2 pr-3">Type</th><th className="py-2 pr-3">Mark</th><th className="py-2 text-right">Percent</th></tr></thead>
            <tbody>
              {data.rows.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-slate-500">Nothing has been added to this class yet.</td></tr>}
              {data.rows.map((r, i) => (
                <tr key={i} className="border-b border-slate-100 align-top">
                  <td className="py-2.5 pr-3 font-medium">{r.title}{r.link && <a href={r.link} className="ml-2 inline-flex items-center gap-1 text-xs font-semibold text-slate-600 underline print:hidden"><ExternalLink size={11} />Corrections</a>}</td>
                  <td className="py-2.5 pr-3 text-slate-500">{r.kind === 'quiz' ? 'Quiz' : 'Task'}</td>
                  <td className={`py-2.5 pr-3 ${r.status === 'released' ? '' : 'text-slate-400'}`}>{r.status === 'released' ? r.label : r.label}</td>
                  <td className={`py-2.5 text-right font-semibold tabular-nums ${r.percent !== null ? band(r.percent) : 'text-slate-300'}`}>{r.percent !== null ? `${r.percent}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
            {data.rows.length > 0 && (
              <tfoot><tr className="border-t-2 border-slate-300"><td colSpan={3} className="py-3 font-bold">Average of released marks ({data.releasedCount})</td><td className={`py-3 text-right text-base font-bold tabular-nums ${data.average !== null ? band(data.average) : 'text-slate-300'}`}>{data.average !== null ? `${data.average}%` : '—'}</td></tr></tfoot>
            )}
          </table>
        </div>
        <p className="mt-6 flex items-start gap-2 text-xs leading-relaxed text-slate-500"><Check size={13} className="mt-0.5 shrink-0" />This transcript lists only the marks your lecturer has released. Marks still being marked or reviewed appear when they are released. Keep this link private: anyone with it can see your marks.</p>
      </main>
    </div>
  );
}
