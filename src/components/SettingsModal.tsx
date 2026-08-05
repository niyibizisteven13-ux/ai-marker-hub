import React, { useEffect, useState } from 'react';
import { authFetch } from '../utils/authFetch';
import { User, UserSettings } from '../types';

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
};

export default function SettingsModal({ isOpen, onClose, user, onUpdateUser, onLogout }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<'account' | 'ai' | 'studio' | 'api'>('account');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [strictness, setStrictness] = useState<UserSettings['defaultStrictness']>('STANDARD');
  const [autoSummarize, setAutoSummarize] = useState(true);
  const [preferredLanguage, setPreferredLanguage] = useState('en');
  const [theme, setTheme] = useState<UserSettings['theme']>('dark');
  const [compactMobileView, setCompactMobileView] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [openAiKey, setOpenAiKey] = useState('');
  const [claudeKey, setClaudeKey] = useState('');
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
    setTheme(settings.theme);
    setCompactMobileView(false);
    setAutoScroll(true);
    setOpenAiKey('');
    setClaudeKey('');
    setStatusMessage(null);
  }, [isOpen, user]);

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
          theme,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Unable to save settings.');
      }

      onUpdateUser(data.user);
      setStatusMessage('Settings saved successfully.');
      onClose();
    } catch (error: any) {
      setStatusMessage(error?.message || 'Failed to save settings.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="w-full max-w-3xl overflow-hidden rounded-[28px] border border-white/10 bg-[#0B0E17] shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800/80 bg-[#0E121E] px-6 py-4">
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

        <div className="flex min-h-[520px] overflow-hidden bg-[#090C15]">
          <div className="w-52 border-r border-slate-800/70 bg-[#090C15] p-4 space-y-2">
            {[
              { key: 'account', label: '👤 Account' },
              { key: 'ai', label: '🤖 AI Engine' },
              { key: 'studio', label: '⚙️ Studio' },
              { key: 'api', label: '🔑 API Keys' },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as any)}
                className={`w-full rounded-2xl px-3.5 py-2.5 text-left text-xs font-semibold transition ${
                  activeTab === tab.key
                    ? 'bg-slate-800 text-orange-400'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-6 text-slate-100">
            {activeTab === 'account' && (
              <div className="space-y-5">
                <div className="space-y-3 rounded-3xl border border-slate-800/80 bg-[#111820] p-5">
                  <h3 className="text-sm font-semibold text-slate-100">Profile</h3>
                  <p className="text-xs text-slate-500">Update your profile details for the marker workspace.</p>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="space-y-2 text-[11px] uppercase tracking-[0.18em] text-slate-400">
                      Full Name
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full rounded-2xl border border-slate-800 bg-[#0F1520] px-4 py-3 text-sm text-slate-100 outline-none focus:border-orange-500"
                      />
                    </label>
                    <label className="space-y-2 text-[11px] uppercase tracking-[0.18em] text-slate-400">
                      Email address
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full rounded-2xl border border-slate-800 bg-[#0F1520] px-4 py-3 text-sm text-slate-100 outline-none focus:border-orange-500"
                      />
                    </label>
                  </div>

                  <label className="space-y-2 text-[11px] uppercase tracking-[0.18em] text-slate-400">
                    Avatar URL
                    <input
                      type="url"
                      value={avatarUrl}
                      onChange={(e) => setAvatarUrl(e.target.value)}
                      placeholder="https://..."
                      className="w-full rounded-2xl border border-slate-800 bg-[#0F1520] px-4 py-3 text-sm text-slate-100 outline-none focus:border-orange-500"
                    />
                  </label>

                  <label className="space-y-2 text-[11px] uppercase tracking-[0.18em] text-slate-400">
                    New password
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Leave blank to keep current password"
                      className="w-full rounded-2xl border border-slate-800 bg-[#0F1520] px-4 py-3 text-sm text-slate-100 outline-none focus:border-orange-500"
                    />
                  </label>
                </div>
              </div>
            )}

            {activeTab === 'ai' && (
              <div className="space-y-5">
                <div className="space-y-3 rounded-3xl border border-slate-800/80 bg-[#111820] p-5">
                  <h3 className="text-sm font-semibold text-slate-100">AI Grading Model</h3>
                  <p className="text-xs text-slate-500">Control grading tone and report behavior.</p>

                  <label className="space-y-2 text-[11px] uppercase tracking-[0.18em] text-slate-400">
                    Default Grading Strictness
                    <select
                      value={strictness}
                      onChange={(e) => setStrictness(e.target.value as UserSettings['defaultStrictness'])}
                      className="w-full rounded-2xl border border-slate-800 bg-[#0F1520] px-4 py-3 text-sm text-slate-100 outline-none focus:border-orange-500"
                    >
                      <option value="LENIENT">Lenient (encouraging feedback)</option>
                      <option value="STANDARD">Standard (balanced academic criteria)</option>
                      <option value="STRICT">Strict (rigorous rubric enforcement)</option>
                    </select>
                  </label>

                  <div className="flex items-center justify-between rounded-2xl border border-slate-800 bg-[#0F1520] p-4">
                    <div>
                      <div className="text-sm font-semibold text-slate-100">Automatic Summary Reports</div>
                      <p className="text-xs text-slate-500">Generate executive feedback when submissions are uploaded.</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={autoSummarize}
                      onChange={(e) => setAutoSummarize(e.target.checked)}
                      className="h-4 w-4 accent-orange-500"
                    />
                  </div>

                  <label className="space-y-2 text-[11px] uppercase tracking-[0.18em] text-slate-400">
                    Preferred Language
                    <select
                      value={preferredLanguage}
                      onChange={(e) => setPreferredLanguage(e.target.value)}
                      className="w-full rounded-2xl border border-slate-800 bg-[#0F1520] px-4 py-3 text-sm text-slate-100 outline-none focus:border-orange-500"
                    >
                      <option value="en">English</option>
                      <option value="es">Spanish</option>
                      <option value="fr">French</option>
                      <option value="pt">Português</option>
                    </select>
                  </label>
                </div>
              </div>
            )}

            {activeTab === 'studio' && (
              <div className="space-y-5">
                <div className="rounded-3xl border border-slate-800/80 bg-[#111820] p-5 space-y-4">
                  <h3 className="text-sm font-semibold text-slate-100">Studio Preferences</h3>
                  <p className="text-xs text-slate-500">Customize how the interface behaves while you work.</p>

                  <label className="space-y-2 text-[11px] uppercase tracking-[0.18em] text-slate-400">
                    Interface Theme
                    <select
                      value={theme}
                      onChange={(e) => setTheme(e.target.value as UserSettings['theme'])}
                      className="w-full rounded-2xl border border-slate-800 bg-[#0F1520] px-4 py-3 text-sm text-slate-100 outline-none focus:border-orange-500"
                    >
                      <option value="dark">Dark</option>
                      <option value="light">Light</option>
                    </select>
                  </label>

                  <div className="flex items-center justify-between rounded-2xl border border-slate-800 bg-[#0F1520] p-4">
                    <div>
                      <div className="text-sm font-semibold text-slate-100">Mobile Compact View</div>
                      <p className="text-xs text-slate-500">Use a tighter layout on phones and tablets.</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={compactMobileView}
                      onChange={(e) => setCompactMobileView(e.target.checked)}
                      className="h-4 w-4 accent-orange-500"
                    />
                  </div>

                  <div className="flex items-center justify-between rounded-2xl border border-slate-800 bg-[#0F1520] p-4">
                    <div>
                      <div className="text-sm font-semibold text-slate-100">Auto-scroll Results</div>
                      <p className="text-xs text-slate-500">Keep the latest analysis in view during review.</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={autoScroll}
                      onChange={(e) => setAutoScroll(e.target.checked)}
                      className="h-4 w-4 accent-orange-500"
                    />
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'api' && (
              <div className="space-y-5">
                <div className="rounded-3xl border border-slate-800/80 bg-[#111820] p-5">
                  <h3 className="text-sm font-semibold text-slate-100">API Keys</h3>
                  <p className="text-xs text-slate-500">Store optional third-party API keys for custom deployments.</p>

                  <label className="space-y-2 text-[11px] uppercase tracking-[0.18em] text-slate-400">
                    OpenAI Key
                    <input
                      type="password"
                      value={openAiKey}
                      onChange={(e) => setOpenAiKey(e.target.value)}
                      className="w-full rounded-2xl border border-slate-800 bg-[#0F1520] px-4 py-3 text-sm text-slate-100 outline-none focus:border-orange-500"
                      placeholder="sk-..."
                    />
                  </label>

                  <label className="space-y-2 text-[11px] uppercase tracking-[0.18em] text-slate-400">
                    Claude Key
                    <input
                      type="password"
                      value={claudeKey}
                      onChange={(e) => setClaudeKey(e.target.value)}
                      className="w-full rounded-2xl border border-slate-800 bg-[#0F1520] px-4 py-3 text-sm text-slate-100 outline-none focus:border-orange-500"
                      placeholder="claude-..."
                    />
                  </label>

                  <p className="text-xs text-slate-500">These keys are stored only in the browser session for custom provider fallback use.</p>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-800/70 bg-[#0E121E] px-6 py-4">
          <div className="text-sm text-slate-400">
            {statusMessage && <span>{statusMessage}</span>}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={onLogout}
              className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-300 transition hover:bg-rose-500/15"
            >
              Sign Out
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-2xl border border-slate-700 bg-slate-900/90 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="rounded-2xl bg-orange-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
