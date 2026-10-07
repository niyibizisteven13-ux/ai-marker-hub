import React, { useEffect, useState } from 'react';
import { authFetch } from '../utils/authFetch';
import { User, UserSettings } from '../types';
import { X } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User | null;
  onUpdateUser: (updatedUser: User) => void;
  onLogout: () => void;
}

const DEFAULT_SETTINGS: UserSettings = {
  defaultStrictness: 'STANDARD',
  autoSummarize: true,
  preferredLanguage: 'en',
  theme: 'dark',
  longTermMemory: false,
  agentTone: 'PROFESSIONAL',
};

export default function SettingsModal({ isOpen, onClose, user, onUpdateUser, onLogout }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<'account' | 'ai'>('account');

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [strictness, setStrictness] = useState<UserSettings['defaultStrictness']>('STANDARD');
  const [autoSummarize, setAutoSummarize] = useState(true);
  const [preferredLanguage, setPreferredLanguage] = useState('en');
  const [longTermMemory, setLongTermMemory] = useState(false);
  const [agentTone, setAgentTone] = useState<UserSettings['agentTone']>('PROFESSIONAL');
  const [customInstructions, setCustomInstructions] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setActiveTab('account');
    setName(user?.name || '');
    setEmail(user?.email || '');
    setAvatarUrl(user?.avatarUrl || '');
    setPassword('');
    const settings = user?.settings || DEFAULT_SETTINGS;
    setStrictness(settings.defaultStrictness);
    setAutoSummarize(settings.autoSummarize);
    setPreferredLanguage(settings.preferredLanguage);
    setLongTermMemory(settings.longTermMemory);
    setAgentTone(settings.agentTone);
    setCustomInstructions(settings.customInstructions || '');
    setStatusMessage(null);
  }, [isOpen, user?.id]);

  if (!isOpen) return null;

  const handleSave = async () => {
    if (!user) {
      setStatusMessage('Please sign in before saving settings.');
      return;
    }

    setIsSaving(true);
    setStatusMessage(null);

    try {
      const response = await authFetch('/api/user/settings', {
        method: 'PUT',
        body: JSON.stringify({
          name,
          email,
          avatarUrl,
          password: password || undefined,
          defaultStrictness: strictness,
          autoSummarize,
          preferredLanguage,
          longTermMemory,
          agentTone,
          customInstructions,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Unable to save settings.');
      }
      if (!data.user) throw new Error('Settings were not confirmed by the server.');

      onUpdateUser(data.user);
      setStatusMessage('Settings saved successfully.');
    } catch (error: any) {
      setStatusMessage(error?.message || 'Failed to save settings.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogoutAll = async () => {
    try {
      const response = await authFetch('/api/auth/logout-all', { method: 'POST' });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Unable to sign out other devices.');
      }
      onLogout();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Unable to sign out other devices.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex h-[100dvh] w-full items-stretch justify-stretch bg-black/70 backdrop-blur-md">
      <style>{`
        input:-webkit-autofill,
        input:-webkit-autofill:hover,
        input:-webkit-autofill:focus,
        input:-webkit-autofill:active {
          -webkit-box-shadow: 0 0 0 30px #0F1520 inset !important;
          -webkit-text-fill-color: #f1f5f9 !important;
          transition: background-color 5000s ease-in-out 0s;
        }
      `}</style>
      <div className="flex h-full min-h-0 w-full flex-col overflow-hidden border border-white/[0.09] bg-[#101318] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/[0.08] bg-[#14171D] px-4 sm:px-7 py-4 shrink-0">

          <div className="flex items-center gap-3">
            <span className="text-orange-400 text-lg">⚙️</span>
            <div>
              <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Studio Preferences</p>
              <h2 className="text-lg font-semibold text-slate-100">Workspace Settings</h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-full px-3 py-2 text-slate-400 transition hover:text-slate-100"
            aria-label="Close settings"
          >
            ✕
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#101318] sm:flex-row">
          <div role="tablist" aria-label="Settings sections" className="flex shrink-0 gap-1 overflow-x-auto border-b border-white/[0.07] bg-[#111419] p-2 sm:w-56 sm:flex-col sm:overflow-y-auto sm:border-b-0 sm:border-r sm:p-4">
            {[
              { key: 'account', label: 'Account' },
              { key: 'ai', label: 'AI preferences' },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                id={`settings-tab-${tab.key}`}
                aria-controls={`settings-panel-${tab.key}`}
                aria-selected={activeTab === tab.key}
                onClick={() => setActiveTab(tab.key as 'account' | 'ai')}
                className={`shrink-0 sm:w-full rounded-2xl px-3 sm:px-4 py-2.5 sm:py-3 text-left text-xs font-bold tracking-wide transition-all duration-200 ${
                  activeTab === tab.key
                    ? 'bg-slate-800/80 text-orange-400 shadow-sm border border-slate-700/50'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div role="tabpanel" id={`settings-panel-${activeTab}`} aria-labelledby={`settings-tab-${activeTab}`} className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-7 lg:p-9 text-slate-100 scrollbar-thin scrollbar-thumb-slate-800">


            {activeTab === 'account' && (
              <div className="mx-auto w-full max-w-5xl space-y-6">
                <div className="space-y-6 rounded-3xl border border-slate-800/80 bg-[#111820] p-6 shadow-inner">
                  <div className="space-y-1">
                    <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wider">Profile Details</h3>
                    <p className="text-xs text-slate-500">Manage your identity and authentication credentials.</p>
                  </div>

                  <div className="grid gap-5 sm:grid-cols-2">
                    <label className="block space-y-2.5 text-[11px] font-bold uppercase tracking-[0.2em] text-slate-300">
                      Full Name
                      <input
                        type="text"
                        required
                        minLength={2}
                        maxLength={100}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full rounded-2xl border border-slate-700/60 bg-[#0F1520] px-4 py-3.5 text-sm text-slate-100 outline-none focus:border-orange-500 focus:bg-[#0F1520] transition-colors shadow-sm"
                      />
                    </label>
                    <label className="block space-y-2.5 text-[11px] font-bold uppercase tracking-[0.2em] text-slate-300">
                      Email address
                      <input
                        type="email"
                        required
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full rounded-2xl border border-slate-700/60 bg-[#0F1520] px-4 py-3.5 text-sm text-slate-100 outline-none focus:border-orange-500 focus:bg-[#0F1520] transition-colors shadow-sm"
                      />
                    </label>
                  </div>

                  <label className="block space-y-2.5 text-[11px] font-bold uppercase tracking-[0.2em] text-slate-300">
                    Avatar URL
                    <input
                      type="url"
                      value={avatarUrl}
                      onChange={(e) => setAvatarUrl(e.target.value)}
                      placeholder="https://..."
                      className="w-full rounded-2xl border border-slate-700/60 bg-[#0F1520] px-4 py-3.5 text-sm text-slate-100 outline-none focus:border-orange-500 focus:bg-[#0F1520] transition-colors shadow-sm"
                    />
                  </label>

                  <label className="block space-y-2.5 text-[11px] font-bold uppercase tracking-[0.2em] text-slate-300">
                    New password
                    <input
                      type="password"
                      minLength={12}
                      maxLength={128}
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Leave blank to keep current password"
                      className="w-full rounded-2xl border border-slate-700/60 bg-[#0F1520] px-4 py-3.5 text-sm text-slate-100 outline-none focus:border-orange-500 focus:bg-[#0F1520] transition-colors shadow-sm"
                    />
                  </label>

                </div>
              </div>
            )}


            {activeTab === 'ai' && (
              <div className="mx-auto w-full max-w-5xl space-y-6">
                <div className="space-y-6 rounded-3xl border border-slate-800/80 bg-[#111820] p-6 shadow-inner">
                  <div className="space-y-1">
                    <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wider">AI Agent Configuration</h3>
                    <p className="text-xs text-slate-500">Tune Bwenge's brain and marking personality.</p>
                  </div>

                  <div className="flex items-center justify-between rounded-2xl border border-slate-700/60 bg-[#0F1520] p-5 shadow-sm transition-colors hover:border-slate-600">
                    <div>
                      <div className="text-sm font-bold text-slate-200">🧠 Bwenge Brain (Long-term Memory)</div>
                      <p className="text-xs text-slate-500">Use saved context from earlier sessions to personalize future responses.</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={longTermMemory}
                      onChange={(e) => setLongTermMemory(e.target.checked)}
                      className="h-5 w-5 rounded-lg border-slate-700 bg-slate-800 text-orange-500 accent-orange-500 transition-all cursor-pointer"
                    />
                  </div>

                  <div className="grid gap-5 sm:grid-cols-2">
                    <label className="block space-y-2.5 text-[11px] font-bold uppercase tracking-[0.2em] text-slate-300">
                      Agent Tone
                      <select
                        value={agentTone}
                        onChange={(e) => setAgentTone(e.target.value as UserSettings['agentTone'])}
                        className="w-full rounded-2xl border border-slate-700/60 bg-[#0F1520] px-4 py-3.5 text-sm text-slate-100 outline-none focus:border-orange-500 transition-colors appearance-none cursor-pointer"
                      >
                        <option value="PROFESSIONAL">Professional & Objective</option>
                        <option value="ENCOURAGING">Encouraging & Mentoring</option>
                        <option value="STRICT">Strict & Rigorous</option>
                        <option value="ACADEMIC">Formal & Academic</option>
                      </select>
                    </label>

                    <label className="block space-y-2.5 text-[11px] font-bold uppercase tracking-[0.2em] text-slate-300">
                      Grading Strictness
                      <select
                        value={strictness}
                        onChange={(e) => setStrictness(e.target.value as UserSettings['defaultStrictness'])}
                        className="w-full rounded-2xl border border-slate-700/60 bg-[#0F1520] px-4 py-3.5 text-sm text-slate-100 outline-none focus:border-orange-500 transition-colors appearance-none cursor-pointer"
                      >
                        <option value="LENIENT">Lenient</option>
                        <option value="STANDARD">Standard</option>
                        <option value="STRICT">Strict</option>
                      </select>
                    </label>
                  </div>

                  <label className="block space-y-2.5 text-[11px] font-bold uppercase tracking-[0.2em] text-slate-300">
                    Response language
                    <select
                      value={preferredLanguage}
                      onChange={(e) => setPreferredLanguage(e.target.value)}
                      className="w-full rounded-2xl border border-slate-700/60 bg-[#0F1520] px-4 py-3.5 text-sm text-slate-100 outline-none transition-colors focus:border-orange-500"
                    >
                      <option value="en">English</option>
                      <option value="fr">French</option>
                      <option value="rw">Kinyarwanda</option>
                    </select>
                  </label>

                  <label className="block space-y-2.5 text-[11px] font-bold uppercase tracking-[0.2em] text-slate-300">
                    Custom Agent Instructions
                    <textarea
                      value={customInstructions}
                      onChange={(e) => setCustomInstructions(e.target.value)}
                      maxLength={2000}
                      placeholder="e.g. Always emphasize critical thinking in your feedback..."
                      className="w-full h-32 rounded-2xl border border-slate-700/60 bg-[#0F1520] px-4 py-3.5 text-sm text-slate-100 outline-none focus:border-orange-500 transition-colors resize-none shadow-sm"
                    />
                    <span className="text-xs text-slate-500">{customInstructions.length}/2000 characters</span>
                  </label>

                  <div className="flex items-center justify-between rounded-2xl border border-slate-700/60 bg-[#0F1520] p-5 shadow-sm transition-colors hover:border-slate-600">
                    <div>
                      <div className="text-sm font-bold text-slate-200">Summarize reviewed work</div>
                      <p className="text-xs text-slate-500">Ask the assistant to include a concise outcomes summary when reviewing student work.</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={autoSummarize}
                      onChange={(e) => setAutoSummarize(e.target.checked)}
                      className="h-5 w-5 rounded-lg border-slate-700 bg-slate-800 text-orange-500 accent-orange-500 transition-all cursor-pointer"
                    />
                  </div>

                </div>
              </div>
            )}


          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 border-t border-white/[0.08] bg-[#14171D] px-4 sm:px-7 py-3 sm:py-4 shrink-0 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">

          <div className="text-sm font-medium text-slate-400" role={statusMessage?.includes('successfully') ? 'status' : statusMessage ? 'alert' : undefined}>
            {statusMessage && <span className={statusMessage.includes('successfully') ? 'text-emerald-400' : 'text-orange-400'}>{statusMessage}</span>}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleLogoutAll}
              className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-rose-300 transition-all hover:bg-rose-500/20 active:scale-95"
            >
              Sign out all devices
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="rounded-2xl border border-rose-500/20 bg-rose-500/5 px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-rose-400 transition-all hover:bg-rose-500/10 active:scale-95"
            >
              Sign Out
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-2xl border border-slate-700 bg-slate-900/60 px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-slate-300 transition-all hover:bg-slate-800 active:scale-95"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="rounded-2xl bg-orange-500 px-6 py-2.5 text-xs font-bold uppercase tracking-wider text-white shadow-lg shadow-orange-500/10 transition-all hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50 active:scale-95"
            >
              {isSaving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
