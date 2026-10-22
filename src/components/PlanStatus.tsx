import { useCallback, useEffect, useState } from 'react';
import { Coins, Loader2, Sparkles } from 'lucide-react';
import { authFetch } from '../utils/authFetch';

/**
 * The user's state at a glance (sidebar): plan, credits left today, GO balance, renewal date and any pending
 * Mobile Money payment. Refreshes after each reply ("bwenge:usage" event) and when the window regains focus.
 */

export interface BillingMe {
  plan: 'FREE' | 'GO' | 'PRO' | 'INSTITUTION'; planName: string;
  subscription: { planType: string; endDate: string | null; daysLeft: number | null } | null;
  wallet: number;
  pendingPayment: { id: string; amountRwf: number } | null;
  usage: { day: { used: number; limit: number } };
}

export function useBillingMe(enabled: boolean) {
  const [me, setMe] = useState<BillingMe | null>(null);
  const load = useCallback(async () => {
    if (!enabled) return;
    try {
      const res = await authFetch('/api/billing/me');
      if (res.ok) setMe(await res.json());
    } catch { /* keep the last state */ }
  }, [enabled]);
  useEffect(() => {
    void load();
    const refresh = () => void load();
    window.addEventListener('bwenge:usage', refresh);
    window.addEventListener('focus', refresh);
    return () => { window.removeEventListener('bwenge:usage', refresh); window.removeEventListener('focus', refresh); };
  }, [load]);
  return me;
}

const TONE: Record<BillingMe['plan'], string> = {
  FREE: 'bg-white/[0.06] text-[#C2C0B6]',
  GO: 'bg-sky-400/12 text-sky-300',
  PRO: 'bg-amber-400/12 text-amber-300',
  INSTITUTION: 'bg-indigo-400/15 text-indigo-300',
};

export default function PlanStatus({ me, collapsed }: { me: BillingMe | null; collapsed: boolean }) {
  if (!me) return null;
  const left = Math.max(0, me.usage.day.limit - me.usage.day.used);
  const pct = me.usage.day.limit ? Math.min(100, (me.usage.day.used / me.usage.day.limit) * 100) : 0;
  const paid = me.plan === 'PRO' || me.plan === 'INSTITUTION';
  const renew = me.subscription?.endDate ? new Date(me.subscription.endDate).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'Africa/Kigali' }) : null;
  if (collapsed) {
    return (
      <a href="/upgrade" title={`${me.planName} · ${left} credits left today`} className={`mx-auto mb-1 hidden h-7 min-w-10 items-center justify-center rounded-md px-1.5 text-[10px] font-bold uppercase tracking-wide lg:flex ${TONE[me.plan]}`}>
        {me.plan === 'INSTITUTION' ? 'ORG' : me.plan}
      </a>
    );
  }
  return (
    <div className={`mb-1 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 ${collapsed ? 'lg:hidden' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${TONE[me.plan]}`}>
          {paid && <Sparkles size={10} />}{me.planName}
        </span>
        <span className="truncate text-[11px] text-[#9C9A92]">
          {me.pendingPayment ? <span className="inline-flex items-center gap-1 text-amber-300"><Loader2 size={11} className="animate-spin" /> Payment pending</span>
            : paid && renew ? `Renews ${renew}${me.subscription?.daysLeft != null && me.subscription.daysLeft <= 3 ? ' · soon' : ''}`
              : <a href="/upgrade" className="font-semibold text-[#D97757] hover:underline">Upgrade</a>}
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-[#C2C0B6]">
        <span>{left} of {me.usage.day.limit} credits left today</span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/[0.07]">
        <div className={`h-full rounded-full ${pct >= 100 ? 'bg-rose-400' : pct >= 80 ? 'bg-[#D97757]' : 'bg-[#5DCAA5]'}`} style={{ width: `${Math.max(pct, me.usage.day.used ? 3 : 0)}%` }} />
      </div>
      {me.wallet > 0 && <div className="mt-1.5 flex items-center gap-1 text-[11px] text-sky-300"><Coins size={11} /> {me.wallet.toLocaleString('en-US')} GO credits</div>}
    </div>
  );
}
