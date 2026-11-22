import { useEffect, useState } from 'react';
import { ArrowUpRight, Bot, KeyRound, Store, UserRound } from 'lucide-react';
import { ownerApi } from '../../biz/api';

/**
 * Settings → Connections: Bwenge4biz as a list of connections. Every row reads its status from the person's own business (nothing is assumed),
 * and Manage opens the right place in the business dashboard.
 */
interface Row { id: string; icon: typeof Store; name: string; text: string; status: string; on: boolean; href: string }
const LEVEL: Record<string, string> = { off: 'Off', watch: 'Watching', assist: 'Assisting', run: 'Running' };

export default function BizConnection() {
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const m = await ownerApi.mine();
      const b = m.businesses.find((page) => page.category !== 'profile');
      const profile = m.businesses.find((page) => page.category === 'profile');
      const [sec, agent] = b ? await Promise.all([ownerApi.secrets(b.id).catch(() => null), ownerApi.agent(b.id).catch(() => null)]) : [null, null];
      const list: Row[] = [
        { id: 'biz', icon: Store, name: 'Bwenge4Biz', text: 'Business page with a short link, sales notebook, stock and dashboard.', status: b ? `${b.name} · ${b.published ? 'live' : 'not published'}` : 'No business yet', on: !!b, href: '/biz' },
        { id: 'profile', icon: UserRound, name: 'Bwenge4Profile', text: 'Personal portfolio with a biography, CV, journey, and updates.', status: profile ? `${profile.name} · ${profile.published ? 'live' : 'not published'}` : 'No profile yet', on: !!profile, href: '/profile' },
        { id: 'agent', icon: Bot, name: 'Business agent', text: 'Morning plan, closing summary, instant alerts, one-tap approvals.', status: agent ? LEVEL[agent.level] ?? 'Off' : 'Off', on: !!agent && agent.level !== 'off', href: '/biz?view=agent' },
        { id: 'mtn', icon: KeyRound, name: 'MTN MoMo payments', text: 'Customers pay from your page; you approve nothing, MTN prompts them.', status: sec?.mtn.set ? `Keys saved · ${sec.mtn.environment}` : 'Not connected', on: !!sec?.mtn.set, href: '/biz?view=secrets' },
        { id: 'airtel', icon: KeyRound, name: 'Airtel Money payments', text: 'The same, for Airtel numbers.', status: sec?.airtel.set ? `Keys saved · ${sec.airtel.environment}` : 'Not connected', on: !!sec?.airtel.set, href: '/biz?view=secrets' },
      ];
      if (alive) setRows(b ? list : list.slice(0, 2));
    })().catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, []);
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)]">
      <div className="border-b border-[var(--line)] px-6 py-4"><h3 className="font-display text-base font-semibold text-[var(--text)]">Business and personal profile</h3></div>
      {rows === null ? <p className="px-6 py-5 text-xs text-[var(--muted)]">Loading…</p> : rows.length === 0 ? <p role="status" className="px-6 py-5 text-xs text-[var(--muted)]">Could not load your pages.</p> : (
        <ul className="divide-y divide-[var(--line)]">{rows.map((r) => { const Icon = r.icon; return (
          <li key={r.id} className="flex flex-wrap items-center gap-4 px-6 py-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)]/15 text-[var(--accent)]"><Icon size={18} aria-hidden="true" /></span>
            <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-[var(--text)]">{r.name}</p><p className="text-xs text-[var(--muted)]">{r.text}</p></div>
            <span className={`rounded-full px-3 py-1 text-xs font-medium ${r.on ? 'bg-[var(--teal)]/15 text-[var(--teal)]' : 'bg-[var(--surface-2)] text-[var(--muted)]'}`}>{r.status}</span>
            <a href={r.href} className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--line)] px-3.5 py-2 text-xs font-medium text-[var(--text)] hover:bg-[var(--surface-2)]">{r.on || (r.id !== 'biz' && r.id !== 'profile') ? 'Manage' : 'Create'} <ArrowUpRight size={13} aria-hidden="true" /></a>
          </li>); })}</ul>)}
    </div>
  );
}
