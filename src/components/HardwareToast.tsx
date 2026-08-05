import React from 'react';
import { Bluetooth, Wifi, CheckCircle2, X, Sparkles, BatteryCharging } from 'lucide-react';
import { HardwarePenState } from '../types';

interface HardwareToastProps {
  penState: HardwarePenState;
  onClose: () => void;
  onSimulateStroke: () => void;
}

export const HardwareToast: React.FC<HardwareToastProps> = ({
  penState,
  onClose,
  onSimulateStroke,
}) => {
  return (
    <div className="fixed bottom-6 left-6 z-40 max-w-sm w-full animate-in slide-in-from-bottom-6 fade-in duration-300 select-none">
      <div className="p-4 rounded-2xl bg-[#FFFFFF] dark:bg-[#202024] border border-[#E8E4DC] dark:border-[#2D2D32] shadow-2xl relative overflow-hidden space-y-3">
        {/* Top bar Accent Line */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-[#D97757]" />

        <div className="flex items-start justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-[#D97757]/15 border border-[#D97757]/30 flex items-center justify-center text-[#D97757]">
              <Bluetooth className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-1.5">
                <span className="text-xs font-bold text-[#191919] dark:text-[#F3F3F3]">
                  Hardware Pen Synced
                </span>
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              </div>
              <p className="text-[11px] text-[#66635B] dark:text-[#A0A0AA] font-mono mt-0.5">
                Bluetooth 5.3 • {penState.batteryPercent}% Battery
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-md text-[#858075] hover:text-[#191919] dark:hover:text-[#F3F3F3] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-[#191919] dark:text-[#F3F3F3] leading-relaxed font-sans">
          Physical AI Pen Connected via Bluetooth 5.3. Ready to stream optical OCR highlights directly into workspace.
        </p>

        {penState.lastOCRText && (
          <div className="p-2.5 rounded-xl bg-[#F4F0E8] dark:bg-[#18181A] border border-[#E8E4DC] dark:border-[#2D2D32] text-[11px] font-mono text-[#52504A] dark:text-[#A0A0AA] truncate">
            <span className="text-[#D97757] font-bold mr-1">Last Stream:</span>
            {penState.lastOCRText}
          </div>
        )}

        <div className="flex items-center space-x-2 pt-1">
          <button
            onClick={onSimulateStroke}
            className="flex-1 py-1.5 px-3 rounded-xl bg-[#D97757] hover:bg-[#C05A3E] text-white text-xs font-bold flex items-center justify-center space-x-1.5 transition-all cursor-pointer shadow-xs"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Test Highlight Stream</span>
          </button>
        </div>
      </div>
    </div>
  );
};
