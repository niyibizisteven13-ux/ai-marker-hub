import React, { useState } from 'react';
import { X, Check, Zap, GraduationCap, Users, Building2, Star, ShieldCheck } from 'lucide-react';

interface UpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentJobId?: string;
  onUpgrade: (plan: string) => void;
}

export default function UpgradeModal({ isOpen, onClose, onUpgrade }: UpgradeModalProps) {
  if (!isOpen) return null;

  const plans = [
    {
      id: 'individual',
      name: 'Individual',
      tagline: 'Pay as you go',
      price: '$0.20+',
      period: 'per batch',
      icon: <Users className="text-emerald-400" size={24} />,
      color: 'emerald',
      features: [
        '1 Free Trial Result',
        'Mobile Money Payments',
        'Precise AI Marking',
        'Individual Data Store',
      ],
      cta: 'Pay for Current Batch',
      popular: false,
    },
    {
      id: 'business',
      name: 'Business Pro',
      tagline: 'For power users',
      price: '$9',
      period: 'per month',
      icon: <Star className="text-amber-400" size={24} />,
      color: 'amber',
      features: [
        'Unlimited Marking',
        'Priority AI Processing',
        'Detailed PDF Reports',
        'Priority Support',
      ],
      cta: 'Get Pro Access',
      popular: true,
    },
    {
      id: 'organisation',
      name: 'Organisation',
      tagline: 'For institutions',
      price: '$50+',
      period: 'min top-up',
      icon: <Building2 className="text-indigo-400" size={24} />,
      color: 'indigo',
      features: [
        'Shared Faculty Balance',
        'Admin Dashboard',
        'Audit Compliance Logs',
        'Priority Support',
      ],
      cta: 'Buy Institution Credits',
      popular: false,
    }
  ];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-xl" onClick={onClose} />

      <div className="relative w-full max-w-6xl max-h-[90vh] bg-[#0F0F0F] border border-white/5 rounded-[40px] shadow-2xl animate-in zoom-in-95 duration-300 flex flex-col overflow-hidden">
        {/* Header Section */}
        <div className="p-8 text-center border-b border-white/5 shrink-0">
          <button onClick={onClose} className="absolute top-6 right-8 p-2 rounded-full hover:bg-white/5 text-neutral-500 hover:text-white transition-colors z-20">
            <X size={24} />
          </button>

          <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-white/5 border border-white/10 rounded-full text-[10px] font-bold text-neutral-400 uppercase tracking-[0.2em] mb-4">
            <ShieldCheck size={14} className="text-emerald-500" />
            Flexible Plans for Every Marker
          </div>

          <h2 className="text-3xl md:text-4xl font-bold text-white mb-2">Choose Your Plan</h2>
          <p className="text-neutral-400 max-w-2xl mx-auto text-xs md:text-sm leading-relaxed">
            From individual classroom teachers to entire university departments.
          </p>
        </div>

        {/* Plans Grid - Scrollable */}
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-white/5 h-full">
            {plans.map((plan) => (
              <div key={plan.id} className={`flex flex-col p-8 md:p-10 relative ${plan.popular ? 'bg-white/[0.02]' : ''}`}>
                {plan.popular && (
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 px-4 py-1 bg-amber-500 rounded-full text-[10px] font-bold text-black uppercase tracking-widest z-10">
                    Most Popular
                  </div>
                )}

              <div className="mb-8">
                <div className={`w-14 h-14 rounded-2xl bg-${plan.color}-500/10 flex items-center justify-center mb-6 border border-${plan.color}-500/20 shadow-lg shadow-${plan.color}-500/5`}>
                  {plan.icon}
                </div>
                <h3 className="text-2xl font-bold text-white mb-1">{plan.name}</h3>
                <p className="text-xs text-neutral-500 font-medium">{plan.tagline}</p>
              </div>

              <div className="mb-8">
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-bold text-white">{plan.price}</span>
                  <span className="text-sm text-neutral-500">{plan.period}</span>
                </div>
              </div>

              <ul className="space-y-4 mb-10 flex-1">
                {plan.features.map((feature, i) => (
                  <li key={i} className="flex items-start gap-3 text-xs text-neutral-300">
                    <Check size={16} className={`text-${plan.color}-500 shrink-0 mt-0.5`} />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              <button
                onClick={() => onUpgrade(plan.id)}
                className={`w-full py-4 rounded-2xl font-bold text-sm transition-all active:scale-[0.98] ${
                  plan.popular
                    ? 'bg-amber-500 hover:bg-amber-400 text-black shadow-xl shadow-amber-500/20'
                    : 'bg-white/5 hover:bg-white/10 text-white border border-white/10'
                }`}
              >
                {plan.cta}
              </button>
            </div>
          ))}
        </div>
      </div>

        {/* Footer */}
        <div className="p-6 bg-white/[0.01] border-t border-white/5 flex items-center justify-center gap-8 text-[10px] text-neutral-600 font-medium uppercase tracking-widest">
          <div className="flex items-center gap-2">
            <Zap size={14} className="text-amber-500" />
            Instant Activation
          </div>
          <div className="w-px h-3 bg-white/5" />
          <div className="flex items-center gap-2">
            <ShieldCheck size={14} className="text-emerald-500" />
            Encrypted Payments
          </div>
        </div>
      </div>
    </div>
  );
}
