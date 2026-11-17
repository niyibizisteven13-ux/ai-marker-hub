import { useState } from 'react';
import { Star } from 'lucide-react';

/** Read-only stars for an average (a fraction fills part of a star). */
export function StarsDisplay({ value, size = 16 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex" role="img" aria-label={`${value.toFixed(1)} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => {
        const fill = Math.max(0, Math.min(1, value - (n - 1)));
        return (
          <span key={n} className="relative inline-block" style={{ width: size, height: size }}>
            <Star size={size} className="absolute inset-0 text-[var(--app-faint)]/40" />
            <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}><Star size={size} className="fill-[var(--brand)] text-[var(--brand)]" /></span>
          </span>
        );
      })}
    </span>
  );
}

const WORDS = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'];
/** Star input: tap or press 1 to 5; arrow keys move; the word under the stars says what the number means. */
export function StarsInput({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  const [hover, setHover] = useState(0); const shown = hover || value;
  return (
    <div>
      <div role="radiogroup" aria-label={label} className="flex gap-1" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} ${n === 1 ? 'star' : 'stars'}: ${WORDS[n]}`} tabIndex={value === n || (!value && n === 1) ? 0 : -1}
            onMouseEnter={() => setHover(n)} onClick={() => onChange(n)}
            onKeyDown={(e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); onChange(Math.min(5, (value || 0) + 1)); } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); onChange(Math.max(1, (value || 2) - 1)); } }}
            className="flex h-11 w-11 items-center justify-center rounded-lg outline-none transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-[var(--brand)]">
            <Star size={30} className={n <= shown ? 'fill-[var(--brand)] text-[var(--brand)]' : 'text-[var(--app-faint)]/50'} />
          </button>
        ))}
      </div>
      <p className="mt-1 h-5 text-sm text-[var(--app-muted)]" aria-live="polite">{shown ? WORDS[shown] : 'Tap a star'}</p>
    </div>
  );
}
