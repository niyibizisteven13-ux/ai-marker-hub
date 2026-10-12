import React, { useState, useEffect } from 'react';
import { ShieldCheck, Zap, ArrowLeft, Loader2, CheckCircle2, AlertCircle, Star, Building2, Check, ChevronDown, ChevronUp, Lock } from 'lucide-react';
import { authFetch } from '../utils/authFetch';
import { PLANS } from '../content/plans';
import { COMPARE_ROWS } from '../content/compare';
import { FAQ_ITEMS } from '../content/faq';
import OrganisationRequestDialog from '../components/OrganisationRequestDialog';

interface UpgradePageProps {
  jobId?: string;
  service?: string;
  targetPlan?: 'individual' | 'business' | 'organisation';
  onBack: () => void;
  onSuccess: () => void;
}

const SERIF = "font-['Georgia','Tiempos_Headline','Times_New_Roman',serif]";

export default function UpgradePage({ jobId, service, targetPlan = 'business', onBack, onSuccess }: UpgradePageProps) {
  const [selectedPlanId, setSelectedPlanId] = useState<'individual' | 'business' | 'organisation'>(targetPlan || 'business');
  const [phone, setPhone] = useState('');
  const [status, setStatus] = useState<'idle' | 'pending' | 'success' | 'failed'>('idle');
  const [price, setPrice] = useState<number | null>(null);
  const [isLoadingPrice, setIsLoadingPrice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [compareOpen, setCompareOpen] = useState(true);
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);
  const [orgDialogOpen, setOrgDialogOpen] = useState(false);
  const [reasonLimit, setReasonLimit] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('reason') === 'limit' || jobId) {
      setReasonLimit(true);
    }
  }, [jobId]);

  // Reorder plans: Business Pro first, then Individual, then Organisation
  const orderedPlans = [
    PLANS.find(p => p.id === 'business') || PLANS[1],
    PLANS.find(p => p.id === 'individual') || PLANS[0],
    PLANS.find(p => p.id === 'organisation') || PLANS[2],
  ];

  const handleSelectPlan = (planId: 'individual' | 'business' | 'organisation') => {
    if (planId === 'organisation') {
      setOrgDialogOpen(true);
      return;
    }
    setSelectedPlanId(planId);
  };

  const handlePay = async () => {
    const cleanedPhone = phone.replace(/\D/g, '');
    const normalizedPhone = cleanedPhone.startsWith('250') ? `+${cleanedPhone}` : cleanedPhone.startsWith('0') ? `+250${cleanedPhone.slice(1)}` : `+250${cleanedPhone}`;

    if (!/^\+250[0-9]{9}$/.test(normalizedPhone)) {
      setError('Enter a valid Rwandan Mobile Money number (e.g. 078XXXXXXX).');
      return;
    }
    setError(null);
    setStatus('pending');

    const payload: { phoneNumber: string; service?: string; batchId?: string; planType?: string; isSubscription?: boolean } = {
      phoneNumber: normalizedPhone,
    };

    if (jobId) {
      payload.batchId = jobId;
      payload.service = service || 'grading';
    }

    if (selectedPlanId === 'business') {
      payload.planType = 'BUSINESS';
      payload.isSubscription = true;
    }

    try {
      const res = await authFetch('/api/payments/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus('failed');
        setError(data.error || 'Payment initiation failed.');
        return;
      }
      void pollPaymentStatus();
    } catch (err) {
      setStatus('failed');
      setError(err instanceof Error ? err.message : 'Network error during payment initiation.');
    }
  };

  const pollPaymentStatus = async () => {
    const maxAttempts = 30;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const url = jobId
          ? `/api/payments/status?${new URLSearchParams({ jobId })}`
          : `/api/payments/status?${new URLSearchParams({ planType: 'BUSINESS' })}`;

        const res = await authFetch(url);
        const data = await res.json();
        if (!res.ok) continue;

        if (data.status === 'SUCCESS') {
          setStatus('success');
          setTimeout(() => onSuccess(), 2000);
          return;
        }
        if (data.status === 'FAILED') {
          setStatus('failed');
          setError('Payment was rejected or failed.');
          return;
        }
      } catch {
        // network retry during poll
      }
    }
    setStatus('failed');
    setError('Payment prompt timed out.');
  };

  if (status === 'success') {
    return (
      <div className="h-[100dvh] w-full bg-[var(--bg)] flex flex-col items-center justify-center p-8 text-center animate-in fade-in zoom-in duration-500 text-[var(--text)]">
        <div className="w-16 h-16 bg-[var(--teal)]/15 rounded-full flex items-center justify-center text-[var(--teal)] mb-6 border border-[var(--teal)]/30">
          <CheckCircle2 size={32} />
        </div>
        <h2 className={`${SERIF} text-3xl font-normal text-[var(--text)] mb-3`}>Payment successful</h2>
        <p className="text-[var(--muted)] mb-8 max-w-md text-sm leading-relaxed">
          Your access has been successfully unlocked. Redirecting to your workspace…
        </p>
        <Loader2 className="animate-spin text-[var(--accent)]" size={24} />
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] w-full bg-[var(--bg)] text-[var(--text)] flex flex-col font-sans antialiased">
      {orgDialogOpen && <OrganisationRequestDialog isOpen={orgDialogOpen} onClose={() => setOrgDialogOpen(false)} />}

      {/* Top Bar */}
      <div className="sticky top-0 z-30 px-4 sm:px-8 py-4 flex items-center justify-between border-b border-[var(--line)] bg-[var(--bg)]/90">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-[var(--muted)] hover:text-[var(--text)] transition-colors rounded-lg px-3 py-2 hover:bg-[var(--hover)]"
        >
          <ArrowLeft size={16} />
          <span className="text-sm font-medium">Back to workspace</span>
        </button>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium text-[var(--muted)] border border-[var(--line)] bg-[var(--surface)]">
          <ShieldCheck size={14} className="text-[var(--teal)]" /> Secure Mobile Money checkout
        </div>
      </div>

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-10 space-y-12">
        {/* Contextual Banner */}
        {(reasonLimit || jobId) && (
          <div className="p-4 sm:p-5 rounded-2xl bg-[var(--accent)]/15 border border-[var(--danger)]/30 flex items-start gap-3.5 animate-in fade-in">
            <Lock size={20} className="text-[var(--accent)] shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-semibold text-[var(--text)]">Usage limit reached or batch unlock required</h3>
              <p className="text-xs text-[var(--muted)] mt-0.5 leading-relaxed">
                You have reached your free tier grading limit or requested a specific batch unlock. Upgrade to Business Pro for unlimited marking, or unlock this batch with Mobile Money.
              </p>
            </div>
          </div>
        )}

        {/* Heading */}
        <div className="text-center max-w-2xl mx-auto space-y-3">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Transparent Pricing</span>
          <h1 className={`${SERIF} text-4xl sm:text-5xl font-normal text-[var(--text)] tracking-tight`}>
            Choose the right plan for your classroom.
          </h1>
          <p className="text-sm text-[var(--muted)] leading-relaxed">
            Simple, predictable pricing with no hidden commitments. Pay securely via MTN MoMo or Airtel Money.
          </p>
        </div>

        {/* 3 Plan Cards (Business Pro first, then Individual, then Organisation) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {orderedPlans.map((plan) => {
            const isRecommended = plan.id === 'business';
            const isSelected = selectedPlanId === plan.id;
            return (
              <div
                key={plan.id}
                className={`relative rounded-2xl bg-[var(--surface)] p-6 sm:p-8 flex flex-col justify-between transition-all border ${
                  isRecommended
                    ? 'border-[var(--accent)] shadow-lg ring-1 ring-[var(--accent)]/30'
                    : 'border-[var(--line)] shadow-sm hover:border-[var(--accent)]/50'
                }`}
              >
                {isRecommended && (
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 px-3.5 py-1 bg-[var(--accent)] rounded-full text-[10px] font-bold text-[var(--on-accent)] uppercase tracking-widest">
                    Most Popular
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isRecommended ? 'bg-[var(--accent)]/15 text-[var(--accent)]' : 'bg-[var(--surface-2)] text-[var(--muted)]'}`}>
                      {plan.id === 'business' ? <Star size={20} /> : plan.id === 'organisation' ? <Building2 size={20} /> : <Zap size={20} />}
                    </div>
                    <span className="text-xs font-medium text-[var(--muted)]">{plan.tagline}</span>
                  </div>

                  <h3 className={`${SERIF} text-2xl font-normal text-[var(--text)] mb-1`}>{plan.name}</h3>
                  <div className="flex items-baseline gap-1 my-4">
                    <span className={`${SERIF} text-4xl font-normal text-[var(--text)]`}>{plan.price}</span>
                    <span className="text-xs text-[var(--muted)]">{plan.period}</span>
                  </div>

                  <ul className="space-y-3 my-6">
                    {plan.features.map((f, i) => (
                      <li key={i} className="flex items-start gap-2.5 text-xs text-[var(--text)]">
                        <div className="w-4 h-4 rounded-full bg-[var(--teal)]/15 text-[var(--teal)] flex items-center justify-center shrink-0 mt-0.5">
                          <Check size={10} strokeWidth={3} />
                        </div>
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <button
                  onClick={() => handleSelectPlan(plan.id as any)}
                  className={`w-full py-3.5 rounded-xl text-sm font-medium transition-colors min-h-[48px] ${
                    isRecommended
                      ? 'bg-[var(--accent)] text-[var(--on-accent)] hover:opacity-90'
                      : 'bg-[var(--surface-2)] text-[var(--text)] hover:bg-[var(--hover)]'
                  }`}
                >
                  {plan.id === 'organisation' ? 'View institution setup' : isSelected ? 'Selected Plan' : 'Select plan'}
                </button>
              </div>
            );
          })}
        </div>

        {/* Selected Plan Checkout Box */}
        {selectedPlanId !== 'organisation' && (
          <div className="max-w-md mx-auto bg-[var(--surface)] border border-[var(--line)] rounded-2xl p-6 sm:p-8 shadow-sm space-y-5">
            <h3 className={`${SERIF} text-xl font-normal text-[var(--text)]`}>Confirm {selectedPlanId === 'business' ? 'Business Pro' : 'Pay as you go'} Checkout</h3>
            <div>
              <label className="text-xs font-medium text-[var(--text)] mb-2 block">Mobile Money Phone Number (+250)</label>
              <input
                type="tel"
                placeholder="078 XXX XXXX"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full bg-[var(--bg)] border border-[var(--line)] rounded-xl py-3 px-4 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2.5 p-3.5 bg-[var(--danger)]/15 border border-[var(--danger)]/30 rounded-xl text-sm text-[var(--danger)]">
                <AlertCircle size={16} className="shrink-0" />
                {error}
              </div>
            )}

            <button
              onClick={handlePay}
              disabled={status === 'pending'}
              className="w-full py-3.5 rounded-xl bg-[var(--accent)] text-[var(--on-accent)] text-sm font-medium hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2 min-h-[48px]"
            >
              {status === 'pending' && <Loader2 size={18} className="animate-spin" />}
              <span>{status === 'pending' ? 'Waiting for Mobile Money prompt…' : 'Pay with Mobile Money'}</span>
            </button>
          </div>
        )}

        {/* Compare Plans Collapsible Table */}
        <div className="border border-[var(--line)] rounded-2xl bg-[var(--surface)] overflow-hidden shadow-sm">
          <button
            onClick={() => setCompareOpen(!compareOpen)}
            className="w-full p-5 flex items-center justify-between bg-[var(--bg)] hover:bg-[var(--hover)] transition-colors text-left"
          >
            <span className={`${SERIF} text-xl font-normal text-[var(--text)]`}>Compare all plan features</span>
            {compareOpen ? <ChevronUp size={20} className="text-[var(--muted)]" /> : <ChevronDown size={20} className="text-[var(--muted)]" />}
          </button>

          {compareOpen && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-[var(--text)]">
                <thead className="bg-[var(--bg)] border-b border-[var(--line)] text-[var(--muted)] uppercase tracking-wider">
                  <tr>
                    <th className="p-4 font-medium">Feature</th>
                    <th className="p-4 font-medium">Business Pro</th>
                    <th className="p-4 font-medium">Individual</th>
                    <th className="p-4 font-medium">Organisation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)]">
                  {COMPARE_ROWS.map((row, i) => (
                    <tr key={i} className="hover:bg-[var(--surface-2)]">
                      <td className="p-4 font-medium text-[var(--text)]">{row.feature}</td>
                      <td className="p-4 font-semibold text-[var(--accent)]">{row.business}</td>
                      <td className="p-4 text-[var(--muted)]">{row.individual}</td>
                      <td className="p-4 text-[var(--muted)]">{row.organisation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* FAQ Accordion */}
        <div className="max-w-3xl mx-auto space-y-4">
          <h2 className={`${SERIF} text-2xl font-normal text-[var(--text)] text-center mb-6`}>Frequently Asked Questions</h2>
          <div className="space-y-3">
            {FAQ_ITEMS.map((faq, index) => {
              const isOpen = openFaqIndex === index;
              return (
                <div key={index} className="border border-[var(--line)] rounded-2xl bg-[var(--surface)] overflow-hidden">
                  <button
                    onClick={() => setOpenFaqIndex(isOpen ? null : index)}
                    className="w-full p-5 flex items-center justify-between text-left hover:bg-[var(--hover)] transition-colors"
                  >
                    <span className="text-sm font-medium text-[var(--text)]">{faq.question}</span>
                    {isOpen ? <ChevronUp size={18} className="text-[var(--muted)]" /> : <ChevronDown size={18} className="text-[var(--muted)]" />}
                  </button>
                  {isOpen && (
                    <div className="px-5 pb-5 pt-0 text-xs text-[var(--muted)] leading-relaxed">
                      {faq.answer}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Currency Note & Trust Footer Items */}
        <div className="pt-8 border-t border-[var(--line)] flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[var(--muted)]">
          <span>All prices quoted in USD with local currency Mobile Money conversion (RWF).</span>
          <div className="flex items-center gap-6">
            <span className="flex items-center gap-1.5"><ShieldCheck size={14} className="text-[var(--teal)]" /> End-to-end encrypted</span>
            <span className="flex items-center gap-1.5"><Star size={14} className="text-[var(--accent)]" /> Trusted by educators</span>
          </div>
        </div>
      </main>
    </div>
  );
}
