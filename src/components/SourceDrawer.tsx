import React from 'react';
import { BottomSheet } from './BottomSheet';
import { SourceItem } from './SourceChips';
import { BookOpen, ExternalLink, ShieldCheck } from 'lucide-react';

interface SourceDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  source: SourceItem | null;
  isAdmin?: boolean;
  debugScores?: { score?: number; retrievalTimeMs?: number; modelUsed?: string };
}

export const SourceDrawer: React.FC<SourceDrawerProps> = ({
  isOpen,
  onClose,
  source,
  isAdmin = false,
  debugScores,
}) => {
  if (!source) return null;

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title="Source Details">
      <div className="space-y-4 text-xs text-[var(--text)]">
        <div className="p-3 rounded-xl bg-[var(--surface-2)] border border-[var(--border)]">
          <div className="flex items-center gap-2 text-[var(--teal)] font-bold mb-1">
            <BookOpen className="w-4 h-4" /> {source.title}
          </div>
          {source.publisher && <p className="text-[var(--muted)]">Publisher: {source.publisher} {source.year ? `(${source.year})` : ''}</p>}
          {source.page && <p className="text-[var(--muted)]">Page: {source.page}</p>}
          {source.table && <p className="text-[var(--muted)]">Table: {source.table}</p>}
        </div>

        {source.snippet && (
          <div>
            <h4 className="font-bold text-[var(--muted)] uppercase tracking-wider text-[10px] mb-1">Snippet</h4>
            <blockquote className="p-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] italic text-[var(--text)] leading-relaxed">
              "{source.snippet}"
            </blockquote>
          </div>
        )}

        {source.url && (
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--accent)] text-[var(--on-accent)] font-bold hover:opacity-90 transition-opacity"
          >
            <span>Open original document</span>
            <ExternalLink className="w-4 h-4" />
          </a>
        )}

        {isAdmin && debugScores && (
          <div className="pt-3 border-t border-[var(--border)] space-y-1.5 text-[11px] text-[var(--muted)] font-mono">
            <div className="flex items-center gap-1.5 font-bold text-[var(--text)]">
              <ShieldCheck className="w-4 h-4 text-[var(--teal)]" /> Admin Retrieval Diagnostics
            </div>
            {debugScores.score !== undefined && <div>Similarity Score: {debugScores.score.toFixed(3)}</div>}
            {debugScores.retrievalTimeMs !== undefined && <div>Retrieval Latency: {debugScores.retrievalTimeMs} ms</div>}
            {debugScores.modelUsed && <div>Model Used: {debugScores.modelUsed}</div>}
          </div>
        )}
      </div>
    </BottomSheet>
  );
};
