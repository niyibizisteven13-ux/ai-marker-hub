import React, { useState, useEffect, useRef } from 'react';
import { MoreVertical, GraduationCap, FilePlus, Award, Plus, Settings, FileOutput, Trash2, Instagram, Upload, Eye, FileText, Download, Share2, Star, Building2 } from 'lucide-react';
import logoUrl from '../assets/bwenge-logo.svg';
import { NavigationTab, User } from '../types';

interface TopNavbarProps {
  activeTab?: NavigationTab;
  setActiveTab?: (val: NavigationTab) => void;
  onNewChat?: () => void;
  onOpenSettings?: () => void;
  onDeleteChat?: () => void;
  onExportChat?: () => void;
  onShare?: () => void;
  activeFormId?: string | null;
  user: User | null;
}

export const TopNavbar: React.FC<TopNavbarProps> = ({
  activeTab,
  setActiveTab,
  onNewChat,
  onOpenSettings,
  onDeleteChat,
  onExportChat,
  onShare,
  activeFormId,
  user,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const mobileNavItems: Array<{ id: NavigationTab; label: string; icon: typeof GraduationCap }> = [
    { id: 'marking_hub', label: 'Marking', icon: GraduationCap },
    { id: 'documents', label: 'Create', icon: FilePlus },
    { id: 'results', label: 'Results', icon: Award },
  ];

  // Handle click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <header className="flex-shrink-0 w-full bg-transparent px-4 py-2.5 transition-colors duration-200">
      <div className="max-w-[1800px] mx-auto flex items-center justify-between">
        {/* Left: Brand logo (Visible on mobile/when sidebar is hidden) */}
        <div className="flex items-center gap-3 opacity-0 pointer-events-none md:opacity-100 md:pointer-events-auto">
          <div className="w-8 h-8 rounded-xl bg-[#0D2B24] flex items-center justify-center overflow-hidden shrink-0">
            <svg viewBox="0 0 220 220" className="w-full h-full">
              <circle cx="110" cy="110" r="110" fill="#0D2B24"/>
              <g transform="translate(110,110)">
                <circle cx="-32" cy="-10" r="26" fill="#5DCAA5"/>
                <circle cx="32" cy="-10" r="26" fill="#5DCAA5"/>
              </g>
            </svg>
          </div>
          <span className="hidden sm:block text-sm font-bold tracking-tight text-slate-900 dark:text-slate-100">Bwenge Studio</span>
        </div>

        {/* Right: Workspace Controls */}
        <div className="flex items-center gap-3">
          {user?.subscription && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-white/[0.03] border border-white/5 rounded-lg">
              {user.subscription.planType === 'BUSINESS' ? (
                <>
                  <Star size={12} className="text-amber-500 fill-amber-500" />
                  <span className="text-[10px] font-bold text-amber-500 uppercase tracking-widest">Business Pro</span>
                </>
              ) : (
                <>
                  <Building2 size={12} className="text-indigo-400" />
                  <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest">Institution</span>
                </>
              )}
            </div>
          )}

          {/* FIX 1: Swapped out 'New Chat' button. Replaced with premium 'Upgrade' action layout anchor */}
          {!user?.subscription && (
            <button
              onClick={() => (window as any).openUpgradeModal?.()}
              className="bg-gradient-to-r from-amber-500/20 to-orange-600/10 hover:from-amber-500/30 hover:to-orange-600/20 text-amber-400 font-medium px-3 py-1.5 rounded-xl border border-amber-500/30 text-xs transition-all shadow-md shadow-orange-950/20 flex items-center gap-1.5"
            >
              <span className="text-amber-400">⭐</span>
              <span>Upgrade</span>
            </button>
          )}

          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((prev) => !prev)}
              className="p-1.5 rounded-xl text-neutral-500 hover:text-neutral-200 transition-colors focus:outline-none"
              title="More options"
            >
              <MoreVertical className="w-4 h-4" />
            </button>

            {menuOpen && (
              <div className="absolute right-0 mt-2 w-52 bg-[#1a1a1a] border border-neutral-800 rounded-xl shadow-2xl z-50 py-1 text-xs text-neutral-300 antialiased animate-in fade-in slide-in-from-top-1 duration-200">
                <button
                  onClick={() => {
                    if (activeFormId) {
                      onShare?.();
                    }
                    setMenuOpen(false);
                  }}
                  disabled={!activeFormId}
                  className={`w-full flex items-center px-3 py-2.5 transition-colors text-left ${
                    activeFormId
                      ? 'hover:bg-neutral-800 hover:text-white text-emerald-400'
                      : 'opacity-40 cursor-not-allowed'
                  }`}
                >
                  <Share2 className="mr-3 w-4 h-4" />
                  {activeFormId ? 'Share USSD Instructions' : 'Share (create form first)'}
                </button>
                <div className="border-t border-neutral-800/80 my-1"></div>
                <button
                  onClick={() => setMenuOpen(false)}
                  className="w-full flex items-center px-3 py-2.5 hover:bg-neutral-800 hover:text-white transition-colors text-left"
                >
                  <Eye className="mr-3 w-4 h-4" /> View Metadata Details
                </button>
                <button
                  onClick={() => setMenuOpen(false)}
                  className="w-full flex items-center px-3 py-2.5 hover:bg-neutral-800 hover:text-white transition-colors text-left"
                >
                  <FileText className="mr-3 w-4 h-4" /> Set Grading Rubric
                </button>
                <button
                  onClick={() => {
                    onExportChat?.();
                    setMenuOpen(false);
                  }}
                  className="w-full flex items-center px-3 py-2.5 hover:bg-neutral-800 hover:text-white transition-colors text-left"
                >
                  <Download className="mr-3 w-4 h-4" /> Export Chat (Markdown)
                </button>
                <div className="border-t border-neutral-800/80 my-1"></div>
                <button
                  onClick={() => {
                    onDeleteChat?.();
                    setMenuOpen(false);
                  }}
                  className="w-full flex items-center px-3 py-2.5 hover:bg-neutral-800 text-rose-400 transition-colors text-left"
                >
                  <Trash2 className="mr-3 w-4 h-4" /> Clear All Messages
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};

