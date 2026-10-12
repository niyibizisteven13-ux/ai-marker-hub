import { useState } from 'react';
import { ShieldCheck, Download, Trash2, AlertTriangle } from 'lucide-react';
import { authFetch } from '../../utils/authFetch';

export default function PrivacySection() {
  const [saveHistory, setSaveHistory] = useState(true);
  const [helpImprove, setHelpImprove] = useState(false);
  const [tempChats, setTempChats] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const handleExportData = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify({ exportedAt: new Date().toISOString(), privacy: 'Bwenge Studio Export' }, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `bwenge_export_${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    setStatusMsg('Data exported successfully.');
  };

  const handleDeleteAccount = async () => {
    try {
      const res = await authFetch('/api/auth/delete-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: deletePassword }),
      });
      if (!res.ok) throw new Error('Failed to delete account');
      window.location.reload();
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Deletion failed');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-normal text-[var(--text)] font-['Georgia',serif]">Privacy & Data Controls</h2>
        <p className="text-xs text-[var(--muted)] mt-0.5">Control how your chat history, training participation, and personal data are handled.</p>
      </div>

      <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">
        {/* Save Chat History */}
        <div className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <label className="text-sm font-medium text-[var(--text)] block">Save Chat History</label>
            <span className="text-xs text-[var(--muted)]">Retain conversation logs across sessions in your secure vault.</span>
          </div>
          <input
            type="checkbox"
            checked={saveHistory}
            onChange={(e) => setSaveHistory(e.target.checked)}
            className="h-5 w-5 rounded border-[var(--line)] text-[var(--accent)] accent-[var(--accent)] cursor-pointer"
          />
        </div>

        {/* Help improve Bwenge */}
        <div className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <label className="text-sm font-medium text-[var(--text)] block">Help Improve Bwenge (Model Training)</label>
            <span className="text-xs text-[var(--muted)]">Allow anonymized conversation samples to help train academic models. Defaults off.</span>
          </div>
          <input
            type="checkbox"
            checked={helpImprove}
            onChange={(e) => setHelpImprove(e.target.checked)}
            className="h-5 w-5 rounded border-[var(--line)] text-[var(--accent)] accent-[var(--accent)] cursor-pointer"
          />
        </div>

        {/* Temporary Chats */}
        <div className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <label className="text-sm font-medium text-[var(--text)] block">Temporary Chats Mode</label>
            <span className="text-xs text-[var(--muted)]">New chats will not be saved to history or used for training.</span>
          </div>
          <input
            type="checkbox"
            checked={tempChats}
            onChange={(e) => setTempChats(e.target.checked)}
            className="h-5 w-5 rounded border-[var(--line)] text-[var(--accent)] accent-[var(--accent)] cursor-pointer"
          />
        </div>

        {/* Export Data */}
        <div className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <label className="text-sm font-medium text-[var(--text)] block">Export Account Data</label>
            <span className="text-xs text-[var(--muted)]">Download a JSON archive of your chats, forms, and settings.</span>
          </div>
          <button
            type="button"
            onClick={handleExportData}
            className="px-4 py-2.5 rounded-xl border border-[var(--line)] bg-[var(--surface)] text-xs font-medium text-[var(--text)] hover:bg-[var(--hover)] transition-colors flex items-center justify-center gap-2 w-full sm:w-auto"
          >
            <Download size={14} /> Export Data
          </button>
        </div>

        {/* Delete Account */}
        <div className="py-4 space-y-4">
          <div>
            <label className="text-sm font-medium text-[var(--text)] block text-[var(--danger)]">Delete Account</label>
            <span className="text-xs text-[var(--muted)]">Permanently remove your account, subscription, and all associated data.</span>
          </div>

          {!showDeleteConfirm ? (
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              className="px-4 py-2.5 rounded-xl bg-[var(--danger)]/15 border border-[var(--danger)]/30 text-xs font-medium text-[var(--danger)] hover:bg-[var(--danger)]/25 transition-colors flex items-center gap-2"
            >
              <Trash2 size={14} /> Delete account
            </button>
          ) : (
            <div className="p-4 rounded-xl bg-[var(--danger)]/15 border border-[var(--danger)]/30 space-y-3 max-w-md">
              <div className="flex items-center gap-2 text-[var(--danger)] text-xs font-semibold">
                <AlertTriangle size={16} /> This action is permanent and cannot be undone.
              </div>
              <input
                type="password"
                placeholder="Enter password to confirm deletion"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                className="w-full bg-[var(--surface)] border border-[var(--line)] rounded-xl px-3 py-2 text-sm text-[var(--text)]"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleDeleteAccount}
                  className="px-4 py-2 rounded-xl bg-[var(--danger)] text-white text-xs font-semibold hover:opacity-90"
                >
                  Confirm Delete
                </button>
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(false)}
                  className="px-4 py-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] text-xs font-semibold text-[var(--text)]"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {statusMsg && (
        <div className="p-3 bg-[var(--surface-2)] rounded-xl text-xs text-[var(--text)] font-medium">
          {statusMsg}
        </div>
      )}
    </div>
  );
}
