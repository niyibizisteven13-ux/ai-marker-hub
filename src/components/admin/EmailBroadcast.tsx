import { useEffect, useState } from 'react';
import { Mail, Send } from 'lucide-react';
import { adminApi } from '../../api/admin';
import { formatBroadcast, isBroadcastLink, type BroadcastDraft } from '../../../shared/bwengeBroadcast';
import { renderBwengeEmail } from '../../../server/email/BwengeEmailLayout';

const emptyDraft = { subject: '', text: '', linkLabel: '', linkUrl: '' };
const field = 'w-full rounded-lg border border-[#334155] bg-[#101a2c] px-3 py-2.5 text-sm text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#4CE5D6]';
const panel = 'min-w-0 rounded-2xl border border-[#263052] bg-[#131c31] p-5';

export default function EmailBroadcast() {
  const [draft, setDraft] = useState(emptyDraft);
  const [audience, setAudience] = useState<number | null>(null);
  const [pending, setPending] = useState<'test' | 'send' | null>(null);
  const [review, setReview] = useState(false);
  const [status, setStatus] = useState<{ message: string; error?: boolean } | null>(null);

  useEffect(() => {
    let active = true;
    adminApi.getBroadcastAudience().then(({ data }) => {
      if (active) setAudience(data.count);
    }).catch(() => {
      if (active) setStatus({ message: 'Could not load the audience. Reload this tab to try again.', error: true });
    });
    return () => { active = false; };
  }, []);

  const hasLink = Boolean(draft.linkLabel.trim() || draft.linkUrl.trim());
  const linkValid = !hasLink || Boolean(draft.linkLabel.trim() && isBroadcastLink(draft.linkUrl.trim()));
  const ready = Boolean(draft.subject.trim() && draft.text.trim() && linkValid);
  const message = formatBroadcast({
    ...draft,
    subject: draft.subject || 'Your subject',
    text: draft.text || 'Your announcement will appear here.',
  });

  function edit(key: keyof BroadcastDraft, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
    setReview(false);
  }

  async function send(mode: 'test' | 'send') {
    if (pending || !ready || (mode === 'send' && (!audience || !review))) return;
    setPending(mode);
    setStatus(null);
    try {
      if (mode === 'test') {
        const { data } = await adminApi.sendBroadcastTest(draft);
        setStatus({ message: `Test accepted for ${data.recipient}. Check your inbox for the message.` });
        return;
      }
      const { data } = await adminApi.broadcastEmail({ ...draft, expectedRecipients: audience! });
      setStatus({
        message: `Broadcast complete. ${data.delivered.toLocaleString()} accepted for sending, ${data.failed.toLocaleString()} failed out of ${data.targeted.toLocaleString()}.`,
        error: data.failed > 0,
      });
      if (!data.failed) setDraft(emptyDraft);
    } catch (error) {
      setStatus({ message: error instanceof Error ? error.message : 'Could not send the email.', error: true });
      if (mode === 'send') {
        await adminApi.getBroadcastAudience().then(({ data }) => setAudience(data.count)).catch(() => setAudience(null));
      }
    } finally {
      setPending(null);
      setReview(false);
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <section className={panel} aria-label="Broadcast composer">
        <div className="mb-5">
          <h3 className="text-base font-semibold text-white">Compose announcement</h3>
          <p className="mt-1 text-sm text-slate-300">{audience === null ? 'Audience count unavailable' : `${audience.toLocaleString()} enabled accounts`}</p>
        </div>
        <form onSubmit={(event) => { event.preventDefault(); if (ready && audience) setReview(true); }}>
          <fieldset disabled={Boolean(pending)} className="space-y-4">
            <label className="block space-y-1.5 text-sm text-slate-200">
              <span>Subject</span>
              <input className={field} value={draft.subject} onChange={(e) => edit('subject', e.target.value)} maxLength={180} required />
            </label>
            <label className="block space-y-1.5 text-sm text-slate-200">
              <span>Message</span>
              <textarea className={field} value={draft.text} onChange={(e) => edit('text', e.target.value)} rows={8} maxLength={10_000} required />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5 text-sm text-slate-200">
                <span>Button text (optional)</span>
                <input className={field} value={draft.linkLabel} onChange={(e) => edit('linkLabel', e.target.value)} maxLength={80} placeholder="View update" />
              </label>
              <label className="block space-y-1.5 text-sm text-slate-200">
                <span>Button link</span>
                <input className={field} value={draft.linkUrl} onChange={(e) => edit('linkUrl', e.target.value)} maxLength={2048} placeholder="https://www.bwenge.space" />
              </label>
            </div>
            {!linkValid && <p className="text-sm text-amber-300">Enter button text and a valid HTTPS link.</p>}
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void send('test')} disabled={!ready || Boolean(pending)} className="inline-flex items-center gap-2 rounded-lg border border-slate-500 px-3 py-2 text-sm text-white disabled:opacity-50">
                <Mail size={16} /> {pending === 'test' ? 'Sending test…' : 'Send test to me'}
              </button>
              <button type="submit" disabled={!ready || !audience || Boolean(pending)} className="rounded-lg bg-[#F6B94A] px-3 py-2 text-sm font-semibold text-[#0B1420] disabled:opacity-50">
                Review broadcast
              </button>
            </div>
          </fieldset>
        </form>
        {review && <div className="mt-4 space-y-3 rounded-lg border border-[#F6B94A] p-3 text-sm text-white">
          <p>Send “{draft.subject.trim()}” to {audience?.toLocaleString()} enabled accounts?</p>
          <div className="flex flex-wrap gap-3">
            <button type="button" disabled={Boolean(pending)} onClick={() => setReview(false)} className="px-2 py-1.5">Cancel</button>
            <button type="button" disabled={Boolean(pending)} onClick={() => void send('send')} className="inline-flex items-center gap-2 rounded-lg bg-[#F6B94A] px-3 py-1.5 font-semibold text-[#0B1420] disabled:opacity-50">
              <Send size={15} /> {pending === 'send' ? 'Sending…' : 'Confirm and send'}
            </button>
          </div>
        </div>}
        {status && <p role="status" className={`mt-4 text-sm ${status.error ? 'text-rose-300' : 'text-teal-200'}`}>{status.message}</p>}
      </section>
      <section className={panel} aria-label="Email preview">
        <h3 className="mb-3 text-base font-semibold text-white">Email preview</h3>
        <iframe title="Branded broadcast preview" sandbox="" srcDoc={renderBwengeEmail(message.html)} className="h-[480px] w-full rounded-xl border border-[#263052] bg-[#0B1420]" />
      </section>
    </div>
  );
}
