import { useEffect, useState } from 'react';
import { Check, Loader2, Sliders } from 'lucide-react';
import type { User } from '../../types';
import { authFetch } from '../../utils/authFetch';

export default function PreferencesSection({ user, onUpdateUser }: { user: User | null; onUpdateUser: (user: User) => void }) {
  const [strictness, setStrictness] = useState(user?.settings?.defaultStrictness || 'STANDARD');
  const [tone, setTone] = useState(user?.settings?.agentTone || 'PROFESSIONAL');
  const [summaries, setSummaries] = useState(user?.settings?.autoSummarize ?? true);
  const [instructions, setInstructions] = useState(user?.settings?.customInstructions || '');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    setStrictness(user?.settings?.defaultStrictness || 'STANDARD');
    setTone(user?.settings?.agentTone || 'PROFESSIONAL');
    setSummaries(user?.settings?.autoSummarize ?? true);
    setInstructions(user?.settings?.customInstructions || '');
  }, [user?.id, user?.settings?.defaultStrictness, user?.settings?.agentTone, user?.settings?.autoSummarize, user?.settings?.customInstructions]);

  const save = async (patch: Record<string, unknown>) => {
    if (!user) { setStatus({ type: 'error', text: 'Sign in to save Agent preferences.' }); return; }
    setSaving(true); setStatus(null);
    try {
      const res = await authFetch('/api/user/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.user) throw new Error(data.error || 'Could not save preferences.');
      onUpdateUser(data.user);
      setStatus({ type: 'success', text: 'Agent preferences saved to your account.' });
    } catch (error) {
      setStatus({ type: 'error', text: error instanceof Error ? error.message : 'Could not save preferences.' });
    } finally { setSaving(false); }
  };

  const selectClass = 'w-full sm:w-72 bg-[var(--surface)] border border-[var(--line)] rounded-xl px-3.5 py-2.5 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]';
  return <div className="space-y-6">
    <div><h2 className="text-xl font-normal text-[var(--text)] font-[\'Georgia\',serif]">Agent Preferences</h2><p className="mt-1 text-xs text-[var(--muted)]">Set how the marking Agent evaluates work and explains its decisions. Changes save to your account.</p></div>
    <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">
      <div className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"><div><label htmlFor="agent-strictness" className="block text-sm font-medium text-[var(--text)]">Marking strictness</label><span className="text-xs text-[var(--muted)]">Sets the default tolerance when applying your rubric.</span></div><select id="agent-strictness" value={strictness} disabled={saving} onChange={(e) => { const value = e.target.value as 'LENIENT' | 'STANDARD' | 'STRICT'; setStrictness(value); void save({ defaultStrictness: value }); }} className={selectClass}><option value="LENIENT">Flexible</option><option value="STANDARD">Balanced</option><option value="STRICT">Strict</option></select></div>
      <div className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"><div><label htmlFor="agent-tone" className="block text-sm font-medium text-[var(--text)]">Feedback tone</label><span className="text-xs text-[var(--muted)]">Controls the style used in marking feedback.</span></div><select id="agent-tone" value={tone} disabled={saving} onChange={(e) => { const value = e.target.value as typeof tone; setTone(value); void save({ agentTone: value }); }} className={selectClass}><option value="PROFESSIONAL">Professional</option><option value="ENCOURAGING">Encouraging</option><option value="STRICT">Direct</option><option value="ACADEMIC">Academic</option></select></div>
      <div className="py-4 flex items-center justify-between gap-4"><div><label htmlFor="agent-summary" className="block text-sm font-medium text-[var(--text)]">Summarize marking outcomes</label><span className="text-xs text-[var(--muted)]">Include a concise class or batch summary when relevant.</span></div><input id="agent-summary" type="checkbox" checked={summaries} disabled={saving} onChange={(e) => { setSummaries(e.target.checked); void save({ autoSummarize: e.target.checked }); }} className="h-5 w-5 accent-[var(--accent)]" /></div>
      <div className="py-4 space-y-2"><label htmlFor="agent-instructions" className="block text-sm font-medium text-[var(--text)]">Additional marking guidance</label><p className="text-xs text-[var(--muted)]">Optional instructions for the Agent. Your uploaded rubric remains the source of marking criteria.</p><textarea id="agent-instructions" maxLength={2000} rows={4} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="For example: use constructive language and explain each deduction briefly." className="w-full resize-y rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3.5 py-3 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]" /><div className="flex items-center justify-between"><span className="text-[11px] text-[var(--muted)]">{instructions.length}/2000</span><button type="button" disabled={saving} onClick={() => void save({ customInstructions: instructions })} className="rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-[var(--on-accent)] disabled:opacity-60">Save guidance</button></div></div>
    </div>
    {saving && <p className="flex items-center gap-2 text-xs text-[var(--muted)]"><Loader2 size={14} className="animate-spin" /> Saving securely…</p>}
    {status && <p role="status" className={`flex items-center gap-2 rounded-xl p-3 text-xs ${status.type === 'error' ? 'bg-[var(--danger)]/10 text-[var(--danger)]' : 'bg-[var(--teal)]/10 text-[var(--teal)]'}`}>{status.type === 'success' && <Check size={14} />}{status.text}</p>}
  </div>;
}
