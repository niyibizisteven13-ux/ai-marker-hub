import React, { useState } from 'react';
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
  const [colorMode, setColorMode] = useState<'light' | 'auto' | 'dark'>(user?.settings?.theme === 'light' ? 'light' : 'dark');
  const [chatFont, setChatFont] = useState('Inter');
  const [textSize, setTextSize] = useState('Medium');
  const [sources, setSources] = useState(true);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  const markDirty = () => {
    setIsDirty(true);
    onDirtyChange(true);
  };

  const handleSave = async () => {
    const res = await authFetch('/api/user/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        preferredLanguage: language,
        theme: colorMode === 'light' ? 'light' : 'dark',
      }),
    });
    const data = await res.json();
    if (res.ok && data.user) {
      onUpdateUser(data.user);
      setIsDirty(false);
      onDirtyChange(false);
    }
  };

  React.useEffect(() => {
    onSaveRef.current = handleSave;
  }, [name, language, colorMode]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-normal text-[var(--text)] font-['Georgia',serif]">General Settings</h2>
        <p className="text-xs text-[var(--muted)] mt-0.5">Manage your profile display, language, and appearance preferences.</p>
      </div>

      <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">
        {/* Profile Name */}
        <div className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <label className="text-sm font-medium text-[var(--text)] block">Display Name</label>
            <span className="text-xs text-[var(--muted)]">Your name as shown across Bwenge Studio.</span>
          </div>
          <input
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); markDirty(); }}
            className="w-full sm:w-72 bg-[var(--surface)] border border-[var(--line)] rounded-xl px-3.5 py-2.5 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
          />
        </div>

        {/* Language */}
        <div className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <label className="text-sm font-medium text-[var(--text)] block">Interface Language</label>
            <span className="text-xs text-[var(--muted)]">Choose your preferred language for Bwenge Studio.</span>
          </div>
          <select
            value={language}
            onChange={(e) => { setLanguage(e.target.value); markDirty(); }}
            className="w-full sm:w-72 bg-[var(--surface)] border border-[var(--line)] rounded-xl px-3.5 py-2.5 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
          >
            <option value="en">English (EN)</option>
            <option value="rw">Kinyarwanda (RW)</option>
            <option value="fr">Français (FR)</option>
          </select>
        </div>

        {/* Color Mode */}
        <div className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <label className="text-sm font-medium text-[var(--text)] block">Color Mode</label>
            <span className="text-xs text-[var(--muted)]">Select light, dark, or system automatic theme.</span>
          </div>
          <select
            value={colorMode}
            onChange={(e) => { setColorMode(e.target.value as 'light' | 'auto' | 'dark'); markDirty(); }}
            className="w-full sm:w-72 bg-[var(--surface)] border border-[var(--line)] rounded-xl px-3.5 py-2.5 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
          >
            <option value="light">Light</option>
            <option value="auto">Auto (System)</option>
            <option value="dark">Dark</option>
          </select>
        </div>

        {/* Chat Font */}
        <div className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <label className="text-sm font-medium text-[var(--text)] block">Chat Font</label>
            <span className="text-xs text-[var(--muted)]">Choose typography style for chat and assistant responses.</span>
          </div>
          <select
            value={chatFont}
            onChange={(e) => setChatFont(e.target.value)}
            className="w-full sm:w-72 bg-[var(--surface)] border border-[var(--line)] rounded-xl px-3.5 py-2.5 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
          >
            <option value="Inter">Inter (Sans)</option>
            <option value="Georgia">Georgia (Serif)</option>
            <option value="JetBrains Mono">JetBrains Mono (Monospace)</option>
          </select>
        </div>

        {/* Text Size */}
        <div className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <label className="text-sm font-medium text-[var(--text)] block">Text Size</label>
            <span className="text-xs text-[var(--muted)]">Adjust reading scale across workspace panels.</span>
          </div>
          <select
            value={textSize}
            onChange={(e) => setTextSize(e.target.value)}
            className="w-full sm:w-72 bg-[var(--surface)] border border-[var(--line)] rounded-xl px-3.5 py-2.5 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
          >
            <option value="Small">Small</option>
            <option value="Medium">Medium</option>
            <option value="Large">Large</option>
          </select>
        </div>

        {/* Sources Toggle */}
        <div className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <label className="text-sm font-medium text-[var(--text)] block">Show Citation Sources</label>
            <span className="text-xs text-[var(--muted)]">Display verified evidence chips alongside AI answers.</span>
          </div>
          <input
            type="checkbox"
            checked={sources}
            onChange={(e) => setSources(e.target.checked)}
            className="h-5 w-5 rounded border-[var(--line)] text-[var(--accent)] accent-[var(--accent)] cursor-pointer"
          />
        </div>

        {/* Reduce Motion */}
        <div className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <label className="text-sm font-medium text-[var(--text)] block">Reduce Motion</label>
            <span className="text-xs text-[var(--muted)]">Minimize interface transition animations.</span>
          </div>
          <input
            type="checkbox"
            checked={reduceMotion}
            onChange={(e) => setReduceMotion(e.target.checked)}
            className="h-5 w-5 rounded border-[var(--line)] text-[var(--accent)] accent-[var(--accent)] cursor-pointer"
          />
        </div>
      </div>
    </div>
  );
}
