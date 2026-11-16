import { api, btnDanger, btnGhost, post, Panel, Stat, td, th, useAct, useLoad, when, type Notify } from './adminKit';

/** Admin → Security: failed sign-ins (24 hours and 7 days), where they come from, and one-click blocking. Failures are kept 30 days. */
interface Sec {
  failedSignIns: { last24h: number; last7d: number; byHour: number[] }; topSources: Array<{ ip: string; attempts: number; blocked: boolean }>;
  recent: Array<{ at: string; type: string; ip: string | null; email: string | null }>; blockedIps: string[]; disabledAccounts: number;
  recentAdminActions: Array<{ id: string; createdAt: string; actorId: string; action: string; resourceType: string }>;
}
const SW = '/api/admin/platform/settings';
export default function SecurityAdmin({ notify }: { notify: Notify }) {
  const { data: S, reload } = useLoad(async () => (await api<{ data: Sec }>('/api/admin/platform/security')).data, notify, 30_000);
  const { busy, act } = useAct(notify);
  if (!S) return <p className="text-sm text-[#9AA6C9]">Loading…</p>;
  const max = Math.max(1, ...S.failedSignIns.byHour);
  const setBlocked = (list: string[]) => act(() => api(SW, { method: 'PUT', body: JSON.stringify({ blockedIps: list }) }), 'Block list saved', reload);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Failed sign-ins, 24 h" value={S.failedSignIns.last24h} tone={S.failedSignIns.last24h > 50 ? 'bad' : S.failedSignIns.last24h > 15 ? 'warn' : undefined} /><Stat label="Failed sign-ins, 7 days" value={S.failedSignIns.last7d} />
        <Stat label="Blocked addresses" value={S.blockedIps.length} /><Stat label="Disabled accounts" value={S.disabledAccounts} />
      </div>
      <Panel title="Failed sign-ins by hour (last 24 hours)" hint="Wrong or expired codes and attempts on disabled accounts. The right-hand bar is the current hour.">
        <div className="flex h-24 items-end gap-1" role="img" aria-label="Failed sign-ins per hour">{S.failedSignIns.byHour.map((n, i) => <div key={i} title={`${n}`} className="flex-1 rounded-t bg-[#3FA7E0]" style={{ height: `${Math.max(3, (n / max) * 100)}%`, opacity: n ? 1 : 0.25 }} />)}</div>
      </Panel>
      <Panel title="Where they come from" hint="Blocking an address stops it everywhere (the health check and status stay readable). You cannot block your own address.">
        <div className="overflow-x-auto"><table className="w-full text-left"><thead className="border-b border-[#263052]"><tr><th className={th}>Address</th><th className={th}>Attempts (7 days)</th><th className={th} /></tr></thead>
          <tbody className="divide-y divide-[#263052]">{S.topSources.map((s) => <tr key={s.ip}><td className={`${td} font-mono`}>{s.ip}</td><td className={td}>{s.attempts}</td><td className={td}>{s.blocked ? <button type="button" className={btnGhost} disabled={busy} onClick={() => void setBlocked(S.blockedIps.filter((x) => x !== s.ip))}>Unblock</button> : <button type="button" className={btnDanger} disabled={busy} onClick={() => { if (confirm(`Block ${s.ip}?`)) void setBlocked([...S.blockedIps, s.ip]); }}>Block</button>}</td></tr>)}
            {!S.topSources.length && <tr><td className={td} colSpan={3}>No failed sign-ins in the last 7 days.</td></tr>}</tbody></table></div>
      </Panel>
      <Panel title="Latest failures">
        <ul className="divide-y divide-[#263052] text-sm text-[#DCE3FA]">{S.recent.map((e, i) => <li key={i} className="py-1.5"><span className="text-[#6C789E]">{when(e.at)}</span> · {e.type} · <span className="font-mono">{e.ip ?? '?'}</span>{e.email ? ` · ${e.email}` : ''}</li>)}{!S.recent.length && <li className="py-1.5 text-[#9AA6C9]">None.</li>}</ul>
      </Panel>
      <Panel title="Latest administrator actions" hint="The full list, with filters and export, is under Audit log.">
        <ul className="divide-y divide-[#263052] text-xs text-[#DCE3FA]">{S.recentAdminActions.map((a) => <li key={a.id} className="py-1.5 font-mono"><span className="text-[#6C789E]">{when(a.createdAt)}</span> · {a.action} · {a.resourceType}</li>)}</ul>
      </Panel>
    </div>
  );
}
