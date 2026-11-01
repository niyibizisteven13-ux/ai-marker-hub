import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, Check, ClipboardCheck, ExternalLink, FileSignature, Link2, ListChecks, Loader2, MessageSquareHeart, PencilLine, Plus, Sparkles, Trash2, UserPlus, Wand2 } from 'lucide-react';
import { authFetch } from '../utils/authFetch';
import { Card, Empty, PageShell, Stat, StatRow, Toolbar, ghostBtn, iconBtn, primaryBtn, relative } from './workspace/Shell';

/**
 * Forms: every form the user made in one place. Describe a form and the AI writes it, start from a template
 * (consent slip, registration, feedback, quiz) or from blank; share one link; answers arrive with charts and
 * Excel in the form's Results. The editor and the shared page are the existing form studio and public form.
 */

interface FormRow { id: string; title: string; schema: { description?: string; questions?: unknown[]; themeColor?: string; acceptingResponses?: boolean; isQuiz?: boolean }; updatedAt: string; createdAt: string; responseCount: number }

type Q = { id: string; type: string; title: string; required?: boolean; options?: string[]; description?: string; scaleMin?: number; scaleMax?: number };
const TEMPLATES: Array<{ id: string; icon: React.ReactNode; name: string; text: string; form: { title: string; description: string; isQuiz?: boolean; questions: Q[] } }> = [
  { id: 'consent', icon: <FileSignature size={16} />, name: 'Consent slip', text: 'Parent or guardian permission for a trip or activity', form: { title: 'Permission slip', description: 'Please complete and submit before the due date.', questions: [
    { id: 'q1', type: 'short_text', title: "Student's full name", required: true },
    { id: 'q2', type: 'short_text', title: 'Class', required: true },
    { id: 'q3', type: 'multiple_choice', title: 'Do you give permission?', required: true, options: ['Yes, I give permission', 'No'] },
    { id: 'q4', type: 'paragraph', title: 'Allergies, medicine or anything we should know' },
    { id: 'q5', type: 'short_text', title: "Parent or guardian's name and phone number", required: true },
  ] } },
  { id: 'register', icon: <UserPlus size={16} />, name: 'Registration', text: 'Sign-ups for a club, event or course', form: { title: 'Registration', description: 'Register below. We will confirm by phone or email.', questions: [
    { id: 'q1', type: 'short_text', title: 'Full name', required: true },
    { id: 'q2', type: 'short_text', title: 'Phone number or email', required: true },
    { id: 'q3', type: 'multiple_choice', title: 'Which session will you attend?', required: true, options: ['Morning', 'Afternoon'] },
    { id: 'q4', type: 'paragraph', title: 'Anything you would like us to know?' },
  ] } },
  { id: 'feedback', icon: <MessageSquareHeart size={16} />, name: 'Feedback survey', text: 'What learners or parents think of a course', form: { title: 'Course feedback', description: 'Your answers are anonymous and help us improve.', questions: [
    { id: 'q1', type: 'linear_scale', title: 'Overall, how satisfied are you?', required: true, scaleMin: 1, scaleMax: 5 },
    { id: 'q2', type: 'checkbox', title: 'What helped you most?', options: ['Explanations in class', 'Practice questions', 'Group work', 'Notes and handouts'] },
    { id: 'q3', type: 'paragraph', title: 'What should we change?' },
  ] } },
  { id: 'quiz', icon: <ListChecks size={16} />, name: 'Quick quiz', text: 'A short self-marking quiz for a lesson', form: { title: 'Quick quiz', description: 'Answer every question. You will see your score at the end.', isQuiz: true, questions: [
    { id: 'q1', type: 'short_text', title: 'Your name', required: true },
    { id: 'q2', type: 'multiple_choice', title: 'Question 1', required: true, options: ['Option A', 'Option B', 'Option C', 'Option D'] },
    { id: 'q3', type: 'multiple_choice', title: 'Question 2', required: true, options: ['Option A', 'Option B', 'Option C', 'Option D'] },
  ] } },
];

