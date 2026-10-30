import { useEffect, useState } from 'react';
import { ArrowUpRight, CheckCircle2, Clock, Coins, Loader2, Receipt, Sparkles, XCircle } from 'lucide-react';
import { authFetch } from '../../utils/authFetch';
import { openReceipt } from '../../pages/UpgradePage';

/** Settings → Billing: current plan and renewal, GO credits, and Mobile Money payments with receipts. */

interface Me { plan: 'FREE' | 'GO' | 'STARTER' | 'PRO' | 'PLUS' | 'INSTITUTION'; planName: string; wallet: number; subscription: { planType: string; endDate: string | null; daysLeft: number | null } | null; payments: 'ready' | 'unavailable' }
interface Payment { id: string; purpose: string; months: number; credits: number; amountRwf: number; currency: string; status: string; receiptNumber: string | null; createdAt: string; paidAt: string | null; phoneMasked: string }

const SERIF = "font-['Georgia','Tiempos_Headline','Times_New_Roman',serif]";
const STATUS: Record<string, { label: string; icon: React.ReactNode; tone: string }> = {
  SUCCESSFUL: { label: 'Paid', icon: <CheckCircle2 size={13} />, tone: 'text-[var(--teal)]' },
  PENDING: { label: 'Pending', icon: <Clock size={13} />, tone: 'text-[var(--accent)]' },
  FAILED: { label: 'Failed', icon: <XCircle size={13} />, tone: 'text-[var(--danger)]' },
  EXPIRED: { label: 'Not approved', icon: <XCircle size={13} />, tone: 'text-[var(--muted)]' },
};
const PLAN_NAME: Record<string, string> = { STARTER: 'Starter', PRO: 'Teacher', PLUS: 'Teacher Plus', INSTITUTION: 'Institution' };
const itemOf = (p: Payment) => (p.purpose === 'GO_PACK' ? `Top-up · ${p.credits.toLocaleString('en-US')} credits` : `${PLAN_NAME[p.purpose] ?? p.purpose} · ${p.months} month${p.months > 1 ? 's' : ''}`);

export default function BillingSection() {
  const [me, setMe] = useState<Me | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [m, p] = await Promise.all([authFetch('/api/billing/me'), authFetch('/api/billing/payments')]);
        if (!m.ok) throw new Error('Billing details are unavailable.');
        setMe(await m.json());
        if (p.ok) setPayments((await p.json()).payments ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Billing details are unavailable.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="flex items-center justify-center gap-2 py-12 text-sm text-[var(--muted)]"><Loader2 size={18} className="animate-spin text-[var(--accent)]" /> Loading billing…</div>;
  if (!me) return <div className="space-y-3"><h2 className="text-xl text-[var(--text)]">Billing</h2><p role="alert" className="text-sm text-[var(--danger)]">{error}</p></div>;

  const paid = me.plan !== 'FREE' && me.plan !== 'GO';
  const end = me.subscription?.endDate ? new Date(me.subscription.endDate).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className={`${SERIF} text-xl font-normal text-[var(--text)]`}>Billing</h2>
        <p className="mt-0.5 text-xs text-[var(--muted)]">Your plan, top-up credits and Mobile Money payments. Receipts are also emailed to you.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm">
          <span className="text-xs font-medium text-[var(--muted)]">Current plan</span>
          <div className="flex items-center gap-2">
            {paid && <Sparkles size={18} className="text-[var(--accent)]" />}
            <h3 className={`${SERIF} text-2xl font-normal text-[var(--text)]`}>{me.planName}</h3>
          </div>
          <p className="text-xs text-[var(--muted)]">
            {paid && end ? <>Active until <b className="text-[var(--text)]">{end}</b>{me.subscription?.daysLeft != null && me.subscription.daysLeft <= 3 ? ' · ends soon' : ''}. Mobile Money does not renew automatically.</> : me.plan === 'GO' ? 'Free allowance plus your top-up credits.' : 'Free monthly allowance.'}
          </p>
          <a href={paid ? '/upgrade?renew=1' : '/upgrade'} className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-[var(--on-accent)] hover:opacity-90">
            {paid ? 'Renew or change plan' : 'See plans'} <ArrowUpRight size={14} />
          </a>
        </div>
        <div className="space-y-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm">
          <span className="flex items-center gap-1.5 text-xs font-medium text-[var(--muted)]"><Coins size={14} /> Top-up credits</span>
          <div className={`${SERIF} text-2xl font-normal text-[var(--text)]`}>{me.wallet.toLocaleString('en-US')} <span className="text-xs text-[var(--muted)]">credits</span></div>
          <p className="text-xs text-[var(--muted)]">Used automatically when your plan's daily, weekly or monthly allowance runs out.</p>
          <a href="/upgrade" className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--line)] px-4 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--hover)]">Buy credits from 500 RWF <ArrowUpRight size={14} /></a>
        </div>
      </div>

      <div className="space-y-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm">
        <h3 className="flex items-center gap-2 text-sm font-medium text-[var(--text)]"><Receipt size={15} /> Payments & receipts</h3>
        {payments.length === 0 ? (
          <p className="text-xs text-[var(--muted)]">No payments yet.</p>
        ) : (
          <div className="divide-y divide-[var(--line)] overflow-hidden rounded-xl border border-[var(--line)]">
            {payments.map((p) => {
              const st = STATUS[p.status] ?? STATUS.PENDING;
              return (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 bg-[var(--surface)] p-3 text-xs">
                  <div className="min-w-0">
                    <div className="font-medium text-[var(--text)]">{itemOf(p)}</div>
                    <div className="text-[var(--muted)]">{new Date(p.paidAt ?? p.createdAt).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} · MoMo {p.phoneMasked}{p.receiptNumber ? ` · ${p.receiptNumber}` : ''}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-semibold tabular-nums text-[var(--text)]">{p.amountRwf.toLocaleString('en-US')} {p.currency}</span>
                    <span className={`inline-flex items-center gap-1 ${st.tone}`}>{st.icon} {st.label}</span>
                    {p.status === 'SUCCESSFUL' && <button type="button" onClick={() => void openReceipt(p.id)} className="rounded-lg border border-[var(--line)] px-2.5 py-1 text-[var(--text)] hover:bg-[var(--hover)]">Receipt</button>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
