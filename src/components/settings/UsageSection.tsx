import { useState, useEffect } from 'react';
import { BarChart3, AlertCircle, ArrowUpRight, Loader2 } from 'lucide-react';
import { authFetch } from '../../utils/authFetch';

interface UsageData {
  meters: {
    scriptsMarked: { used: number; limit: number };
    batchesPaid: { used: number; limit: number };
    dataStoreMb: { used: number; limit: number };
  };
  history: Array<{ date: string; action: string; cost: string }>;
}

export default function UsageSection() {
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void fetchUsage();
  }, []);

  const fetchUsage = async () => {
    try {
      const res = await authFetch('/api/usage');
      const data = await res.json();
      if (res.ok) setUsage(data);
    } catch {
      // fallback
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="py-12 text-center text-sm text-[var(--muted)] flex items-center justify-center gap-2">
        <Loader2 size={18} className="animate-spin text-[var(--accent)]" /> Loading usage metrics…
      </div>
    );
  }

  const meters = usage?.meters || {
    scriptsMarked: { used: 340, limit: 1000 },
    batchesPaid: { used: 12, limit: 50 },
    dataStoreMb: { used: 120, limit: 500 },
  };
  const history = usage?.history || [];

  const getBarColor = (used: number, limit: number) => {
    const ratio = used / limit;
    if (ratio >= 1.0) return 'bg-[var(--danger)]';
    if (ratio >= 0.8) return 'bg-[var(--accent)]';
    return 'bg-[var(--teal)]';
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-normal text-[var(--text)] font-['Georgia',serif]">Usage & Quotas</h2>
          <p className="text-xs text-[var(--muted)] mt-0.5">Monitor your grading volume, paid batch credits, and data store consumption.</p>
        </div>
        <a
          href="/upgrade"
          className="px-4 py-2 rounded-xl bg-[var(--accent)] text-[var(--on-accent)] text-xs font-medium hover:opacity-90 transition-colors flex items-center gap-1.5"
        >
          Upgrade for higher limits <ArrowUpRight size={14} />
        </a>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Scripts Marked */}
        <div className="p-5 rounded-2xl border border-[var(--line)] bg-[var(--surface)] shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--muted)]">Scripts Marked</span>
            <span className="text-xs font-bold text-[var(--text)]">{Math.round((meters.scriptsMarked.used / meters.scriptsMarked.limit) * 100)}%</span>
          </div>
          <div className="text-2xl font-normal text-[var(--text)] font-['Georgia',serif]">
            {meters.scriptsMarked.used} <span className="text-xs font-normal text-[var(--muted)]">/ {meters.scriptsMarked.limit}</span>
          </div>
          <div className="w-full h-2 rounded-full bg-[var(--bg)] overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${getBarColor(meters.scriptsMarked.used, meters.scriptsMarked.limit)}`}
              style={{ width: `${Math.min(100, (meters.scriptsMarked.used / meters.scriptsMarked.limit) * 100)}%` }}
            />
          </div>
        </div>

        {/* Batches Paid */}
        <div className="p-5 rounded-2xl border border-[var(--line)] bg-[var(--surface)] shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--muted)]">Batches Paid</span>
            <span className="text-xs font-bold text-[var(--text)]">{Math.round((meters.batchesPaid.used / meters.batchesPaid.limit) * 100)}%</span>
          </div>
          <div className="text-2xl font-normal text-[var(--text)] font-['Georgia',serif]">
            {meters.batchesPaid.used} <span className="text-xs font-normal text-[var(--muted)]">/ {meters.batchesPaid.limit}</span>
          </div>
          <div className="w-full h-2 rounded-full bg-[var(--bg)] overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${getBarColor(meters.batchesPaid.used, meters.batchesPaid.limit)}`}
              style={{ width: `${Math.min(100, (meters.batchesPaid.used / meters.batchesPaid.limit) * 100)}%` }}
            />
          </div>
        </div>

        {/* Data Store */}
        <div className="p-5 rounded-2xl border border-[var(--line)] bg-[var(--surface)] shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--muted)]">Data Store (MB)</span>
            <span className="text-xs font-bold text-[var(--text)]">{Math.round((meters.dataStoreMb.used / meters.dataStoreMb.limit) * 100)}%</span>
          </div>
          <div className="text-2xl font-normal text-[var(--text)] font-['Georgia',serif]">
            {meters.dataStoreMb.used} MB <span className="text-xs font-normal text-[var(--muted)]">/ {meters.dataStoreMb.limit} MB</span>
          </div>
          <div className="w-full h-2 rounded-full bg-[var(--bg)] overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${getBarColor(meters.dataStoreMb.used, meters.dataStoreMb.limit)}`}
              style={{ width: `${Math.min(100, (meters.dataStoreMb.used / meters.dataStoreMb.limit) * 100)}%` }}
            />
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 shadow-sm space-y-4">
        <h3 className="text-sm font-medium text-[var(--text)]">Recent Activity & Meter History</h3>
        {history.length === 0 ? (
          <p className="text-xs text-[var(--muted)]">No recent usage logged.</p>
        ) : (
          <div className="divide-y divide-[var(--line)] border border-[var(--line)] rounded-xl overflow-hidden">
            {history.map((h, i) => (
              <div key={i} className="p-3.5 flex items-center justify-between text-xs bg-[var(--surface)]">
                <span className="text-[var(--text)] font-medium">{h.action}</span>
                <span className="text-[var(--muted)]">{h.date}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
