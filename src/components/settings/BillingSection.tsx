import { useState, useEffect } from 'react';
import { CreditCard, CheckCircle2, ArrowUpRight, Loader2 } from 'lucide-react';
import { authFetch } from '../../utils/authFetch';

interface Receipt {
  id: string;
  date: string;
  amount: string;
  status: string;
}

interface BillingData {
  subscription: {
    planType: string;
    status: string;
    renewalDate: string;
  };
  receipts: Receipt[];
}

const SERIF = "font-['Georgia','Tiempos_Headline','Times_New_Roman',serif]";

export default function BillingSection() {
  const [billing, setBilling] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [canceling, setCanceling] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    void fetchBilling();
  }, []);

  const fetchBilling = async () => {
    try {
      const res = await authFetch('/api/billing');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch billing');
      setBilling(data);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not load billing');
    } finally {
      setLoading(false);
    }
  };

  const handleCancelSubscription = async () => {
    if (!confirm('Are you sure you want to cancel your subscription?')) return;
    setCanceling(true);
    try {
      const res = await authFetch('/api/billing/cancel', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to cancel');
      await fetchBilling();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Cancellation failed');
    } finally {
      setCanceling(false);
    }
  };

  if (loading) {
    return (
      <div className="py-12 text-center text-sm text-[var(--muted)] flex items-center justify-center gap-2">
        <Loader2 size={18} className="animate-spin text-[var(--accent)]" /> Loading billing details…
      </div>
    );
  }

  if (!billing) return <div className="space-y-4"><h2 className="text-xl text-[var(--text)]">Billing & Subscription</h2><p role="alert" className="text-sm text-[var(--danger)]">{errorMsg || 'Billing details are unavailable.'}</p><button type="button" onClick={() => { setLoading(true); setErrorMsg(null); void fetchBilling(); }} className="rounded-xl border border-[var(--line)] px-4 py-2 text-xs text-[var(--text)]">Retry</button></div>;
  const sub = billing.subscription;
  const receipts = billing?.receipts || [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-normal text-[var(--text)] font-['Georgia',serif]">Billing & Subscription</h2>
        <p className="text-xs text-[var(--muted)] mt-0.5">Manage your active plan, Mobile Money payment methods, and invoice receipts.</p>
      </div>

      <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 shadow-sm space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-[var(--line)]">
          <div>
            <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider block mb-1">Current Plan</span>
            <h3 className={`${SERIF} text-2xl font-normal text-[var(--text)]`}>
              {sub.planType === 'BUSINESS' ? 'Business Pro' : sub.planType === 'ORGANISATION' ? 'Organisation' : 'Pay as you go'}
            </h3>
            <p className="text-xs text-[var(--muted)] mt-1">
              Status: <span className="font-semibold text-[var(--teal)]">{sub.status}</span> {sub.renewalDate ? `· Renews on ${new Date(sub.renewalDate).toLocaleDateString()}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="/upgrade"
              className="px-4 py-2.5 rounded-xl bg-[var(--accent)] text-[var(--on-accent)] text-xs font-medium hover:opacity-90 transition-colors flex items-center gap-1.5"
            >
              Upgrade plan <ArrowUpRight size={14} />
            </a>
            {sub.status === 'ACTIVE' && (
              <button
                type="button"
                disabled={canceling}
                onClick={handleCancelSubscription}
                className="px-4 py-2.5 rounded-xl border border-[var(--line)] text-xs font-medium text-[var(--danger)] hover:bg-[var(--danger)]/15 transition-colors"
              >
                {canceling ? 'Canceling…' : 'Cancel plan'}
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pb-5 border-b border-[var(--line)]">
          <div className="p-4 rounded-xl border border-[var(--line)] bg-[var(--bg)]">
            <span className="text-xs font-medium text-[var(--muted)] block mb-1">Payment Method</span>
            <div className="flex items-center gap-2 text-sm font-medium text-[var(--text)]">
              <CreditCard size={16} className="text-[var(--accent)]" />
              Mobile Money checkout is available when you purchase a plan or marking batch.
            </div>
          </div>
          <div className="p-4 rounded-xl border border-[var(--line)] bg-[var(--bg)]">
            <span className="text-xs font-medium text-[var(--muted)] block mb-1">Account email</span>
            <span className="text-sm font-medium text-[var(--text)]">Your account email is used for billing notices.</span>
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-[var(--text)] mb-3">Receipts & Invoices</h4>
          {receipts.length === 0 ? (
            <p className="text-xs text-[var(--muted)] py-4">No payment receipts found yet.</p>
          ) : (
            <div className="divide-y divide-[var(--line)] border border-[var(--line)] rounded-xl overflow-hidden">
              {receipts.map((r) => (
                <div key={r.id} className="p-3.5 flex items-center justify-between text-xs bg-[var(--surface)] hover:bg-[var(--surface-2)]">
                  <div>
                    <span className="font-medium text-[var(--text)] block">{new Date(r.date).toLocaleDateString()}</span>
                    <span className="text-[var(--muted)]">Mobile Money · {r.amount}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="px-2.5 py-1 rounded-full bg-[var(--teal)]/15 text-[var(--teal)] font-medium">{r.status}</span>
                    <span className="text-[var(--muted)]">Ref {r.id.slice(0, 8)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {errorMsg && (
        <p className="text-xs text-[var(--danger)] font-medium">{errorMsg}</p>
      )}
    </div>
  );
}
