import React, { useState, useEffect } from 'react';
import { ShieldCheck, Zap, ArrowLeft, Loader2, Phone, CreditCard, CheckCircle2, AlertCircle, Star, Building2, Users } from 'lucide-react';
import { authFetch } from '../utils/authFetch';

interface UpgradePageProps {
  jobId?: string;
  service?: string;
  targetPlan?: string;
  customPrice?: number;
  onBack: () => void;
  onSuccess: () => void;
}

export default function UpgradePage({ jobId, service, targetPlan = 'individual', customPrice, onBack, onSuccess }: UpgradePageProps) {
  const [phone, setPhone] = useState('');
  const [status, setStatus] = useState<'idle' | 'pending' | 'success' | 'failed'>('idle');
  const [price, setPrice] = useState<number | null>(customPrice || null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (jobId && service) {
      fetchQuote();
    } else if (targetPlan === 'business') {
      setPrice(9.00);
    } else if (targetPlan === 'organisation' && customPrice) {
      setPrice(customPrice);
    }
  }, [jobId, service, targetPlan, customPrice]);

  const fetchQuote = async () => {
    try {
      const res = await authFetch(`/api/payments/quote?jobId=${jobId}&service=${service}`);
      const data = await res.json();
      if (res.ok) {
        setPrice(data.priceUsd);
      } else {
        setError(data.error || 'Failed to fetch pricing');
      }
    } catch (err) {
      setError('Connection error');
    }
  };

  const handlePay = async () => {
    if (!phone) return setError('Please enter your MoMo number');
    setError(null);
    setStatus('pending');

    const payload: any = { phoneNumber: phone, service };

    if (jobId) {
      payload.batchId = jobId;
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

      pollPaymentStatus();
    } catch (err) {
      setStatus('failed');
      setError('Network error during initiation');
    }
  };

  const pollPaymentStatus = async () => {
    const maxAttempts = 30;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, 3000));
      try {
        const url = jobId
          ? `/api/payments/status?jobId=${jobId}`
          : `/api/payments/status?planType=${targetPlan}`;

        const res = await authFetch(url);
        const { status: currentStatus } = await res.json();

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
      } catch (e) {
        // Continue polling
      }
    }
    setStatus('failed');
    setError('Payment timed out.');
  };

  const getPlanInfo = () => {
    if (jobId) return {
      name: 'Single Batch Unlock',
      icon: <Zap size={32} />,
      color: 'amber',
      desc: 'Unlock results for this specific marking batch.'
    };
    if (targetPlan === 'business') return {
      name: 'Business Pro',
      icon: <Star size={32} />,
      color: 'amber',
      desc: 'Upgrade to Business Pro for unlimited marking.'
    };
    return {
      name: 'Organisation',
      icon: <Building2 size={32} />,
      color: 'indigo',
      desc: 'Institutional setup requires admin approval.'
    };
  };

  const plan = getPlanInfo();

  if (status === 'success') {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center animate-in fade-in zoom-in duration-500">
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
    <div className="h-full w-full bg-[#0A0A0A] text-white flex flex-col overflow-y-auto">
      <div className="p-6 border-b border-white/5 flex items-center justify-between sticky top-0 bg-[#0A0A0A]/80 backdrop-blur-md z-10">
        <button onClick={onBack} className="flex items-center gap-2 text-neutral-400 hover:text-white transition-colors">
          <ArrowLeft size={20} />
          <span className="text-sm font-medium">Back</span>
        </button>
        <div className="flex items-center gap-2 px-3 py-1 bg-amber-500/10 border border-amber-500/20 rounded-full text-[10px] font-bold text-amber-500 uppercase tracking-widest">
          <ShieldCheck size={12} />
          Secure MoMo Checkout
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-lg bg-[#111111] border border-white/5 rounded-[40px] overflow-hidden shadow-2xl p-10">
          <div className="mb-10 text-center">
            <div className={`w-16 h-16 bg-${plan.color}-500/10 rounded-2xl flex items-center justify-center text-${plan.color}-400 mx-auto mb-6 border border-${plan.color}-500/20 shadow-lg`}>
              {plan.icon}
            </div>
            <h2 className="text-2xl font-bold mb-2">{plan.name}</h2>
            <p className="text-sm text-neutral-400">{plan.desc}</p>
          </div>

          <div className="bg-white/[0.02] rounded-3xl p-6 border border-white/5 mb-8 flex items-center justify-between">
            <div>
              <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest block mb-1">Amount Due</span>
              <span className="text-3xl font-bold text-white">${price?.toFixed(2) || '0.00'}</span>
            </div>
            <div className="text-right">
              <span className={`text-[10px] font-bold text-${plan.color}-500 bg-${plan.color}-500/10 px-2 py-0.5 rounded-full uppercase tracking-widest mb-2 inline-block`}>
                {jobId ? 'Job Unlock' : 'Subscription'}
              </span>
              <p className="text-[10px] text-neutral-500 italic">Immediate activation</p>
            </div>
          </div>

          <div className="space-y-6 mb-8">
            <div>
              <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest mb-2 block px-1">
                MoMo Wallet Number
              </label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-neutral-500 group-focus-within:text-amber-500 transition-colors">
                  <Phone size={18} />
                </div>
                <input
                  type="tel"
                  placeholder="078 XXX XXXX"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  disabled={status === 'pending'}
                  className="w-full bg-white/[0.03] border border-white/10 rounded-2xl py-4 pl-12 pr-4 text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 transition-all"
                />
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-xs text-red-400">
                <AlertCircle size={16} />
                {error}
              </div>
            )}
          </div>

          <button
            onClick={handlePay}
            disabled={status === 'pending' || price === null}
            className="w-full py-4 rounded-2xl font-bold transition-all bg-amber-500 text-black hover:bg-amber-400 disabled:opacity-50"
          >
            {status === 'pending' ? 'Processing...' : 'Pay with Mobile Money'}
          </button>
        </div>
      </div>
    </div>
  );
}
