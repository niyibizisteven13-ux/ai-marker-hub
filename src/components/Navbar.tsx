import React from 'react';
import { Bot, Sparkles, Sun, Moon, GraduationCap, CheckCircle2 } from 'lucide-react';

interface NavbarProps {
  darkMode: boolean;
  setDarkMode: (val: boolean) => void;
  activeExamTitle?: string;
  totalScriptsCount?: number;
  approvedCount?: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  darkMode,
  setDarkMode,
  activeExamTitle,
  totalScriptsCount = 0,
  approvedCount = 0,
}) => {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 dark:border-white/10 bg-white/90 dark:bg-[#0A1128]/90 backdrop-blur-md transition-colors duration-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
        
        {/* Brand */}
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-sm bg-[#0A1128] dark:bg-white flex items-center justify-center text-white dark:text-[#0A1128] shadow-md border border-cyan-400/30">
            <div className="w-5 h-5 border-2 border-current rotate-45 flex items-center justify-center">
              <div className="w-1.5 h-1.5 bg-current"></div>
            </div>
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-extrabold text-xl tracking-tight text-slate-900 dark:text-white uppercase font-sans">
                MARKER <span className="text-[#4CC9F0]">AI</span>
              </span>
              <span className="inline-flex items-center px-2 py-0.5 rounded-xs text-[10px] font-bold uppercase tracking-widest bg-cyan-500/10 text-[#4CC9F0] border border-[#4CC9F0]/30">
                <Sparkles className="w-3 h-3 mr-1 text-[#4CC9F0]" />
                EDU CORE
              </span>
            </div>
            <p className="text-[10px] uppercase tracking-widest text-slate-500 dark:text-white/40 hidden sm:block font-mono">
              Evidence-Based Assessment Engine
            </p>
          </div>
        </div>

        {/* Center Context Status */}
        {activeExamTitle && (
          <div className="hidden md:flex items-center space-x-3 bg-slate-100 dark:bg-white/[0.03] px-4 py-2 rounded-sm text-xs font-mono border border-slate-200 dark:border-white/10 text-slate-700 dark:text-white/80">
            <GraduationCap className="w-4 h-4 text-[#4CC9F0]" />
            <span className="truncate max-w-xs">{activeExamTitle}</span>
            {totalScriptsCount > 0 && (
              <span className="flex items-center space-x-1 pl-3 border-l border-slate-300 dark:border-white/10 text-[#4CC9F0]">
                <CheckCircle2 className="w-3.5 h-3.5 text-[#4CC9F0]" />
                <span>{approvedCount}/{totalScriptsCount} approved</span>
              </span>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center space-x-3">
          <button
            onClick={() => setDarkMode(!darkMode)}
            className="p-2.5 rounded-sm border border-slate-200 dark:border-white/10 text-slate-600 hover:text-slate-900 dark:text-white/70 dark:hover:text-[#4CC9F0] hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
            title="Toggle Light/Dark Theme"
          >
            {darkMode ? <Sun className="w-4 h-4 text-[#4CC9F0]" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>

      </div>
    </header>
  );
};

