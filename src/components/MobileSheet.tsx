import React from 'react';
import { ArrowLeft, Camera } from 'lucide-react';

interface MobileSheetProps {
  title: string;
  onBack: () => void;
  onScan?: () => void;
  children: React.ReactNode;
}

export const MobileSheet: React.FC<MobileSheetProps> = ({
  title,
  onBack,
  onScan,
  children,
}) => {
  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-[#262624] text-[#FAF9F5] animate-in slide-in-from-right duration-200 motion-reduce:animate-none">
      {/* Header */}
      <header className="flex h-[calc(56px+env(safe-area-inset-top,0px))] shrink-0 items-center justify-between border-b border-white/[0.06] bg-[#212121]/95 px-3 pt-[env(safe-area-inset-top,0px)] backdrop-blur-md">
        <button
          type="button"
          onClick={onBack}
          className="flex h-11 w-11 items-center justify-center rounded-xl text-[#C2C0B6] hover:bg-white/10 hover:text-white transition-colors"
          aria-label="Back to chat"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>

        <h1 className="text-base font-semibold tracking-tight text-[#FAF9F5] truncate max-w-[200px]">
          {title}
        </h1>

        <div className="flex items-center">
          {onScan ? (
            <button
              type="button"
              onClick={onScan}
              className="flex h-11 w-11 items-center justify-center rounded-xl text-amber-400 hover:bg-amber-500/15 transition-colors"
              aria-label="Scan documents"
            >
              <Camera className="h-5 w-5" />
            </button>
          ) : (
            <div className="w-11" />
          )}
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto pb-[env(safe-area-inset-bottom,0px)]">
        {children}
      </div>
    </div>
  );
};
