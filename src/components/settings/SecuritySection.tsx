import { useCallback, useEffect, useState } from 'react';
import { Fingerprint, KeyRound, Loader2, ShieldCheck, Smartphone, Trash2, Copy, Download } from 'lucide-react';
import {
  addPasskey, explain, hasBuiltInBiometric, passkeysSupported, regenerateRecovery, removePasskey, setRequired, status, wasCancelled, withProof, type PasskeyStatus,
} from '../../auth/passkeys';
import { MINUTE_CHOICES, readAppLock, writeAppLock } from '../../auth/appLock';

/**
 * Settings → Security: passkeys (fingerprint or face), the sign-in step that asks for one after Google or the emailed code, recovery
 * codes, and the lock that opens the app with the fingerprint or face on this phone.
 */
const card = 'rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5';
const btn = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold disabled:opacity-60';
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'never');

function Switch({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50 ${on ? 'bg-[var(--accent)]' : 'bg-[var(--surface-2)] border border-[var(--line)]'}`}>
      <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  );
}

export default function SecuritySection() {
  const [st, setSt] = useState<PasskeyStatus | null>(null);
  const [busy, setBusy] = useState<string>('');
  const [note, setNote] = useState<{ error: boolean; text: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [name, setName] = useState('');
  const [bio, setBio] = useState(false);
  const [lock, setLock] = useState(readAppLock());
  const supported = passkeysSupported();

  const load = useCallback(async () => { try { setSt(await status()); } catch (e) { setNote({ error: true, text: explain(e) }); } }, []);
  useEffect(() => { void load(); void hasBuiltInBiometric().then(setBio); }, [load]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setNote(null);
    try { await fn(); } catch (e) { if (!wasCancelled(e)) setNote({ error: true, text: explain(e) }); } finally { setBusy(''); }
  };
  const add = () => run('add', async () => {
    const r = await addPasskey(name || undefined); setSt(r); setName('');
    if (r.recoveryCodes?.length) setCodes(r.recoveryCodes);
    setNote({ error: false, text: 'Passkey added. You can now turn on the sign-in step below.' });
  });
  const toggleRequired = (v: boolean) => run('req', async () => { setSt(v ? await setRequired(true) : await withProof(() => setRequired(false))); });
  const remove = (id: string, label: string) => { if (!confirm(`Remove “${label}”? ${st?.creds.length === 1 ? 'This was your last passkey: the extra sign-in step will be switched off.' : ''}`)) return; void run('rm', async () => { setSt(await withProof(() => removePasskey(id))); if ((st?.creds.length ?? 0) <= 1) { writeAppLock({ ...lock, on: false }); setLock({ ...lock, on: false }); } }); };
  const newCodes = () => { if (!confirm('Make new recovery codes? The old ones stop working.')) return; void run('codes', async () => { const r = await withProof(() => regenerateRecovery()); setCodes(r.recoveryCodes); await load(); }); };
  const setLockCfg = (c: typeof lock) => { setLock(c); writeAppLock(c); };

  const has = (st?.creds.length ?? 0) > 0;
  const download = () => {
    const blob = new Blob([`Bwenge recovery codes\nKeep these somewhere safe. Each works once.\n\n${codes!.join('\n')}\n`], { type: 'text/plain' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'bwenge-recovery-codes.txt'; a.click(); URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-normal text-[var(--text)] font-display">Security</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">Keep marks, student work and results safe with your fingerprint or face. A passkey stays in your phone: Bwenge never sees your fingerprint.</p>
      </div>

      {!supported && <p role="status" className="rounded-xl bg-[var(--surface-2)] p-3 text-xs text-[var(--muted)]">This browser cannot use passkeys. Open Bwenge in a recent Chrome, Safari or Edge on your phone or laptop.</p>}

      {codes && (
        <div role="alert" className="space-y-3 rounded-2xl border border-[var(--accent)]/50 bg-[var(--accent)]/10 p-5">
          <p className="text-sm font-semibold text-[var(--text)]">Save your recovery codes now</p>
          <p className="text-xs leading-relaxed text-[var(--muted)]">If you lose your phone, each code lets you sign in once. They are shown only now. Keep them somewhere safe, not on the same phone.</p>
          <ul className="grid grid-cols-2 gap-2 font-mono text-sm text-[var(--text)]">{codes.map((c) => <li key={c} className="select-all rounded-lg bg-[var(--surface)] px-3 py-2 text-center">{c}</li>)}</ul>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={`${btn} bg-[var(--surface)] text-[var(--text)] border border-[var(--line)]`} onClick={() => void navigator.clipboard?.writeText(codes.join('\n'))}><Copy size={15} />Copy</button>
            <button type="button" className={`${btn} bg-[var(--surface)] text-[var(--text)] border border-[var(--line)]`} onClick={download}><Download size={15} />Download</button>
            <button type="button" className={`${btn} bg-[var(--accent)] text-[var(--on-accent)]`} onClick={() => setCodes(null)}>I saved them</button>
          </div>
        </div>
      )}

      <section className={card}>
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--teal)]/15 text-[var(--teal)]"><Fingerprint size={24} /></div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-medium text-[var(--text)]">Passkeys (fingerprint or face)</h3>
            <p className="mt-0.5 text-xs text-[var(--muted)]">Add this phone or laptop. Next time, it will ask for your fingerprint, face or screen lock.</p>
          </div>
        </div>
        {!st ? <div className="mt-4 flex justify-center"><Loader2 className="animate-spin text-[var(--accent)]" /></div> : (
          <>
            {has && (
              <ul className="mt-4 divide-y divide-[var(--line)] rounded-xl border border-[var(--line)]">
                {st.creds.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 p-3">
                    <Smartphone size={18} className="shrink-0 text-[var(--muted)]" />
                    <div className="min-w-0 flex-1"><p className="truncate text-sm text-[var(--text)]">{c.name}</p><p className="text-[11px] text-[var(--muted)]">Added {when(c.createdAt)} · last used {when(c.lastUsedAt)}</p></div>
                    <button type="button" aria-label={`Remove ${c.name}`} disabled={!!busy} onClick={() => remove(c.id, c.name)} className="rounded-lg p-2 text-[var(--danger)] hover:bg-[var(--danger)]/10 disabled:opacity-50"><Trash2 size={16} /></button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Name it (for example: My phone)" aria-label="Passkey name"
                className="min-h-11 flex-1 rounded-xl border border-[var(--line)] bg-transparent px-3 text-sm text-[var(--text)] placeholder:text-[var(--muted)]" />
              <button type="button" disabled={!supported || !!busy} onClick={() => void add()} className={`${btn} bg-[var(--accent)] text-[var(--on-accent)] hover:opacity-90`}>
                {busy === 'add' ? <Loader2 size={16} className="animate-spin" /> : <Fingerprint size={16} />}Add a passkey
              </button>
            </div>
          </>
        )}
      </section>

      <section className={card}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--teal)]/15 text-[var(--teal)]"><ShieldCheck size={24} /></div>
            <div>
              <h3 className="text-base font-medium text-[var(--text)]">Ask for my passkey when I sign in</h3>
              <p className="mt-0.5 max-w-md text-xs leading-relaxed text-[var(--muted)]">After you sign in with Google or an emailed code, Bwenge also checks your fingerprint or face. Someone who only has your email cannot get in.</p>
            </div>
          </div>
          <Switch on={!!st?.required} disabled={!has || !!busy} label="Ask for my passkey when I sign in" onChange={(v) => void toggleRequired(v)} />
        </div>
        {!has && <p className="mt-3 text-xs text-[var(--muted)]">Add a passkey first.</p>}
        {has && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-4">
            <p className="text-xs text-[var(--muted)]"><KeyRound size={13} className="mr-1 inline" />{st!.recoveryLeft} recovery code{st!.recoveryLeft === 1 ? '' : 's'} left</p>
            <button type="button" disabled={!!busy} onClick={newCodes} className={`${btn} border border-[var(--line)] text-[var(--text)] hover:bg-[var(--hover)]`}>Make new recovery codes</button>
          </div>
        )}
      </section>

      <section className={card}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-medium text-[var(--text)]">Lock the app on this phone</h3>
            <p className="mt-0.5 max-w-md text-xs leading-relaxed text-[var(--muted)]">Bwenge opens only after your fingerprint or face. This setting is only for this phone or browser.</p>
          </div>
          <Switch on={lock.on} disabled={!has || !bio} label="Lock the app on this phone" onChange={(v) => setLockCfg({ ...lock, on: v })} />
        </div>
        {!has ? <p className="mt-3 text-xs text-[var(--muted)]">Add a passkey first.</p> : !bio ? <p className="mt-3 text-xs text-[var(--muted)]">This device has no fingerprint, face or screen lock set up.</p> : lock.on && (
          <label className="mt-4 flex items-center justify-between gap-3 border-t border-[var(--line)] pt-4 text-xs text-[var(--muted)]">
            Ask again after being away for
            <select value={lock.minutes} onChange={(e) => setLockCfg({ ...lock, minutes: Number(e.target.value) })} className="min-h-10 rounded-lg border border-[var(--line)] bg-transparent px-2 text-sm text-[var(--text)]">
              {MINUTE_CHOICES.map((m) => <option key={m} value={m}>{m === 0 ? 'any time' : `${m} min`}</option>)}
            </select>
          </label>
        )}
      </section>

      {note && <p role="status" className={`rounded-xl p-3 text-xs ${note.error ? 'bg-[var(--danger)]/10 text-[var(--danger)]' : 'bg-[var(--teal)]/10 text-[var(--teal)]'}`}>{note.text}</p>}
    </div>
  );
}
