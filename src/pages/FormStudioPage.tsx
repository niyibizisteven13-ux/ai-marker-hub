import { useCallback, useEffect, useRef, useState } from 'react';
import FormResponses from '../components/FormResponses';
import { AlertTriangle, ArrowLeft, CircleCheck, Download, Loader2 } from 'lucide-react';
import FormBuilder from '../components/FormBuilder';
import AskBwengeDrawer from '../components/AskBwengeDrawer';
import { authFetch } from '../utils/authFetch';

/**
 * The owner's page for one form: the builder, the results (readiness review, per-question summaries, data
 * dictionary, CSV) and "Ask Bwenge" beside them, so a change asked in plain words lands in the open form.
 */

type Finding = { level: 'critical' | 'error' | 'warning' | 'suggestion'; area: string; question?: string; finding: string; recommendation: string };
type Studio = {
  form: { id: string; title: string; schema: any; open: boolean; updatedAt: string };
  links: { fill: string; edit: string; results: string };
  responses: number;
  review: { score: number; ready: boolean; findings: Finding[]; questions: number; sections: number };
  versions: Array<{ version: number; createdAt: string }>;
  codebook: Array<{ variable: string; question: string; type: string; measurement: string; required: boolean; values: string; shownWhen: string }>;
  summaries: any[];
};

