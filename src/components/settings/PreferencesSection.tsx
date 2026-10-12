import { useState } from 'react';
import { Sliders } from 'lucide-react';

export default function PreferencesSection() {
  const [defaultMode, setDefaultMode] = useState('Marking Hub');
  const [answerLanguage, setAnswerLanguage] = useState('English');
  const [voiceLanguage, setVoiceLanguage] = useState('Kinyarwanda / English');
  const [reportFormat, setReportFormat] = useState('Excel (.xlsx)');
  const [notifications, setNotifications] = useState(true);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-normal text-[var(--text)] font-['Georgia',serif]">Workspace Preferences</h2>
        <p className="text-xs text-[var(--muted)] mt-0.5">Configure default assistant behavior, report formats, and audio input settings.</p>
      </div>

      <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">
        {/* Default Mode */}
        <div className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <label className="text-sm font-medium text-[var(--text)] block">Default Studio Mode</label>
            <span className="text-xs text-[var(--muted)]">Choose which tab opens by default when starting Bwenge Studio.</span>
          </div>
          <select
            value={defaultMode}
            onChange={(e) => setDefaultMode(e.target.value)}
            className="w-full sm:w-72 bg-[var(--surface)] border border-[var(--line)] rounded-xl px-3.5 py-2.5 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
          >
            <option value="Marking Hub">Marking Hub</option>
            <option value="Exam Prep">Exam Prep</option>
            <option value="Document Scanner">Document Scanner</option>
            <option value="Knowledge Base">Knowledge Base</option>
          </select>
        </div>

        {/* Answer Language */}
        <div className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <label className="text-sm font-medium text-[var(--text)] block">Default Answer Language</label>
            <span className="text-xs text-[var(--muted)]">Primary language for AI generated explanations and feedback.</span>
          </div>
          <select
            value={answerLanguage}
            onChange={(e) => setAnswerLanguage(e.target.value)}
            className="w-full sm:w-72 bg-[var(--surface)] border border-[var(--line)] rounded-xl px-3.5 py-2.5 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
          >
            <option value="English">English</option>
            <option value="Kinyarwanda">Kinyarwanda</option>
            <option value="French">French</option>
          </select>
        </div>

        {/* Voice Input Language */}
        <div className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <label className="text-sm font-medium text-[var(--text)] block">Voice Input Language</label>
            <span className="text-xs text-[var(--muted)]">Speech-to-text recognition dialect for voice dictation.</span>
          </div>
          <select
            value={voiceLanguage}
            onChange={(e) => setVoiceLanguage(e.target.value)}
            className="w-full sm:w-72 bg-[var(--surface)] border border-[var(--line)] rounded-xl px-3.5 py-2.5 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
          >
            <option value="Kinyarwanda / English">Kinyarwanda / English</option>
            <option value="English">English (US)</option>
            <option value="French">Français</option>
          </select>
        </div>

        {/* Default Report Format */}
        <div className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <label className="text-sm font-medium text-[var(--text)] block">Default Export Report Format</label>
            <span className="text-xs text-[var(--muted)]">Preferred spreadsheet or document export format for batch results.</span>
          </div>
          <select
            value={reportFormat}
            onChange={(e) => setReportFormat(e.target.value)}
            className="w-full sm:w-72 bg-[var(--surface)] border border-[var(--line)] rounded-xl px-3.5 py-2.5 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
          >
            <option value="Excel (.xlsx)">Excel (.xlsx)</option>
            <option value="CSV (.csv)">CSV (.csv)</option>
            <option value="PDF Summary">PDF Summary Report</option>
          </select>
        </div>

        {/* Notifications */}
        <div className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <label className="text-sm font-medium text-[var(--text)] block">Email & Telegram Notifications</label>
            <span className="text-xs text-[var(--muted)]">Receive instant alerts when batch marking completes.</span>
          </div>
          <input
            type="checkbox"
            checked={notifications}
            onChange={(e) => setNotifications(e.target.checked)}
            className="h-5 w-5 rounded border-[var(--line)] text-[var(--accent)] accent-[var(--accent)] cursor-pointer"
          />
        </div>
      </div>
    </div>
  );
}
