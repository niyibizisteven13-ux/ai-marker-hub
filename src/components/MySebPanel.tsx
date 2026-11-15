import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '../utils/authFetch';

/** Lecturer: exam code + QR for MySEB, and who is in the test right now. Lives inside the form's test-protection settings. */
type Student = { id: string; student_name: string; status: 'IN_EXAM' | 'PAUSED' | 'LEFT' | 'ENDED'; client_type: string; platform: string | null; violation_count: number; last_violation: string | null; seen_ago: number; end_reason: string | null };
type Monitor = { counts: Record<string, number>; students: Student[] };
type Code = { display: string; qrSvg: string; expiresAt: string };

const PILL: Record<string, string> = { IN_EXAM: 'bg-green-600', PAUSED: 'bg-amber-600', LEFT: 'bg-red-600', ENDED: 'bg-slate-500' };
const btn = 'min-h-9 rounded-lg border border-[#DADCE0] px-3 text-xs font-semibold text-[#202124] hover:bg-black/5 disabled:opacity-40';

export default function MySebPanel({ formId, onExamId }: { formId?: string; onExamId: (id: string) => void }) {
  const [code, setCode] = useState<Code | null>(null);
  const [mon, setMon] = useState<Monitor | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [log, setLog] = useState<{ name: string; rows: Array<{ id: number; type: string; created_at: string }> } | null>(null);
  const base = formId ? `/api/forms/${encodeURIComponent(formId)}/myseb` : '';

  const call = useCallback(async (path: string, method = 'GET') => {
    const r = await authFetch(`${base}${path}`, { method });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(b.error || 'Something went wrong.');
    return b;
  }, [base]);

  const refresh = useCallback(() => { if (formId) call('/monitor').then(setMon).catch(() => undefined); }, [formId, call]);
  useEffect(() => { refresh(); const t = setInterval(refresh, 4000); return () => clearInterval(t); }, [refresh]);

  if (!formId) return <p className="text-xs text-[#5F6368]">Save and publish the form first. Then you can make the MySEB code here.</p>;

  const generate = async () => {
    setBusy(true); setErr('');
    try { const b = await call('/code', 'POST'); setCode(b); onExamId(b.mysebExamId); refresh(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const act = async (sid: string, what: 'resume' | 'end') => { try { await call(`/sessions/${sid}/${what}`, 'POST'); refresh(); } catch (e) { setErr((e as Error).message); } };
  const showLog = async (s: Student) => { try { const rows = await call(`/sessions/${s.id}/violations`); setLog({ name: s.student_name, rows }); } catch (e) { setErr((e as Error).message); } };
  const endAll = async () => { if (confirm('End this test for everyone? The code stops working.')) { try { await call('/end', 'POST'); refresh(); } catch (e) { setErr((e as Error).message); } } };

  return (
    <div className="space-y-3 rounded-xl border border-[#E0E0E0] bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={generate} disabled={busy} className="min-h-10 rounded-lg bg-[#B4502F] px-4 text-sm font-bold text-white hover:bg-[#C45A37] disabled:opacity-60">{busy ? 'Making code…' : 'Generate MySEB code'}</button>
        <button type="button" onClick={endAll} className={btn}>End test for everyone</button>
      </div>
      {err && <p role="alert" className="text-xs font-semibold text-rose-600">{err}</p>}
      {code && (
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <div className="font-mono text-3xl font-bold tracking-wider text-[#202124] sm:text-4xl">{code.display}</div>
            <button type="button" className={`${btn} mt-2`} onClick={async () => { await navigator.clipboard.writeText(code.display); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? 'Copied' : 'Copy'}</button>
            <p className="mt-2 max-w-xs text-xs text-[#5F6368]">Give this to your students. They type it in MySEB. One code works for the whole class. It is shown once; generate again if you lose it. Expires {new Date(code.expiresAt).toLocaleString()}.</p>
          </div>
          {/* the SVG is made by our own MySEB server; shown as an image so it can never run script */}
          <img alt="QR code to open MySEB on a phone" className="h-36 w-36 rounded-lg border border-[#E0E0E0] bg-white p-1" src={`data:image/svg+xml;utf8,${encodeURIComponent(code.qrSvg)}`} />
        </div>
      )}
      {mon && (
        <div>
          <div className="mb-2 flex flex-wrap gap-1.5 text-[11px] font-bold text-white">
            {(['IN_EXAM', 'PAUSED', 'LEFT', 'ENDED'] as const).map((k) => <span key={k} className={`rounded-full px-2.5 py-0.5 ${PILL[k]}`}>{k.replace('_', ' ')}: {mon.counts[k] ?? 0}</span>)}
          </div>
          {mon.students.length === 0 ? <p className="text-xs text-[#5F6368]">No students yet.</p> : (
            <ul className="divide-y divide-[#E0E0E0] text-sm">
              {mon.students.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="min-w-[8rem] flex-1 truncate font-semibold">{s.student_name}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold text-white ${PILL[s.status]}`}>{s.status.replace('_', ' ')}</span>
                  <span className="text-xs text-[#5F6368]">{s.client_type}{s.platform ? ` · ${s.platform}` : ''}</span>
                  <button type="button" className={btn} onClick={() => showLog(s)}>{s.violation_count} violation{s.violation_count === 1 ? '' : 's'}{s.last_violation ? ` · ${s.last_violation}` : ''}</button>
                  {(s.status === 'PAUSED' || s.status === 'LEFT') && <button type="button" className={btn} onClick={() => act(s.id, 'resume')}>Resume</button>}
                  <button type="button" className={`${btn} text-rose-700`} disabled={s.status === 'ENDED'} onClick={() => act(s.id, 'end')}>End for student</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {log && (
        <div role="dialog" aria-label="Violations" className="rounded-lg border border-[#E0E0E0] bg-[#F8F9FA] p-3 text-xs">
          <div className="mb-1 flex items-center justify-between font-bold"><span>{log.name}</span><button type="button" className={btn} onClick={() => setLog(null)}>Close</button></div>
          {log.rows.length === 0 ? 'None' : <ul className="space-y-0.5">{log.rows.map((v) => <li key={v.id}>{new Date(v.created_at).toLocaleTimeString()} · {v.type}</li>)}</ul>}
        </div>
      )}
    </div>
  );
}
