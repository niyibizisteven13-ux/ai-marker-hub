import React, { useState } from 'react';
import { User } from '../../types';
import { authFetch } from '../../utils/authFetch';
import { Shield, Smartphone, KeyRound, LogOut, Check } from 'lucide-react';

interface AccountSectionProps {
  user: User | null;
  onUpdateUser: (user: User) => void;
  onLogout: () => void;
}

export default function AccountSection({ user, onUpdateUser, onLogout }: AccountSectionProps) {
  const [email, setEmail] = useState(user?.email || '');
  const [phone, setPhone] = useState('+250 781234567');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPassword || newPassword.length < 12) {
      setStatusMessage('Password must be at least 12 characters.');
      return;
    }
    try {
      const res = await authFetch('/api/user/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: newPassword }),
      });
      if (!res.ok) throw new Error('Failed to update password');
      setStatusMessage('Password updated successfully.');
      setCurrentPassword('');
      setNewPassword('');
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Could not update password');
    }
  };

  const handleRevokeOtherSessions = async () => {
    try {
      await authFetch('/api/auth/logout-all', { method: 'POST' });
      setStatusMessage('All other active sessions revoked.');
    } catch {
      setStatusMessage('Failed to revoke sessions.');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-normal text-[var(--text)] font-['Georgia',serif]">Account Security & Access</h2>
        <p className="text-xs text-[var(--muted)] mt-0.5">Manage your login credentials, connected sign-in providers, and active sessions.</p>
      </div>

      <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">
        {/* Email */}
        <div className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <label className="text-sm font-medium text-[var(--text)] block">Email Address</label>
            <span className="text-xs text-[var(--muted)]">Primary account identifier for notifications and sign-in.</span>
          </div>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full sm:w-72 bg-[var(--surface)] border border-[var(--line)] rounded-xl px-3.5 py-2.5 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
          />
        </div>

        {/* Phone (+250) */}
        <div className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <label className="text-sm font-medium text-[var(--text)] block">Mobile Money Phone Number</label>
            <span className="text-xs text-[var(--muted)]">Used for fast Mobile Money checkouts and verification (+250).</span>
          </div>
          <div className="relative w-full sm:w-72">
            <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-xs text-[var(--muted)]">+250</span>
            <input
              type="tel"
              value={phone.replace(/^\+250\s*/, '')}
              onChange={(e) => setPhone(`+250 ${e.target.value.trim()}`)}
              className="w-full bg-[var(--surface)] border border-[var(--line)] rounded-xl pl-14 pr-3.5 py-2.5 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
            />
          </div>
        </div>

        {/* Password */}
        <div className="py-4 space-y-4">
          <div>
            <label className="text-sm font-medium text-[var(--text)] block">Change Password</label>
            <span className="text-xs text-[var(--muted)]">Ensure your account is protected with a secure password (min 12 chars).</span>
          </div>
          <form onSubmit={handleUpdatePassword} className="space-y-3 max-w-md">
            <input
              type="password"
              placeholder="Current password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full bg-[var(--surface)] border border-[var(--line)] rounded-xl px-3.5 py-2.5 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
            />
            <input
              type="password"
              placeholder="New password (min 12 chars)"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full bg-[var(--surface)] border border-[var(--line)] rounded-xl px-3.5 py-2.5 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
            />
            <button
              type="submit"
              className="px-4 py-2.5 rounded-xl bg-[var(--text)] text-[var(--on-accent)] text-xs font-medium hover:opacity-90 transition-colors"
            >
              Update Password
            </button>
          </form>
        </div>

        {/* Active Sessions */}
        <div className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <label className="text-sm font-medium text-[var(--text)] block">Active Sessions</label>
            <span className="text-xs text-[var(--muted)]">Revoke access from other browsers and devices.</span>
          </div>
          <button
            type="button"
            onClick={handleRevokeOtherSessions}
            className="px-4 py-2.5 rounded-xl border border-[var(--line)] bg-[var(--surface)] text-xs font-medium text-[var(--text)] hover:bg-[var(--hover)] transition-colors w-full sm:w-auto"
          >
            Revoke all other sessions
          </button>
        </div>

        {/* Log Out */}
        <div className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <label className="text-sm font-medium text-[var(--text)] block">Sign Out</label>
            <span className="text-xs text-[var(--muted)]">Log out of your Bwenge Studio account on this device.</span>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="px-4 py-2.5 rounded-xl bg-[var(--danger)]/15 border border-[var(--danger)]/30 text-xs font-medium text-[var(--danger)] hover:bg-[var(--danger)]/25 transition-colors w-full sm:w-auto flex items-center justify-center gap-2"
          >
            <LogOut size={14} /> Log out
          </button>
        </div>
      </div>

      {statusMessage && (
        <div className="p-3 bg-[var(--surface-2)] rounded-xl text-xs text-[var(--text)] font-medium">
          {statusMessage}
        </div>
      )}
    </div>
  );
}
