import { tx } from '../../biz/studioI18n';
import type { ReactNode } from 'react';
import { Globe, Lock } from 'lucide-react';

/** Small pieces shared by the business workspace screens. Colours come from the --app-* tokens the workspace sets (light surface). */
export const card = 'rounded-2xl border border-[var(--app-line)] bg-[var(--app-panel)] p-5 shadow-[0_1px_2px_rgba(14,23,34,0.04)]';
export const input = 'w-full rounded-xl border border-[var(--app-line)] bg-[var(--app-bg)] px-3.5 py-2.5 text-sm text-[var(--app-text)] outline-none placeholder:text-[var(--app-faint)] focus:border-[var(--brand)]';
export const btn = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold disabled:opacity-50';
export const btnPrimary = `${btn} bg-[var(--brand)] text-[var(--brand-on)] hover:opacity-90`;
export const btnGhost = `${btn} border border-[var(--app-line)] bg-[var(--app-panel)] text-[var(--app-text)] hover:bg-[var(--app-panel-hover)]`;
export const msg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Please try again.');
export const rwfShort = (n: number) => (Math.abs(n) >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M` : Math.abs(n) >= 1000 ? `${Math.round(n / 100) / 10}K`.replace(/\.0K$/, 'K') : String(n));

export function Tag({ kind }: { kind: 'public' | 'private' }) {
  return kind === 'public'
    ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-700"><Globe size={11} />{tx("Visitors see this")}</span>
    : <span className="inline-flex items-center gap-1 rounded-full bg-[var(--app-panel-hover)] px-2 py-0.5 text-[11px] font-medium text-[var(--app-muted)]"><Lock size={11} />{tx("Only you see this")}</span>;
}
export const Title = ({ children, kind, hint }: { children: ReactNode; kind?: 'public' | 'private'; hint?: string }) => (
  <div className="mb-4"><div className="flex flex-wrap items-center gap-2"><h2 className="font-display text-lg font-semibold tracking-tight">{children}</h2>{kind && <Tag kind={kind} />}</div>{hint && <p className="mt-1 text-sm text-[var(--app-muted)]">{hint}</p>}</div>
);

/** Shown where a feature needs a paid plan (videos, the business agent, online payments). Photos, the page, the notebook and the feed stay free. */
export const PaidNote = ({ what, url = '/upgrade' }: { what: string; url?: string }) => (
  <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--brand)]/40 bg-[var(--brand)]/10 px-4 py-3 text-sm"><Lock size={16} className="shrink-0" aria-hidden="true" /><p className="min-w-0 flex-1"><b>{what}</b> {what.endsWith('s') ? 'are' : 'is'} for paid plans. Everything else here is free.</p><a href={url} className="rounded-xl bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-[var(--brand-on)]">{tx("See plans")}</a></div>
);
