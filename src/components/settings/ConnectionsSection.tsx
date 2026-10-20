import { useCallback, useEffect, useState } from 'react';
import { Send, CheckCircle2, Link2, Unlink, Loader2, RefreshCw, ExternalLink } from 'lucide-react';
import { authFetch } from '../../utils/authFetch';

type TelegramConnection = { connected: boolean; chatId: string | null; botUsername: string; botConfigured: boolean };

export default function ConnectionsSection() {
  const [telegram, setTelegram] = useState<TelegramConnection>({ connected: false, chatId: null, botUsername: '@Bwengebot', botConfigured: false });
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);

  const fetchConnections = useCallback(async () => {
    const res = await authFetch('/api/connections');
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.telegram) throw new Error(data.error || 'Could not load account connections.');
    setTelegram(data.telegram);
    return Boolean(data.telegram.connected);
  }, []);

  useEffect(() => {
    void fetchConnections().catch((e) => setMessage({ error: true, text: e.message })).finally(() => setLoading(false));
  }, [fetchConnections]);

  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => {
      void fetchConnections().then((connected) => {
        if (connected) { setWaiting(false); setMessage({ error: false, text: 'Telegram is successfully connected to your account!' }); }
      }).catch((error) => {
        setMessage({
          error: true,
          text: error instanceof Error ? `Could not confirm Telegram connection: ${error.message}` : 'Could not confirm Telegram connection.',
        });
      });
    }, 3000);
    const timeout = window.setTimeout(() => {
      setWaiting(false);
      setMessage((current) => current?.error ? current : { error: true, text: 'Pairing timed out. Click Connect again to retry.' });
    }, 10 * 60 * 1000);
    return () => { window.clearInterval(timer); window.clearTimeout(timeout); };
  }, [waiting, fetchConnections]);

  const handleConnect = async () => {
    setConnecting(true); setMessage(null);
    try {
      const res = await authFetch('/api/connections/telegram/link', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.link) throw new Error(data.error || 'Could not create a secure Telegram link.');
      if (typeof data.botUsername === 'string') {
        setTelegram((current) => ({ ...current, botUsername: data.botUsername }));
      }
      const link = document.createElement('a');
      link.href = data.link; link.target = '_blank'; link.rel = 'noopener noreferrer';
      document.body.appendChild(link); link.click(); link.remove();
      setWaiting(true);
      setMessage({ error: false, text: 'Finish pairing in Telegram (@Bwengebot). This page will update automatically once connected.' });
    } catch (e) { setMessage({ error: true, text: e instanceof Error ? e.message : 'Could not connect Telegram.' }); }
    finally { setConnecting(false); }
  };

  const handleDisconnect = async () => {
    setConnecting(true); setMessage(null);
    try {
      const res = await authFetch('/api/connections/telegram', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'disconnect' }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'Could not disconnect Telegram.');
      setTelegram((current) => ({ ...current, connected: false, chatId: null }));
      setWaiting(false);
      setMessage({ error: false, text: 'Telegram has been disconnected from your account.' });
    } catch (e) { setMessage({ error: true, text: e instanceof Error ? e.message : 'Could not disconnect Telegram.' }); }
    finally { setConnecting(false); }
  };

  if (loading) return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-[var(--muted)]">
      <Loader2 size={18} className="animate-spin text-[var(--accent)]" /> Loading connections...
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-normal text-[var(--text)] font-['Georgia',serif]">Connected Apps & Integrations</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">Link your Bwenge account to Telegram for instant batch grading, forms, and AI assistant notifications.</p>
      </div>

      <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 shadow-sm transition-all hover:border-[var(--accent)]/30">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--teal)]/15 text-[var(--teal)]">
              <Send size={24} />
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-medium text-[var(--text)]">Bwengebot</h3>
                <a
                  href="https://t.me/Bwengebot"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline"
                >
                  @Bwengebot <ExternalLink size={11} />
                </a>
              </div>
              <p className="text-xs text-[var(--muted)]">Your grading companion on Telegram</p>
            </div>
          </div>

          <div>
            {telegram.connected ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--teal)]/15 px-3 py-1 text-xs font-medium text-[var(--teal)]">
                <CheckCircle2 size={14} /> Connected
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--surface-2)] px-3 py-1 text-xs font-medium text-[var(--muted)]">
                Not connected
              </span>
            )}
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-t border-[var(--line)] pt-5">
          <p className="text-xs leading-relaxed text-[var(--muted)] max-w-md">
            {telegram.connected
              ? `Linked to chat ID: ${telegram.chatId}. You can run /grade, /exam, /form, and /scan directly in Telegram.`
              : telegram.botConfigured
              ? 'Connect securely in one click. Opens @Bwengebot with a pairing session token.'
              : 'Telegram bot is currently unconfigured on this server.'}
          </p>

          <div className="flex items-center gap-2">
            {telegram.connected ? (
              <button
                type="button"
                disabled={connecting}
                onClick={() => void handleDisconnect()}
                className="flex items-center justify-center gap-2 rounded-xl border border-[var(--line)] px-4 py-2 text-xs font-medium text-[var(--danger)] transition-colors hover:bg-[var(--danger)]/10 disabled:opacity-60"
              >
                {connecting ? <Loader2 size={14} className="animate-spin" /> : <Unlink size={14} />} Disconnect
              </button>
            ) : (
              <button
                type="button"
                disabled={connecting || waiting || !telegram.botConfigured}
                onClick={() => void handleConnect()}
                className="flex items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-5 py-2.5 text-xs font-medium text-[var(--on-accent)] transition-opacity hover:opacity-90 disabled:opacity-60 shadow-sm"
              >
                {connecting || waiting ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
                {waiting ? 'Waiting for Telegram...' : 'Connect Telegram'}
              </button>
            )}

            {waiting && (
              <button
                type="button"
                onClick={() => void fetchConnections().then((connected) => { if (connected) setWaiting(false); }).catch((e) => setMessage({ error: true, text: e.message }))}
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)] transition-colors"
                aria-label="Refresh connection status"
              >
                <RefreshCw size={15} />
              </button>
            )}
          </div>
        </div>
      </div>

      {message && (
        <div role="status" className={`rounded-xl p-3 text-xs flex items-center gap-2 ${message.error ? 'bg-[var(--danger)]/10 text-[var(--danger)]' : 'bg-[var(--teal)]/10 text-[var(--teal)]'}`}>
          <span>{message.text}</span>
        </div>
      )}
    </div>
  );
}
