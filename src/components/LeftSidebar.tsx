import React, { useState } from 'react';
import { Settings, GraduationCap, FilePlus, Award } from 'lucide-react';
import UserProfileButton from './UserProfileButton';
import { NavigationTab, User } from '../types';

interface LeftSidebarProps {
  activeTab: NavigationTab;
  setActiveTab: (tab: NavigationTab) => void;
  collapsed: boolean;
  setCollapsed: (val: boolean) => void;
  highlightsCount?: number;
  documentsCount?: number;
  decksCount?: number;
  onUploadStudentPaper?: (files: File[] | FileList | File) => void;
  onOpenScanner?: () => void;
  user: User | null;
  onOpenLoginModal: () => void;
  onOpenSettings: () => void;
  onLogout: () => void;
}

export const LeftSidebar: React.FC<LeftSidebarProps> = ({
  activeTab,
  setActiveTab,
  collapsed,
  setCollapsed,
  onUploadStudentPaper = () => {},
  onOpenScanner = () => {},
  onOpenLoginModal = () => {},
  onOpenSettings = () => {},
  onLogout = () => {},
  user = null,
}) => {
  const [showProfileMenu, setShowProfileMenu] = useState(false);

  const navItems = [
    {
      id: 'marking_hub' as NavigationTab,
      label: 'Marking Studio',
      icon: GraduationCap,
    },
    {
      id: 'documents' as NavigationTab,
      label: 'Create Assignment',
      icon: FilePlus,
    },
    {
      id: 'results' as NavigationTab,
      label: 'Results & Analytics',
      icon: Award,
    },
  ];

  return (
    <aside
      className={`relative flex flex-col justify-between h-auto max-h-none w-full bg-[#090C15] text-slate-100 border-r border-slate-800/70 transition-all duration-300 lg:h-[calc(100vh-61px)] ${
        collapsed ? 'lg:w-16' : 'lg:w-64'
      } shrink-0 select-none`}
    >
      <div className="space-y-5 p-3">
        <div className="flex items-center gap-3 p-3 rounded-2xl bg-[#0D111A] border border-slate-800/80 shadow-sm">
          <div className="w-10 h-10 rounded-xl bg-orange-500/15 border border-orange-500/30 flex items-center justify-center text-orange-400 font-bold text-sm shrink-0">
            BW
          </div>
          {!collapsed && (
            <div className="flex flex-col text-left">
              <span className="text-xs font-bold text-slate-100 tracking-wide">Bwenge Studio</span>
              <span className="text-[10px] text-slate-500 font-medium">AI Marking Suite</span>
            </div>
          )}
        </div>

        <nav className="space-y-1">
          <span className="px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Workspace
          </span>
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl text-xs font-medium transition-all duration-150 ${
                  isActive
                    ? 'bg-slate-900/90 text-orange-400 border border-slate-700/70 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                }`}
              >
                <Icon className="w-4 h-4" />
                {!collapsed && <span>{item.label}</span>}
              </button>
            );
          })}
        </nav>
      </div>

      {!collapsed && (
        <div className="space-y-3 p-3 border-t border-slate-800/70">
          <button
            type="button"
            onClick={onOpenSettings}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-2xl text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 transition-all"
          >
            <Settings className="w-4 h-4" />
            <span>Settings</span>
          </button>

          <div className="relative">
            <UserProfileButton
              user={user ? { name: user.name, email: user.email, avatarUrl: user.avatarUrl } : null}
              onClick={() => {
                if (!user) {
                  onOpenLoginModal();
                } else {
                  setShowProfileMenu((value) => !value);
                }
              }}
            />

            {user && showProfileMenu && (
              <div className="absolute left-0 bottom-20 w-full rounded-2xl border border-slate-800/80 bg-[#0D111A] shadow-2xl p-1.5 z-20">
                <button
                  type="button"
                  onClick={() => {
                    setShowProfileMenu(false);
                    onOpenSettings();
                  }}
                  className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-slate-800 rounded-xl transition"
                >
                  Account Profile
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowProfileMenu(false);
                    onLogout();
                  }}
                  className="w-full text-left px-3 py-2 text-xs text-rose-400 hover:bg-rose-500/10 rounded-xl transition"
                >
                  Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </aside>
  );
};
