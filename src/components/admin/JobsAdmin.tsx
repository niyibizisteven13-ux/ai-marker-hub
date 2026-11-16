import { api, btnDanger, btnGhost, post, Panel, Stat, td, th, useAct, useLoad, ago, type Notify } from './adminKit';

/** Admin → Jobs & Telegram: background work that is running, waiting or stuck (never its contents), failed jobs to review, and the Telegram bot. */
interface QJob { id: string; type: string; ownerId: string; status: string; attempts: number; maxAttempts: number; createdAt: string; updatedAt: string; progress: { stage: string; percent: number | null }; error?: { code: string; message: string } }
interface Snap { counts: Record<string, number>; byType: Record<string, number>; jobs: QJob[] }
interface Jobs { queue: Snap; overnight: Snap | null; failed: Array<{ id: string; jobId: string; jobType: string; errorMessage: string; attempts: number; createdAt: string }>; batches: Record<string, number>; stuckBatches: Array<{ id: string; userId: string; status: string; paperType: string; updatedAt: string }> }
interface Tg { botConfigured: boolean; total: number; linked: number; active24h: number; recent: Array<{ id: string; chat: string; language: string; lastActiveAt: string; user: { id: string; email: string; name: string } | null }> }

export default function JobsAdmin({ notify }: { notify: Notify }) {
  const jobs = useLoad(async () => (await api<{ data: Jobs }>('/api/admin/platform/jobs')).data, notify, 15_000);
  const tg = useLoad(async () => (await api<{ data: Tg }>('/api/admin/platform/telegram')).data, notify);
  const { busy, act } = useAct(notify);
  const J = jobs.data; const T = tg.data;
  const table = (which: 'main' | 'overnight', s: Snap) => (
    <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left"><thead className="border-b border-[#263052]"><tr><th className={th}>Job</th><th className={th}>Owner</th><th className={th}>State</th><th className={th}>Tries</th><th className={th}>Updated</th><th className={th} /></tr></thead>
      <tbody className="divide-y divide-[#263052]">
        {s.jobs.map((j) => (
          <tr key={j.id}><td className={`${td} font-semibold text-white`}>{j.type}<span className="block text-[11px] font-normal text-[#6C789E]">{j.progress.stage}{j.progress.percent !== null ? ` ${j.progress.percent}%` : ''}</span></td><td className={`${td} max-w-[120px] truncate`} title={j.ownerId}>{j.ownerId.slice(0, 8)}</td>
            <td className={`${td} ${j.status === 'failed' ? 'text-[#FF8798]' : ''}`}>{j.status}{j.error ? <span className="block text-[11px] text-[#9AA6C9]">{j.error.message.slice(0, 80)}</span> : null}</td><td className={td}>{j.attempts}/{j.maxAttempts}</td><td className={td}>{ago(j.updatedAt)}</td>
            <td className={td}><div className="flex gap-1.5">
              {(j.status === 'queued' || j.status === 'processing') && <button type="button" className={btnDanger} disabled={busy} onClick={() => { if (confirm('Stop this job?')) void act(() => post(`/api/admin/platform/jobs/queue/${which}/${j.id}/cancel`), 'Stopped', jobs.reload); }}>Stop</button>}
              {j.status === 'failed' && <button type="button" className={btnGhost} disabled={busy} onClick={() => void act(() => post(`/api/admin/platform/jobs/queue/${which}/${j.id}/retry`), 'Started again', jobs.reload)}>Retry</button>}
            </div></td></tr>
        ))}
        {!s.jobs.length && <tr><td className={td} colSpan={6}>Nothing running, waiting or failed.</td></tr>}
      </tbody></table></div>
  );
  return (
    <div className="space-y-5">
      <Panel title="Background jobs" hint="Marking, document reading and other work that runs behind the scenes. Shows what is running, waiting or failed. Never shows people's files or answers." right={<button type="button" className={btnGhost} onClick={() => void jobs.reload()}>Refresh</button>}>
        {J && (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">{(['processing', 'queued', 'failed', 'completed', 'cancelled'] as const).map((k) => <Stat key={k} label={k} value={J.queue.counts[k] ?? 0} tone={k === 'failed' && (J.queue.counts.failed ?? 0) > 0 ? 'bad' : k === 'queued' && (J.queue.counts.queued ?? 0) > 20 ? 'warn' : undefined} />)}</div>
            {table('main', J.queue)}
          </>
        )}
      </Panel>
      {J?.overnight && <Panel title="Overnight marking queue" hint="Half-price marking that finishes by the next morning.">{table('overnight', J.overnight)}</Panel>}
      <Panel title="Failed jobs to review" hint="Jobs that used all their tries. Mark one as handled once you have looked at it.">
        <ul className="divide-y divide-[#263052]">{(J?.failed ?? []).map((f) => <li key={f.id} className="flex items-center justify-between gap-3 py-2 text-sm text-[#DCE3FA]"><span><span className="font-semibold text-white">{f.jobType}</span> · {f.attempts} tries · {ago(f.createdAt)}<span className="block text-xs text-[#9AA6C9]">{f.errorMessage.slice(0, 160)}</span></span><button type="button" className={btnGhost} disabled={busy} onClick={() => void act(() => post(`/api/admin/platform/jobs/failed/${f.id}/resolve`), 'Marked as handled', jobs.reload)}>Handled</button></li>)}</ul>
        {!J?.failed.length && <p className="text-sm text-[#9AA6C9]">Nothing to review.</p>}
      </Panel>
      <Panel title="Batch marking runs" hint="Runs that have been waiting or running for more than an hour are listed so you can stop them.">
        <div className="flex flex-wrap gap-3 text-sm text-[#DCE3FA]">{Object.entries(J?.batches ?? {}).map(([k, v]) => <span key={k}>{k}: <b className="text-white">{v}</b></span>)}</div>
        <ul className="divide-y divide-[#263052]">{(J?.stuckBatches ?? []).map((b) => <li key={b.id} className="flex items-center justify-between gap-3 py-2 text-sm text-[#DCE3FA]"><span>{b.paperType} · {b.status} · owner {b.userId.slice(0, 8)} · {ago(b.updatedAt)}</span><button type="button" className={btnDanger} disabled={busy} onClick={() => { if (confirm('Stop this run?')) void act(() => post(`/api/admin/platform/jobs/batches/${b.id}/fail`), 'Stopped', jobs.reload); }}>Stop</button></li>)}</ul>
        {!J?.stuckBatches.length && <p className="text-sm text-[#9AA6C9]">No run looks stuck.</p>}
      </Panel>
      <Panel title="Telegram bot" hint="Chats linked to accounts. Chat numbers are hidden except the last four digits.">
        {T && <div className="grid grid-cols-2 gap-3 md:grid-cols-4"><Stat label="Bot" value={T.botConfigured ? 'Configured' : 'Not set up'} tone={T.botConfigured ? 'good' : 'warn'} /><Stat label="Chats" value={T.total} /><Stat label="Linked to an account" value={T.linked} /><Stat label="Active in 24 h" value={T.active24h} /></div>}
        <ul className="divide-y divide-[#263052]">{(T?.recent ?? []).map((s) => <li key={s.id} className="flex items-center justify-between gap-3 py-2 text-sm text-[#DCE3FA]"><span>{s.chat} · {s.language} · {ago(s.lastActiveAt)} · {s.user ? s.user.email : 'not linked'}</span>{s.user && <button type="button" className={btnGhost} disabled={busy} onClick={() => { if (confirm(`Unlink this chat from ${s.user!.email}?`)) void act(() => post(`/api/admin/platform/telegram/${s.id}/unlink`), 'Unlinked', tg.reload); }}>Unlink</button>}</li>)}</ul>
      </Panel>
    </div>
  );
}
