import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { authFetch } from '../../utils/authFetch';

/** Small shared pieces for the administrator's pages: one way to call the server and one look for cards, buttons and tables. */
export const card = 'rounded-2xl border border-[#263052] bg-[#0E1426] p-5';
export const input = 'w-full rounded-lg border border-[#2A3760] bg-[#0A1020] px-2.5 py-1.5 text-sm text-white outline-none focus:border-[#3FA7E0]';
export const btn = 'inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50';
export const btnPrimary = `${btn} bg-[#3FA7E0] text-[#06101F] hover:bg-[#5BB6E8]`;
export const btnGhost = `${btn} border border-[#2E3A63] text-[#C9D2F0] hover:bg-[#18213D]`;
export const btnDanger = `${btn} bg-[#B3263E] text-white hover:bg-[#C93049]`;
export const th = 'p-3 text-[11px] font-bold uppercase tracking-wide text-[#9AA6C9]';
export const td = 'p-3 text-sm text-[#DCE3FA]';
export type Notify = (msg: string, error?: boolean) => void;

export async function api<T = any>(url: string, init?: RequestInit): Promise<T> {
  const res = await authFetch(url, { ...init, headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status}).`);
  return body as T;
}
export const post = <T = any>(url: string, body?: unknown) => api<T>(url, { method: 'POST', body: JSON.stringify(body ?? {}) });

/** Loads data when the page opens and on demand; a failure is shown, never thrown. */
export function useLoad<T>(load: () => Promise<T>, notify: Notify, every = 0) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const ref = useRef(load); ref.current = load;
  const reload = useCallback(async () => { try { setData(await ref.current()); } catch (e) { notify(e instanceof Error ? e.message : 'Could not load.', true); } finally { setLoading(false); } }, [notify]);
  useEffect(() => { void reload(); if (!every) return; const t = window.setInterval(() => void reload(), every); return () => window.clearInterval(t); }, [reload, every]);
  return { data, loading, reload, setData };
}
/** Runs an action with a busy flag and a message; refuses to start while another is running. */
export function useAct(notify: Notify) {
  const [busy, setBusy] = useState(false);
  const act = useCallback(async (fn: () => Promise<unknown>, ok?: string, then?: () => Promise<unknown> | void) => {
    setBusy(true);
    try { await fn(); if (ok) notify(ok); if (then) await then(); } catch (e) { notify(e instanceof Error ? e.message : 'Something went wrong.', true); } finally { setBusy(false); }
  }, [notify]);
  return { busy, act };
}

export function Panel({ title, hint, right, children }: { title: string; hint?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className={`${card} space-y-3`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h3 className="text-sm font-bold text-white">{title}</h3>{hint && <p className="mt-0.5 max-w-3xl text-xs leading-relaxed text-[#9AA6C9]">{hint}</p>}</div>
        {right}
      </div>
      {children}
    </section>
  );
}
export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'good' | 'warn' | 'bad' }) {
  const c = tone === 'bad' ? 'text-[#FF8798]' : tone === 'warn' ? 'text-[#F2C230]' : tone === 'good' ? 'text-[#5FD39B]' : 'text-white';
  return <div className="rounded-xl border border-[#263052] bg-[#0A1020] p-3"><p className="text-[11px] uppercase tracking-wide text-[#6C789E]">{label}</p><p className={`mt-1 text-lg font-bold ${c}`}>{value}</p></div>;
}
export function Toggle({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${on ? 'bg-[#3DB27A]' : 'bg-[#3A4670]'}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  );
}
export const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : '–');
export const ago = (iso: string | null | undefined) => { if (!iso) return '–'; const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000)); return s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 129600 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`; };
/** Downloads a file from an admin endpoint (the browser cannot send the sign-in header through a plain link). */
export async function download(url: string, name: string) {
  const res = await authFetch(url);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not download.');
  const a = document.createElement('a'); a.href = URL.createObjectURL(await res.blob()); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
