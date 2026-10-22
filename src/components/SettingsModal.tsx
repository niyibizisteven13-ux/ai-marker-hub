import React, { useEffect, useState } from 'react';
import { authFetch } from '../utils/authFetch';
import { User, UserSettings } from '../types';
import { X, User as UserIcon, Cpu, ShieldAlert, LogOut, Check, Sparkles, Brain } from 'lucide-react';

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
    <div className="fixed inset-0 z-50 flex h-[100dvh] w-full items-center justify-center bg-black/80 backdrop-blur-md p-2 sm:p-6">
      <style>{`
        input:-webkit-autofill,
        input:-webkit-autofill:hover,
        input:-webkit-autofill:focus,
        input:-webkit-autofill:active {
          -webkit-box-shadow: 0 0 0 30px #090D14 inset !important;
          -webkit-text-fill-color: #f1f5f9 !important;
          transition: background-color 5000s ease-in-out 0s;
        }
      `}</style>
      <div className="flex h-full max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-white/[0.12] bg-[#0A0D14] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[0.08] bg-[#0E121A] px-6 py-4 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-orange-500/15 border border-orange-500/30 flex items-center justify-center text-orange-400">
              <Sparkles size={18} />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-400">Preferences & Profile</p>
              <h2 className="text-base font-semibold text-white">Workspace Settings</h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full border border-white/10 bg-white/5 flex items-center justify-center text-neutral-400 hover:text-white hover:bg-white/10 transition-all"
            aria-label="Close settings"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body split */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#0A0D14] sm:flex-row">
          {/* Sidebar Tabs */}
          <div role="tablist" aria-label="Settings sections" className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-white/[0.08] bg-[#0C0F17] p-3 sm:w-64 sm:flex-col sm:overflow-y-auto sm:border-b-0 sm:border-r sm:p-4">
            {[
              { key: 'account', label: 'Account Profile', icon: <UserIcon size={16} /> },
              { key: 'ai', label: 'AI & Marking Agent', icon: <Cpu size={16} /> },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                id={`settings-tab-${tab.key}`}
                aria-controls={`settings-panel-${tab.key}`}
                aria-selected={activeTab === tab.key}
                onClick={() => setActiveTab(tab.key as 'account' | 'ai')}
                className={`flex items-center gap-3 shrink-0 sm:w-full rounded-2xl px-4 py-3 text-left text-xs font-semibold tracking-wide transition-all duration-200 ${
                  activeTab === tab.key
                    ? 'bg-orange-500/10 text-orange-400 border border-orange-500/25 shadow-sm'
                    : 'text-neutral-400 hover:text-white hover:bg-white/[0.04] border border-transparent'
                }`}
              >
                <span className={activeTab === tab.key ? 'text-orange-400' : 'text-neutral-500'}>{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </div>

          {/* Content Panel */}
          <div role="tabpanel" id={`settings-panel-${activeTab}`} aria-labelledby={`settings-tab-${activeTab}`} className="min-h-0 flex-1 overflow-y-auto p-6 sm:p-8 text-neutral-100 scrollbar-thin scrollbar-thumb-neutral-800">
            {activeTab === 'account' && (
              <div className="mx-auto w-full max-w-2xl space-y-6 animate-in fade-in duration-200">
                <div className="space-y-5 rounded-3xl border border-white/[0.08] bg-[#0E121A] p-6 shadow-xl">
                  <div className="space-y-1 pb-2 border-b border-white/[0.06]">
                    <h3 className="text-sm font-bold text-white tracking-wide">Personal Details</h3>
                    <p className="text-xs text-neutral-400">Update your account credentials and profile avatar.</p>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block space-y-2 text-[11px] font-bold uppercase tracking-[0.15em] text-neutral-300">
                      Full Name
                      <input
                        type="text"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full rounded-xl border border-white/10 bg-[#090D14] px-4 py-3 text-sm text-white outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/50 transition-all shadow-inner"
                      />
                    </label>
                    <label className="block space-y-2 text-[11px] font-bold uppercase tracking-[0.15em] text-neutral-300">
                      Email Address
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full rounded-xl border border-white/10 bg-[#090D14] px-4 py-3 text-sm text-white outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/50 transition-all shadow-inner"
                      />
                    </label>
                  </div>

                  <label className="block space-y-2 text-[11px] font-bold uppercase tracking-[0.15em] text-neutral-300">
                    Avatar URL
                    <input
                      type="url"
                      value={avatarUrl}
                      onChange={(e) => setAvatarUrl(e.target.value)}
                      placeholder="https://..."
                      className="w-full rounded-xl border border-white/10 bg-[#090D14] px-4 py-3 text-sm text-white outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/50 transition-all shadow-inner"
                    />
                  </label>

                  <label className="block space-y-2 text-[11px] font-bold uppercase tracking-[0.15em] text-neutral-300">
                    New Password
                    <input
                      type="password"
                      placeholder="Leave blank to keep current password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-[#090D14] px-4 py-3 text-sm text-white outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/50 transition-all shadow-inner"
                    />
                  </label>
                </div>
              </div>
            )}

            {activeTab === 'ai' && (
              <div className="mx-auto w-full max-w-2xl space-y-6 animate-in fade-in duration-200">
                <div className="space-y-6 rounded-3xl border border-white/[0.08] bg-[#0E121A] p-6 shadow-xl">
                  <div className="space-y-1 pb-2 border-b border-white/[0.06]">
                    <h3 className="text-sm font-bold text-white tracking-wide">AI Agent Tuning</h3>
                    <p className="text-xs text-neutral-400">Configure Bwenge's persona, strictness, and memory behavior.</p>
                  </div>

                  <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-[#090D14] p-4 transition-colors hover:border-white/20">
                    <div>
                      <div className="flex items-center gap-2 text-sm font-bold text-white"><Brain size={16} className="text-violet-400" /> Long-Term Workspace Memory</div>
                      <p className="text-xs text-neutral-400 mt-0.5">Retain context from previous marking sessions to personalize feedback.</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={longTermMemory}
                      onChange={(e) => setLongTermMemory(e.target.checked)}
                      className="h-5 w-5 rounded border-neutral-700 bg-neutral-900 text-orange-500 accent-orange-500 cursor-pointer"
                    />
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block space-y-2 text-[11px] font-bold uppercase tracking-[0.15em] text-neutral-300">
                      Agent Tone
                      <select
                        value={agentTone}
                        onChange={(e) => setAgentTone(e.target.value as UserSettings['agentTone'])}
                        className="w-full rounded-xl border border-white/10 bg-[#090D14] px-4 py-3 text-sm text-white outline-none focus:border-orange-500 transition-colors cursor-pointer"
                      >
                        <option value="PROFESSIONAL">Professional & Objective</option>
                        <option value="ENCOURAGING">Encouraging & Mentoring</option>
                        <option value="STRICT">Strict & Rigorous</option>
                        <option value="ACADEMIC">Formal & Academic</option>
                      </select>
                    </label>

                    <label className="block space-y-2 text-[11px] font-bold uppercase tracking-[0.15em] text-neutral-300">
                      Default Grading Strictness
                      <select
                        value={strictness}
                        onChange={(e) => setStrictness(e.target.value as UserSettings['defaultStrictness'])}
                        className="w-full rounded-xl border border-white/10 bg-[#090D14] px-4 py-3 text-sm text-white outline-none focus:border-orange-500 transition-colors cursor-pointer"
                      >
                        <option value="LENIENT">Lenient</option>
                        <option value="STANDARD">Standard</option>
                        <option value="STRICT">Strict</option>
                      </select>
                    </label>
                  </div>

                  <label className="block space-y-2 text-[11px] font-bold uppercase tracking-[0.15em] text-neutral-300">
                    Preferred Response Language
                    <select
                      value={preferredLanguage}
                      onChange={(e) => setPreferredLanguage(e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-[#090D14] px-4 py-3 text-sm text-white outline-none focus:border-orange-500 transition-colors cursor-pointer"
                    >
                      <option value="en">English</option>
                      <option value="fr">French</option>
                      <option value="rw">Kinyarwanda</option>
                    </select>
                  </label>

                  <label className="block space-y-2 text-[11px] font-bold uppercase tracking-[0.15em] text-neutral-300">
                    Custom Marking Instructions
                    <textarea
                      value={customInstructions}
                      onChange={(e) => setCustomInstructions(e.target.value)}
                      maxLength={2000}
                      placeholder="e.g. Always emphasize critical thinking and concise mathematical notation..."
                      className="w-full h-28 rounded-xl border border-white/10 bg-[#090D14] px-4 py-3 text-sm text-white outline-none focus:border-orange-500 transition-colors resize-none shadow-inner"
                    />
                    <span className="text-[11px] text-neutral-500">{customInstructions.length}/2000 characters</span>
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-white/[0.08] bg-[#0E121A] px-6 py-4 shrink-0">
          <div className="flex items-center gap-3 w-full sm:w-auto">
            {statusMessage && (
              <span className={`text-xs font-medium ${statusMessage.includes('successfully') ? 'text-emerald-400' : 'text-orange-400'}`}>
                {statusMessage}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2.5 w-full sm:w-auto">
            <button
              type="button"
              onClick={handleLogoutAll}
              className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2 text-xs font-semibold text-rose-300 hover:bg-rose-500/20 transition-all"
            >
              Sign out all devices
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-2 text-xs font-semibold text-rose-400 hover:bg-rose-500/10 transition-all"
            >
              Sign Out
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-neutral-300 hover:bg-white/10 transition-all"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="rounded-xl bg-orange-500 px-5 py-2 text-xs font-semibold text-white shadow-lg shadow-orange-500/20 hover:bg-orange-600 disabled:opacity-50 transition-all"
            >
              {isSaving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
