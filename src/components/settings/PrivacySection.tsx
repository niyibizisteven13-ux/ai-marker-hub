import { useState } from 'react';
import { Download, Loader2, ShieldCheck } from 'lucide-react';
import { authFetch } from '../../utils/authFetch';

export default function PrivacySection() {
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);

  const exportData = async () => {
    setExporting(true); setMessage(null);
    try {
      const res = await authFetch('/api/user/export');
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Could not export account data.');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = `bwenge-account-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
      setMessage({ error: false, text: 'Your account export has been downloaded.' });
    } catch (error) { setMessage({ error: true, text: error instanceof Error ? error.message : 'Could not export account data.' }); }
    finally { setExporting(false); }
  };

  return <div className="space-y-6">
    <div><h2 className="text-xl font-normal text-[var(--text)] font-[\'Georgia\',serif]">Privacy & Data</h2><p className="mt-1 text-xs text-[var(--muted)]">Review how workspace data is stored and export the account data currently held by Bwenge.</p></div>
    <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">
      <div className="flex items-start gap-3 py-5"><ShieldCheck size={18} className="mt-0.5 shrink-0 text-[var(--teal)]" /><div><h3 className="text-sm font-medium text-[var(--text)]">Account workspace history</h3><p className="mt-1 max-w-2xl text-xs leading-relaxed text-[var(--muted)]">Saved chats, forms, projects, grading batches, and uploaded-file records are associated with your account. Use Temporary chat from the conversation menu for chats that should not be added to saved workspace history.</p></div></div>
      <div className="flex flex-col justify-between gap-4 py-5 sm:flex-row sm:items-center"><div><h3 className="text-sm font-medium text-[var(--text)]">Export account data</h3><p className="mt-1 text-xs text-[var(--muted)]">Download your profile, settings, workspace, projects, forms, grading records, and file metadata as JSON.</p></div><button type="button" disabled={exporting} onClick={() => void exportData()} className="flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-2.5 text-xs font-medium text-[var(--text)] hover:bg-[var(--hover)] disabled:opacity-60 sm:w-auto">{exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}Download export</button></div>
      <div className="py-5"><h3 className="text-sm font-medium text-[var(--text)]">Account deletion</h3><p className="mt-1 text-xs text-[var(--muted)]">For account deletion, contact <a className="text-[var(--accent)] underline" href="mailto:support@bwenge.space?subject=Account%20deletion%20request">Bwenge support</a>. Self-serve deletion is not available in this version.</p></div>
    </div>
    {message && <p role="status" className={`rounded-xl p-3 text-xs ${message.error ? 'bg-[var(--danger)]/10 text-[var(--danger)]' : 'bg-[var(--teal)]/10 text-[var(--teal)]'}`}>{message.text}</p>}
  </div>;
}
