import { BadgeCheck } from 'lucide-react';

/** The check mark that goes next to the name of someone who bought the verified badge. */
export function VerifiedBadge({ label = 'Verified', size = 20, className = '' }: { label?: string; size?: number; className?: string }) {
  return <span role="img" aria-label={label} title={label} className={`inline-flex shrink-0 align-middle ${className}`}><BadgeCheck size={size} className="fill-[#1D9BF0] text-white" aria-hidden="true" /></span>;
}
