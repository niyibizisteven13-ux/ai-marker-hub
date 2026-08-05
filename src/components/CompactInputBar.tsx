import React from 'react';
import type { ChatAttachment } from '../types';

interface CompactInputBarProps {
  inputValue: string;
  setInputValue: React.Dispatch<React.SetStateAction<string>>;
  onSend: () => void;
  onAttachClick: () => void;
  onScannerClick: () => void;
  stagedAttachments: Array<File | ChatAttachment>;
  onRemoveAttachment: (index: number) => void;
  onClearAttachments: () => void;
}

export const CompactInputBar: React.FC<CompactInputBarProps> = ({
  inputValue,
  setInputValue,
  onSend,
  onAttachClick,
  onScannerClick,
  stagedAttachments,
  onRemoveAttachment,
  onClearAttachments,
}) => {
  return (
    <div className="rounded-3xl border border-slate-800/90 bg-slate-900/95 p-3 shadow-[0_12px_30px_-20px_rgba(0,0,0,0.8)]">
      {stagedAttachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2 pb-2 border-b border-slate-800/60">
          {stagedAttachments.map((attachment, idx) => (
            <div
              key={`${attachment instanceof File ? attachment.name : attachment.id}-${idx}`}
              className="group flex items-center gap-2 rounded-xl bg-slate-800/90 border border-slate-700/70 px-3 py-2 text-xs text-slate-200 shadow-sm"
            >
              <span className="text-sm text-orange-400">📄</span>
              <div className="min-w-0">
                <div className="truncate max-w-[160px] text-[11px] font-medium text-slate-100">
                  {attachment instanceof File ? attachment.name : attachment.name}
                </div>
                <div className="text-[10px] text-slate-500">
                  {attachment instanceof File ? `${Math.round(attachment.size / 1024)} KB` : attachment.size || ''}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onRemoveAttachment(idx)}
                className="text-slate-400 hover:text-rose-400 rounded-full w-5 h-5 flex items-center justify-center transition"
                title="Remove attachment"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <textarea
        rows={2}
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        placeholder="Ask Bwenge to review a submission, attach a rubric, or process a scan..."
        className="w-full resize-none rounded-2xl border border-slate-800/80 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/10"
      />

      <div className="mt-3 border-t border-slate-800/60 pt-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onAttachClick}
              className="group relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-300 bg-slate-800/60 hover:bg-slate-700/80 hover:text-white border border-slate-700/50 hover:border-orange-500/40 shadow-sm transition-all duration-200 active:scale-95"
            >
              <span className="text-sm transition-transform duration-200 group-hover:-translate-y-0.5">📎</span>
              <span>Attach</span>
            </button>

            <button
              type="button"
              onClick={onScannerClick}
              className="group relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-300 bg-slate-800/60 hover:bg-slate-700/80 hover:text-white border border-slate-700/50 hover:border-orange-500/40 shadow-sm transition-all duration-200 active:scale-95"
            >
              <span className="text-sm transition-transform duration-200 group-hover:scale-110">📷</span>
              <span>Scanner</span>
            </button>
          </div>

          <button
            type="button"
            onClick={onSend}
            className="w-8 h-8 rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-bold flex items-center justify-center text-xs transition shadow-md shadow-orange-500/20 active:scale-95"
          >
            ➔
          </button>
        </div>
      </div>
    </div>
  );
};
