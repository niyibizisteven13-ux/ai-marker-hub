import { useState } from 'react';
import { X, Building2, CheckCircle2, Loader2 } from 'lucide-react';
import { authFetch } from '../utils/authFetch';

interface OrganisationRequestDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const SERIF = "font-['Georgia','Tiempos_Headline','Times_New_Roman',serif]";

export default function OrganisationRequestDialog({ isOpen, onClose }: OrganisationRequestDialogProps) {
  const [organizationName, setOrganizationName] = useState('');
  const [faculty, setFaculty] = useState('');
  const [estimatedSeats, setEstimatedSeats] = useState('25');
  const [contactEmail, setContactEmail] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organizationName.trim() || !contactEmail.trim()) {
      setErrorMsg('Organization name and contact email are required.');
      return;
    }
    setErrorMsg(null);
    setStatus('submitting');

    try {
      const res = await authFetch('/api/sales/organisation-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationName: organizationName.trim(),
          faculty: faculty.trim(),
          estimatedSeats: Number(estimatedSeats) || 10,
          contactEmail: contactEmail.trim(),
          message: message.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to submit organisation request.');
      setStatus('success');
    } catch (err) {
      setStatus('error');
      setErrorMsg(err instanceof Error ? err.message : 'Network error');
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-lg bg-[var(--bg)] border border-[var(--line)] rounded-2xl shadow-2xl p-6 sm:p-8 animate-in zoom-in-95 duration-200">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-full hover:bg-[var(--hover)] text-[var(--muted)] hover:text-[var(--text)] transition-colors"
          aria-label="Close dialog"
        >
          <X size={20} />
        </button>

        {status === 'success' ? (
          <div className="py-8 text-center">
            <div className="w-14 h-14 bg-[var(--teal)]/15 rounded-full flex items-center justify-center text-[var(--teal)] mx-auto mb-4 border border-[var(--teal)]/30">
              <CheckCircle2 size={28} />
            </div>
            <h3 className={`${SERIF} text-2xl font-normal text-[var(--text)] mb-2`}>Request submitted</h3>
            <p className="text-sm text-[var(--muted)] leading-relaxed mb-6">
              Thank you. Our institutional partnerships team will contact you within 24 hours with a custom quote and faculty setup details.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-3 rounded-xl bg-[var(--text)] text-[var(--on-accent)] text-sm font-medium hover:opacity-90 transition-colors min-h-[48px]"
            >
              Back to workspace
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl bg-[var(--surface-2)] text-[var(--accent)] flex items-center justify-center">
                <Building2 size={20} />
              </div>
              <div>
                <h3 className={`${SERIF} text-xl font-normal text-[var(--text)]`}>Organisation Setup</h3>
                <p className="text-xs text-[var(--muted)]">Request institutional pricing and shared faculty management.</p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[var(--text)] mb-1.5">Institution / School Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. University of Rwanda"
                  value={organizationName}
                  onChange={(e) => setOrganizationName(e.target.value)}
                  className="w-full bg-[var(--surface)] border border-[var(--line)] rounded-xl px-4 py-3 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text)] mb-1.5">Department / Faculty</label>
                <input
                  type="text"
                  placeholder="e.g. Faculty of Science & Technology"
                  value={faculty}
                  onChange={(e) => setFaculty(e.target.value)}
                  className="w-full bg-[var(--surface)] border border-[var(--line)] rounded-xl px-4 py-3 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--text)] mb-1.5">Estimated Markers / Seats</label>
                  <input
                    type="number"
                    min="1"
                    max="1000"
                    value={estimatedSeats}
                    onChange={(e) => setEstimatedSeats(e.target.value)}
                    className="w-full bg-[var(--surface)] border border-[var(--line)] rounded-xl px-4 py-3 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--text)] mb-1.5">Contact Email *</label>
                  <input
                    type="email"
                    required
                    placeholder="admin@school.ac.rw"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    className="w-full bg-[var(--surface)] border border-[var(--line)] rounded-xl px-4 py-3 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text)] mb-1.5">Additional Requirements or Notes</label>
                <textarea
                  rows={3}
                  placeholder="Mention any custom compliance, SIS integration, or invoicing requirements..."
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="w-full bg-[var(--surface)] border border-[var(--line)] rounded-xl px-4 py-3 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)] resize-none"
                />
              </div>
            </div>

            {errorMsg && (
              <p className="text-xs text-[var(--danger)] font-medium">{errorMsg}</p>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-3 rounded-xl border border-[var(--line)] text-sm font-medium text-[var(--muted)] hover:bg-[var(--hover)] min-h-[48px]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={status === 'submitting'}
                className="px-6 py-3 rounded-xl bg-[var(--accent)] text-[var(--on-accent)] text-sm font-medium hover:opacity-90 disabled:opacity-55 flex items-center gap-2 min-h-[48px]"
              >
                {status === 'submitting' && <Loader2 size={16} className="animate-spin" />}
                <span>Send Request</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
