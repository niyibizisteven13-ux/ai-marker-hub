import { useEffect, useState } from 'react';
import { ArrowUpRight, Brain, CalendarDays, CalendarRange, Clock, Database, FileBarChart2, GraduationCap, Loader2, ScanLine, Sparkles, type LucideIcon } from 'lucide-react';
import { authFetch } from '../../utils/authFetch';

/** Settings → Usage: the plan, credits used today / this week / this month, daily feature limits and plan limits. */

interface Meter { used: number; limit: number; resetsAt: string }
interface UsageData {
  plan: { id: 'FREE' | 'GO' | 'PRO' | 'INSTITUTION'; name: string; priceUsd: number | null; listPriceUsd: number | null; priceRwf: number | null; priceNote: string };
  credits: { day: Meter; week: Meter; month: Meter };
  features: Array<{ kind: 'tool' | 'vision' | 'artifact' | 'marking'; label: string; used: number; limit: number }>;
  limits: { maxMessageChars: number; maxAttachments: number; maxUploadMb: number; memory: boolean; memoryItems: number };
  recent: Array<{ at: string; kind: string; credits: number; channel: string }>;
  upgrade: 'PRO' | 'INSTITUTION' | null;
  pro: { priceUsd: number; listPriceUsd: number | null; priceRwf: number; daily: number };
}

const FEATURE_ICON: Record<string, LucideIcon> = { tool: Database, vision: ScanLine, artifact: FileBarChart2, marking: GraduationCap };
const KIND_LABEL: Record<string, string> = { chat: 'Chat reply', tool: 'Data or tool answer', vision: 'Image or scan read', artifact: 'File, chart or dashboard', marking: 'Marked script' };
const n = (v: number) => v.toLocaleString('en-US');

function resetText(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'Renews now';
  const h = Math.round(ms / 3_600_000);
  if (h < 1) return 'Renews within the hour';
  if (h < 36) return `Renews in ${h} h`;
  // Limits renew at midnight Kigali time, so dates are shown in that time zone.
  return `Renews ${new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Africa/Kigali' })}`;
}

function Bar({ used, limit }: { used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const tone = pct >= 100 ? 'bg-[var(--danger)]' : pct >= 80 ? 'bg-[var(--accent)]' : 'bg-[var(--teal)]';
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--bg)]" role="progressbar" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used}>
      <div className={`h-full rounded-full transition-all duration-500 ${tone}`} style={{ width: `${Math.max(pct, used > 0 ? 2 : 0)}%` }} />
    </div>
  );
}

