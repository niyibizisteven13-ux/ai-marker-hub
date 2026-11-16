import { api, btnDanger, btnGhost, post, Panel, Stat, th, td, Toggle, useAct, useLoad, ago, type Notify } from './adminKit';

/** Admin → MySEB: how the exam server is doing, every exam on it, stop one, run the clean-up now, and the two switches. */
interface Exam { id: string; title: string; status: string; students: number; in_exam: number; paused: number; left: number; ended: number; allow_web: boolean; last_seen: string | null; created_at: string }
interface Data {
  configured: boolean; embedded: { running: boolean; restarts: number; lastExit: { code: number | null; signal: string | null; at: string } | null; inFlight: number; shed: number; maxInFlight: number } | null;
  overview: { error?: string; controls?: { enabled: boolean; browserMode: boolean }; retentionDays?: number; live?: { reports: number; mailboxes: number; waiting: number; pictureMb: number }; server?: { uptimeSeconds: number; memoryMb: number; node: string };
    totals?: { exams: number; activeExams: number; inExam: number; paused: number; left: number; ended: number }; exams?: Exam[] };
  downloads: Record<string, string>; wanted: { enabled: boolean; browserMode: boolean };
}
const SW = '/api/admin/platform/settings';

export default function MySebAdmin({ notify }: { notify: Notify }) {
  const { data, reload } = useLoad(async () => (await api<{ data: Data }>('/api/admin/myseb/overview')).data, notify, 10_000);
  const { busy, act } = useAct(notify);
  if (!data) return <p className="text-sm text-[#9AA6C9]">Loading…</p>;
  const o = data.overview; const e = data.embedded;
  const setFlag = (id: string, on: boolean) => act(async () => { await api(SW, { method: 'PUT', body: JSON.stringify({ flags: { [id]: on } }) }); }, undefined, reload);
  const down = e && !e.running;
  return (
    <div className="space-y-5">
      <Panel title="Exam server" hint={data.configured ? 'Refreshes every 10 seconds.' : 'MySEB is not set up on this server.'} right={<button type="button" className={btnGhost} onClick={() => void reload()}>Refresh</button>}>
        {o?.error && <p role="alert" className="rounded-lg bg-[#3A1722] p-3 text-sm text-[#FFB3C0]">{o.error}</p>}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Exam server" value={e ? (e.running ? 'Running' : 'DOWN') : 'Separate server'} tone={down ? 'bad' : 'good'} />
          <Stat label="Restarts" value={e?.restarts ?? '–'} tone={(e?.restarts ?? 0) > 3 ? 'warn' : undefined} />
          <Stat label="Requests in flight" value={e ? `${e.inFlight} / ${e.maxInFlight}` : '–'} tone={e && e.inFlight > e.maxInFlight * 0.8 ? 'warn' : undefined} />
          <Stat label="Turned away as busy" value={e?.shed ?? '–'} tone={(e?.shed ?? 0) > 0 ? 'warn' : undefined} />
          <Stat label="Students in a test now" value={o?.totals?.inExam ?? '–'} />
          <Stat label="Paused / connection lost" value={`${o?.totals?.paused ?? '–'} / ${o?.totals?.left ?? '–'}`} />
          <Stat label="Live pictures held" value={o?.live ? `${o.live.pictureMb} MB` : '–'} />
          <Stat label="Memory" value={o?.server ? `${o.server.memoryMb} MB` : '–'} />
        </div>
        {e?.lastExit && <p className="text-xs text-[#9AA6C9]">Last stopped {ago(e.lastExit.at)} (code {String(e.lastExit.code)}{e.lastExit.signal ? `, ${e.lastExit.signal}` : ''}). It restarts by itself.</p>}
      </Panel>

      <Panel title="Switches" hint="Stopping new sign-ins is for emergencies or while the exam server is fixed. Students already inside a test carry on either way.">
        <ul className="divide-y divide-[#263052]">
          <li className="flex items-center justify-between gap-4 py-2.5"><div><p className="text-sm font-semibold text-white">Allow new MySEB sign-ins</p><p className="text-xs text-[#9AA6C9]">Off: nobody can start a test and lecturers cannot make codes.</p></div>
            <Toggle on={data.wanted.enabled} disabled={busy} label="Allow new MySEB sign-ins" onChange={(v) => { if (v || confirm('Stop all new MySEB sign-ins? Students already inside a test are not affected.')) void setFlag('myseb.enabled', v); }} /></li>
          <li className="flex items-center justify-between gap-4 py-2.5"><div><p className="text-sm font-semibold text-white">Allow browser mode (iPhones)</p><p className="text-xs text-[#9AA6C9]">Off: students must use the MySEB app.</p></div>
            <Toggle on={data.wanted.browserMode} disabled={busy} label="Allow browser mode" onChange={(v) => void setFlag('myseb.browserMode', v)} /></li>
        </ul>
        {o?.controls && (o.controls.enabled !== data.wanted.enabled || o.controls.browserMode !== data.wanted.browserMode) && <p className="text-xs text-[#F2C230]">The exam server has not picked up the latest choice yet; it syncs within a minute. <button type="button" className="underline" onClick={() => void act(() => post('/api/admin/myseb/sync'), 'Sent', reload)}>Send now</button></p>}
      </Panel>

      <Panel title="Every exam" hint="Exams with students inside come first. Ending an exam ends every student's test in it.">
        <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left">
          <thead className="border-b border-[#263052]"><tr><th className={th}>Exam</th><th className={th}>Students</th><th className={th}>In</th><th className={th}>Paused</th><th className={th}>Lost</th><th className={th}>Done</th><th className={th}>Browser</th><th className={th}>Last seen</th><th className={th} /></tr></thead>
          <tbody className="divide-y divide-[#263052]">
            {(o?.exams ?? []).map((x) => (
              <tr key={x.id}><td className={`${td} max-w-[220px] truncate font-semibold text-white`} title={x.title}>{x.title}{x.status === 'ended' ? ' (ended)' : ''}</td><td className={td}>{x.students}</td><td className={`${td} font-bold ${x.in_exam ? 'text-[#5FD39B]' : ''}`}>{x.in_exam}</td><td className={td}>{x.paused}</td><td className={td}>{x.left}</td><td className={td}>{x.ended}</td><td className={td}>{x.allow_web ? 'yes' : 'no'}</td><td className={td}>{ago(x.last_seen)}</td>
                <td className={td}>{x.status !== 'ended' && <button type="button" className={btnDanger} disabled={busy} onClick={() => { const reason = prompt(`End “${x.title}” for all ${x.students} students? Write a reason for the audit log:`); if (reason !== null) void act(() => post(`/api/admin/myseb/exams/${x.id}/end`, { reason }), 'Exam ended', reload); }}>End exam</button>}</td></tr>
            ))}
            {!o?.exams?.length && <tr><td className={td} colSpan={9}>No exams yet.</td></tr>}
          </tbody></table></div>
      </Panel>

      <Panel title="Clean-up and apps" hint={`Finished exams are deleted after ${o?.retentionDays ?? 90} days (change it in Platform controls).`}>
        <button type="button" className={btnGhost} disabled={busy} onClick={() => { if (confirm('Delete finished exams older than the retention period now?')) void act(async () => { const r = await post('/api/admin/myseb/purge'); notify(`Removed ${r.data?.sessions ?? 0} students and ${r.data?.exams ?? 0} exams`); }); }}>Run the clean-up now</button>
        <div className="grid gap-1 text-xs text-[#9AA6C9]">{Object.entries(data.downloads ?? {}).map(([k, v]) => <p key={k}><span className="font-semibold text-[#DCE3FA]">{k}</span>: <a className="underline" href={v} target="_blank" rel="noreferrer">{v.split('/').slice(-2).join('/')}</a></p>)}{!Object.keys(data.downloads ?? {}).length && <p>No app downloads are published.</p>}</div>
      </Panel>
    </div>
  );
}
