import { useState, useEffect } from 'react';
import { Send, CheckCircle2, Link2, Unlink, Loader2 } from 'lucide-react';
import { authFetch } from '../../utils/authFetch';

export default function ConnectionsSection() {
  const [connected, setConnected] = useState(false);
  const [chatId, setChatId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    void fetchConnections();
  }, []);

  const fetchConnections = async () => {
    try {
      const res = await authFetch('/api/connections');
      const data = await res.json();
      if (res.ok && data.telegram) {
        setConnected(data.telegram.connected);
        setChatId(data.telegram.chatId);
      }
    } catch {
      // fallback
    } finally {
      setLoading(false);
    }
  };

  const handleConnectTelegram = () => {
    setConnecting(true);
    // Simulate deep link or token linking to Telegram bot @BwengeAI_Bot
    setTimeout(async () => {
      try {
        const mockChatId = 'tg_' + Math.floor(100000 + Math.random() * 900000);
        const res = await authFetch('/api/connections/telegram', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'connect', chatId: mockChatId }),
        });
        const data = await res.json();
        if (res.ok && data.success) {
          setConnected(true);
          setChatId(mockChatId);
        }
      } catch {
        // error
      } finally {
        setConnecting(false);
      }
    }, 1500);
  };

  const handleDisconnectTelegram = async () => {
    setConnecting(true);
    try {
      await authFetch('/api/connections/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'disconnect' }),
      });
      setConnected(false);
      setChatId(null);
    } catch {
      // error
    } finally {
      setConnecting(false);
    }
  };

  if (loading) {
    return (
      <div className="py-12 text-center text-sm text-[var(--muted)] flex items-center justify-center gap-2">
        <Loader2 size={18} className="animate-spin text-[var(--accent)]" /> Loading integrations…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-normal text-[var(--text)] font-['Georgia',serif]">Connected Apps & Integrations</h2>
        <p className="text-xs text-[var(--muted)] mt-0.5">Link your Telegram bot to receive batch grading notifications and submit answer sheets on the go.</p>
      </div>

      <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 shadow-sm space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-[var(--line)]">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-[var(--teal)]/15 text-[var(--teal)] flex items-center justify-center shrink-0">
              <Send size={24} />
            </div>
            <div>
              <h3 className="text-base font-medium text-[var(--text)]">Telegram Bot Integration</h3>
              <p className="text-xs text-[var(--muted)] mt-0.5">@BwengeAI_Bot · Send exam papers and get automated grading results in Telegram.</p>
            </div>
          </div>
          <div>
            {connected ? (
              <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[var(--teal)]/15 text-[var(--teal)] text-xs font-medium">
                <CheckCircle2 size={14} /> Connected ({chatId})
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[var(--surface-2)] text-[var(--muted)] text-xs font-medium">
                Not connected
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-xs text-[var(--muted)] leading-relaxed max-w-md">
            {connected
              ? 'Your Telegram account is linked. Batch results and Excel exports will be dispatched directly to your chat.'
              : 'Connect your Telegram account via secure deep link to start grading papers directly from your phone.'}
          </div>

          {connected ? (
            <button
              type="button"
              disabled={connecting}
              onClick={handleDisconnectTelegram}
              className="px-5 py-2.5 rounded-xl border border-[var(--line)] bg-[var(--surface)] text-xs font-medium text-[var(--danger)] hover:bg-[var(--danger)]/15 transition-colors flex items-center gap-2 w-full sm:w-auto justify-center"
            >
              {connecting ? <Loader2 size={14} className="animate-spin" /> : <Unlink size={14} />}
              Disconnect Telegram
            </button>
          ) : (
            <button
              type="button"
              disabled={connecting}
              onClick={handleConnectTelegram}
              className="px-5 py-2.5 rounded-xl bg-[var(--accent)] text-[var(--on-accent)] text-xs font-medium hover:opacity-90 transition-colors flex items-center gap-2 w-full sm:w-auto justify-center"
            >
              {connecting ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
              Connect Telegram Bot
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
