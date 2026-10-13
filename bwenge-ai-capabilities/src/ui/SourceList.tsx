import type { SourcePassage } from './types';

function safeHref(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Collapsible "Sources" list shown under answers that used the knowledge base. */
export function SourceList({ sources }: { sources?: SourcePassage[] }) {
  if (!sources?.length) return null;
  return (
    <details className="mt-3 text-xs text-stone-400" data-testid="sources">
      <summary className="cursor-pointer select-none text-stone-300 hover:text-white">Sources ({sources.length})</summary>
      <ol className="mt-2 list-none space-y-1.5">
        {sources.map((s, i) => {
          const label = [s.title, s.publisher, s.year, s.page ? `p. ${s.page}` : '', s.table ? `table ${s.table}` : ''].filter(Boolean).join(', ') || 'Untitled source';
          const href = safeHref(s.url);
          return (
            <li key={i} className="flex gap-2">
              <span className="shrink-0 text-stone-500">[{i + 1}]</span>
              {href ? <a href={href} target="_blank" rel="noopener noreferrer" className="underline decoration-stone-600 underline-offset-2 hover:text-stone-200">{label}</a> : <span>{label}</span>}
            </li>
          );
        })}
      </ol>
    </details>
  );
}
