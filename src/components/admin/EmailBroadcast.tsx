import { useEffect, useRef, useState } from 'react';
import { Mail, Send } from 'lucide-react';
import { adminApi } from '../../api/admin';
import { formatBroadcast, isBroadcastLink, type BroadcastSender } from '../../../shared/bwengeBroadcast';
import { renderBwengeEmail } from '../../../server/email/BwengeEmailLayout';

const emptyDraft = { subject: '', text: '', linkLabel: '', linkUrl: '', htmlSource: '', videoUrl: '' };
const field = 'w-full rounded-lg border border-[#334155] bg-[#101a2c] px-3 py-2.5 text-sm text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#4CE5D6]';
const panel = 'min-w-0 rounded-2xl border border-[#263052] bg-[#131c31] p-5';

export default function EmailBroadcast() {
  const [draft, setDraft] = useState(emptyDraft);
  const [sender, setSender] = useState<BroadcastSender>('notifications');
  const [senders, setSenders] = useState<Array<{ id: BroadcastSender; from: string }>>([]);
  const selectedFrom = senders.find(({ id }) => id === sender)?.from;
  const [audience, setAudience] = useState<number | null>(null);
  const [pending, setPending] = useState<'test' | 'send' | 'upload' | null>(null);
  const [recipientText, setRecipientText] = useState('');
  const [allAccounts, setAllAccounts] = useState(false);
  const [htmlMode, setHtmlMode] = useState(false);
  const [htmlPreview, setHtmlPreview] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const [review, setReview] = useState(false);
  const confirmationRef = useRef<HTMLDivElement>(null);
  const sendButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (review) confirmationRef.current?.focus();
  }, [review]);
  const [status, setStatus] = useState<{ message: string; error?: boolean } | null>(null);

  useEffect(() => {
    let active = true;
    adminApi.getBroadcastAudience().then(({ data }) => {
      if (active) {
        setAudience(data.count);
        setSenders(data.senders);
      }
    }).catch(() => {
      if (active) setStatus({ message: 'Could not load the audience. Reload this tab to try again.', error: true });
    });
    return () => { active = false; };
  }, []);

  const hasLink = Boolean(draft.linkLabel.trim() || draft.linkUrl.trim());
  const linkValid = !hasLink || Boolean(draft.linkLabel.trim() && isBroadcastLink(draft.linkUrl.trim()));
  const videoValid = !draft.videoUrl.trim() || isBroadcastLink(draft.videoUrl.trim());
  const ready = Boolean(selectedFrom && draft.subject.trim() && (draft.text.trim() || (htmlMode && draft.htmlSource.trim())) && linkValid && videoValid);
  const recipients = [...new Set(recipientText.trim().toLowerCase().split(/[\s,;]+/).filter(Boolean))];
  const validRecipients = recipients.length <= 25 && recipients.every((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
  const targetCount = allAccounts ? audience : validRecipients ? recipients.length : 0;
  const payload = { ...draft, sender, htmlSource: htmlMode ? draft.htmlSource : undefined };
  const message = formatBroadcast({
    ...draft,
    subject: draft.subject || 'Your subject',
    text: draft.text || 'Your announcement will appear here.',
  });

  function edit(key: keyof typeof emptyDraft, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
    setHtmlPreview(null);
    setReview(false);
  }

  useEffect(() => {
    setHtmlPreview(null);
    setPreviewError(false);
    if (!htmlMode || !draft.htmlSource.trim()) return;

    let active = true;
    const timer = window.setTimeout(() => {
      adminApi.previewBroadcast({
        ...draft,
        subject: draft.subject.trim() || 'Your subject',
        linkLabel: linkValid ? draft.linkLabel : '',
        linkUrl: linkValid ? draft.linkUrl : '',
        videoUrl: videoValid ? draft.videoUrl : '',
      }).then(({ data }) => {
        if (active) setHtmlPreview(data.html);
      }).catch(() => {
        if (active) setPreviewError(true);
      });
    }, 300);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [draft, htmlMode, linkValid, videoValid]);

  async function importHtml(file: File) {
    try {
      const source = await file.text();
      if (!source.trim() || source.trim().length > 20_000) {
        throw new Error('Choose an HTML file with between 1 and 20,000 characters.');
      }
      setHtmlMode(true);
      edit('htmlSource', source.trim());
      setStatus(null);
    } catch (error) {
      setStatus({ message: error instanceof Error ? error.message : 'Could not read the HTML file.', error: true });
    }
  }

  async function uploadVideo(file: File) {
    if (file.size > 100 * 1024 * 1024 || !/\.mp4$/i.test(file.name)) {
      setStatus({ message: 'Choose an MP4 video up to 100 MB.', error: true });
      return;
    }
    setPending('upload');
    setReview(false);
    setStatus(null);
    try {
      edit('videoUrl', await adminApi.uploadBroadcastVideo(file));
      setStatus({ message: 'Video uploaded and added to the email.' });
    } catch (error) {
      setStatus({ message: error instanceof Error ? error.message : 'Could not upload the video.', error: true });
    } finally {
      setPending(null);
    }
  }

  async function send(mode: 'test' | 'send') {
    if (pending || !ready || (mode === 'send' && (!targetCount || !review))) return;
    setPending(mode);
    setStatus(null);
    try {
      if (mode === 'test') {
        const { data } = await adminApi.sendBroadcastTest(payload);
        setStatus({ message: `Test accepted for ${data.recipient}. Check your inbox for the message.` });
        return;
      }
      const { data } = await adminApi.broadcastEmail({ ...payload, recipients: allAccounts ? undefined : recipients, expectedRecipients: targetCount! });
      setStatus({
        message: `Broadcast complete. ${data.delivered.toLocaleString()} accepted for sending, ${data.failed.toLocaleString()} failed out of ${data.targeted.toLocaleString()}.`,
        error: data.failed > 0,
      });
      if (!data.failed) {
        setDraft(emptyDraft);
        setHtmlPreview(null);
      }
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
        <form onSubmit={(event) => { event.preventDefault(); if (ready && targetCount) setReview(true); }}>
          <fieldset disabled={Boolean(pending)} className="space-y-4">
            <label className="block space-y-1.5 text-sm text-slate-200">
              <span>From</span>
              <select className={field} value={sender} disabled={!senders.length} onChange={(event) => {
                setSender(event.target.value as BroadcastSender);
                setReview(false);
              }}>
                {!senders.length && <option value="notifications">Sender unavailable</option>}
                {senders.map(({ id, from }) => <option key={id} value={id}>{from}</option>)}
              </select>
            </label>
            <label className="block space-y-1.5 text-sm text-slate-200">
              <span>Send to</span>
              <select className={field} value={allAccounts ? 'all' : 'specific'} onChange={(event) => {
                setAllAccounts(event.target.value === 'all');
                setReview(false);
              }}>
                <option value="specific">Specific email addresses</option>
                <option value="all">All enabled accounts</option>
              </select>
            </label>
            {!allAccounts && <label className="block space-y-1.5 text-sm text-slate-200">
              <span>Recipient email addresses (up to 25)</span>
              <textarea className={field} value={recipientText} rows={2} maxLength={7_000} placeholder="lecturer@example.edu" onChange={(event) => {
                setRecipientText(event.target.value);
                setReview(false);
              }} />
              {!validRecipients && <span className="block text-amber-300">Enter up to 25 valid email addresses.</span>}
            </label>}
            <label className="block space-y-1.5 text-sm text-slate-200">
              <span>Subject</span>
              <input className={field} value={draft.subject} onChange={(e) => edit('subject', e.target.value)} maxLength={180} required />
            </label>
            <label className="block space-y-1.5 text-sm text-slate-200">
              <span>{htmlMode ? 'Plain-text version (optional with HTML)' : 'Message'}</span>
              <textarea className={field} value={draft.text} onChange={(e) => edit('text', e.target.value)} rows={8} maxLength={10_000} required={!htmlMode || !draft.htmlSource.trim()} />
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-200">
              <input type="checkbox" checked={htmlMode} onChange={(event) => {
                setHtmlMode(event.target.checked);
                setHtmlPreview(null);
                setReview(false);
              }} />
              Write formatted HTML
            </label>
            {htmlMode && <div className="space-y-2">
              <label className="block space-y-1.5 text-sm text-slate-200">
                <span>HTML message</span>
                <textarea className={`${field} font-mono`} value={draft.htmlSource} rows={7} maxLength={20_000} onChange={(event) => edit('htmlSource', event.target.value)} placeholder="<p>Dear Professor,</p>" />
              </label>
              <label className="block space-y-1.5 text-sm text-slate-200">
                <span>Import HTML file</span>
                <input type="file" accept=".html,.htm,text/html" className={field} onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = '';
                  if (file) void importHtml(file);
                }} />
              </label>
            </div>}
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
            <label className="block space-y-1.5 text-sm text-slate-200">
              <span>Inline video URL (optional)</span>
              <input className={field} value={draft.videoUrl} onChange={(e) => edit('videoUrl', e.target.value)} maxLength={2048} placeholder="https://media.example.com/demo.mp4" />
              <span className="block text-xs text-slate-400">Use a direct, publicly accessible MP4 link. The email also includes a Watch video link.</span>
            </label>
            <label className="block space-y-1.5 text-sm text-slate-200">
              <span>{pending === 'upload' ? 'Uploading video…' : 'Upload MP4 video (up to 100 MB)'}</span>
              <input type="file" accept=".mp4,video/mp4" className={field} onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (file) void uploadVideo(file);
              }} />
              <span className="block text-xs text-slate-400">Bwenge hosts your upload and fills in the video URL automatically.</span>
            </label>
            {!videoValid && <p className="text-sm text-amber-300">Enter a valid HTTPS video URL.</p>}
            {!linkValid && <p className="text-sm text-amber-300">Enter button text and a valid HTTPS link.</p>}
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void send('test')} disabled={!ready || Boolean(pending)} className="inline-flex items-center gap-2 rounded-lg border border-slate-500 px-3 py-2 text-sm text-white disabled:opacity-50">
                <Mail size={16} /> {pending === 'test' ? 'Sending test…' : 'Send test to me'}
              </button>
              <button ref={sendButtonRef} type="submit" disabled={!ready || !targetCount || Boolean(pending)} className="inline-flex items-center gap-2 rounded-lg bg-[#F6B94A] px-3 py-2 text-sm font-semibold text-[#0B1420] disabled:opacity-50">
                <Send size={16} /> Send email
              </button>
            </div>
          </fieldset>
        </form>
        {review && <div ref={confirmationRef} tabIndex={-1} role="group" aria-label="Confirm email recipients" className="mt-4 space-y-3 rounded-lg border border-[#F6B94A] p-3 text-sm text-white">
          <p>Send “{draft.subject.trim()}” to {targetCount?.toLocaleString()} {allAccounts ? 'enabled accounts' : 'selected recipients'}?</p>
          <p>From {selectedFrom}</p>
          {!allAccounts && <p className="break-words">To {recipients.join(', ')}</p>}
          <div className="flex flex-wrap gap-3">
            <button type="button" disabled={Boolean(pending)} onClick={() => { setReview(false); sendButtonRef.current?.focus(); }} className="px-2 py-1.5">Cancel</button>
            <button type="button" disabled={Boolean(pending)} onClick={() => void send('send')} className="inline-flex items-center gap-2 rounded-lg bg-[#F6B94A] px-3 py-1.5 font-semibold text-[#0B1420] disabled:opacity-50">
              <Send size={15} /> {pending === 'send' ? 'Sending…' : 'Confirm and send'}
            </button>
          </div>
        </div>}
        {status && <p role="status" className={`mt-4 text-sm ${status.error ? 'text-rose-300' : 'text-teal-200'}`}>{status.message}</p>}
      </section>
      <section className={panel} aria-label="Email preview">
        <h3 className="mb-3 text-base font-semibold text-white">Email preview</h3>
        {htmlMode && draft.htmlSource.trim() && !htmlPreview && (
          <p role="status" className="mb-3 text-sm text-slate-300">
            {previewError ? 'Could not render the HTML preview. Edit the draft to try again.' : 'Rendering HTML preview…'}
          </p>
        )}
        {selectedFrom && <p className="mb-3 break-words text-sm text-slate-300">From {selectedFrom}</p>}
        <iframe title="Branded broadcast preview" sandbox="" allow="autoplay" srcDoc={htmlMode && htmlPreview ? htmlPreview : renderBwengeEmail(message.html)} className="h-[480px] w-full rounded-xl border border-[#263052] bg-[#0B1420]" />
      </section>
    </div>
  );
}
