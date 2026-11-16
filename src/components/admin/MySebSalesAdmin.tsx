import { useEffect, useState } from 'react';
import { api, btnDanger, btnGhost, btnPrimary, input, Panel, post, Stat, td, th, Toggle, useAct, useLoad, ago, when, type Notify } from './adminKit';

/**
 * Admin → MySEB sales: MySEB is sold (a monthly plan or one test). Payment is by Mobile Money and WhatsApp for now: the lecturer pays,
 * sends the screenshot, taps "I have paid", and you enable them here (from the waiting list, or by typing their email).
 */
type Plan = 'MONTH' | 'TEST';
interface Req { id: string; userId: string; email: string; name: string; plan: Plan; note: string; status: string; createdAt: string; decidedAt?: string }
interface Data {
  charging: boolean; config: { monthUsd: number; testRwf: number; momoCode: string; momoName: string; whatsapp: string }; monthRwf: number;
  pending: Req[]; recent: Req[]; subscribers: Array<{ userId: string; email: string; name: string; monthUntil: string | null; tests: number; history: Array<{ at: string; plan: Plan; by: string; note?: string }> }>;
}
const A = '/api/admin/myseb-access';
const rwf = (n: number) => `${Math.round(n).toLocaleString('en-US')} RWF`;

export default function MySebSalesAdmin({ notify }: { notify: Notify }) {
  const { data, reload } = useLoad(async () => (await api<{ data: Data }>(A)).data, notify, 20_000);
  const { busy, act } = useAct(notify);
  const [f, setF] = useState({ monthUsd: '5', testRwf: '1500', momoCode: '', momoName: '', whatsapp: '' });
  const [g, setG] = useState({ email: '', plan: 'MONTH' as Plan, count: '1', note: '' });
  const [pick, setPick] = useState<Record<string, { plan: Plan; count: string }>>({});
  useEffect(() => { if (data) setF({ monthUsd: String(data.config.monthUsd), testRwf: String(data.config.testRwf), momoCode: data.config.momoCode, momoName: data.config.momoName, whatsapp: data.config.whatsapp ? `+${data.config.whatsapp}` : '' }); }, [data?.config.monthUsd, data?.config.testRwf, data?.config.momoCode, data?.config.momoName, data?.config.whatsapp]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return <p className="text-sm text-[#9AA6C9]">Loading…</p>;
  const countBody = (plan: Plan, count: string) => (plan === 'MONTH' ? { months: Math.max(1, Number(count) || 1) } : { tests: Math.max(1, Number(count) || 1) });
  const setCharging = (on: boolean) => act(() => api('/api/admin/platform/settings', { method: 'PUT', body: JSON.stringify({ flags: { 'myseb.requirePayment': on } }) }), on ? 'MySEB is now paid' : 'MySEB is now free for everyone', reload);

  return (
    <div className="space-y-5">
      <Panel title="Charge for MySEB" hint="On: a lecturer needs a monthly plan or a test credit to get a code for students. Off: MySEB is free for everyone. Administrators are never charged. Students never pay.">
        <div className="flex items-center gap-3">
          <Toggle on={data.charging} disabled={busy} label="Charge for MySEB" onChange={(v) => { if (v || confirm('Make MySEB free for every lecturer?')) void setCharging(v); }} />
          <span className={`text-sm font-semibold ${data.charging ? 'text-[#5FD39B]' : 'text-[#F2C230]'}`}>{data.charging ? 'Paid: lecturers need a plan or a test credit' : 'Free for everyone'}</span>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Waiting for you" value={data.pending.length} tone={data.pending.length ? 'warn' : undefined} /><Stat label="With access now" value={data.subscribers.length} />
          <Stat label="Monthly price" value={`US$${data.config.monthUsd}`} /><Stat label="Monthly in RWF (today's rate)" value={rwf(data.monthRwf)} />
        </div>
      </Panel>

      <Panel title="Waiting for you" hint="Lecturers who paid and pressed “I have paid”. Check the WhatsApp screenshot or your Mobile Money messages, then press Enable.">
        {data.pending.length === 0 && <p className="text-sm text-[#9AA6C9]">Nobody is waiting.</p>}
        <ul className="divide-y divide-[#263052]">
          {data.pending.map((r) => {
            const sel = pick[r.id] ?? { plan: r.plan, count: '1' };
            return (
              <li key={r.id} className="space-y-2 py-3">
                <p className="text-sm text-white"><b>{r.email}</b> <span className="text-[#9AA6C9]">({r.name}) asked for {r.plan === 'MONTH' ? 'the monthly plan' : 'one test'} {ago(r.createdAt)}</span></p>
                {r.note && <p className="text-xs text-[#9AA6C9]">Note: “{r.note}”</p>}
                <div className="flex flex-wrap items-center gap-2">
                  <select className={`${input} w-auto`} value={sel.plan} onChange={(e) => setPick((x) => ({ ...x, [r.id]: { ...sel, plan: e.target.value as Plan } }))} aria-label={`Plan for ${r.email}`}><option value="MONTH">Monthly (30 days each)</option><option value="TEST">Tests</option></select>
                  <input className={`${input} w-20`} inputMode="numeric" value={sel.count} onChange={(e) => setPick((x) => ({ ...x, [r.id]: { ...sel, count: e.target.value.replace(/\D/g, '') } }))} aria-label={sel.plan === 'MONTH' ? 'Months' : 'Tests'} />
                  <span className="text-xs text-[#9AA6C9]">{sel.plan === 'MONTH' ? 'month(s)' : 'test(s)'}</span>
                  <button type="button" className={btnPrimary} disabled={busy} onClick={() => void act(() => post(`${A}/requests/${r.id}/approve`, { plan: sel.plan, ...countBody(sel.plan, sel.count) }), `${r.email} can now use MySEB`, reload)}>Enable</button>
                  <button type="button" className={btnGhost} disabled={busy} onClick={() => { if (confirm(`Reject ${r.email}'s request?`)) void act(() => post(`${A}/requests/${r.id}/reject`), 'Rejected', reload); }}>Reject</button>
                </div>
              </li>
            );
          })}
        </ul>
      </Panel>

      <Panel title="Enable someone by email" hint="Use this when you were paid and they did not press “I have paid”. They must have signed in to Bwenge once.">
        <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); void act(() => post(`${A}/grant`, { email: g.email.trim(), plan: g.plan, ...countBody(g.plan, g.count), ...(g.note.trim() ? { note: g.note.trim() } : {}) }), `${g.email.trim()} can now use MySEB`, async () => { setG((x) => ({ ...x, email: '', note: '' })); await reload(); }); }}>
          <input className={`${input} min-w-[14rem] flex-1`} type="email" required value={g.email} onChange={(e) => setG({ ...g, email: e.target.value })} placeholder="Their email on Bwenge" aria-label="Email to enable" />
          <select className={`${input} w-auto`} value={g.plan} onChange={(e) => setG({ ...g, plan: e.target.value as Plan })} aria-label="Plan"><option value="MONTH">Monthly</option><option value="TEST">Tests</option></select>
          <input className={`${input} w-20`} inputMode="numeric" value={g.count} onChange={(e) => setG({ ...g, count: e.target.value.replace(/\D/g, '') })} aria-label="How many" />
          <input className={`${input} min-w-[10rem] flex-1`} value={g.note} onChange={(e) => setG({ ...g, note: e.target.value })} placeholder="Note (for example the MoMo reference)" aria-label="Note" />
          <button type="submit" className={btnPrimary} disabled={busy || !g.email.trim()}>Enable</button>
        </form>
      </Panel>

      <Panel title="People with access" hint="A monthly plan that has not ended, or test credits left. Paying again before the end adds to it.">
        <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left"><thead className="border-b border-[#263052]"><tr><th className={th}>Email</th><th className={th}>Monthly until</th><th className={th}>Test credits</th><th className={th}>Last given</th><th className={th} /></tr></thead>
          <tbody className="divide-y divide-[#263052]">
            {data.subscribers.map((s) => (
              <tr key={s.userId}><td className={`${td} font-semibold text-white`}>{s.email}<span className="block text-[11px] font-normal text-[#6C789E]">{s.name}</span></td><td className={td}>{s.monthUntil ? when(s.monthUntil) : '–'}</td><td className={td}>{s.tests}</td><td className={`${td} text-xs text-[#9AA6C9]`}>{s.history.length ? `${ago(s.history[s.history.length - 1].at)}${s.history[s.history.length - 1].note ? ` · ${s.history[s.history.length - 1].note}` : ''}` : '–'}</td>
                <td className={td}><button type="button" className={btnDanger} disabled={busy} onClick={() => { if (confirm(`Remove ${s.email}'s MySEB access?`)) void act(() => post(`${A}/revoke`, { userId: s.userId }), 'Access removed', reload); }}>Remove</button></td></tr>
            ))}
            {!data.subscribers.length && <tr><td className={td} colSpan={5}>Nobody has access yet.</td></tr>}
          </tbody></table></div>
      </Panel>

      <Panel title="Prices and where to pay" hint="This is what lecturers see in the live room. The WhatsApp number needs its country code, for example +250788123456.">
        <form className="grid gap-3 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void act(() => api(`${A}/config`, { method: 'PUT', body: JSON.stringify({ monthUsd: Number(f.monthUsd), testRwf: Number(f.testRwf), momoCode: f.momoCode.trim(), momoName: f.momoName.trim(), whatsapp: f.whatsapp.trim() }) }), 'Saved', reload); }}>
          <label className="text-xs text-[#9AA6C9]">Monthly price (US$)<input className={input} inputMode="decimal" value={f.monthUsd} onChange={(e) => setF({ ...f, monthUsd: e.target.value })} /></label>
          <label className="text-xs text-[#9AA6C9]">One test (RWF)<input className={input} inputMode="numeric" value={f.testRwf} onChange={(e) => setF({ ...f, testRwf: e.target.value.replace(/\D/g, '') })} /></label>
          <label className="text-xs text-[#9AA6C9]">MTN Mobile Money code<input className={input} inputMode="numeric" value={f.momoCode} onChange={(e) => setF({ ...f, momoCode: e.target.value.replace(/\D/g, '') })} /></label>
          <label className="text-xs text-[#9AA6C9]">Name on the code<input className={input} value={f.momoName} onChange={(e) => setF({ ...f, momoName: e.target.value })} /></label>
          <label className="text-xs text-[#9AA6C9] md:col-span-2">WhatsApp number for the payment screenshot<input className={input} value={f.whatsapp} onChange={(e) => setF({ ...f, whatsapp: e.target.value })} placeholder="+250788123456" />{!data.config.whatsapp && <span className="mt-1 block text-[#F2C230]">Not set yet: lecturers are told to ask you for it until you add it here.</span>}</label>
          <div className="md:col-span-2"><button type="submit" className={btnPrimary} disabled={busy}>Save</button></div>
        </form>
      </Panel>

      {data.recent.length > 0 && (
        <Panel title="Recently decided"><ul className="divide-y divide-[#263052] text-sm text-[#DCE3FA]">{data.recent.map((r) => <li key={r.id} className="py-1.5">{r.email} · {r.plan === 'MONTH' ? 'monthly' : 'one test'} · <span className={r.status === 'approved' ? 'text-[#5FD39B]' : 'text-[#FF8798]'}>{r.status}</span> · {ago(r.decidedAt)}</li>)}</ul></Panel>
      )}
    </div>
  );
}
