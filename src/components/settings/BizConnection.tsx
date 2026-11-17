import { useEffect, useState } from 'react';
import { ArrowUpRight, Store } from 'lucide-react';
import { ownerApi } from '../../biz/api';

/** Settings → Connections: bwenge4biz. Shows whether the person has a business page and opens the business dashboard. */
export default function BizConnection() {
  const [state, setState] = useState<{ n: number; name?: string; live?: boolean } | null>(null);
  useEffect(() => { let alive = true; void ownerApi.mine().then((m) => { if (alive) setState({ n: m.businesses.length, name: m.businesses[0]?.name, live: m.businesses[0]?.published }); }).catch(() => { if (alive) setState({ n: 0 }); }); return () => { alive = false; }; }, []);
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--accent)]/15 text-[var(--accent)]"><Store size={22} aria-hidden="true" /></span>
          <div>
            <h3 className="font-display text-base font-semibold text-[var(--text)]">Bwenge4biz</h3>
            <p className="text-xs text-[var(--muted)]">Run your business here and show it to the world with a public page and a short link.</p>
          </div>
        </div>
        <span className="inline-flex items-center rounded-full bg-[var(--surface-2)] px-3 py-1 text-xs font-medium text-[var(--muted)]">
          {state === null ? '…' : state.n ? `${state.name}${state.live ? ' · live' : ' · not published'}` : 'No business yet'}
        </span>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-5">
        <p className="max-w-md text-xs leading-relaxed text-[var(--muted)]">Tell the Bwenge assistant “today I sold 5 loaves for 4,000” and it writes it in your private notebook. Your dashboard shows sales, profit, top products and low stock.</p>
        <a href="/biz" className="inline-flex items-center gap-2 rounded-xl bg-[var(--accent)] px-5 py-2.5 text-xs font-medium text-[var(--on-accent)] shadow-sm hover:opacity-90">
          {state?.n ? 'Open business dashboard' : 'Create my business'} <ArrowUpRight size={14} aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}
