import { useEffect, useId, useRef, useState } from 'react';
import { BadgeCheck, Check, X } from 'lucide-react';

/** What a visitor is told when they tap the check mark. The page passes the words (so they follow the visitor's language). */
export interface VerifiedExplain { hint: string; title: string; lead: string; points: string[]; link: { label: string; href: string }; close: string }

const Mark = ({ size, label }: { size: number; label: string }) => <BadgeCheck size={size} aria-label={label} className="fill-[#1D9BF0] text-white" />;

/** The check mark that goes next to the name of someone who bought the verified badge. With `explain` it is a button that opens a short dialog saying what the badge means. */
export function VerifiedBadge({ label = 'Verified', size = 20, className = '', explain }: { label?: string; size?: number; className?: string; explain?: VerifiedExplain }) {
  const [open, setOpen] = useState(false); const trigger = useRef<HTMLButtonElement>(null); const closeBtn = useRef<HTMLButtonElement>(null); const id = useId();
  useEffect(() => {
    if (!open) return; closeBtn.current?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('keydown', key); const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = prev; };
  }, [open]);
  if (!explain) return <span role="img" aria-label={label} title={label} className={`inline-flex shrink-0 align-middle ${className}`}><BadgeCheck size={size} className="fill-[#1D9BF0] text-white" aria-hidden="true" /></span>;
  const close = () => { setOpen(false); trigger.current?.focus(); };
  return (
    <>
      <button ref={trigger} type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }} aria-haspopup="dialog" aria-expanded={open} aria-label={`${label}. ${explain.hint}`} title={explain.hint}
        className={`inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full align-middle transition hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D9BF0] ${className}`}><Mark size={size} label="" /></button>
      {open && (
        <div className="fixed inset-0 z-[500] grid place-items-center bg-black/55 p-4" onClick={close}>
          <div role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-3xl bg-white p-6 text-[#0E1722] shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3"><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#E8F3FE]"><Mark size={30} label="" /></span><h2 id={`${id}-t`} className="font-display text-xl font-semibold leading-tight">{explain.title}</h2></div>
              <button ref={closeBtn} type="button" onClick={close} aria-label={explain.close} className="-mr-2 -mt-2 rounded-full p-2 hover:bg-[#F2F4F7]"><X size={18} /></button>
            </div>
            <p className="mt-4 text-[15px] leading-relaxed text-[#344054]">{explain.lead}</p>
            <ul className="mt-3 space-y-2.5">{explain.points.map((p) => <li key={p} className="flex items-start gap-2.5 text-[14.5px] leading-snug text-[#344054]"><span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#E8F6EE] text-[#14532D]"><Check size={13} strokeWidth={3} aria-hidden="true" /></span>{p}</li>)}</ul>
            <a href={explain.link.href} target="_blank" rel="noopener noreferrer" className="mt-5 flex min-h-11 w-full items-center justify-center rounded-xl bg-[#0E1722] px-4 text-sm font-semibold text-white hover:opacity-90">{explain.link.label}</a>
          </div>
        </div>
      )}
    </>
  );
}
