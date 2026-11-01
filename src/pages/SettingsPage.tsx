import { useState, useRef } from 'react';
import { ArrowLeft, User as UserIcon, Shield, Lock, CreditCard, BarChart2, Sliders, Send, Check, X, Sparkles, Brain, Palette } from 'lucide-react';
import { User } from '../types';
import { useIsMobile } from '../hooks/useIsMobile';

import GeneralSection from '../components/settings/GeneralSection';
import AppearanceSection from '../components/settings/AppearanceSection';
import AccountSection from '../components/settings/AccountSection';
import PrivacySection from '../components/settings/PrivacySection';
import BillingSection from '../components/settings/BillingSection';
import UsageSection from '../components/settings/UsageSection';
import MemorySection from '../components/settings/MemorySection';
import PreferencesSection from '../components/settings/PreferencesSection';
import ConnectionsSection from '../components/settings/ConnectionsSection';

interface SettingsPageProps {
  user: User | null;
  onUpdateUser: (user: User) => void;
  onLogout: () => void;
  onBack: () => void;
}

const SECTIONS = [
  { id: 'general', label: 'General', icon: <UserIcon size={16} /> },
  { id: 'appearance', label: 'Appearance', icon: <Palette size={16} /> },
  { id: 'account', label: 'Account', icon: <Shield size={16} /> },
  { id: 'privacy', label: 'Privacy', icon: <Lock size={16} /> },
  { id: 'billing', label: 'Billing', icon: <CreditCard size={16} /> },
  { id: 'usage', label: 'Usage', icon: <BarChart2 size={16} /> },
  { id: 'memory', label: 'Memory', icon: <Brain size={16} /> },
  { id: 'preferences', label: 'Preferences', icon: <Sliders size={16} /> },
  { id: 'connections', label: 'Connections', icon: <Send size={16} /> },
];

export default function SettingsPage({ user, onUpdateUser, onLogout, onBack }: SettingsPageProps) {
  const isMobile = useIsMobile();
  const [activeSection, setActiveSection] = useState<string>('general');
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveActionRef = useRef<(() => Promise<void>) | null>(null);

  const handleSaveAll = async () => {
    if (saveActionRef.current) {
      setSaving(true);
      try {
        await saveActionRef.current();
        setIsDirty(false);
      } catch {
        // The active section displays the save error inline.
      } finally {
        setSaving(false);
      }
    }
  };

  const renderSectionContent = () => {
    switch (activeSection) {
      case 'general':
        return <GeneralSection user={user} onUpdateUser={onUpdateUser} onDirtyChange={setIsDirty} onSaveRef={saveActionRef} />;
      case 'appearance':
        return <AppearanceSection user={user} onUpdateUser={onUpdateUser} />;
      case 'account':
        return <AccountSection user={user} onLogout={onLogout} />;
      case 'privacy':
        return <PrivacySection />;
      case 'billing':
        return <BillingSection />;
      case 'usage':
        return <UsageSection />;
      case 'memory':
        return <MemorySection />;
      case 'preferences':
        return <PreferencesSection user={user} onUpdateUser={onUpdateUser} />;
      case 'connections':
        return <ConnectionsSection />;
      default:
        return <GeneralSection user={user} onUpdateUser={onUpdateUser} onDirtyChange={setIsDirty} onSaveRef={saveActionRef} />;
    }
  };

  return (
    <div className="h-[100dvh] w-full bg-[var(--bg)] text-[var(--text)] flex flex-col font-sans antialiased overflow-hidden">
      {/* Top Navbar */}
      <div className="shrink-0 px-4 sm:px-8 py-3.5 border-b border-[var(--line)] flex items-center justify-between bg-[var(--surface)]/80">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-[var(--muted)] hover:text-[var(--text)] transition-colors rounded-lg px-3 py-2 hover:bg-[var(--hover)]"
        >
          <ArrowLeft size={16} />
          <span className="text-sm font-medium">Back to workspace</span>
        </button>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-[var(--accent)]/15 text-[var(--accent)] flex items-center justify-center">
            <Sparkles size={14} />
          </div>
          <span className="text-sm font-semibold font-['Georgia',serif]">Bwenge Studio Settings</span>
        </div>
      </div>

      {/* Main Layout */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Desktop Sidebar Navigation / Mobile List Screen */}
        {(!isMobile || !mobileDetailOpen) && (
          <div className={`${isMobile ? 'w-full' : 'w-72'} shrink-0 border-r border-[var(--line)] bg-[var(--bg)] flex flex-col overflow-y-auto`}>
            <div className="p-4 sm:p-6 space-y-1">
              <span className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider px-3 mb-2 block">Settings</span>
              {SECTIONS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => {
                    setActiveSection(s.id);
                    if (isMobile) setMobileDetailOpen(true);
                  }}
                  className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-sm font-medium transition-colors ${
                    activeSection === s.id && (!isMobile || mobileDetailOpen)
                      ? 'bg-[var(--line)]/70 text-[var(--text)] font-semibold'
                      : 'text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className={activeSection === s.id ? 'text-[var(--accent)]' : 'text-[var(--muted)]'}>{s.icon}</span>
                    <span>{s.label}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Right Content Area / Mobile Detail View */}
        {(!isMobile || mobileDetailOpen) && (
          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col bg-[var(--surface)]">
            {isMobile && (
              <div className="px-4 py-3 border-b border-[var(--line)] flex items-center gap-3 bg-[var(--bg)]">
                <button
                  onClick={() => setMobileDetailOpen(false)}
                  className="flex items-center gap-1.5 text-sm font-medium text-[var(--muted)]"
                >
                  <ArrowLeft size={16} /> All Settings
                </button>
              </div>
            )}
            <div className="flex-1 max-w-4xl w-full mx-auto p-6 sm:p-12 pb-24">
              {renderSectionContent()}
            </div>
          </div>
        )}
      </div>

      {/* Dirty Save Bar */}
      {isDirty && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 bg-[var(--text)] text-[var(--on-accent)] px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-4 animate-in slide-in-from-bottom duration-300 border border-[var(--line)]">
          <span className="text-xs font-medium text-[var(--muted)]">You have unsaved changes.</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsDirty(false)}
              className="px-3 py-1.5 rounded-xl bg-[var(--hover)] text-xs font-medium hover:bg-[var(--surface-2)] transition-colors text-[var(--text)]"
            >
              Discard
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={handleSaveAll}
              className="px-4 py-1.5 rounded-xl bg-[var(--accent)] text-xs font-medium hover:opacity-90 transition-colors flex items-center gap-1.5 text-[var(--on-accent)]"
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