export default function UsageSection() {
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUsage = async () => {
    try {
      const res = await authFetch('/api/usage');
      const data = await res.json();
      if (!res.ok || !data.plan) throw new Error(data.error || 'Could not load usage.');
      setUsage(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load usage.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void fetchUsage(); }, []);

  if (loading) {
    return <div className="flex items-center justify-center gap-2 py-12 text-center text-sm text-[var(--muted)]"><Loader2 size={18} className="animate-spin text-[var(--accent)]" /> Loading usage…</div>;
  }
  if (!usage) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl text-[var(--text)]">Usage & limits</h2>
        <p role="alert" className="text-sm text-[var(--danger)]">{error || 'Usage data is unavailable.'}</p>
        <button type="button" onClick={() => { setLoading(true); setError(null); void fetchUsage(); }} className="rounded-xl border border-[var(--line)] px-4 py-2 text-xs text-[var(--text)]">Retry</button>
      </div>
    );
  }

  const meters: Array<{ key: string; label: string; icon: LucideIcon; m: Meter }> = [
    { key: 'day', label: 'Today', icon: Clock, m: usage.credits.day },
    { key: 'week', label: 'This week', icon: CalendarDays, m: usage.credits.week },
    { key: 'month', label: 'This month', icon: CalendarRange, m: usage.credits.month },
  ];
  const isFree = usage.plan.id === 'FREE' || usage.plan.id === 'GO';

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="font-['Georgia',serif] text-xl font-normal text-[var(--text)]">Usage & limits</h2>
          <p className="mt-0.5 text-xs text-[var(--muted)]">Credits measure AI work: a chat reply is 1 credit, heavier work such as reading scans or building dashboards uses a few more.</p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1 text-xs font-semibold text-[var(--text)]">
          <Sparkles size={13} className="text-[var(--accent)]" /> {usage.plan.name} plan
        </span>
      </div>

      {usage.upgrade && (
        <div className="flex flex-col gap-3 rounded-2xl border border-[var(--accent)]/30 bg-[var(--accent)]/[0.06] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-[var(--text)]">
            {usage.upgrade === 'PRO' ? (
              <>
                <b>PRO</b> gives you {usage.pro.daily} credits a day, memory across all chats and larger files:{' '}
                {usage.pro.listPriceUsd ? <span className="text-[var(--muted)] line-through">${usage.pro.listPriceUsd}</span> : null} <b>${usage.pro.priceUsd}/month</b> <span className="text-[var(--muted)]">(about {n(usage.pro.priceRwf)} RWF)</span>.
              </>
            ) : (
              <><b>Institution</b> plans start at $50/month for 25 seats with shared credits and admin tools.</>
            )}
          </div>
          <a href="/upgrade?reason=usage" className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-[var(--on-accent)] hover:opacity-90">
            Upgrade <ArrowUpRight size={14} />
          </a>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {meters.map(({ key, label, icon: Icon, m }) => {
          const left = Math.max(0, m.limit - m.used);
          return (
            <div key={key} className="space-y-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-medium text-[var(--muted)]"><Icon size={14} /> {label}</span>
                <span className={`text-xs font-bold ${left === 0 ? 'text-[var(--danger)]' : 'text-[var(--text)]'}`}>{n(left)} left</span>
              </div>
              <div className="font-['Georgia',serif] text-2xl font-normal text-[var(--text)]">
                {n(m.used)} <span className="text-xs font-normal text-[var(--muted)]">/ {n(m.limit)} credits</span>
              </div>
              <Bar used={m.used} limit={m.limit} />
              <p className="text-[11px] text-[var(--muted)]">{resetText(m.resetsAt)}</p>
            </div>
          );
        })}
      </div>

      <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm">
        <h3 className="text-sm font-medium text-[var(--text)]">Daily feature limits</h3>
        <p className="mt-0.5 text-xs text-[var(--muted)]">These renew every day at midnight (Kigali time). Plain chat is limited only by your credits.</p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {usage.features.map((f) => {
            const Icon = FEATURE_ICON[f.kind] ?? Database;
            return (
              <div key={f.kind} className="flex items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--bg)]/40 p-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[var(--surface-2)] text-[var(--accent)]"><Icon size={16} /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate font-medium text-[var(--text)]">{f.label.charAt(0).toUpperCase() + f.label.slice(1)}</span>
                    <span className="shrink-0 tabular-nums text-[var(--muted)]">{f.used} / {f.limit}</span>
                  </div>
                  <div className="mt-1.5"><Bar used={f.used} limit={f.limit} /></div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm">
        <h3 className="text-sm font-medium text-[var(--text)]">Your plan includes</h3>
        <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
          {[
            ['Longest message', `${n(usage.limits.maxMessageChars)} characters`],
            ['Attachments per message', String(usage.limits.maxAttachments)],
            ['Largest upload', `${usage.limits.maxUploadMb} MB`],
            ['Credits per day / week / month', `${n(usage.credits.day.limit)} / ${n(usage.credits.week.limit)} / ${n(usage.credits.month.limit)}`],
          ].map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-3 border-b border-[var(--line)] py-2"><dt className="text-[var(--muted)]">{k}</dt><dd className="font-medium text-[var(--text)]">{v}</dd></div>
          ))}
          <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] py-2">
            <dt className="flex items-center gap-1.5 text-[var(--muted)]"><Brain size={13} /> Memory across all chats</dt>
            <dd className="font-medium">{usage.limits.memory ? <span className="text-[var(--teal)]">Included · {n(usage.limits.memoryItems)} memories</span> : <a href="/upgrade?reason=memory" className="text-[var(--accent)] hover:underline">PRO only · Upgrade</a>}</dd>
          </div>
        </dl>
      </div>

      <div className="space-y-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm">
        <h3 className="text-sm font-medium text-[var(--text)]">Recent activity</h3>
        {usage.recent.length === 0 ? (
          <p className="text-xs text-[var(--muted)]">No AI activity yet{isFree ? '. Your free credits are ready to use.' : '.'}</p>
        ) : (
          <div className="divide-y divide-[var(--line)] overflow-hidden rounded-xl border border-[var(--line)]">
            {usage.recent.map((r, i) => (
              <div key={i} className="flex items-center justify-between gap-3 bg-[var(--surface)] p-3 text-xs">
                <span className="min-w-0 truncate font-medium text-[var(--text)]">{KIND_LABEL[r.kind] ?? r.kind}{r.channel === 'telegram' ? <span className="ml-1.5 text-[var(--muted)]">· Telegram</span> : null}</span>
                <span className="flex shrink-0 items-center gap-3 text-[var(--muted)]">
                  <span className="tabular-nums">{r.credits} credit{r.credits === 1 ? '' : 's'}</span>
                  <span>{new Date(r.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
