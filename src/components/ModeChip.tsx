import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { CHAT_MODES, ChatMode } from '../config/modes';

interface ModeChipProps {
  selectedMode: string;
  onModeChange: (modeId: string) => void;
  isAdmin?: boolean;
}

export const ModeChip: React.FC<ModeChipProps> = ({
  selectedMode,
  onModeChange,
  isAdmin = false,
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const currentMode = CHAT_MODES.find((m) => m.id === selectedMode) || CHAT_MODES[0];

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener('mousedown', handleOutside);
    }
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-2)] text-xs font-semibold text-[var(--text)] hover:bg-[var(--hover)] transition-colors min-h-[36px]"
        title={isAdmin ? `Router hint: ${currentMode.routerHint}` : 'Select chat mode'}
      >
        <span className="w-2 h-2 rounded-full bg-[var(--teal)]" />
        <span>{currentMode.shortLabel}</span>
        <ChevronDown className="w-3.5 h-3.5 opacity-60" />
      </button>

      {open && (
        <div className="absolute left-0 sm:left-auto sm:right-0 mt-2 w-52 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-1 shadow-2xl z-50 animate-in fade-in slide-in-from-top-2 duration-150">
          {CHAT_MODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              onClick={() => {
                onModeChange(mode.id);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-medium transition-colors ${
                selectedMode === mode.id
                  ? 'bg-[var(--surface-2)] text-[var(--text)] font-bold'
                  : 'text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]'
              }`}
            >
              <div className="flex items-center justify-between">
                <span>{mode.shortLabel}</span>
                {isAdmin && <span className="text-[10px] opacity-50">{mode.routerHint}</span>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
