import React from 'react';
import { BookOpen } from 'lucide-react';

export interface SourceItem {
  id: string;
  title: string;
  publisher?: string;
  year?: number;
  page?: number;
  table?: string;
  url?: string;
  snippet?: string;
}

interface SourceChipsProps {
  sources?: SourceItem[];
  onOpenSource: (source: SourceItem) => void;
}

export const SourceChips: React.FC<SourceChipsProps> = ({ sources = [], onOpenSource }) => {
  if (!sources || sources.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 mt-3 pt-2 border-t border-[var(--border)]">
      <div className="flex items-center gap-1 text-[11px] font-bold text-[var(--muted)]">
        <BookOpen className="w-3.5 h-3.5 text-[var(--teal)]" /> Sources:
      </div>
      {sources.map((src, idx) => (
        <button
          key={src.id || idx}
          type="button"
          onClick={() => onOpenSource(src)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-[var(--border)] bg-[var(--surface-2)] text-xs text-[var(--text)] hover:border-[var(--teal)] hover:bg-[var(--hover)] transition-all max-w-[220px]"
          title={src.snippet || src.title}
        >
          <span className="font-bold text-[var(--teal)]">[{idx + 1}]</span>
          <span className="truncate">{src.title}{src.page ? `, p. ${src.page}` : ''}</span>
        </button>
      ))}
    </div>
  );
};
