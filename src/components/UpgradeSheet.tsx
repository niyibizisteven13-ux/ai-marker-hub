import { X, Sparkles, ArrowRight, ShieldCheck, Zap } from 'lucide-react';

interface UpgradeSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectPlan: (plan: 'individual' | 'business' | 'organisation') => void;
}

const SERIF = "font-['Georgia','Tiempos_Headline','Times_New_Roman',serif]";

export default function UpgradeSheet({ isOpen, onClose, onSelectPlan }: UpgradeSheetProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-lg bg-[var(--bg)] border-t sm:border border-[var(--line)] rounded-t-3xl sm:rounded-2xl shadow-2xl p-6 sm:p-8 animate-in slide-in-from-bottom duration-300">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-full hover:bg-[var(--hover)] text-[var(--muted)] hover:text-[var(--text)] transition-colors"
          aria-label="Close sheet"
        >
          <X size={20} />
        </button>

        <div className="flex items-center gap-2 px-3 py-1 bg-[var(--surface-2)] rounded-full text-xs font-medium text-[var(--muted)] w-fit mb-4">
          <Sparkles size={14} className="text-[var(--accent)]" /> Upgrade Bwenge Studio
        </div>

        <h2 className={`${SERIF} text-2xl font-normal text-[var(--text)] mb-2`}>Choose your marking power</h2>
        <p className="text-sm text-[var(--muted)] mb-6 leading-relaxed">
          Unlock unlimited batches, priority AI processing, and institutional collaboration tools.
        </p>

        <div className="space-y-3 mb-6">
          <button
            onClick={() => { onClose(); onSelectPlan('business'); }}
            className="w-full flex items-center justify-between p-4 rounded-xl border border-[var(--accent)]/40 bg-[var(--accent)]/15 hover:bg-[var(--accent)]/25 transition-all group text-left min-h-[48px]"
          >
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-[var(--text)]">Business Pro</span>
                <span className="px-2 py-0.5 rounded-full bg-[var(--accent)] text-[var(--on-accent)] text-[10px] font-bold uppercase tracking-wider">Most Popular</span>
              </div>
              <p className="text-xs text-[var(--muted)] mt-0.5">Unlimited marking & priority processing · $9/mo</p>
            </div>
            <ArrowRight size={18} className="text-[var(--accent)] group-hover:translate-x-1 transition-transform" />
          </button>

          <button
            onClick={() => { onClose(); onSelectPlan('individual'); }}
            className="w-full flex items-center justify-between p-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] hover:bg-[var(--hover)] transition-all group text-left min-h-[48px]"
          >
            <div>
              <span className="text-sm font-semibold text-[var(--text)]">Individual Pay as you go</span>
              <p className="text-xs text-[var(--muted)] mt-0.5">Unlock single batches with Mobile Money · $0.20+</p>
            </div>
            <ArrowRight size={18} className="text-[var(--muted)] group-hover:translate-x-1 transition-transform" />
          </button>

          <button
            onClick={() => { onClose(); onSelectPlan('organisation'); }}
            className="w-full flex items-center justify-between p-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] hover:bg-[var(--hover)] transition-all group text-left min-h-[48px]"
          >
            <div>
              <span className="text-sm font-semibold text-[var(--text)]">Organisation Setup</span>
              <p className="text-xs text-[var(--muted)] mt-0.5">Institutional quote & shared faculty management</p>
            </div>
            <ArrowRight size={18} className="text-[var(--muted)] group-hover:translate-x-1 transition-transform" />
          </button>
        </div>

        <div className="flex items-center justify-center gap-6 pt-4 border-t border-[var(--line)] text-xs text-[var(--muted)]">
          <span className="flex items-center gap-1.5"><ShieldCheck size={14} className="text-[var(--teal)]" /> Secure MoMo</span>
          <span className="flex items-center gap-1.5"><Zap size={14} className="text-[var(--accent)]" /> Instant activation</span>
        </div>
      </div>
    </div>
  );
}