const api = (path: string, init: RequestInit = {}) => authFetch(`/api/forms${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
const levelTone: Record<Finding['level'], string> = { critical: 'bg-rose-50 text-rose-700 border-rose-200', error: 'bg-orange-50 text-orange-700 border-orange-200', warning: 'bg-amber-50 text-amber-800 border-amber-200', suggestion: 'bg-[#F1F3F4] text-[#3C4043] border-[#E0E0E0]' };

function SummaryCard({ s }: { s: any }) {
  const cov = s.coverage;
  return (
    <div className="rounded-2xl border border-[#E0E0E0] bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[15px] font-medium text-[#202124]">{s.question}</p>
        <code className="shrink-0 rounded bg-[#F1F3F4] px-1.5 py-0.5 text-[11px] text-[#5F6368]">{s.variable}</code>
      </div>
      <p className="mt-1 text-xs text-[#5F6368]">{cov.answered} answered{cov.skipped ? ` · ${cov.skipped} skipped` : ''}{cov.notShown ? ` · ${cov.notShown} not shown (branching)` : ''}</p>
      {s.kind === 'categorical' && (
        <div className="mt-3 space-y-1.5">
          {s.table.map((r: any) => (
            <div key={r.value} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-sm">
              <div className="min-w-0">
                <div className="truncate text-[#3C4043]">{r.value}</div>
                <div className="mt-0.5 h-1.5 rounded-full bg-[#F1F3F4]"><div className="h-1.5 rounded-full bg-[#D97757]" style={{ width: `${Math.min(100, r.percent)}%` }} /></div>
              </div>
              <span className="tabular-nums text-xs text-[#5F6368]">{r.count} · {r.percent}%</span>
            </div>
          ))}
          {s.median !== undefined && s.median !== null && <p className="pt-1 text-xs text-[#5F6368]">Median {s.median} · mean {s.mean}</p>}
        </div>
      )}
      {s.kind === 'numeric' && (
        <dl className="mt-3 grid grid-cols-3 gap-2 text-sm sm:grid-cols-6">
          {[['n', s.n], ['Mean', s.mean], ['SD', s.sd], ['Median', s.median], ['Min', s.min], ['Max', s.max]].map(([k, v]) => (
            <div key={k as string} className="rounded-lg bg-[#F8F9FA] px-2 py-1.5"><dt className="text-[11px] text-[#5F6368]">{k}</dt><dd className="tabular-nums text-[#202124]">{v ?? '–'}{s.unit && k !== 'n' && v !== null && v !== undefined ? ` ${s.unit}` : ''}</dd></div>
          ))}
        </dl>
      )}
      {s.kind === 'text' && (s.examples.length ? <ul className="mt-3 space-y-1.5 text-sm text-[#3C4043]">{s.examples.map((t: string, i: number) => <li key={i} className="rounded-lg bg-[#F8F9FA] px-3 py-2">{t}</li>)}</ul> : <p className="mt-3 text-sm text-[#5F6368]">No answers yet.</p>)}
      {s.kind === 'date' && <p className="mt-3 text-sm text-[#3C4043]">{s.first ? `From ${s.first} to ${s.last}` : 'No answers yet.'}</p>}
      {s.kind === 'grid' && (
        <div className="mt-3 overflow-x-auto"><table className="w-full text-sm"><tbody>
          {s.rows.map((r: any) => <tr key={r.row} className="border-t border-[#F1F3F4]"><td className="py-1.5 pr-3 text-[#3C4043]">{r.row}</td>{r.table.map((c: any) => <td key={c.value} className="px-2 py-1.5 text-xs text-[#5F6368]">{c.value}: {c.count}</td>)}</tr>)}
        </tbody></table></div>
      )}
    </div>
  );
}

export default function FormStudioPage({ formId, onBack }: { formId: string; onBack: () => void }) {
  const [data, setData] = useState<Studio | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'build' | 'results'>(() => (new URLSearchParams(window.location.search).get('tab') === 'results' ? 'results' : 'build'));
  const [rev, setRev] = useState(0);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const timer = useRef<number | undefined>(undefined);
  const lastSaved = useRef('');
  const primed = useRef(false);

  const load = useCallback(async (remount: boolean) => {
    try {
      const res = await api(`/${formId}/studio`);
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || 'This form could not be loaded.');
      setData(body);
      lastSaved.current = JSON.stringify(body.form.schema);
      if (remount) { primed.current = false; setRev((r) => r + 1); }
    } catch (e) { setError((e as Error).message); }
  }, [formId]);
  useEffect(() => { void load(false); }, [load]);
  useEffect(() => {
    const url = tab === 'results' ? `/forms/${formId}/edit?tab=results` : `/forms/${formId}/edit`;
    window.history.replaceState({}, '', url);
  }, [tab, formId]);

  const save = useCallback(async (schema: any) => {
    const json = JSON.stringify(schema);
    if (json === lastSaved.current) return;
    setSaving('saving');
    const res = await api(`/${formId}/schema`, { method: 'PUT', body: JSON.stringify({ schema }) });
    if (!res.ok) { setSaving('error'); return; }
    lastSaved.current = json;
    const body = await res.json().catch(() => null);
    setData((d) => (d ? { ...d, form: { ...d.form, title: schema.title || d.form.title, schema: { ...d.form.schema, ...schema } }, review: body?.review ?? d.review } : d));
    setSaving('saved');
  }, [formId]);
  const onChange = useCallback((schema: any) => {
    // The builder reports its normalised schema once on mount: that is the saved form, not an edit.
    if (!primed.current) { primed.current = true; lastSaved.current = JSON.stringify(schema); return; }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(schema), 1200);
  }, [save]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const setOpen = async (open: boolean) => {
    const res = await api(`/${formId}/open`, { method: 'POST', body: JSON.stringify({ open }) });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.error || 'The form could not be updated.');
    setData((d) => (d ? { ...d, form: { ...d.form, open } } : d));
    return body;
  };
  const onPublish = async (schema: any) => {
    window.clearTimeout(timer.current);
    await save(schema);
    const body = await setOpen(true);
    void load(false);
    return { shareUrl: body?.links?.fill };
  };

  if (error) {
    return (
      <div className="form-dark h-[100dvh] overflow-y-auto bg-[#F4F4F1] px-4 py-10 text-[#202124]">
        <div className="mx-auto max-w-xl rounded-2xl border border-[#E0E0E0] bg-white p-6">
          <p className="font-semibold">{error}</p>
          <button type="button" onClick={onBack} className="mt-4 inline-flex items-center gap-2 text-sm text-[#5F6368] hover:text-[#202124]"><ArrowLeft size={16} /> Back to workspace</button>
        </div>
      </div>
    );
  }
  if (!data) return <div className="form-dark grid min-h-[100dvh] place-items-center bg-[#F4F4F1]"><Loader2 className="animate-spin text-[#5F6368]" /></div>;

  const { review } = data;
  const critical = review.findings.filter((f) => f.level === 'critical' || f.level === 'error');
  return (
    <div className="form-dark h-[100dvh] overflow-y-auto overscroll-contain bg-[#F4F4F1] text-[#202124]">
      <header className="sticky top-0 z-40 flex flex-wrap items-center gap-2 border-b border-[#E0E0E0] bg-white/95 px-3 py-2 backdrop-blur sm:px-5">
        <button type="button" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full hover:bg-black/5" aria-label="Back"><ArrowLeft size={18} /></button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{data.form.title}</p>
          <p className="truncate text-[11px] text-[#5F6368]">{data.form.open ? 'Accepting responses' : 'Draft · not accepting responses'} · {data.responses} response{data.responses === 1 ? '' : 's'}{saving === 'saving' ? ' · saving…' : saving === 'saved' ? ' · saved' : saving === 'error' ? ' · not saved' : ''}</p>
        </div>
        <nav className="flex rounded-full bg-[#F1F3F4] p-0.5 text-sm">
          {(['build', 'results'] as const).map((t) => (
            <button key={t} type="button" onClick={() => { setTab(t); if (t === 'results') void load(false); }} className={`rounded-full px-4 py-1.5 font-medium ${tab === t ? 'bg-white shadow-sm' : 'text-[#5F6368]'}`}>{t === 'build' ? 'Questions' : `Results${data.responses ? ` (${data.responses})` : ''}`}</button>
          ))}
        </nav>
      </header>

      {tab === 'build' ? (
        <FormBuilder key={`${data.form.id}:${rev}`} initialSchema={data.form.schema} onChange={onChange} onPublish={onPublish}
          onUpdateSettings={async ({ acceptingResponses }) => { await setOpen(acceptingResponses); }}
          shareUrl={data.form.open ? data.links.fill : undefined} onResults={() => { setTab('results'); void load(false); }} />
      ) : (
        <main className="mx-auto max-w-3xl space-y-4 px-4 py-6 pb-28">
          <section className="rounded-2xl border border-[#E0E0E0] bg-white p-5">
            <div className="flex flex-wrap items-center gap-4">
              <div className={`grid h-16 w-16 shrink-0 place-items-center rounded-full text-xl font-semibold ${review.ready ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>{review.score}</div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{review.ready ? 'Ready to collect data' : critical.length ? 'Fix these before publishing' : 'Almost ready'}</p>
                <p className="text-sm text-[#5F6368]">Readiness score out of 100 · {review.questions} questions in {review.sections} section{review.sections === 1 ? '' : 's'}{data.versions.length ? ` · version ${data.versions[data.versions.length - 1].version}` : ''}</p>
              </div>
              {review.ready ? <CircleCheck className="text-emerald-600" /> : <AlertTriangle className="text-amber-600" />}
            </div>
            {review.findings.length > 0 && (
              <ul className="mt-4 space-y-2">
                {review.findings.slice(0, 12).map((f, i) => (
                  <li key={i} className={`rounded-xl border px-3 py-2 text-sm ${levelTone[f.level]}`}>
                    <span className="font-semibold capitalize">{f.level}</span>{f.question ? ` · ${f.question}` : ''}: {f.finding}
                    <div className="mt-0.5 text-xs opacity-90">{f.recommendation}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="flex flex-wrap items-center gap-2">
            <a href={`/api/forms/${formId}/results/export.csv`} className="inline-flex items-center gap-2 rounded-xl border border-[#DADCE0] bg-white px-3.5 py-2 text-sm font-medium hover:bg-[#F8F9FA]"><Download size={15} /> Responses (CSV)</a>
            {data.form.open && <a href={data.links.fill} target="_blank" rel="noreferrer" className="rounded-xl border border-[#DADCE0] bg-white px-3.5 py-2 text-sm font-medium hover:bg-[#F8F9FA]">Open the form</a>}
            <span className="text-xs text-[#5F6368]">For the HTML report and the Excel file with the data dictionary, ask Bwenge.</span>
          </section>

          {data.responses === 0
            ? <p className="rounded-2xl border border-dashed border-[#DADCE0] bg-white p-6 text-center text-sm text-[#5F6368]">No responses yet. {data.form.open ? 'Share the form link to start collecting.' : 'Publish the form to start collecting.'}</p>
            : data.summaries.map((s) => <SummaryCard key={s.variable} s={s} />)}

          {data.responses > 0 && <FormResponses formId={formId} questions={(data.form.schema?.questions ?? data.form.schema?.fields ?? []) as any[]} />}

          <details className="rounded-2xl border border-[#E0E0E0] bg-white p-5">
            <summary className="cursor-pointer font-semibold">Data dictionary ({data.codebook.length} variables)</summary>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="text-xs text-[#5F6368]"><tr><th className="py-2 pr-3">Variable</th><th className="pr-3">Question</th><th className="pr-3">Type</th><th className="pr-3">Level</th><th className="pr-3">Values</th><th>Shown when</th></tr></thead>
                <tbody>{data.codebook.map((c) => <tr key={c.variable} className="border-t border-[#F1F3F4] align-top"><td className="py-2 pr-3 font-mono text-xs">{c.variable}</td><td className="pr-3">{c.question}{c.required ? ' *' : ''}</td><td className="pr-3">{c.type}</td><td className="pr-3">{c.measurement}</td><td className="pr-3 text-xs">{c.values}</td><td className="text-xs">{c.shownWhen}</td></tr>)}</tbody>
              </table>
            </div>
          </details>
        </main>
      )}

      <AskBwengeDrawer surface="form" surfaceId={formId} title={data.form.title} light onDone={() => { window.clearTimeout(timer.current); void load(true); }}
        suggestions={data.responses
          ? ['Analyse the responses', 'Compare satisfaction by faculty', 'Create the HTML report and Excel file', 'Review this form']
          : ['Review this form before I publish it', 'Add a consent statement', 'Add a question about monthly income in RWF', 'Publish the form']} />
    </div>
  );
}
