import { useState, type FormEvent } from 'react';
import { LogOut, Loader2, Monitor, Shield, X } from 'lucide-react';
import { authFetch } from '../../utils/authFetch';
import type { User } from '../../types';

interface AccountSectionProps { user: User | null; onLogout: () => void }
type AccountSession = { id: string; userAgent: string | null; ip: string | null; createdAt: string; lastUsedAt: string };

export default function AccountSection({ user, onLogout }: AccountSectionProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [status, setStatus] = useState<{ error: boolean; text: string } | null>(null);

  const changePassword = async (event: FormEvent) => {
    event.preventDefault(); setStatus(null);
    if (newPassword.length < 12) { setStatus({ error: true, text: 'Use at least 12 characters for the new password.' }); return; }
    setBusy(true);
    try {
      const res = await authFetch('/api/user/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword, password: newPassword }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not update password.');
      setCurrentPassword(''); setNewPassword(''); setStatus({ error: false, text: 'Password updated successfully.' });
    } catch (e) { setStatus({ error: true, text: e instanceof Error ? e.message : 'Could not update password.' }); }
    finally { setBusy(false); }
  };

  const loadSessions = async () => {
    setBusy(true); setStatus(null);
    try {
      const res = await authFetch('/api/auth/sessions');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error?.message || data.error || 'Could not load sessions.');
      setSessions(data.sessions || []); setSessionsOpen(true);
    } catch (e) { setStatus({ error: true, text: e instanceof Error ? e.message : 'Could not load sessions.' }); }
    finally { setBusy(false); }
  };

  const revokeSession = async (id: string) => {
    if (!window.confirm('Revoke this session? Its refresh access will be removed.')) return;
    setBusy(true);
    try {
      const res = await authFetch(`/api/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Could not revoke this session.');
      setSessions((current) => current.filter((session) => session.id !== id));
      setStatus({ error: false, text: 'Session revoked.' });
    } catch (e) { setStatus({ error: true, text: e instanceof Error ? e.message : 'Could not revoke session.' }); }
    finally { setBusy(false); }
  };

  const inputClass = 'w-full max-w-md rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3.5 py-2.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]';
  return <div className="space-y-6">
    <div><h2 className="text-xl font-normal text-[var(--text)] font-[\'Georgia\',serif]">Account Security</h2><p className="mt-1 text-xs text-[var(--muted)]">Signed in as {user?.email || 'your Bwenge account'}. Manage your password and active sessions.</p></div>
    <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">
      <div className="py-5"><div className="mb-4"><label className="block text-sm font-medium text-[var(--text)]">Change password</label><span className="text-xs text-[var(--muted)]">Your current password is required to confirm this change.</span></div><form onSubmit={(e) => void changePassword(e)} className="space-y-3"><input autoComplete="current-password" type="password" required placeholder="Current password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className={inputClass} /><input autoComplete="new-password" type="password" minLength={12} maxLength={128} required placeholder="New password (at least 12 characters)" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className={inputClass} /><button type="submit" disabled={busy} className="flex items-center gap-2 rounded-xl bg-[var(--text)] px-4 py-2.5 text-xs font-medium text-[var(--on-accent)] disabled:opacity-60">{busy && <Loader2 size={14} className="animate-spin" />}Update password</button></form></div>
      <div className="py-5"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><label className="block text-sm font-medium text-[var(--text)]">Active sessions</label><span className="text-xs text-[var(--muted)]">Review and revoke refresh sessions on your account.</span></div><button type="button" disabled={busy} onClick={() => void loadSessions()} className="rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-2.5 text-xs font-medium text-[var(--text)] hover:bg-[var(--hover)] disabled:opacity-60">{busy ? 'Loading…' : sessionsOpen ? 'Refresh sessions' : 'View sessions'}</button></div>{sessionsOpen && <div className="mt-4 divide-y divide-[var(--line)] overflow-hidden rounded-xl border border-[var(--line)]">{sessions.length === 0 ? <p className="p-4 text-xs text-[var(--muted)]">No active refresh sessions were returned.</p> : sessions.map((session) => <div key={session.id} className="flex items-center justify-between gap-3 p-3"><div className="flex min-w-0 items-center gap-3"><Monitor size={16} className="shrink-0 text-[var(--muted)]" /><div className="min-w-0"><p className="truncate text-xs font-medium text-[var(--text)]">{session.userAgent || 'Unknown device'}</p><p className="text-[11px] text-[var(--muted)]">Last active {new Date(session.lastUsedAt).toLocaleString()}{session.ip ? ` · ${session.ip}` : ''}</p></div></div><button type="button" disabled={busy} aria-label="Revoke session" onClick={() => void revokeSession(session.id)} className="rounded-lg p-2 text-[var(--danger)] hover:bg-[var(--danger)]/10 disabled:opacity-50"><X size={16} /></button></div>)}</div>}</div>
      <div className="flex flex-col justify-between gap-3 py-5 sm:flex-row sm:items-center"><div><label className="block text-sm font-medium text-[var(--text)]">Sign out</label><span className="text-xs text-[var(--muted)]">End your current Bwenge session on this device.</span></div><button type="button" onClick={onLogout} className="flex items-center justify-center gap-2 rounded-xl border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-4 py-2.5 text-xs font-medium text-[var(--danger)] hover:bg-[var(--danger)]/15"><LogOut size={14} />Sign out</button></div>
    </div>
    {status && <p role="status" className={`flex items-center gap-2 rounded-xl p-3 text-xs ${status.error ? 'bg-[var(--danger)]/10 text-[var(--danger)]' : 'bg-[var(--teal)]/10 text-[var(--teal)]'}`}><Shield size={14} />{status.text}</p>}
  </div>;
}
