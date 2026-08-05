import React, { useState } from 'react';
import { FileText, ChevronDown, ChevronUp, Play, X, CheckCircle2, Sparkles } from 'lucide-react';
import { UploadedFile } from '../types';

interface Props {
  file: UploadedFile;
  onStartMarking: (file: UploadedFile) => void;
  onRemove: (file: UploadedFile) => void;
}

export const MobileDocumentCard: React.FC<Props> = ({ file, onStartMarking, onRemove }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="w-full max-w-sm bg-[#0f1013] border border-[#1a1a1d] rounded-2xl overflow-hidden shadow-sm">
      <div className="p-3 bg-[#111214] flex items-center justify-between border-b border-[#151516]">
        <div className="flex items-center gap-2 overflow-hidden">
          <div className="p-2 bg-[#D97757]/10 text-[#D97757] rounded-lg shrink-0">
            <FileText className="w-4 h-4" />
          </div>
          <div className="truncate">
            <p className="text-xs font-medium truncate">{file.name}</p>
            <p className="text-[10px] text-neutral-400">{file.fileType?.toUpperCase() || 'FILE'} • {file.rawText ? `${Math.min(1, (file.rawText.length/1000)).toFixed(0)}p` : '1 Page'} • Upload complete</p>
          </div>
        </div>

        <button
          onClick={() => setIsExpanded((s) => !s)}
          className="p-1.5 text-neutral-400 hover:text-white bg-transparent rounded-lg"
          aria-label={isExpanded ? 'Collapse' : 'Expand'}
        >
          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {isExpanded ? (
        <div className="relative w-full h-64 bg-black">
          {file.url ? (
            <iframe src={file.url} title={file.name} className="w-full h-full" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-neutral-400">Preview not available</div>
          )}

          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-[#0b0b0b]/90 border border-[#222] px-3 py-1.5 rounded-full shadow-lg">
            <button
              onClick={() => onStartMarking(file)}
              className="flex items-center gap-1.5 bg-[#D97757] hover:bg-[#c96b45] text-black text-[11px] px-3 py-1 rounded-full"
            >
              <Play className="w-3 h-3" />
              Start Marking
            </button>
            <div className="w-px h-4 bg-[#222]" />
            <button onClick={() => onRemove(file)} className="text-neutral-400 p-1">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      ) : (
        <div className="px-3 py-2 bg-[#0f1013] flex items-center justify-between">
          <span className="text-[10px] text-emerald-400 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> Ready to process
          </span>
          <button onClick={() => onStartMarking(file)} className="text-xs text-[#D97757] hover:text-amber-400 font-medium flex items-center gap-1">
            <Sparkles className="w-3 h-3" /> Start Marking
          </button>
        </div>
      )}
    </div>
  );
};

export default MobileDocumentCard;
