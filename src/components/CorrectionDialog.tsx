import React, { useState } from 'react';
import { BottomSheet } from './BottomSheet';
import { ShieldAlert, Send } from 'lucide-react';

interface CorrectionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmitCorrection: (payload: { reason: string; correction?: string }) => void;
}

export const CorrectionDialog: React.FC<CorrectionDialogProps> = ({
  isOpen,
  onClose,
  onSubmitCorrection,
}) => {
  const [reason, setReason] = useState('Wrong fact');
  const [correction, setCorrection] = useState('');

  const reasons = [
    'Wrong fact',
    'Wrong number or statistic',
    'Outdated information',
    'Wrong language or translation',
    'Unsafe or inappropriate',
    'Other',
  ];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmitCorrection({ reason, correction: correction.trim() || undefined });
    setCorrection('');
    onClose();
  };

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title="Report or Correct Answer">
      <form onSubmit={handleSubmit} className="space-y-4 text-xs text-[var(--text)]">
        <div>
          <label className="block font-bold text-[var(--muted)] uppercase tracking-wider text-[10px] mb-2">
            What is wrong with this answer?
          </label>
          <div className="space-y-2">
            {reasons.map((r) => (
              <label key={r} className="flex items-center gap-3 p-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] cursor-pointer hover:bg-[var(--hover)]">
                <input
                  type="radio"
                  name="correctionReason"
                  value={r}
                  checked={reason === r}
                  onChange={(e) => setReason(e.target.value)}
                  className="accent-[var(--teal)]"
                />
                <span className="font-medium">{r}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="block font-bold text-[var(--muted)] uppercase tracking-wider text-[10px] mb-1.5">
            Suggested correct answer (optional)
          </label>
          <textarea
            value={correction}
            onChange={(e) => setCorrection(e.target.value)}
            placeholder="Provide the correct information or context..."
            rows={3}
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3 text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--teal)]"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-[var(--border)] font-semibold hover:bg-[var(--hover)] transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[var(--accent)] text-[var(--on-accent)] font-bold hover:opacity-90 transition-opacity"
          >
            <Send className="w-4 h-4" /> Submit feedback
          </button>
        </div>
      </form>
    </BottomSheet>
  );
};
