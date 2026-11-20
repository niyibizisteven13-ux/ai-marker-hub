import { useEffect, useState } from 'react';
import { BadgeCheck, Check, Copy, ExternalLink, Loader2, Plus, Store, UserRound } from 'lucide-react';
import { ownerApi } from '../../biz/api';

/**
 * Sidebar → Agents: the two agents a person can run, Bwenge4biz (a business or a creator page with its dashboard and assistant) and Bwenge4profile
 * (their own page for letters and emails, at bwenge.space/p/<name>), each with the person's own pages, whether they are live, and a copy-link button.
 */
interface Page { id: string; name: string; slug: string; category: string; published: boolean }
const host = () => (typeof window !== 'undefined' ? window.location.host.replace(/^www\./, '') : 'bwenge.space');
const origin = () => (typeof window !== 'undefined' ? window.location.origin : 'https://www.bwenge.space');
export const publicPath = (p: Pick<Page, 'slug' | 'category'>) => `/${p.category === 'profile' ? 'p' : 'b'}/${p.slug}`;
const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/70';

function Section({ icon: Icon, title, text, pages, newLabel, onNew, studio, onGo, empty }: { icon: typeof Store; title: string; text: string; pages: Page[] | null; newLabel: string; onNew: () => void; studio: (p: Page) => string; onGo: () => void; empty: string }) {
  const [copied, setCopied] = useState('');
  const copy = async (p: Page) => { try { await navigator.clipboard.writeText(`${origin()}${publicPath(p)}`); setCopied(p.id); window.setTimeout(() => setCopied(''), 1600); } catch { /* the link is shown, copy by hand */ } };
  return (
    <section className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--brand)]/15 text-[var(--brand)]"><Icon size={19} aria-hidden="true" /></span>
        <div className="min-w-0"><h3 className="text-[14px] font-semibold text-white">{title}</h3><p className="mt-0.5 text-[12px] leading-snug text-[var(--app-faint)]">{text}</p></div>
      </div>
      <ul className="mt-3 space-y-1.5">
        {pages === null && <li className="flex items-center gap-2 px-1 py-2 text-xs text-[var(--app-faint)]"><Loader2 size={13} className="animate-spin" aria-hidden="true" />Loading…</li>}
        {pages?.length === 0 && <li className="px-1 py-1 text-xs text-[var(--app-faint)]">{empty}</li>}
        {pages?.map((p) => (
          <li key={p.id} className="rounded-xl bg-black/20 p-2.5">
            <a href={studio(p)} onClick={onGo} className={`flex items-center gap-2 rounded-md ${FOCUS}`}>
              <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${p.published ? 'bg-emerald-400' : 'bg-white/25'}`} />
              <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-white">{p.name}</span>
              <span className="shrink-0 text-[10.5px] font-medium uppercase tracking-wide text-[var(--app-faint)]">{p.published ? 'Live' : 'Draft'}</span>
            </a>
            <div className="mt-1.5 flex items-center gap-1.5">
              <code className="min-w-0 flex-1 truncate rounded-md bg-white/[0.05] px-2 py-1 text-[11.5px] text-[var(--app-muted)]" title={`${host()}${publicPath(p)}`}>{host()}{publicPath(p)}</code>
              <button type="button" onClick={() => void copy(p)} aria-label={`Copy the link of ${p.name}`} className={`grid h-7 w-7 shrink-0 place-items-center rounded-md text-[var(--app-muted)] hover:bg-white/[0.08] hover:text-white ${FOCUS}`}>{copied === p.id ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}</button>
              {p.published && <a href={publicPath(p)} target="_blank" rel="noreferrer" aria-label={`Open the page of ${p.name}`} className={`grid h-7 w-7 shrink-0 place-items-center rounded-md text-[var(--app-muted)] hover:bg-white/[0.08] hover:text-white ${FOCUS}`}><ExternalLink size={14} /></a>}
            </div>
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => { onGo(); onNew(); }} className={`mt-2.5 flex h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-white/10 text-[13px] font-medium text-white hover:bg-white/[0.06] ${FOCUS}`}><Plus size={15} aria-hidden="true" />{newLabel}</button>
    </section>
  );
}

export default function AgentsPanel({ onGo }: { onGo: () => void }) {
  const [pages, setPages] = useState<Page[] | null>(null); const [locked, setLocked] = useState(false);
  useEffect(() => {
    let alive = true;
    ownerApi.mine().then((m) => { if (!alive) return; setLocked(!!m.locked); setPages(m.businesses.map((b) => ({ id: b.id, name: b.name, slug: b.slug, category: ('category' in b ? (b as { category?: string }).category : undefined) ?? 'other', published: !!b.published }))); }).catch(() => { if (alive) setPages([]); });
    return () => { alive = false; };
  }, []);
  const go = (href: string) => () => { window.location.href = href; };
  const biz = pages === null ? null : pages.filter((p) => p.category !== 'profile'); const prof = pages === null ? null : pages.filter((p) => p.category === 'profile');
  return (
    <div className="space-y-3 px-3 pb-4">
      <p className="px-1 pt-1 text-[12px] leading-snug text-[var(--app-faint)]">Agents run something for you, with a public page, a dashboard and an assistant that knows it.</p>
      {locked && <p className="flex items-center gap-2 rounded-xl bg-amber-400/10 px-3 py-2 text-xs text-amber-200"><BadgeCheck size={14} aria-hidden="true" />Needs a paid plan. Open an agent to see the plans.</p>}
      <Section icon={Store} title="Bwenge4biz" text="A page, sales notebook, stock and assistant for a business or a creator." pages={biz} newLabel="New business or creator page" onNew={go('/biz')} studio={(p) => `/biz?page=${encodeURIComponent(p.id)}`} onGo={onGo} empty="No business page yet." />
      <Section icon={UserRound} title="Bwenge4profile" text="Your own page for application letters and emails: studies, projects, videos, skills." pages={prof} newLabel="Create my profile" onNew={go('/profile')} studio={(p) => `/profile?page=${encodeURIComponent(p.id)}`} onGo={onGo} empty="No profile yet. Your link will be bwenge.space/p/your-name." />
    </div>
  );
}
