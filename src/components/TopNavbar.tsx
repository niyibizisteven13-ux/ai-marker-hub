import React, { useState } from 'react';
import { MoreVertical, GraduationCap, FilePlus, Award } from 'lucide-react';
import logoUrl from '../assets/bwenge-logo.svg';
import { HardwarePenState, NavigationTab } from '../types';

interface TopNavbarProps {
  activeTab?: NavigationTab;
  setActiveTab?: (val: NavigationTab) => void;
}

export const TopNavbar: React.FC<TopNavbarProps> = ({
  activeTab,
  setActiveTab,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const mobileNavItems: Array<{ id: NavigationTab; label: string; icon: typeof GraduationCap }> = [
    { id: 'marking_hub', label: 'Marking', icon: GraduationCap },
    { id: 'documents', label: 'Create', icon: FilePlus },
    { id: 'results', label: 'Results', icon: Award },
  ];

  return (
    <header className="sticky top-0 z-30 w-full bg-[#FBF9F6] dark:bg-[#141416] border-b border-[#E8E4DC] dark:border-[#2D2D32] px-1.5 py-1.5 sm:px-4 sm:py-3 transition-colors duration-200">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-1.5 sm:gap-4">
        {/* Left: Brand logo & Title */}
        <div className="flex items-center space-x-2 sm:space-x-3">
          <img src={logoUrl} alt="Bwenge AI logo" className="w-8 h-8 rounded-xl shadow-xs object-cover shrink-0" />
        </div>

        {/* Right: mobile menu only */}
        <div className="flex items-center space-x-1.5 sm:space-x-3">
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((prev) => !prev)}
              className="rounded-xl border border-[#E8E4DC] bg-[#F4F0E8] p-1.5 sm:p-2 text-[#52504A] transition hover:border-[#D97757] hover:text-[#D97757] dark:border-[#2D2D32] dark:bg-[#1C1C1F] dark:text-[#A0A0AA]"
              aria-label="Toggle navigation menu"
            >
              <MoreVertical className="h-4 w-4" />
            </button>

            {menuOpen && (
              <div className="absolute right-0 mt-2 w-44 rounded-2xl border border-[#E8E4DC] bg-[#FFFFFF] p-1.5 shadow-xl dark:border-[#2D2D32] dark:bg-[#202024]">
                {mobileNavItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setActiveTab?.(item.id);
                        setMenuOpen(false);
                      }}
                      className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-semibold transition ${
                        isActive ? 'bg-[#F4F0E8] text-[#D97757] dark:bg-[#2D2D32]' : 'text-[#191919] hover:bg-[#E8E4DC] dark:text-[#F3F3F3] dark:hover:bg-[#25252A]'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

        </div>
      </div>
    </header>
  );
};
