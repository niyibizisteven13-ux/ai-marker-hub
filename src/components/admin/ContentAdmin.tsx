import { useState } from 'react';
import { api, btnDanger, btnGhost, btnPrimary, input, Panel, post, td, th, useAct, useLoad, when, type Notify } from './adminKit';

/** Admin → Content & organisations: every form on the platform (find one, close it), and organisations with their members. */
interface FormRow { id: string; title: string; owner: { id: string; email?: string; name?: string }; responses: number | null; open: boolean; myseb: boolean; timed: boolean; updatedAt: string }
interface Org { id: string; name: string; creditBalanceUsd: number; createdAt: string; members: Array<{ userId: string; role: string; email?: string; name?: string; disabled: boolean }> }

export default function ContentAdmin({ notify }: { notify: Notify }) {
  const [q, setQ] = useState('');
  const forms = useLoad(async () => (await api<{ data: FormRow[] }>(`/api/admin/platform/content/forms?q=${encodeURIComponent(q)}`)).data, notify);
  const orgs = useLoad(async () => (await api<{ data: Org[] }>('/api/admin/platform/organizations')).data, notify);
  const { busy, act } = useAct(notify);
  const [email, setEmail] = useState<Record<string, string>>({});
  return (
    <div className="space-y-5">
      <Panel title="Forms and quizzes" hint="Every form on the platform, newest first (100 at a time). Closing stops it taking answers; the answers already given stay.">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void forms.reload(); }}><input className={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by title or owner's email" aria-label="Search forms" /><button type="submit" className={btnPrimary}>Search</button></form>
        <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left"><thead className="border-b border-[#263052]"><tr><th className={th}>Form</th><th className={th}>Owner</th><th className={th}>Answers</th><th className={th}>Kind</th><th className={th}>Updated</th><th className={th} /></tr></thead>
          <tbody className="divide-y divide-[#263052]">
            {(forms.data ?? []).map((f) => (
              <tr key={f.id}><td className={`${td} max-w-[240px] truncate font-semibold text-white`} title={f.title}>{f.title}</td><td className={`${td} max-w-[200px] truncate`} title={f.owner.email}>{f.owner.email ?? f.owner.id}</td><td className={td}>{f.responses ?? '–'}</td>
                <td className={td}>{f.open ? 'open' : 'closed'}{f.timed ? ' · timed' : ''}{f.myseb ? ' · MySEB' : ''}</td><td className={td}>{when(f.updatedAt)}</td>
                <td className={td}>{f.open && <button type="button" className={btnDanger} disabled={busy} onClick={() => { const reason = prompt(`Close “${f.title}”? Write a reason for the audit log:`); if (reason !== null) void act(() => post(`/api/admin/platform/content/forms/${f.id}/close`, { reason }), 'Form closed', forms.reload); }}>Close</button>}</td></tr>
            ))}
            {!forms.data?.length && <tr><td className={td} colSpan={6}>{forms.loading ? 'Loading…' : 'No forms match.'}</td></tr>}
          </tbody></table></div>
      </Panel>

      <Panel title="Organisations" hint="Add people who already have an account (they must have signed in once). Removing an organisation needs its members removed first.">
        {(orgs.data ?? []).map((o) => (
          <div key={o.id} className="rounded-xl border border-[#263052] bg-[#0A1020] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-bold text-white">{o.name} <span className="text-xs font-normal text-[#6C789E]">{o.members.length} member(s)</span></p>
              <div className="flex gap-2">
                <button type="button" className={btnGhost} disabled={busy} onClick={() => { const name = prompt('New name', o.name); if (name?.trim()) void act(() => api(`/api/admin/platform/organizations/${o.id}`, { method: 'PATCH', body: JSON.stringify({ name }) }), 'Renamed', orgs.reload); }}>Rename</button>
                <button type="button" className={btnDanger} disabled={busy} onClick={() => { if (confirm(`Remove the organisation “${o.name}”${o.members.length ? ` and its ${o.members.length} members' membership` : ''}?`)) void act(() => api(`/api/admin/platform/organizations/${o.id}?force=true`, { method: 'DELETE' }), 'Organisation removed', orgs.reload); }}>Remove</button>
              </div>
            </div>
            <ul className="mt-2 divide-y divide-[#263052]">{o.members.map((m) => (
              <li key={m.userId} className="flex items-center justify-between gap-2 py-1.5 text-sm text-[#DCE3FA]"><span>{m.email ?? m.userId} <span className="text-xs text-[#6C789E]">{m.role}{m.disabled ? ' · disabled' : ''}</span></span>
                <button type="button" className={btnGhost} disabled={busy} onClick={() => void act(() => api(`/api/admin/platform/organizations/${o.id}/members/${m.userId}`, { method: 'DELETE' }), 'Removed', orgs.reload)}>Remove</button></li>))}</ul>
            <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); const v = (email[o.id] ?? '').trim(); if (v) void act(() => post(`/api/admin/platform/organizations/${o.id}/members`, { email: v }), 'Member added', async () => { setEmail((x) => ({ ...x, [o.id]: '' })); await orgs.reload(); }); }}>
              <input className={input} placeholder="Add a member by email" value={email[o.id] ?? ''} onChange={(e) => setEmail((x) => ({ ...x, [o.id]: e.target.value }))} aria-label={`Add a member to ${o.name}`} /><button type="submit" className={btnPrimary} disabled={busy}>Add</button></form>
          </div>
        ))}
        {!orgs.data?.length && <p className="text-sm text-[#9AA6C9]">{orgs.loading ? 'Loading…' : 'No organisations yet.'}</p>}
      </Panel>
    </div>
  );
}
