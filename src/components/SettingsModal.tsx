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
  longTermMemory: false,
  agentTone: 'PROFESSIONAL',
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
  const [longTermMemory, setLongTermMemory] = useState(false);
  const [agentTone, setAgentTone] = useState<UserSettings['agentTone']>('PROFESSIONAL');
  const [customInstructions, setCustomInstructions] = useState('');

  const [compactMobileView, setCompactMobileView] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [openAiKey, setOpenAiKey] = useState('');
  const [claudeKey, setClaudeKey] = useState('');
  const [nvidiaKey, setNvidiaKey] = useState('');
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
    setLongTermMemory(settings.longTermMemory);
    setAgentTone(settings.agentTone);
    setCustomInstructions(settings.customInstructions || '');

    setCompactMobileView(false);
    setAutoScroll(true);
    setOpenAiKey('');
    setClaudeKey('');
    setNvidiaKey('');
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
          longTermMemory,
          agentTone,
          customInstructions,
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
      <div className="w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden rounded-[28px] border border-white/10 bg-[#0B0E17] shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800/80 bg-[#0E121E] px-6 py-4 shrink-0">

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

        <div className="flex flex-1 overflow-hidden bg-[#090C15]">
          <div className="w-48 border-r border-slate-800/70 bg-[#090C15] p-5 space-y-2.5 shrink-0">
            {[
              { key: 'account', label: '👤 Account' },
              { key: 'ai', label: '🤖 AI Engine' },
              { key: 'studio', label: '⚙️ Studio' },
              { key: 'api', label: '🔑 API Keys' },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as any)}
                className={`w-full rounded-2xl px-4 py-3 text-left text-xs font-bold tracking-wide transition-all duration-200 ${
                  activeTab === tab.key
                    ? 'bg-slate-800/80 text-orange-400 shadow-sm border border-slate-700/50'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-8 text-slate-100 scrollbar-thin scrollbar-thumb-slate-800">


            {activeTab === 'account' && (
              <div className="space-y-6">
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
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full rounded-2xl border border-slate-700/60 bg-[#0F1520] px-4 py-3.5 text-sm text-slate-100 outline-none focus:border-orange-500 focus:bg-[#0F1520] transition-colors shadow-sm"
                      />
                    </label>
                    <label className="block space-y-2.5 text-[11px] font-bold uppercase tracking-[0.2em] text-slate-300">
                      Email address
                      <input
                        type="email"
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
              <div className="space-y-6">
                <div className="space-y-6 rounded-3xl border border-slate-800/80 bg-[#111820] p-6 shadow-inner">
                  <div className="space-y-1">
                    <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wider">AI Agent Configuration</h3>
                    <p className="text-xs text-slate-500">Tune Bwenge's brain and marking personality.</p>
                  </div>

                  <div className="flex items-center justify-between rounded-2xl border border-slate-700/60 bg-[#0F1520] p-5 shadow-sm transition-colors hover:border-slate-600">
                    <div>
                      <div className="text-sm font-bold text-slate-200">🧠 Bwenge Brain (Long-term Memory)</div>
                      <p className="text-xs text-slate-500">Allow the agent to remember context across all your chat sessions.</p>
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
                        onChange={(e) => setAgentTone(e.target.value as any)}
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
                    Custom Agent Instructions
                    <textarea
                      value={customInstructions}
                      onChange={(e) => setCustomInstructions(e.target.value)}
                      placeholder="e.g. Always emphasize critical thinking in your feedback..."
                      className="w-full h-32 rounded-2xl border border-slate-700/60 bg-[#0F1520] px-4 py-3.5 text-sm text-slate-100 outline-none focus:border-orange-500 transition-colors resize-none shadow-sm"
                    />
                  </label>

                  <div className="flex items-center justify-between rounded-2xl border border-slate-700/60 bg-[#0F1520] p-5 shadow-sm transition-colors hover:border-slate-600">
                    <div>
                      <div className="text-sm font-bold text-slate-200">Automatic Summary Reports</div>
                      <p className="text-xs text-slate-500">Generate executive feedback when submissions are uploaded.</p>
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


            {activeTab === 'studio' && (
              <div className="space-y-6">
                <div className="rounded-3xl border border-slate-800/80 bg-[#111820] p-6 shadow-inner space-y-6">
                  <div className="space-y-1">
                    <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wider">Studio Preferences</h3>
                    <p className="text-xs text-slate-500">Customize how the interface behaves while you work.</p>
                  </div>

                  <label className="block space-y-2.5 text-[11px] font-bold uppercase tracking-[0.2em] text-slate-300">
                    Interface Theme
                    <select
                      value={theme}
                      onChange={(e) => setTheme(e.target.value as UserSettings['theme'])}
                      className="w-full rounded-2xl border border-slate-700/60 bg-[#0F1520] px-4 py-3.5 text-sm text-slate-100 outline-none focus:border-orange-500 focus:bg-[#0F1520] transition-colors shadow-sm appearance-none cursor-pointer"
                    >
                      <option value="dark">Dark</option>
                      <option value="light">Light</option>
                    </select>
                  </label>


                  <div className="space-y-4">
                    <div className="flex items-center justify-between rounded-2xl border border-slate-700/60 bg-[#0F1520] p-5 shadow-sm transition-colors hover:border-slate-600">
                      <div>
                        <div className="text-sm font-bold text-slate-200">Mobile Compact View</div>
                        <p className="text-xs text-slate-500">Use a tighter layout on phones and tablets.</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={compactMobileView}
                        onChange={(e) => setCompactMobileView(e.target.checked)}
                        className="h-5 w-5 rounded-lg border-slate-700 bg-slate-800 text-orange-500 accent-orange-500 cursor-pointer"
                      />
                    </div>

                    <div className="flex items-center justify-between rounded-2xl border border-slate-700/60 bg-[#0F1520] p-5 shadow-sm transition-colors hover:border-slate-600">
                      <div>
                        <div className="text-sm font-bold text-slate-200">Auto-scroll Results</div>
                        <p className="text-xs text-slate-500">Keep the latest analysis in view during review.</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={autoScroll}
                        onChange={(e) => setAutoScroll(e.target.checked)}
                        className="h-5 w-5 rounded-lg border-slate-700 bg-slate-800 text-orange-500 accent-orange-500 cursor-pointer"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}


            {activeTab === 'api' && (
              <div className="space-y-6">
                <div className="rounded-3xl border border-slate-800/80 bg-[#111820] p-6 shadow-inner space-y-6">
                  <div className="space-y-1">
                    <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wider">API Keys</h3>
                    <p className="text-xs text-slate-500">Store optional third-party API keys for custom deployments.</p>
                  </div>

                  <label className="block space-y-2.5 text-[11px] font-bold uppercase tracking-[0.2em] text-slate-300">
                    OpenAI Key
                    <input
                      type="password"
                      value={openAiKey}
                      onChange={(e) => setOpenAiKey(e.target.value)}
                      className="w-full rounded-2xl border border-slate-700/60 bg-[#0F1520] px-4 py-3.5 text-sm text-slate-100 outline-none focus:border-orange-500 focus:bg-[#0F1520] transition-colors shadow-sm"
                      placeholder="sk-..."
                    />
                  </label>

                  <label className="block space-y-2.5 text-[11px] font-bold uppercase tracking-[0.2em] text-slate-300">
                    Claude Key
                    <input
                      type="password"
                      value={claudeKey}
                      onChange={(e) => setClaudeKey(e.target.value)}
                      className="w-full rounded-2xl border border-slate-700/60 bg-[#0F1520] px-4 py-3.5 text-sm text-slate-100 outline-none focus:border-orange-500 focus:bg-[#0F1520] transition-colors shadow-sm"
                      placeholder="claude-..."
                    />
                  </label>

                  <label className="block space-y-2.5 text-[11px] font-bold uppercase tracking-[0.2em] text-slate-300">
                    NVIDIA NIM Key
                    <input
                      type="password"
                      value={nvidiaKey}
                      onChange={(e) => setNvidiaKey(e.target.value)}
                      className="w-full rounded-2xl border border-slate-700/60 bg-[#0F1520] px-4 py-3.5 text-sm text-slate-100 outline-none focus:border-orange-500 focus:bg-[#0F1520] transition-colors shadow-sm"
                      placeholder="nvapi-..."
                    />
                  </label>


                  <div className="rounded-2xl bg-amber-500/5 border border-amber-500/20 p-4">
                    <p className="text-[11px] leading-relaxed text-amber-200/70">
                      <strong>Security Note:</strong> These keys are stored only in your local browser session and are used for custom provider fallbacks.
                    </p>
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-800/70 bg-[#0E121E] px-8 py-5 shrink-0">

          <div className="text-sm text-slate-400 font-medium">
            {statusMessage && <span className="animate-pulse text-orange-400">{statusMessage}</span>}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3.5">
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
