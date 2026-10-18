import { useCallback, useEffect, useState } from 'react';
import { Send, CheckCircle2, Link2, Unlink, Loader2, RefreshCw, ExternalLink } from 'lucide-react';
import { authFetch } from '../../utils/authFetch';

type TelegramConnection = { connected: boolean; chatId: string | null; botUsername: string };
export default function ConnectionsSection() {
  const [telegram, setTelegram] = useState<TelegramConnection>({ connected: false, chatId: null, botUsername: '@BwengeAI_Bot' });
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
        if (connected) { setWaiting(false); setMessage({ error: false, text: 'Telegram is connected to your account.' }); }
      }).catch(() => {});
    }, 3000);
    const timeout = window.setTimeout(() => {
      setWaiting(false);
      setMessage((current) => current?.error ? current : { error: true, text: 'Pairing timed out. Start a new secure link and try again.' });
    }, 10 * 60 * 1000);
    return () => { window.clearInterval(timer); window.clearTimeout(timeout); };
  }, [waiting, fetchConnections]);

  const handleConnect = async () => {
    setConnecting(true); setMessage(null);
    try {
      const res = await authFetch('/api/connections/telegram/link', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.link) throw new Error(data.error || 'Could not create a secure Telegram link.');
      const link = document.createElement('a');
      link.href = data.link; link.target = '_blank'; link.rel = 'noopener noreferrer';
      document.body.appendChild(link); link.click(); link.remove();
      setWaiting(true);
      setMessage({ error: false, text: 'Finish pairing in Telegram. This page will update when the bot confirms your account.' });
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
      setMessage({ error: false, text: 'Telegram has been disconnected.' });
    } catch (e) { setMessage({ error: true, text: e instanceof Error ? e.message : 'Could not disconnect Telegram.' }); }
    finally { setConnecting(false); }
  };

  if (loading) return <div className="flex items-center justify-center gap-2 py-12 text-sm text-[var(--muted)]"><Loader2 size={18} className="animate-spin text-[var(--accent)]" />Loading integrations…</div>;
  return <div className="space-y-6">
    <div><h2 className="text-xl font-normal text-[var(--text)] font-[\'Georgia\',serif]">Connected Apps & Integrations</h2><p className="mt-1 text-xs text-[var(--muted)]">Connections are confirmed by the service and tied to your signed-in account.</p></div>
    <section className="space-y-5 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 shadow-sm">
      <div className="flex flex-col justify-between gap-4 border-b border-[var(--line)] pb-5 sm:flex-row sm:items-center"><div className="flex items-center gap-4"><div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--teal)]/15 text-[var(--teal)]"><Send size={24} /></div><div><h3 className="text-base font-medium text-[var(--text)]">Telegram Bot</h3><p className="mt-1 text-xs text-[var(--muted)]">{telegram.botUsername} · secure account pairing</p></div></div>{telegram.connected ? <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--teal)]/15 px-3.5 py-1.5 text-xs font-medium text-[var(--teal)]"><CheckCircle2 size={14} />Connected · {telegram.chatId}</span> : <span className="rounded-full bg-[var(--surface-2)] px-3.5 py-1.5 text-xs font-medium text-[var(--muted)]">Not connected</span>}</div>
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center"><p className="max-w-xl text-xs leading-relaxed text-[var(--muted)]">{telegram.connected ? 'This Telegram chat is linked to your Bwenge account. Disconnecting revokes that association.' : 'Open the bot using a short-lived pairing link. The link expires after 10 minutes and can only be used once.'}</p><div className="flex w-full gap-2 sm:w-auto">{telegram.connected ? <button type="button" disabled={connecting} onClick={() => void handleDisconnect()} className="flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--line)] px-5 py-2.5 text-xs font-medium text-[var(--danger)] transition-colors hover:bg-[var(--danger)]/10 disabled:opacity-60 sm:w-auto">{connecting ? <Loader2 size={14} className="animate-spin" /> : <Unlink size={14} />}Disconnect</button> : <button type="button" disabled={connecting || waiting} onClick={() => void handleConnect()} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-5 py-2.5 text-xs font-medium text-[var(--on-accent)] transition-opacity hover:opacity-90 disabled:opacity-60 sm:w-auto">{connecting ? <Loader2 size={14} className="animate-spin" /> : waiting ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}{waiting ? 'Waiting for Telegram…' : 'Connect Telegram'}</button>}{waiting && <button type="button" onClick={() => void fetchConnections().then((connected) => { if (connected) setWaiting(false); }).catch((e) => setMessage({ error: true, text: e.message }))} className="inline-flex items-center justify-center rounded-xl border border-[var(--line)] px-3 text-[var(--muted)] hover:text-[var(--text)]" aria-label="Refresh connection status"><RefreshCw size={15} /></button>}</div></div>
      {!telegram.connected && !waiting && <a href={`https://t.me/${telegram.botUsername.replace(/^@/, '')}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs text-[var(--accent)] hover:underline">Open bot details <ExternalLink size={12} /></a>}
    </section>
    {message && <p role="status" className={`rounded-xl p-3 text-xs ${message.error ? 'bg-[var(--danger)]/10 text-[var(--danger)]' : 'bg-[var(--teal)]/10 text-[var(--teal)]'}`}>{message.text}</p>}
  </div>;
}
