import { useState } from 'react';
import { api, btnGhost, btnPrimary, download, input, Panel, td, th, useLoad, when, type Notify } from './adminKit';

/** Admin → Audit log: every administrator change and everything the chat did on someone's behalf (CHAT_…), with filters and a CSV export. */
interface Row { id: string; createdAt: string; actorId: string; action: string; resourceType: string; resourceId: string | null; details: string | null }
export default function AuditAdmin({ notify }: { notify: Notify }) {
  const [f, setF] = useState({ actor: '', action: '', resource: '', q: '', from: '', to: '' });
  const [rows, setRows] = useState<Row[]>([]); const [next, setNext] = useState<string | null>(null);
  const qs = (extra = '') => `?${new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString()}${extra}`;
  const { reload, loading } = useLoad(async () => { const r = await api<{ data: Row[]; next: string | null }>(`/api/admin/platform/audit${qs('&limit=100')}`); setRows(r.data); setNext(r.next); return true; }, notify);
  const more = async () => { try { const r = await api<{ data: Row[]; next: string | null }>(`/api/admin/platform/audit${qs(`&limit=100&before=${encodeURIComponent(next ?? '')}`)}`); setRows((x) => [...x, ...r.data]); setNext(r.next); } catch (e) { notify((e as Error).message, true); } };
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const quick = (action: string) => setF((x) => ({ ...x, action }));
  return (
    <Panel title="System audit log" hint="Administrator changes, and actions the chat took for lecturers (they start with CHAT_). Text in the details can be searched.">
      <form className="grid gap-2 md:grid-cols-6" onSubmit={(e) => { e.preventDefault(); void reload(); }}>
        <input className={input} placeholder="Who (user id)" value={f.actor} onChange={set('actor')} aria-label="Who" />
        <input className={input} placeholder="Action contains…" value={f.action} onChange={set('action')} aria-label="Action" />
        <input className={input} placeholder="Resource type" value={f.resource} onChange={set('resource')} aria-label="Resource type" />
        <input className={input} placeholder="Search details" value={f.q} onChange={set('q')} aria-label="Search details" />
        <input className={input} type="date" value={f.from} onChange={set('from')} aria-label="From" />
        <input className={input} type="date" value={f.to} onChange={set('to')} aria-label="To" />
        <div className="flex flex-wrap items-center gap-2 md:col-span-6">
          <button type="submit" className={btnPrimary}>Search</button>
          <button type="button" className={btnGhost} onClick={() => { setF({ actor: '', action: '', resource: '', q: '', from: '', to: '' }); setTimeout(() => void reload(), 0); }}>Clear</button>
          <button type="button" className={btnGhost} onClick={() => { quick('CHAT_'); setTimeout(() => void reload(), 0); }}>What the chat did</button>
          <button type="button" className={btnGhost} onClick={() => void download(`/api/admin/platform/audit${qs('&format=csv')}`, 'audit-log.csv').catch((e) => notify(e.message, true))}>Export CSV</button>
        </div>
      </form>
      <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left font-mono text-xs">
        <thead className="border-b border-[#263052]"><tr><th className={th}>Time</th><th className={th}>Who</th><th className={th}>Action</th><th className={th}>Resource</th><th className={th}>Details</th></tr></thead>
        <tbody className="divide-y divide-[#263052]">
          {rows.map((r) => <tr key={r.id}><td className={`${td} whitespace-nowrap text-[#6C789E]`}>{when(r.createdAt)}</td><td className={`${td} max-w-[130px] truncate text-[#7CC4EE]`} title={r.actorId}>{r.actorId}</td><td className={`${td} font-bold ${r.action.startsWith('CHAT_') ? 'text-[#F2C230]' : 'text-white'}`}>{r.action}</td><td className={`${td} max-w-[160px] truncate`} title={r.resourceId ?? ''}>{r.resourceType}{r.resourceId ? ` · ${r.resourceId.slice(0, 8)}` : ''}</td><td className={`${td} max-w-[340px] truncate text-[#9AA6C9]`} title={r.details ?? ''}>{r.details}</td></tr>)}
          {!rows.length && !loading && <tr><td className={td} colSpan={5}>Nothing matches.</td></tr>}
        </tbody></table></div>
      {next && <button type="button" className={btnGhost} onClick={() => void more()}>Load older</button>}
    </Panel>
  );
}
