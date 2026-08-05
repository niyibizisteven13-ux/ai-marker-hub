import React, { useState } from 'react';
import { FileText, ChevronDown, ChevronUp, Play, Eye } from 'lucide-react';

interface GeminiFileCardProps {
  attachment: {
    id: string;
    name: string;
    size?: string;
    type?: string;
    previewContent?: string;
    url?: string;
    rawText?: string;
  };
  onStartMarking?: () => void;
  onOpenDesktopView?: () => void;
}

export function GeminiFileCard({ attachment, onStartMarking, onOpenDesktopView }: GeminiFileCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-lg my-2">
      <div className="p-3 bg-slate-800/80 flex items-center justify-between border-b border-slate-700/50">
        <div className="flex items-center gap-2.5 overflow-hidden">
          <div className="p-2 bg-orange-500/15 text-orange-400 rounded-xl shrink-0">
            <FileText className="w-4 h-4" />
          </div>
          <div className="truncate">
            <p className="text-xs font-semibold text-slate-100 truncate">{attachment.name}</p>
            <p className="text-[10px] text-slate-400">{attachment.type || 'FILE'} • {attachment.size || 'Ready'}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="p-1.5 text-slate-400 hover:text-slate-100 bg-slate-800 rounded-lg text-xs flex items-center gap-1 transition-colors"
        >
          <span className="text-[10px] hidden sm:inline">{isExpanded ? 'Hide' : 'Preview'}</span>
          {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>

      {isExpanded && (
        <div className="p-3 bg-slate-950 border-t border-slate-800 space-y-3">
          <div className="max-h-44 overflow-y-auto p-2.5 bg-slate-900 rounded-xl text-[11px] text-slate-300 font-mono leading-relaxed border border-slate-800">
            {attachment.previewContent || 'Document content loaded for review...'}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={onStartMarking}
              className="flex-1 flex items-center justify-center gap-1.5 bg-gradient-to-r from-orange-500 to-amber-500 text-white font-medium text-xs py-2 rounded-xl shadow-md active:scale-95 transition-all"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              Start Marking
            </button>

            <button
              type="button"
              onClick={onOpenDesktopView}
              className="hidden md:flex items-center gap-1 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-xl transition-colors"
            >
              <Eye className="w-3.5 h-3.5" />
              View
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
