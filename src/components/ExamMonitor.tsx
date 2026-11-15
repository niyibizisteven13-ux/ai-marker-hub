import { useCallback, useEffect, useState } from 'react';
import { Accessibility, Loader2, Pause, Play, Plus, Square, UserCheck } from 'lucide-react';
import { authFetch } from '../utils/authFetch';

/**
 * The lecturer's live view of a timed test: who is sitting, who is paused and why, what the camera and the page
 * reported. Resume, pause, add time, end one student's test, let a student who lost their page back in.
 * Everything here is a signal for a person to look at: nothing changes a mark.
 */

interface Row {
  id: string; studentId: string; studentName: string; status: 'running' | 'paused' | 'submitted' | 'ended'; camera: 'off' | 'warn' | 'pause';
  remainingSeconds: number; usedSeconds: number; pause: { by: string; reason: string; sinceSeconds: number } | null; hasAccommodation: boolean; reentry: boolean;
  summary: { faceLost: number; multipleFaces: number; cameraProblems: number; tabHidden: number; pauses: number; awaySeconds: number };
}
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const REASON: Record<string, string> = { face_lost: 'Face left the frame', camera_denied: 'Camera blocked', camera_stopped: 'Camera stopped', break: 'On a break', lecturer: 'Paused by you', setup: 'Camera check', reconnect: 'Reconnecting' };
const STATUS: Record<Row['status'], { text: string; cls: string }> = {
  running: { text: 'Sitting', cls: 'bg-emerald-100 text-emerald-800' }, paused: { text: 'Paused', cls: 'bg-amber-100 text-amber-900' },
  submitted: { text: 'Handed in', cls: 'bg-slate-100 text-slate-700' }, ended: { text: 'Time over', cls: 'bg-slate-100 text-slate-700' },
};
const btn = 'inline-flex items-center gap-1 rounded-lg border border-[#DADCE0] bg-white px-2.5 py-1.5 text-xs font-medium text-[#202124] hover:bg-[#F8F9FA] disabled:opacity-40';

export default function ExamMonitor({ formId }: { formId: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await authFetch(`/api/form-exams/${encodeURIComponent(formId)}/sessions`);
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b.error || 'Could not load the test.');
      setRows(b.sessions); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load the test.'); }
  }, [formId]);
  useEffect(() => { void load(); const t = window.setInterval(() => void load(), 4000); return () => window.clearInterval(t); }, [load]);

  const act = async (id: string, what: 'resume' | 'pause' | 'end' | 'reentry' | 'extend') => {
    if (what === 'end' && !window.confirm('End this student\'s test now? Their page sends the answers they have.')) return;
    setBusy(id + what);
    try {
      const r = await authFetch(`/api/form-exams/session/${id}/${what}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(what === 'extend' ? { minutes: 5 } : {}) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'That did not work.');
      setNotice(what === 'reentry' ? 'The student can start again by entering their number.' : null); await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'That did not work.'); } finally { setBusy(null); }
  };
  const resumeAll = async () => {
    setBusy('all');
    try { const r = await authFetch(`/api/form-exams/${encodeURIComponent(formId)}/resume-all`, { method: 'POST' }); const b = await r.json(); setNotice(`${b.resumed} student${b.resumed === 1 ? '' : 's'} resumed.`); await load(); } finally { setBusy(null); }
  };

  const paused = rows?.filter((x) => x.status === 'paused') ?? [];
  return (
    <section className="rounded-2xl border border-[#E0E0E0] bg-white p-5" aria-label="Live test">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex-1 font-semibold">Live test{rows ? ` · ${rows.filter((x) => x.status === 'running').length} sitting, ${paused.length} paused, ${rows.filter((x) => x.status === 'submitted').length} handed in` : ''}</h3>
        <button type="button" disabled={busy === 'all' || !paused.length} onClick={() => void resumeAll()} className={btn} title="Resumes students whose face is back in the frame"><UserCheck size={14} />Resume those whose face is back</button>
      </div>
      {notice && <p role="status" className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{notice}</p>}
      {error && <p role="alert" className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}
      {!rows ? <div className="flex justify-center py-6 text-[#5F6368]"><Loader2 className="animate-spin" /></div> : !rows.length ? <p className="mt-3 text-sm text-[#5F6368]">Nobody has started yet. Students start with their registration number on the form link.</p> : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <caption className="sr-only">Students sitting this test</caption>
            <thead><tr className="border-b border-[#E0E0E0] text-xs text-[#5F6368]"><th scope="col" className="py-2 pr-3 font-medium">Student</th><th scope="col" className="px-2 font-medium">Status</th><th scope="col" className="px-2 font-medium">Time left</th><th scope="col" className="px-2 font-medium">Signals</th><th scope="col" className="pl-2 font-medium">Actions</th></tr></thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className="border-b border-[#F1F3F4] align-top last:border-0">
                  <th scope="row" className="py-2.5 pr-3 font-normal"><span className="flex items-center gap-1 font-semibold">{s.studentName}{s.hasAccommodation && <Accessibility size={13} aria-label="Has accommodations" className="text-sky-600" />}</span><span className="font-mono text-xs text-[#5F6368]">{s.studentId}</span></th>
                  <td className="px-2 py-2.5"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS[s.status].cls}`}>{STATUS[s.status].text}</span>{s.pause && <span className="mt-1 block text-xs text-[#5F6368]">{REASON[s.pause.reason] ?? s.pause.reason}{s.pause.sinceSeconds >= 5 ? ` · ${mmss(s.pause.sinceSeconds)}` : ''}</span>}</td>
                  <td className="px-2 py-2.5 tabular-nums">{s.status === 'submitted' ? '–' : mmss(s.remainingSeconds)}</td>
                  <td className="px-2 py-2.5 text-xs text-[#3C4043]">
                    {s.camera === 'off' ? <span className="text-[#5F6368]">No camera check</span> : <span>Face lost {s.summary.faceLost}×{s.summary.awaySeconds ? ` (${s.summary.awaySeconds}s)` : ''}{s.summary.multipleFaces ? ` · several faces ${s.summary.multipleFaces}×` : ''}{s.summary.cameraProblems ? ` · camera problems ${s.summary.cameraProblems}×` : ''}</span>}
                    <span className="block">Left the page {s.summary.tabHidden}×</span>
                  </td>
                  <td className="py-2.5 pl-2">
                    <div className="flex flex-wrap gap-1.5">
                      {s.status === 'paused' && <button type="button" disabled={!!busy} onClick={() => void act(s.id, 'resume')} className={btn}><Play size={12} />Resume</button>}
                      {s.status === 'running' && <button type="button" disabled={!!busy} onClick={() => void act(s.id, 'pause')} className={btn}><Pause size={12} />Pause</button>}
                      {(s.status === 'running' || s.status === 'paused' || s.status === 'ended') && <button type="button" disabled={!!busy} onClick={() => void act(s.id, 'extend')} className={btn}><Plus size={12} />5 min</button>}
                      {(s.status === 'running' || s.status === 'paused') && <button type="button" disabled={!!busy} onClick={() => void act(s.id, 'end')} className={btn}><Square size={12} />End</button>}
                      {s.status !== 'submitted' && !s.reentry && <button type="button" disabled={!!busy} onClick={() => void act(s.id, 'reentry')} className={btn} title="For a student who lost their page or device">Let back in</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-[#5F6368]">Signals are for you to look at: a dim room or a weak camera can lose a face. They never change a mark.</p>
        </div>
      )}
    </section>
  );
}
