import React, { useEffect, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { User } from '../../types';
import { authFetch } from '../../utils/authFetch';

interface GeneralSectionProps {
  user: User | null;
  onUpdateUser: (user: User) => void;
  onDirtyChange: (isDirty: boolean) => void;
  onSaveRef: React.MutableRefObject<(() => Promise<void>) | null>;
}

export default function GeneralSection({ user, onUpdateUser, onDirtyChange, onSaveRef }: GeneralSectionProps) {
  const [name, setName] = useState(user?.name || '');
  const [language, setLanguage] = useState(user?.settings?.preferredLanguage || 'en');
  const [theme, setTheme] = useState<'light' | 'dark'>(user?.settings?.theme === 'light' ? 'light' : 'dark');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setName(user?.name || '');
    setLanguage(user?.settings?.preferredLanguage || 'en');
    setTheme(user?.settings?.theme === 'light' ? 'light' : 'dark');
  }, [user?.id, user?.name, user?.settings?.preferredLanguage, user?.settings?.theme]);

  const markDirty = () => { setDirty(true); onDirtyChange(true); setStatus(null); };
  const handleSave = async () => {
    if (!user) throw new Error('Sign in to save account settings.');
    setSaving(true);
    try {
      const res = await authFetch('/api/user/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, preferredLanguage: language, theme }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.user) throw new Error(data.error || 'Could not save settings.');
      onUpdateUser(data.user);
      try { localStorage.setItem('darkMode', String(theme === 'dark')); } catch {}
      setDirty(false);
      onDirtyChange(false);
      setStatus({ type: 'success', text: 'Settings saved to your account.' });
    } catch (error) {
      setStatus({ type: 'error', text: error instanceof Error ? error.message : 'Could not save settings.' });
      throw error;
    } finally { setSaving(false); }
  };

  useEffect(() => { onSaveRef.current = handleSave; return () => { onSaveRef.current = null; }; }, [name, language, theme, user?.id]);

  const fieldClass = 'w-full sm:w-72 bg-[var(--surface)] border border-[var(--line)] rounded-xl px-3.5 py-2.5 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]';
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-normal text-[var(--text)] font-[\'Georgia\',serif]">General Settings</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">These profile and appearance preferences are saved to your Bwenge account.</p>
      </div>
      <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">
        <div className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div><label htmlFor="settings-name" className="block text-sm font-medium text-[var(--text)]">Display name</label><span className="text-xs text-[var(--muted)]">Shown across your workspace and account.</span></div>
          <input id="settings-name" autoComplete="name" maxLength={100} value={name} onChange={(e) => { setName(e.target.value); markDirty(); }} className={fieldClass} />
        </div>
        <div className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div><label htmlFor="settings-language" className="block text-sm font-medium text-[var(--text)]">Interface language</label><span className="text-xs text-[var(--muted)]">Preferred language for your account.</span></div>
          <select id="settings-language" value={language} onChange={(e) => { setLanguage(e.target.value); markDirty(); }} className={fieldClass}>
            <option value="en">English</option><option value="rw">Kinyarwanda</option><option value="fr">Français</option>
          </select>
        </div>
        <div className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div><label htmlFor="settings-theme" className="block text-sm font-medium text-[var(--text)]">Color mode</label><span className="text-xs text-[var(--muted)]">Choose the appearance preference stored with your profile.</span></div>
          <select id="settings-theme" value={theme} onChange={(e) => { setTheme(e.target.value as 'light' | 'dark'); markDirty(); }} className={fieldClass}>
            <option value="light">Light</option><option value="dark">Dark</option>
          </select>
        </div>
      </div>
      {dirty && <button type="button" disabled={saving} onClick={() => void handleSave().catch(() => {})} className="inline-flex items-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-xs font-semibold text-[var(--on-accent)] disabled:opacity-60">{saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save general settings</button>}
      {status && <p role="status" className={`rounded-xl p-3 text-xs ${status.type === 'error' ? 'bg-[var(--danger)]/10 text-[var(--danger)]' : 'bg-[var(--teal)]/10 text-[var(--teal)]'}`}>{status.text}</p>}
    </div>
  );
}
