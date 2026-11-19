import { api, btnDanger, btnGhost, Panel, useAct, useLoad, when, type Notify } from './adminKit';

/** Admin → Platform controls: business pages (bwenge4biz), reports against them, and hiding a page. */
interface Row { id: string; slug: string; name: string; published: boolean; suspended: { at: string; reason: string } | null; reports: number; updatedAt: string }
interface Data { businesses: Row[]; reports: Array<{ id: string; at: string; slug: string; reason: string; detail: string }> }

export default function BizCard({ notify }: { notify: Notify }) {
  const { data, reload } = useLoad(async () => (await api<{ data: Data }>('/api/admin/platform/biz')).data, notify);
  const { busy, act } = useAct(notify);
  if (!data) return null;
  const suspend = (r: Row) => { const reason = prompt(`Why hide ${r.name}? The owner will see this.`); if (reason?.trim()) void act(async () => { await api(`/api/admin/platform/biz/${r.slug}/suspend`, { method: 'POST', body: JSON.stringify({ reason }) }); reload(); }, 'Page hidden'); };
  const restore = (r: Row) => void act(async () => { await api(`/api/admin/platform/biz/${r.slug}/suspend`, { method: 'POST', body: JSON.stringify({ reason: null }) }); reload(); }, 'Page restored');
  return (
    <Panel title="Business pages" hint="Pages made with bwenge4biz. Pages with reports come first. Hiding a page makes it return “not found” to the public.">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#1E2848] p-3">
        <p className="min-w-0 flex-1 text-xs text-[#9AA6C9]"><b className="text-[#DCE3FA]">4biz venture page.</b> Makes or refreshes the page for MySEB, Bwenge AI and Bwenge4biz under “AI in our context” on your account, publishes it and gives you the blue verified badge. Safe to press again.</p>
        <button type="button" className={btnGhost} disabled={busy} onClick={() => void act(async () => { const r = await api<{ data: { url: string; created: boolean; verified: boolean } }>('/api/admin/platform/biz/venture', { method: 'POST', body: JSON.stringify({}) }); reload(); notify(`${r.data.created ? 'Created' : 'Refreshed'}: ${r.data.url}${r.data.verified ? ' (verified badge on)' : ''}`); })}>Create the 4biz page</button>
      </div>
      {!data.businesses.length ? <p className="text-sm text-[#9AA6C9]">No business pages yet.</p> : (
        <ul className="divide-y divide-[#1E2848]">{data.businesses.slice(0, 50).map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 py-2 text-sm text-[#DCE3FA]">
            <div className="min-w-0 flex-1"><a className="font-semibold underline" href={`/b/${r.slug}`} target="_blank" rel="noreferrer">{r.name}</a> <span className="text-xs text-[#8A97C2]">/b/{r.slug} · {r.suspended ? `hidden: ${r.suspended.reason}` : r.published ? 'live' : 'draft'} · {when(r.updatedAt)}</span></div>
            {r.reports > 0 && <span className="rounded-full bg-[#B3263E]/30 px-2 py-0.5 text-xs text-[#FF8798]">{r.reports} report{r.reports === 1 ? '' : 's'}</span>}
            {r.suspended ? <button type="button" className={btnGhost} disabled={busy} onClick={() => restore(r)}>Restore</button> : <button type="button" className={btnDanger} disabled={busy} onClick={() => suspend(r)}>Hide</button>}
          </li>))}</ul>)}
      {data.reports.length > 0 && <div className="mt-3"><p className="mb-1 text-xs font-semibold text-[#9AA6C9]">Latest reports</p><ul className="space-y-1 text-xs text-[#C9D3F0]">{data.reports.slice(0, 10).map((r) => <li key={r.id}><b>/b/{r.slug}</b> · {r.reason}{r.detail ? `: ${r.detail}` : ''} · {when(r.at)}</li>)}</ul></div>}
    </Panel>
  );
}