const json = async <T,>(res: Response): Promise<T> => {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status}).`);
  return body as T;
};
const openEditor = (id: string, results = false) => { window.location.href = `/forms/${encodeURIComponent(id)}/edit${results ? '?tab=results' : ''}`; };

export default function FormsPage({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<FormRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'open' | 'closed'>('all');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setRows((await json<{ forms: FormRow[] }>(await authFetch('/api/forms'))).forms); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load your forms.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);

  const accepting = (r: FormRow) => r.schema?.acceptingResponses !== false;
  const shown = useMemo(() => (rows ?? []).filter((r) => (filter === 'all' || (filter === 'open') === accepting(r)) && (!query.trim() || r.title.toLowerCase().includes(query.trim().toLowerCase()))), [rows, filter, query]);
  const totals = useMemo(() => {
    const list = rows ?? [];
    return { forms: list.length, open: list.filter(accepting).length, responses: list.reduce((n, r) => n + (r.responseCount ?? 0), 0), busiest: [...list].sort((a, b) => (b.responseCount ?? 0) - (a.responseCount ?? 0))[0] };
  }, [rows]);

  const createWithAi = async () => {
    if (!prompt.trim()) return;
    setBusy('ai'); setError(null);
    try { openEditor((await json<{ formId: string }>(await authFetch('/api/forms/create-from-chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ description: prompt.trim() }) }))).formId); }
    catch (e) { setError(e instanceof Error ? e.message : 'The AI could not write that form. Try describing it differently.'); setBusy(null); }
  };
  const createFrom = async (key: string, form: { title: string; description: string; isQuiz?: boolean; questions: Q[] }) => {
    setBusy(key); setError(null);
    try { openEditor((await json<{ form: { id: string } }>(await authFetch('/api/forms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) }))).form.id); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not create the form.'); setBusy(null); }
  };
  const copy = async (r: FormRow) => { try { await navigator.clipboard.writeText(new URL(`/forms/${r.id}`, window.location.origin).toString()); setCopied(r.id); window.setTimeout(() => setCopied(null), 1600); } catch { /* clipboard may be blocked */ } };
  const remove = async (r: FormRow) => {
    if (!window.confirm(`Delete "${r.title}" and its ${r.responseCount} response${r.responseCount === 1 ? '' : 's'}? This cannot be undone.`)) return;
    try { await json(await authFetch(`/api/forms/${r.id}`, { method: 'DELETE' })); setRows((cur) => (cur ?? []).filter((x) => x.id !== r.id)); } catch (e) { setError(e instanceof Error ? e.message : 'Could not delete the form.'); }
  };

  const blank = { title: 'Untitled form', description: '', questions: [{ id: 'q1', type: 'short_text', title: 'Your name', required: true }] };
  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto bg-[var(--ws-bg)]">
      <PageShell icon={<ClipboardCheck size={20} />} title="Forms" onBack={onClose} wide
        subtitle="Surveys, registrations, consent slips and quizzes. Share one link; answers arrive here with charts, and download to Excel."
        actions={<button type="button" disabled={!!busy} onClick={() => void createFrom('blank', blank)} className={ghostBtn}>{busy === 'blank' ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}Blank form</button>}>

        <section className="rounded-2xl border border-white/[0.08] bg-gradient-to-br from-[var(--ws-card-hover)] to-[var(--ws-card)] p-4 sm:p-5">
          <p className="flex items-center gap-2 text-[14px] font-semibold text-white"><Wand2 size={16} className="text-[var(--brand-soft)]" />Describe the form, the AI writes it</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void createWithAi(); }} maxLength={600}
              placeholder="e.g. Parent consent for the S4 Biology trip on Friday, with allergies and an emergency contact"
              className="min-w-0 flex-1 rounded-xl border border-white/[0.1] bg-[var(--ws-bg)] px-3.5 py-2.5 text-[14px] text-white placeholder:text-neutral-500 focus:border-[var(--brand)]/60 focus:outline-none" />
            <button type="button" disabled={!prompt.trim() || !!busy} onClick={() => void createWithAi()} className={primaryBtn}>{busy === 'ai' ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}{busy === 'ai' ? 'Writing…' : 'Create with AI'}</button>
          </div>
          <p className="mt-4 text-[11.5px] font-medium uppercase tracking-wide text-neutral-500">Or start from a template</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {TEMPLATES.map((t) => (
              <button key={t.id} type="button" disabled={!!busy} onClick={() => void createFrom(t.id, t.form)} className="flex items-start gap-2.5 rounded-xl border border-white/[0.08] bg-[var(--ws-bg)]/60 p-3 text-left hover:border-white/[0.18] disabled:opacity-50">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/[0.06] text-neutral-200">{busy === t.id ? <Loader2 size={15} className="animate-spin" /> : t.icon}</span>
                <span className="min-w-0"><span className="block text-[13px] font-semibold text-white">{t.name}</span><span className="block text-[12px] leading-snug text-neutral-500">{t.text}</span></span>
              </button>
            ))}
          </div>
        </section>

        {error && <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[13px] text-rose-300">{error}</p>}

        {!rows ? <div className="flex justify-center py-16 text-neutral-400"><Loader2 className="animate-spin" /></div>
          : !rows.length ? <Empty icon={<ClipboardCheck size={22} />} title="No forms yet" text="Describe one above or pick a template. You can change every question before sharing." />
            : (
              <>
                <StatRow>
                  <Stat label="Forms" value={totals.forms} hint={`${totals.open} accepting answers`} />
                  <Stat label="Responses" value={totals.responses} hint="across all forms" />
                  <Stat label="Most answered" value={totals.busiest?.responseCount ?? 0} hint={totals.busiest?.title ?? ''} />
                  <Stat label="Closed" value={totals.forms - totals.open} hint="not taking answers" />
                </StatRow>
                <Toolbar<'all' | 'open' | 'closed'> query={query} onQuery={setQuery} placeholder="Search forms" filter={filter} onFilter={setFilter}
                  filters={[{ id: 'all', label: 'All', count: rows.length }, { id: 'open', label: 'Accepting', count: totals.open }, { id: 'closed', label: 'Closed', count: rows.length - totals.open }]} />
                {!shown.length ? <p className="py-10 text-center text-[13px] text-neutral-500">No form matches.</p> : (
                  <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {shown.map((r) => {
                      const color = /^#[0-9a-f]{6}$/i.test(r.schema?.themeColor ?? '') ? r.schema.themeColor! : '#D97757';
                      const n = r.schema?.questions?.length ?? 0;
                      return (
                        <li key={r.id}>
                          <Card onClick={() => openEditor(r.id)} className="flex h-full flex-col overflow-hidden">
                            <span className="h-1 w-full" style={{ background: color }} />
                            <div className="flex flex-1 flex-col p-4">
                              <div className="flex items-start gap-2">
                                <span className="min-w-0 flex-1 text-[15px] font-semibold leading-snug text-white [overflow-wrap:anywhere]">{r.title}</span>
                                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${accepting(r) ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/10 text-neutral-300'}`}>{accepting(r) ? 'Accepting' : 'Closed'}</span>
                              </div>
                              {r.schema?.description && <p className="mt-1 line-clamp-2 text-[12.5px] text-neutral-400">{r.schema.description.replace(/<[^>]+>/g, '')}</p>}
                              <p className="mt-2 text-[12px] text-neutral-500">{n} question{n === 1 ? '' : 's'}{r.schema?.isQuiz ? ' · quiz' : ''} · edited {relative(r.updatedAt)}</p>
                              <div className="mt-auto flex items-end gap-2 pt-4">
                                <div className="min-w-0 flex-1"><p className="text-[24px] font-semibold leading-none tabular-nums text-white">{r.responseCount}</p><p className="mt-1 text-[12px] text-neutral-500">response{r.responseCount === 1 ? '' : 's'}</p></div>
                                <div className="flex shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} role="toolbar" aria-label={`Actions for ${r.title}`}>
                                  <button type="button" title="Edit questions" aria-label="Edit questions" onClick={() => openEditor(r.id)} className={iconBtn}><PencilLine size={15} /></button>
                                  <button type="button" title="Results and charts" aria-label="Results and charts" onClick={() => openEditor(r.id, true)} className={iconBtn}><BarChart3 size={15} /></button>
                                  <a href={`/forms/${r.id}`} target="_blank" rel="noreferrer" title="Preview as a respondent" aria-label="Preview as a respondent" className={iconBtn}><ExternalLink size={15} /></a>
                                  <button type="button" title="Copy link" aria-label="Copy link" onClick={() => void copy(r)} className={iconBtn}>{copied === r.id ? <Check size={15} className="text-emerald-300" /> : <Link2 size={15} />}</button>
                                  <button type="button" title="Delete" aria-label="Delete" onClick={() => void remove(r)} className={`${iconBtn} hover:text-rose-300`}><Trash2 size={15} /></button>
                                </div>
                              </div>
                            </div>
                          </Card>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}
      </PageShell>
    </div>
  );
}
