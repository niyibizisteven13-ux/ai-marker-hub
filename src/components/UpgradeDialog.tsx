import { useEffect, useRef, useState } from 'react';
import { Sparkles, X } from 'lucide-react';

/**
 * Shown once for the whole app when an AI feature is refused because the person's credits are used up
 * (authFetch raises "bwenge:upgrade-required" on a 402 UPGRADE_REQUIRED answer). The server's message already
 * says what was used and what a plan gives; the buttons lead to the plans or close the dialog.
 */
export default function UpgradeDialog() {
  const [info, setInfo] = useState<{ message: string; url: string; whatsappLink: string | null } | null>(null);
  const lastAt = useRef(0);
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail as { message?: string; url?: string; whatsappLink?: string | null } | undefined;
      if (Date.now() - lastAt.current < 1500) return;          // several requests failing at once show one dialog
      lastAt.current = Date.now();
      setInfo({ message: d?.message || 'You have used your credits.', url: d?.url || '/upgrade?reason=limit', whatsappLink: d?.whatsappLink ?? null });
    };
    window.addEventListener('bwenge:upgrade-required', on);
    return () => window.removeEventListener('bwenge:upgrade-required', on);
  }, []);
  useEffect(() => {
    if (!info) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setInfo(null); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [info]);
  if (!info) return null;
  return (
    <div className="fixed inset-0 z-[300] flex items-end justify-center bg-black/50 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label="Upgrade to continue" onClick={() => setInfo(null)}>
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[var(--app-surface,#14161b)] p-5 text-[var(--app-text,#fff)] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <p className="flex items-center gap-2 text-[15px] font-semibold"><Sparkles size={17} className="text-[var(--accent,#f59e0b)]" />Upgrade to keep going</p>
          <button type="button" onClick={() => setInfo(null)} aria-label="Close" className="rounded-lg p-1 text-neutral-400 hover:bg-white/10"><X size={16} /></button>
        </div>
        <p className="mt-3 text-[13.5px] leading-relaxed text-neutral-300">{info.message}</p>
        <p className="mt-2 text-[12.5px] text-neutral-500">You pay by Mobile Money{info.whatsappLink ? ', then send the screenshot on WhatsApp to get access' : ''}.</p>
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={() => setInfo(null)} className="min-h-11 rounded-xl border border-white/15 px-4 text-sm text-neutral-200 hover:bg-white/5">Not now</button>
          {info.whatsappLink && <a href={info.whatsappLink} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center justify-center rounded-xl bg-emerald-500 px-4 text-sm font-semibold text-white hover:bg-emerald-400">Pay on WhatsApp</a>}
          <a href={info.url} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[var(--accent,#f59e0b)] px-5 text-sm font-semibold text-[var(--on-accent,#000)] hover:opacity-90">See plans</a>
        </div>
      </div>
    </div>
  );
}
