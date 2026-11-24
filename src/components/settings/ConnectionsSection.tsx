import { useCallback, useEffect, useState } from 'react';
import { Send, CheckCircle2, Link2, Unlink, Loader2, RefreshCw, ExternalLink, ShieldCheck, Store, UserRound, ArrowUpRight, BookOpen } from 'lucide-react';
import { setPin, usePins, type Pin } from '../../utils/sidebarPrefs';
import { authFetch } from '../../utils/authFetch';
import BizConnection from './BizConnection';

type TelegramConnection = { connected: boolean; chatId: string | null; botUsername: string; botConfigured: boolean };

/** MySEB and Ventures are not in the sidebar by default: add them here if you want a shortcut. */
function SidebarShortcuts() {
  const pins = usePins();
  const rows: Array<{ id: Pin; icon: typeof Store; name: string; text: string; href: string }> = [
    { id: 'myseb', icon: ShieldCheck, name: 'MySEB', text: 'Secure exams and live rooms for lecturers. MySEB is its own app: open it, or install it on your phone or computer.', href: '/ms' },
    { id: 'ventures', icon: Store, name: 'Bwenge4Biz', text: 'Manage business and creator pages, products, orders, and sales.', href: '/biz' },
    { id: 'profile', icon: UserRound, name: 'Bwenge4Profile', text: 'Manage your personal portfolio, biography, CV, and public updates.', href: '/profile' },
  ];
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)]">
      <div className="border-b border-[var(--line)] px-6 py-4"><h3 className="font-display text-base font-semibold text-[var(--text)]">Sidebar shortcuts</h3><p className="text-xs text-[var(--muted)]">Choose what shows in the left sidebar. Bwenge4biz and Bwenge4profile are always under Agents.</p></div>
      <ul className="divide-y divide-[var(--line)]">{rows.map((r) => { const Icon = r.icon; const on = pins[r.id]; return (
        <li key={r.id} className="flex flex-wrap items-center gap-4 px-6 py-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)]/15 text-[var(--accent)]"><Icon size={18} aria-hidden="true" /></span>
          <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-[var(--text)]">{r.name}</p><p className="text-xs text-[var(--muted)]">{r.text}</p></div>
          <a href={r.href} className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--line)] px-3.5 py-2 text-xs font-medium text-[var(--text)] hover:bg-[var(--surface-2)]">Open <ArrowUpRight size={13} aria-hidden="true" /></a>
          <button type="button" role="switch" aria-checked={on} aria-label={`Show ${r.name} in the sidebar`} onClick={() => setPin(r.id, !on)} className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? 'bg-[var(--accent)]' : 'bg-[var(--surface-2)] ring-1 ring-[var(--line)]'}`}><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} /></button>
          <span className="w-24 text-xs text-[var(--muted)]">{on ? 'In the sidebar' : 'Not in the sidebar'}</span>
        </li>); })}</ul>
    </div>
  );
}

function ResearchConnection() {
  const [connected,setConnected]=useState<boolean|null>(null);
  useEffect(()=>{
    let active=true;
    const refresh=async()=>{try{const r=await authFetch('/api/research/studio/access');if(!r.ok)throw Error('Access unavailable');const d=await r.json();if(active)setConnected(d.connected===true);}catch{if(active)setConnected(null);}};
    void refresh();
    const timer=window.setInterval(refresh,15000);
    window.addEventListener('focus',refresh);
    return()=>{active=false;window.clearInterval(timer);window.removeEventListener('focus',refresh);};
  },[]);
  if(connected!==true)return null;
  return <section className="flex flex-wrap items-center gap-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6">
    <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--teal)]/15 text-[var(--teal)]"><BookOpen size={24}/></span>
    <div className="min-w-0 flex-1"><h3 className="font-semibold text-[var(--text)]">Bwenge4Research</h3><p className="text-xs text-[var(--muted)]">Your invitation-only scholarly publishing membership. Access is managed by Bwenge administrators.</p></div>
    <span className="inline-flex items-center gap-1 text-xs text-[var(--teal)]"><CheckCircle2 size={14}/> Connected</span>
    <a href="/research?studio=1" className="inline-flex items-center gap-1 rounded-xl border border-[var(--line)] px-4 py-2 text-xs font-medium text-[var(--text)]">Open Research Studio <ArrowUpRight size={14}/></a>
  </section>;
}

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
        <h2 className="text-xl font-normal text-[var(--text)] font-display">Connected Apps & Integrations</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">Link your Bwenge account to Telegram for instant batch grading, forms, and AI companion notifications.</p>
      </div>
      <SidebarShortcuts />

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

      <BizConnection />
      <ResearchConnection />

      {message && (
        <div role="status" className={`rounded-xl p-3 text-xs flex items-center gap-2 ${message.error ? 'bg-[var(--danger)]/10 text-[var(--danger)]' : 'bg-[var(--teal)]/10 text-[var(--teal)]'}`}>
          <span>{message.text}</span>
        </div>
      )}
    </div>
  );
}
