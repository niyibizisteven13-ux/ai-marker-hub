import { useState, useEffect, useRef } from 'react';
import { ShieldCheck, Phone, CheckCircle2, AlertCircle, Loader2, ArrowLeft, ExternalLink, RefreshCw } from 'lucide-react';
import { authFetch } from '../utils/authFetch';

interface CheckoutPageProps {
  batchId?: string;
  service?: string;
  planType?: string;
  amountUsd?: number;
  onBack: () => void;
  onSuccess: () => void;
}

const SERIF = "font-['Georgia','Tiempos_Headline','Times_New_Roman',serif]";

export default function CheckoutPage({ batchId, service, planType, amountUsd = 0.20, onBack, onSuccess }: CheckoutPageProps) {
  const [phone, setPhone] = useState('');
  const [status, setStatus] = useState<'idle' | 'pending' | 'success' | 'failed' | 'timeout'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const idempotencyKeyRef = useRef<string>(crypto.randomUUID());

  const normalizePhone = (input: string) => {
    const cleaned = input.replace(/\D/g, '');
    if (cleaned.startsWith('250')) return `+${cleaned}`;
    if (cleaned.startsWith('0')) return `+250${cleaned.slice(1)}`;
    return `+250${cleaned}`;
  };

  const handleInitiatePayment = async () => {
    const normalized = normalizePhone(phone);
    if (!/^\+250[0-9]{9}$/.test(normalized)) {
      setError('Enter a valid Rwandan Mobile Money number (e.g. 078XXXXXXX).');
      return;
    }
    setError(null);
    setStatus('pending');

    const payload: { phoneNumber: string; batchId?: string; service?: string; planType?: string; idempotencyKey: string } = {
      phoneNumber: normalized,
      batchId,
      service,
      planType,
      idempotencyKey: idempotencyKeyRef.current,
    };

    try {
      const res = await authFetch('/api/payments/initiate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': idempotencyKeyRef.current,
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus('failed');
        setError(data.error || 'Payment initiation failed.');
        return;
      }
      setPaymentId(data.paymentId || batchId || planType || 'pay_current');
      void pollPaymentStatus(data.paymentId || batchId || planType || 'pay_current');
    } catch (err) {
      setStatus('failed');
      setError(err instanceof Error ? err.message : 'Network error during payment initiation.');
    }
  };

  const pollPaymentStatus = async (targetId: string) => {
    const maxAttempts = 30; // 30 * 3s = 90s timeout
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const url = batchId
          ? `/api/payments/status?${new URLSearchParams({ jobId: batchId })}`
          : planType
          ? `/api/payments/status?${new URLSearchParams({ planType })}`
          : `/api/payments/status?${new URLSearchParams({ id: targetId })}`;

        const res = await authFetch(url);
        const data = await res.json();
        if (!res.ok) continue;

        if (data.status === 'SUCCESS') {
          setStatus('success');
          setReceiptUrl(`#receipt-${targetId}`);
          setTimeout(() => onSuccess(), 2500);
          return;
        }
        if (data.status === 'FAILED') {
          setStatus('failed');
          setError('Payment was declined or failed.');
          return;
        }
      } catch {
        // network retry during poll
      }
    }
    setStatus('timeout');
    setError('Payment prompt timed out. Please check your phone or retry.');
  };

  return (
    <div className="h-[100dvh] w-full bg-[var(--bg)] text-[var(--text)] flex flex-col font-sans antialiased">
      {/* Top Bar */}
      <div className="px-4 sm:px-6 py-3.5 border-b border-[var(--line)] flex items-center justify-between bg-[var(--surface)]/80">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-[var(--muted)] hover:text-[var(--text)] transition-colors rounded-lg px-3 py-2 hover:bg-[var(--hover)]"
        >
          <ArrowLeft size={16} />
          <span className="text-sm font-medium">Back</span>
        </button>
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium text-[var(--muted)] border border-[var(--line)] bg-[var(--surface)]">
          <ShieldCheck size={14} className="text-[var(--teal)]" /> Mobile Money Secure Checkout
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-md bg-[var(--surface)] border border-[var(--line)] rounded-2xl p-6 sm:p-8 shadow-md">
          {status === 'success' ? (
            <div className="py-6 text-center">
              <div className="w-16 h-16 bg-[var(--teal)]/15 rounded-full flex items-center justify-center text-[var(--teal)] mx-auto mb-5 border border-[var(--teal)]/30">
                <CheckCircle2 size={32} />
              </div>
              <h2 className={`${SERIF} text-2xl font-normal text-[var(--text)] mb-2`}>Payment Confirmed</h2>
              <p className="text-sm text-[var(--muted)] mb-6 leading-relaxed">
                Your Mobile Money transaction was successful. Access is now unlocked.
              </p>
              {receiptUrl && (
                <a
                  href={receiptUrl}
                  className="inline-flex items-center gap-2 text-xs font-medium text-[var(--accent)] hover:underline mb-6"
                >
                  View transaction receipt <ExternalLink size={12} />
                </a>
              )}
              <button
                onClick={onSuccess}
                className="w-full py-3.5 rounded-xl bg-[var(--text)] text-[var(--on-accent)] text-sm font-medium hover:opacity-90 transition-colors min-h-[48px]"
              >
                Return to Workspace
              </button>
            </div>
          ) : (
            <div className="space-y-5">
              <div>
                <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider block mb-1">Secure Checkout</span>
                <h2 className={`${SERIF} text-2xl font-normal text-[var(--text)]`}>
                  {planType ? `Subscribe to ${planType}` : 'Unlock Marking Batch'}
                </h2>
                <p className="text-xs text-[var(--muted)] mt-1">
                  Amount due: <span className="font-semibold text-[var(--text)]">${amountUsd.toFixed(2)} USD</span>
                </p>
              </div>

              <div>
                <label className="text-xs font-medium text-[var(--text)] mb-2 block">
                  Mobile Money Phone Number (+250)
                </label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[var(--muted)]">
                    <Phone size={17} />
                  </div>
                  <input
                    type="tel"
                    placeholder="078 XXX XXXX"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    disabled={status === 'pending'}
                    className="w-full bg-[var(--bg)] border border-[var(--line)] rounded-xl py-3 pl-11 pr-4 text-sm text-[var(--text)] placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--accent)] disabled:opacity-50"
                  />
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-2.5 p-3.5 bg-[var(--danger)]/15 border border-[var(--danger)]/30 rounded-xl text-sm text-[var(--danger)]">
                  <AlertCircle size={16} className="shrink-0" />
                  {error}
                </div>
              )}

              <button
                onClick={handleInitiatePayment}
                disabled={status === 'pending'}
                className="w-full py-3.5 rounded-xl font-medium text-sm transition-colors bg-[var(--accent)] text-[var(--on-accent)] hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2 min-h-[48px]"
              >
                {status === 'pending' && <Loader2 size={18} className="animate-spin" />}
                <span>{status === 'pending' ? 'Waiting for MoMo confirmation…' : status === 'timeout' ? 'Retry Payment' : 'Pay with Mobile Money'}</span>
              </button>

              {status === 'timeout' && (
                <button
                  onClick={() => setStatus('idle')}
                  className="w-full py-2.5 rounded-xl border border-[var(--line)] bg-[var(--bg)] text-xs font-medium text-[var(--text)] hover:bg-[var(--hover)] flex items-center justify-center gap-1.5"
                >
                  <RefreshCw size={14} /> Reset & Try Again
                </button>
              )}

              <p className="text-center text-xs text-[var(--muted)] leading-relaxed">
                Approve the MTN MoMo or Airtel Money payment prompt on your phone when prompted.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
