import { useState } from 'react';
import { api, btnDanger, btnGhost, btnPrimary, card, download, input, post, Stat, useAct, useLoad, when, type Notify } from './adminKit';

/** One person's account for the administrator: plan, credits, storage (and extra room), sign-ins, everything they have made, export and erasing. */
interface Detail {
  user: { id: string; email: string; name: string; role: string; createdAt: string; lastLoginAt: string | null; disabledAt: string | null };
  plan: string | null; activeSessions: number; telegramLinked: boolean;
  usage: { day?: { used: number; limit: number }; week?: { used: number; limit: number }; month?: { used: number; limit: number } } | null;
  storage: { usedMb: number; limitMb: number; files: number; extraMb: number } | null;
  content: { forms: Array<{ id: string; title: string; open: boolean; myseb: boolean }>; tasks: Array<{ id: string; title: string; open: boolean; submitted: number }>; courses: Array<{ id: string; name: string; students: number }>; exams: Array<{ id: string; title: string; candidates: number; marked: number }> };
  organizations: Array<{ id: string; name: string; role: string }>;
}
export default function UserDetail({ userId, onClose, notify, onChanged }: { userId: string; onClose: () => void; notify: Notify; onChanged: () => void }) {
  const { data: d, reload } = useLoad(async () => (await api<{ data: Detail }>(`/api/admin/platform/users/${userId}`)).data, notify);
  const { busy, act } = useAct(notify);
  const [extra, setExtra] = useState(''); const [confirmEmail, setConfirmEmail] = useState('');
  const U = `/api/admin/platform/users/${userId}`;
  const meter = (m?: { used: number; limit: number }) => (m ? `${m.used} / ${m.limit}` : '–');
  return (
    <div role="dialog" aria-label="Account details" className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-3 sm:items-center" onClick={onClose}>
      <div className={`${card} max-h-[88dvh] w-full max-w-3xl space-y-4 overflow-y-auto`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-bold text-white">{d?.user.name ?? 'Account'}</h2><p className="text-sm text-[#9AA6C9]">{d?.user.email}</p></div><button type="button" className={btnGhost} onClick={onClose}>Close</button></div>
        {!d ? <p className="text-sm text-[#9AA6C9]">Loading…</p> : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Role" value={d.user.role} /><Stat label="Plan" value={d.plan ?? '–'} /><Stat label="Account" value={d.user.disabledAt ? 'Disabled' : 'Enabled'} tone={d.user.disabledAt ? 'bad' : 'good'} /><Stat label="Last sign-in" value={d.user.lastLoginAt ? when(d.user.lastLoginAt) : 'never'} />
              <Stat label="Credits today" value={meter(d.usage?.day)} /><Stat label="This week" value={meter(d.usage?.week)} /><Stat label="This month" value={meter(d.usage?.month)} /><Stat label="Signed-in devices" value={d.activeSessions} />
            </div>
            <section className="space-y-2"><h3 className="text-sm font-bold text-white">Storage</h3>
              <p className="text-sm text-[#DCE3FA]">{d.storage ? `${d.storage.usedMb} MB used of ${d.storage.limitMb} MB (${d.storage.files} files)${d.storage.extraMb ? `, including ${d.storage.extraMb} MB extra from you` : ''}` : 'Not available.'}</p>
              <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); void act(() => post(`${U}/storage`, { extraMb: Number(extra || 0) }), 'Storage updated', async () => { setExtra(''); await reload(); }); }}>
                <input className={`${input} w-40`} inputMode="numeric" value={extra} onChange={(e) => setExtra(e.target.value.replace(/\D/g, ''))} placeholder="Extra MB (0 removes)" aria-label="Extra storage in MB" /><button type="submit" className={btnPrimary} disabled={busy || extra === ''}>Set extra room</button></form></section>
            <section className="space-y-1"><h3 className="text-sm font-bold text-white">What they have made</h3>
              <p className="text-xs text-[#9AA6C9]">Read-only: this is for support. To act on something, use Content & organisations.</p>
              <ul className="space-y-0.5 text-sm text-[#DCE3FA]">
                {d.content.forms.map((f) => <li key={f.id}>Form: {f.title} <span className="text-xs text-[#6C789E]">{f.open ? 'open' : 'closed'}{f.myseb ? ' · MySEB' : ''}</span></li>)}
                {d.content.tasks.map((t) => <li key={t.id}>Task: {t.title} <span className="text-xs text-[#6C789E]">{t.open ? 'open' : 'closed'} · {t.submitted} handed in</span></li>)}
                {d.content.courses.map((c) => <li key={c.id}>Class: {c.name} <span className="text-xs text-[#6C789E]">{c.students} students</span></li>)}
                {d.content.exams.map((x) => <li key={x.id}>Marked exam: {x.title} <span className="text-xs text-[#6C789E]">{x.marked}/{x.candidates} marked</span></li>)}
                {!d.content.forms.length && !d.content.tasks.length && !d.content.courses.length && !d.content.exams.length && <li className="text-[#9AA6C9]">Nothing yet.</li>}
              </ul>
              {d.organizations.length > 0 && <p className="text-xs text-[#9AA6C9]">Organisations: {d.organizations.map((o) => `${o.name} (${o.role})`).join(', ')}{d.telegramLinked ? ' · Telegram linked' : ''}</p>}</section>
            <section className="flex flex-wrap items-center gap-2 border-t border-[#263052] pt-3">
              <button type="button" className={btnGhost} disabled={busy} onClick={() => { if (confirm(`Sign ${d.user.email} out of every device?`)) void act(() => post(`${U}/revoke-sessions`), 'Signed out everywhere', reload); }}>Sign out everywhere</button>
              <button type="button" className={btnGhost} disabled={busy} onClick={() => void act(() => download(`${U}/export`, `user-${userId}.json`), 'Downloaded')}>Download their data (JSON)</button>
            </section>
            <section className="space-y-2 rounded-xl border border-[#5A2030] bg-[#1A0D14] p-3">
              <h3 className="text-sm font-bold text-[#FF8798]">Erase this person</h3>
              <p className="text-xs leading-relaxed text-[#C9A0AA]">Removes their name, email, sign-in links, memory and Telegram link, deletes their tasks and classes, and stops their forms taking answers (answers already given stay). Payments and usage records stay without a name. This cannot be undone.</p>
              <div className="flex flex-wrap gap-2"><input className={`${input} max-w-xs`} value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} placeholder="Type their email to confirm" aria-label="Confirm email" />
                <button type="button" className={btnDanger} disabled={busy || confirmEmail.trim().toLowerCase() !== d.user.email.toLowerCase()} onClick={() => void act(async () => { const r = await post(`${U}/erase`, { confirmEmail }); notify(`Erased. ${r.data.formsClosed} form(s) closed, ${r.data.tasksRemoved} task(s) and ${r.data.classesRemoved} class(es) removed.`); }, undefined, async () => { onChanged(); onClose(); })}>Erase permanently</button></div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
