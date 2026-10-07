import React, { useState, useEffect } from 'react';
import { ShieldCheck, Zap, ArrowLeft, Loader2, Phone, CheckCircle2, AlertCircle, Star, Building2, Check } from 'lucide-react';
import { authFetch } from '../utils/authFetch';

interface UpgradePageProps {
  jobId?: string;
  service?: string;
  targetPlan?: 'individual' | 'business' | 'organisation';
  onBack: () => void;
  onSuccess: () => void;
}

// Mirrors the feature copy already shown in UpgradeModal, trimmed to the
// 3 most relevant lines — this is the "what am I actually paying for"
// reminder the original page was missing at the point of payment.
const PLAN_FEATURE_SUMMARY: Record<'individual' | 'business' | 'organisation', string[]> = {
  individual: ['1 Free Trial Result', 'Mobile Money Payments', 'Precise AI Marking'],
  business: ['Unlimited Marking', 'Priority AI Processing', 'Detailed PDF Reports'],
  organisation: ['Institution-specific pricing', 'Shared faculty setup', 'Admin-managed billing'],
};

export default function UpgradePage({ jobId, service, targetPlan = 'individual', onBack, onSuccess }: UpgradePageProps) {
  const [phone, setPhone] = useState('');
  const [status, setStatus] = useState<'idle' | 'pending' | 'success' | 'failed'>('idle');
  const [price, setPrice] = useState<number | null>(null);
  const [isLoadingPrice, setIsLoadingPrice] = useState(Boolean(jobId && service));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (jobId && service) {
      void fetchQuote();
    } else if (jobId) {
      setPrice(null);
      setError('A service is required to quote this batch.');
      setIsLoadingPrice(false);
    } else if (targetPlan === 'business') {
      setPrice(9);
      setError(null);
      setIsLoadingPrice(false);
    } else {
      setPrice(null);
      setIsLoadingPrice(false);
    }
  }, [jobId, service, targetPlan]);

  const fetchQuote = async () => {
    setIsLoadingPrice(true);
    try {
      const params = new URLSearchParams({ jobId: jobId || '', service: service || '' });
      const res = await authFetch(`/api/payments/quote?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch pricing');
      const quotedPrice = Number(data.priceUsd);
      if (!Number.isFinite(quotedPrice) || quotedPrice < 0) throw new Error('The server returned an invalid price.');
      setPrice(quotedPrice);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection error');
      setPrice(null);
    } finally {
      setIsLoadingPrice(false);
    }
  };

  const handlePay = async () => {
    if (!jobId && targetPlan !== 'business') return;
    if (jobId && !service) return setError('A service is required to pay for this batch.');
    if (!/^\+?[0-9\s()-]{9,18}$/.test(phone.trim())) {
      setError('Enter a valid Mobile Money number.');
      return;
    }
    setError(null);
    setStatus('pending');

    const payload: { phoneNumber: string; service?: string; batchId?: string; planType?: 'BUSINESS'; isSubscription?: boolean } = {
      phoneNumber: phone.trim(),
    };

    if (jobId) {
      payload.batchId = jobId;
      payload.service = service;
    }

    if (targetPlan === 'business') {
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
        setError(data.error || 'Payment initiation failed');
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
    let lastPollingError: string | null = null;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, 3000));
      try {
        const url = jobId
          ? `/api/payments/status?${new URLSearchParams({ jobId })}`
          : `/api/payments/status?${new URLSearchParams({ planType: 'BUSINESS' })}`;

        const res = await authFetch(url);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not check payment status.');
        const currentStatus = data.status;

        if (currentStatus === 'SUCCESS') {
          setStatus('success');
          setTimeout(() => onSuccess(), 2000);
          return;
        }
        if (currentStatus === 'FAILED') {
          setStatus('failed');
          setError('Payment was rejected or failed.');
          return;
        }
      } catch (err) {
        lastPollingError = err instanceof Error ? err.message : 'Could not check payment status.';
      }
    }
    setStatus('failed');
    setError(lastPollingError || 'Payment timed out.');
  };

  const getPlanInfo = () => {
    if (jobId) return {
      name: 'Single Batch Unlock',
      icon: <Zap size={28} />,
      color: 'amber' as const,
      desc: 'Unlock results for this specific marking batch.',
    };
    if (targetPlan === 'business') return {
      name: 'Business Pro',
      icon: <Star size={28} />,
      color: 'amber' as const,
      desc: 'Unlimited marking, every month.',
    };
    if (targetPlan === 'individual') return {
      name: 'Pay as you go',
      icon: <Zap size={28} />,
      color: 'emerald' as const,
      desc: 'Unlock a single result, quoted for this batch.',
    };
    return {
      name: 'Organisation',
      icon: <Building2 size={28} />,
      color: 'indigo' as const,
      desc: 'Institutional pricing, arranged with your organization.',
    };
  };

  const plan = getPlanInfo();
  const accentText = plan.color === 'emerald' ? 'text-emerald-300' : plan.color === 'indigo' ? 'text-indigo-300' : 'text-amber-300';
  const accentBg = plan.color === 'emerald' ? 'bg-emerald-400/10 border-emerald-400/15' : plan.color === 'indigo' ? 'bg-indigo-400/10 border-indigo-400/15' : 'bg-amber-400/10 border-amber-300/15';
  const featureList = PLAN_FEATURE_SUMMARY[targetPlan];

  if (status === 'success') {
    return (
      <div className="h-dvh w-full bg-[#0B0C0F] flex flex-col items-center justify-center p-8 text-center animate-in fade-in zoom-in duration-500">
        <div className="w-20 h-20 bg-emerald-500/20 rounded-full flex items-center justify-center text-emerald-400 mb-6 border border-emerald-500/30">
          <CheckCircle2 size={40} />
        </div>
        <h2 className="text-3xl font-bold text-white mb-4">Payment Successful!</h2>
        <p className="text-neutral-400 mb-8 max-w-md">
          {jobId ? 'Your result has been unlocked.' : 'Your account has been upgraded.'} Redirecting...
        </p>
        <Loader2 className="animate-spin text-emerald-500" size={32} />
      </div>
    );
  }

  return (
    <div className="h-dvh w-full overflow-hidden bg-[#0B0C0F] text-white flex flex-col">
      {/* Slim top bar — no sticky needed, page never scrolls */}
      <div className="shrink-0 px-4 sm:px-8 py-3 sm:py-4 border-b border-white/[0.08] flex items-center justify-between">
        <button onClick={onBack} className="flex items-center gap-2 text-neutral-400 hover:text-white transition-colors rounded-xl px-3 py-2 hover:bg-white/5">
          <ArrowLeft size={18} />
          <span className="text-sm font-medium">Back</span>
        </button>
        <div className="flex items-center gap-2 px-3 py-1 bg-amber-500/10 border border-amber-500/20 rounded-full text-[10px] font-bold text-amber-500 uppercase tracking-widest">
          <ShieldCheck size={12} />
          Secure MoMo Checkout
        </div>
      </div>

      {/* Full-width, full-height split. No max-width cap, no page scroll —
          the right pane is the only thing that can scroll, and only as a
          fallback for extreme viewport/zoom combinations. */}
      <div className="flex-1 min-h-0 w-full flex flex-col lg:flex-row">
        {/* Left: trimmed brand/trust panel. Hidden on mobile — on a short
            viewport, a marketing hero is the first thing to cut, not the
            payment form. */}
        <section className="hidden lg:flex flex-1 flex-col justify-center px-10 xl:px-16 2xl:px-24 py-10 border-r border-white/[0.06] bg-gradient-to-br from-white/[0.015] to-transparent">
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/[0.07] px-3 py-1.5 text-[11px] font-semibold text-emerald-300">
            <ShieldCheck size={14} /> Secure checkout
          </div>
          <h1 className="mt-6 text-3xl xl:text-4xl font-semibold tracking-tight text-white max-w-xl">
            Keep your work moving.
          </h1>
          <p className="mt-3 text-sm leading-6 text-neutral-400 max-w-md">
            Confirm your plan and pay with Mobile Money. Access activates the moment your payment is confirmed.
          </p>
          <div className="mt-8 flex items-center gap-4 text-xs text-neutral-500">
            <span className="flex items-center gap-1.5"><Zap size={14} className="text-amber-300" /> Instant activation</span>
            <span className="w-px h-3 bg-white/10" />
            <span className="flex items-center gap-1.5"><ShieldCheck size={14} className="text-emerald-300" /> PIN never leaves your provider</span>
          </div>
        </section>

        {/* Right: the actual payment card — this is the page. */}
        <section className="w-full lg:w-[460px] xl:w-[500px] shrink-0 flex flex-col min-h-0">
          <div className="flex-1 min-h-0 overflow-y-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none] flex flex-col justify-center px-5 sm:px-8 py-6">
            <div className="w-full bg-[#15161B] border border-white/[0.09] rounded-3xl p-5 sm:p-7 shadow-2xl">
              {/* Plan header */}
              <div className="flex items-start gap-3 mb-5">
                <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 border ${accentBg} ${accentText}`}>
                  {plan.icon}
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Selected plan</p>
                  <h2 className="text-lg font-semibold leading-tight">{plan.name}</h2>
                  <p className="text-xs text-neutral-400 mt-0.5">{plan.desc}</p>
                </div>
              </div>

              {/* Order summary — the piece the original page didn't have */}
              <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 mb-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest block">
                      {targetPlan === 'organisation' ? 'Price' : 'Amount due'}
                    </span>
                    <span className="text-2xl font-semibold text-white">
                      {targetPlan === 'organisation' ? 'Custom' : isLoadingPrice ? (
                        <span className="inline-block h-7 w-16 rounded-md bg-white/10 animate-pulse align-middle" />
                      ) : price !== null && Number.isFinite(price) ? `$${price.toFixed(2)}` : '—'}
                    </span>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-widest ${accentBg} ${accentText}`}>
                    {jobId ? 'Job unlock' : targetPlan === 'organisation' ? 'Institution' : 'Subscription'}
                  </span>
                </div>
                <ul className="space-y-1.5 pt-3 border-t border-white/[0.06]">
                  {featureList.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-[11px] text-neutral-300">
                      <Check size={12} className={accentText} />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>

              {targetPlan === 'organisation' ? (
                <div className="rounded-2xl border border-indigo-400/20 bg-indigo-400/[0.06] p-4 text-sm leading-6 text-indigo-100">
                  Institution subscriptions aren't available for self-service payment yet. Ask your platform administrator for a quote and setup.
                </div>
              ) : !jobId && targetPlan !== 'business' ? (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm leading-6 text-neutral-300">
                  Pay-as-you-go pricing is calculated for a specific marking batch. Return to your workspace and start a batch to receive its exact quote.
                </div>
              ) : (
                <>
                  <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest mb-1.5 block px-1">
                    MoMo wallet number
                  </label>
                  <div className="relative group mb-2">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-neutral-500 group-focus-within:text-amber-500 transition-colors">
                      <Phone size={16} />
                    </div>
                    <input
                      type="tel"
                      placeholder="078 XXX XXXX"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      autoComplete="tel"
                      inputMode="tel"
                      aria-label="Mobile Money wallet number"
                      disabled={status === 'pending'}
                      className="w-full bg-white/[0.03] border border-white/10 rounded-xl py-3 pl-10 pr-4 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 transition-all"
                    />
                  </div>

                  {error && (
                    <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400 mb-3">
                      <AlertCircle size={14} className="shrink-0" />
                      {error}
                    </div>
                  )}

                  <button
                    onClick={handlePay}
                    disabled={status === 'pending' || isLoadingPrice || price === null || !Number.isFinite(price)}
                    className="w-full py-3.5 rounded-xl font-semibold text-sm transition-all bg-[#E8A64A] text-[#17130C] hover:bg-[#F1B75E] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {status === 'pending' ? 'Processing...' : status === 'failed' ? 'Try again' : 'Pay with Mobile Money'}
                  </button>

                  <p className="mt-3 text-center text-[10px] text-neutral-500 leading-relaxed">
                    You'll get a payment prompt on your phone. Never share your Mobile Money PIN.
                  </p>
                </>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}