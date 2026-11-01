import type { ReactNode } from 'react';
import { ArrowLeft, Search } from 'lucide-react';

/**
 * One layout for the workspace pages (Tasks, Forms, Practice, Classes): a calm near-black page, a header with an
 * icon, title, one-line purpose and the main action, then statistics, a toolbar and cards. Same spacing, type and
 * colours everywhere, so the product feels like one tool.
 */

export const ACCENT = '#D97757';

export function PageShell({ icon, title, subtitle, actions, onBack, backLabel = 'Back to chat', children, wide = false }: {
  icon: ReactNode; title: string; subtitle?: string; actions?: ReactNode; onBack?: () => void; backLabel?: string; children: ReactNode; wide?: boolean;
}) {
  return (
    <div className="min-h-full bg-[var(--ws-bg)] text-[var(--ws-text)]">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-[radial-gradient(55%_100%_at_50%_0%,rgba(217,119,87,0.10),transparent_70%)]" />
      {onBack && (
        <div className="relative px-4 pt-3 sm:px-6">
          <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] text-neutral-400 hover:bg-white/[0.05] hover:text-white"><ArrowLeft size={15} />{backLabel}</button>
        </div>
      )}
      <main className={`relative mx-auto w-full ${wide ? 'max-w-6xl' : 'max-w-5xl'} px-4 pb-16 pt-4 sm:px-6 sm:pt-6`}>
        <header className="flex flex-wrap items-start gap-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-[var(--brand)]/25 bg-[var(--brand)]/[0.12] text-[var(--brand-soft)]">{icon}</span>
          <div className="min-w-0 flex-1">
            <h1 className="text-[24px] font-semibold leading-tight tracking-tight text-white sm:text-[28px]">{title}</h1>
            {subtitle && <p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-neutral-400">{subtitle}</p>}
          </div>
          {actions && <div className="flex w-full flex-wrap gap-2 sm:w-auto">{actions}</div>}
        </header>
        <div className="mt-6 space-y-5">{children}</div>
      </main>
    </div>
  );
}

export function StatRow({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">{children}</div>;
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: 'good' | 'warn' }) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-[var(--ws-card)] px-4 py-3">
      <p className="text-[11.5px] font-medium uppercase tracking-wide text-neutral-500">{label}</p>
      <p className={`mt-1 text-[22px] font-semibold tabular-nums ${tone === 'good' ? 'text-emerald-300' : tone === 'warn' ? 'text-amber-300' : 'text-white'}`}>{value}</p>
      {hint && <p className="mt-0.5 truncate text-[11.5px] text-neutral-500">{hint}</p>}
    </div>
  );
}

/** Search box and a segmented filter. */
export function Toolbar<T extends string>({ query, onQuery, placeholder, filters, filter, onFilter }: {
  query: string; onQuery: (q: string) => void; placeholder: string; filters?: Array<{ id: T; label: string; count?: number }>; filter?: T; onFilter?: (f: T) => void;
}) {
  return (
    <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
      <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-white/[0.08] bg-[var(--ws-card)] px-3 py-2 focus-within:border-[var(--brand)]/50">
        <Search size={15} className="shrink-0 text-neutral-500" />
        <input value={query} onChange={(e) => onQuery(e.target.value)} placeholder={placeholder} className="min-w-0 flex-1 bg-transparent text-[13.5px] text-white placeholder:text-neutral-500 focus:outline-none" />
      </label>
      {filters && onFilter && (
        <div role="tablist" className="flex shrink-0 rounded-xl border border-white/[0.08] bg-[var(--ws-card)] p-0.5">
          {filters.map((f) => (
            <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} onClick={() => onFilter(f.id)}
              className={`rounded-[10px] px-3 py-1.5 text-[12.5px] font-medium transition ${filter === f.id ? 'bg-white/[0.09] text-white' : 'text-neutral-400 hover:text-neutral-200'}`}>
              {f.label}{f.count !== undefined && <span className="ml-1.5 tabular-nums text-neutral-500">{f.count}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Card({ children, onClick, className = '' }: { children: ReactNode; onClick?: () => void; className?: string }) {
  const base = `rounded-2xl border border-white/[0.07] bg-[var(--ws-card)] ${className}`;
  return onClick
    ? <div role="button" tabIndex={0} onClick={onClick} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }} className={`${base} cursor-pointer text-left transition hover:border-white/[0.16] hover:bg-[var(--ws-card-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/50`}>{children}</div>
    : <div className={base}>{children}</div>;
}

export function Empty({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/[0.12] px-6 py-14 text-center">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[var(--brand)]/[0.12] text-[var(--brand-soft)]">{icon}</span>
      <p className="mt-3 text-[15px] font-semibold text-white">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-[13px] text-neutral-400">{text}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export const primaryBtn = 'inline-flex items-center justify-center gap-1.5 rounded-xl bg-[var(--brand)] px-4 py-2.5 text-[13.5px] font-semibold text-white shadow-[0_6px_20px_-8px_rgba(217,119,87,0.7)] hover:bg-[var(--brand-strong)] disabled:opacity-40';
export const ghostBtn = 'inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/[0.1] px-3.5 py-2.5 text-[13px] font-medium text-neutral-200 hover:bg-white/[0.05] disabled:opacity-40';
export const iconBtn = 'grid h-8 w-8 place-items-center rounded-lg text-neutral-400 hover:bg-white/[0.07] hover:text-white';

/** "in 2 days", "3 h ago", "overdue by 1 day" for dates near now. */
export function relative(iso: string, now = Date.now()): string {
  const diff = Date.parse(iso) - now;
  const abs = Math.abs(diff);
  const [n, unit] = abs < 3600e3 ? [Math.max(1, Math.round(abs / 60e3)), 'min'] : abs < 86400e3 ? [Math.round(abs / 3600e3), 'h'] : [Math.round(abs / 86400e3), 'day'];
  const label = unit === 'day' && n !== 1 ? `${n} days` : `${n} ${unit}`;
  return diff >= 0 ? `in ${label}` : `${label} ago`;
}
