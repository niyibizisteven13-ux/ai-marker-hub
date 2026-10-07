import React, { useState } from 'react';
import {
  Plus,
  X,
  Star,
  Settings,
  Trash2,
  Building2,
  Zap,
  MessageSquare,
  GraduationCap,
  BarChart3,
  Shield,
} from 'lucide-react';
import { NavigationTab, User, ChatSession } from '../types';
import logoUrl from '../assets/bwenge-logo.svg';
import { tokens } from '../utils/designTokens';

interface LeftSidebarProps {
  activeTab: NavigationTab;
  setActiveTab: (tab: NavigationTab) => void;
  collapsed: boolean;
  setCollapsed: (val: boolean) => void;
  onOpenLoginModal: () => void;
  onOpenSettings: () => void;
  onOpenAdmin?: () => void;
  onLogout: () => void;
  user: User | null;
  sessions: ChatSession[];
  onLoadSession: (id: string) => void;
  onNewChat: () => void;
  onDeleteSession?: (id: string) => void;
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
}

export const LeftSidebar: React.FC<LeftSidebarProps> = ({
  activeTab,
  setActiveTab,
  collapsed,
  setCollapsed,
  onOpenLoginModal = () => {},
  onOpenSettings = () => {},
  onOpenAdmin,
  onLogout = () => {},
  user = null,
  sessions = [],
  onLoadSession,
  onNewChat,
  onDeleteSession,
  isMobileOpen = false,
  onCloseMobile = () => {},
}) => {
  const [showProfileMenu, setShowProfileMenu] = useState(false);

  const navItems = [
    {
      id: 'documents' as NavigationTab,
      label: 'Chat',
      icon: MessageSquare,
    },
    {
      id: 'marking_hub' as NavigationTab,
      label: 'Marking',
      icon: GraduationCap,
    },
    {
      id: 'results' as NavigationTab,
      label: 'Results',
      icon: BarChart3,
    },
  ];

  return (
    <aside
      className={`fixed lg:static inset-y-0 left-0 z-50 flex flex-col h-dvh lg:h-screen transition-all duration-300 ease-in-out motion-reduce:transition-none border-r shrink-0 select-none ${
        isMobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
      } ${
        collapsed ? 'lg:w-16' : 'lg:w-64'
      } w-[86vw] max-w-[300px] lg:w-64`}
      style={{ backgroundColor: tokens.bgSidebar, borderColor: tokens.border }}
    >
      <div className="flex flex-col h-full overflow-hidden pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)]">
        {/* Top Header: Branding & Toggle */}
        <div className={`flex items-center px-4 h-16 shrink-0 ${collapsed ? 'lg:justify-center' : 'justify-between'} justify-between`}>
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 flex-shrink-0 rounded-lg overflow-hidden border border-amber-500/20 shadow-md">
              <img src={logoUrl} alt="Bwenge Logo" className="w-full h-full object-cover" />
            </div>
            <span className={`font-serif text-base tracking-tight text-white font-medium ${collapsed ? 'lg:hidden' : 'block'}`}>Bwenge</span>
          </div>

          <div className="flex items-center">
            {/* Minimal Layout Split Toggler Icon */}
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="hidden lg:block p-1 text-neutral-500 hover:text-neutral-200 rounded transition-colors"
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <rect x="3" y="3" width="18" height="18" rx="2"></rect>
                <path d="M9 3v18"></path>
              </svg>
            </button>

            {/* Mobile Close Button */}
            <button
              onClick={onCloseMobile}
              className="lg:hidden h-11 w-11 grid place-items-center rounded-lg text-neutral-400 hover:text-white hover:bg-white/5 transition-colors"
              aria-label="Close navigation drawer"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Action Operational Trigger Button */}
        <div className="px-4 mb-4">
          <button
            onClick={() => {
              onNewChat();
              onCloseMobile();
            }}
            className={`w-full flex items-center justify-center space-x-2 py-2.5 lg:py-2 bg-[#222222] hover:bg-neutral-800 text-neutral-200 hover:text-white rounded-xl text-sm font-medium border border-neutral-800/80 transition-colors ${collapsed ? 'px-0' : ''}`}
          >
            <span>➕</span>
            {!collapsed && <span>New Chat</span>}
          </button>
        </div>

        {/* Navigation Items */}
        <nav className={`flex-1 px-3 space-y-1 py-2 overflow-y-auto ${collapsed ? 'lg:flex lg:flex-col lg:items-center' : ''}`}>
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            const Icon = item.icon;
            return (
              <div key={item.id} className="relative group w-full flex justify-center">
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab(item.id);
                    onCloseMobile();
                  }}
                  className={`flex items-center gap-3 px-3 py-2.5 text-[15px] lg:py-2 lg:text-sm rounded-lg transition-all duration-200 ${
                    collapsed ? 'lg:w-10 lg:h-10 lg:justify-center' : 'w-full'
                  } ${
                    isActive
                      ? 'bg-[#262626] text-white font-medium shadow-sm border border-white/5'
                      : 'text-[#9B9B9B] hover:bg-[#222222] hover:text-white'
                  }`}
                >
                  <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'opacity-150 text-emerald-400' : 'opacity-70'}`} />
                  <span className={`${collapsed ? 'lg:hidden' : 'block'}`}>{item.label}</span>
                </button>

                {collapsed && (
                  <div className="absolute left-14 top-1/2 -translate-y-1/2 bg-neutral-900 text-white text-[11px] px-2.5 py-1.5 rounded-lg shadow-xl opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap hidden lg:block z-50 pointer-events-none font-semibold">
                    {item.label}
                    <div className="absolute left-0 top-1/2 -translate-x-1 -translate-y-1/2 w-2 h-2 bg-neutral-900 rotate-45" />
                  </div>
                )}
              </div>
            );
          })}

          {!collapsed && sessions.length > 0 && (
            <div className="animate-in fade-in duration-500">
              <div className="pt-5 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-600 px-3 flex items-center justify-between">
                <span>Recent Chats</span>
                <span className="text-xs opacity-40">↕</span>
              </div>
              <div className="space-y-0.5 lg:max-h-48 overflow-y-auto pr-1 scrollbar-hidden">
                {sessions.map((session) => (
                  <div key={session.id} className="group relative flex items-center">
                    <button
                      onClick={() => {
                        onLoadSession(session.id);
                        onCloseMobile();
                      }}
                      className="flex-1 flex items-center gap-3 px-3 py-2 rounded-md hover:bg-[#222222] text-[#9B9B9B] hover:text-white truncate text-xs transition-colors text-left min-h-[36px]"
                    >
                      <span className="opacity-60 text-sm">💬</span>
                      <span className="truncate">{session.title}</span>
                    </button>
                    {onDeleteSession && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteSession(session.id);
                        }}
                        className="absolute right-2 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 h-9 w-9 flex items-center justify-center text-neutral-500 hover:text-rose-400 transition-all"
                        title="Delete chat"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </nav>

        {/* Bottom Section: Settings & Profile */}
        <div className={`p-3 border-t border-neutral-900 space-y-1 shrink-0 ${collapsed ? 'lg:flex lg:flex-col lg:items-center' : ''}`}>

          <div className="relative group w-full flex justify-center">
            <button
              type="button"
              onClick={() => {
                onOpenSettings();
                onCloseMobile();
              }}
              className={`flex items-center gap-3 px-3 py-2.5 lg:py-2 rounded-lg text-xs font-medium text-[#9B9B9B] hover:bg-[#222222] hover:text-white transition-all ${
                collapsed ? 'lg:w-10 lg:h-10 lg:justify-center' : 'w-full'
              }`}
            >
              <Settings className="h-4 w-4 shrink-0 opacity-70" />
              <span className={`${collapsed ? 'lg:hidden' : 'block'}`}>Settings</span>
            </button>
            {collapsed && (
              <div className="absolute left-14 top-1/2 -translate-y-1/2 bg-neutral-900 text-white text-[11px] px-2.5 py-1.5 rounded-lg shadow-xl opacity-0 group-hover:opacity-100 transition-opacity hidden lg:block whitespace-nowrap z-50 pointer-events-none font-semibold">
                Settings
                <div className="absolute left-0 top-1/2 -translate-x-1 -translate-y-1/2 w-2 h-2 bg-neutral-900 rotate-45" />
              </div>
            )}
          </div>

          {user?.role === 'ADMIN' && onOpenAdmin && (
            <div className="relative group w-full flex justify-center">
              <button
                type="button"
                onClick={() => {
                  onOpenAdmin();
                  onCloseMobile();
                }}
                className={`flex items-center gap-3 rounded-lg border border-emerald-500/15 bg-emerald-500/[0.06] px-3 py-2.5 text-xs font-medium text-emerald-300 transition-all hover:bg-emerald-500/10 ${
                  collapsed ? 'lg:h-10 lg:w-10 lg:justify-center' : 'w-full'
                }`}
                aria-label="Open admin dashboard"
              >
                <Shield className="h-4 w-4 shrink-0" />
                <span className={`${collapsed ? 'lg:hidden' : 'block'}`}>Admin Dashboard</span>
              </button>
              {collapsed && (
                <div className="pointer-events-none absolute left-14 top-1/2 z-50 hidden -translate-y-1/2 whitespace-nowrap rounded-lg bg-neutral-900 px-2.5 py-1.5 text-[11px] font-semibold text-white opacity-0 shadow-xl transition-opacity group-hover:opacity-100 lg:block">
                  Admin Dashboard
                </div>
              )}
            </div>
          )}

          <div className="relative group w-full flex justify-center">
            <button
              onClick={() => {
                if (!user) {
                  onOpenLoginModal();
                  onCloseMobile();
                } else {
                  setShowProfileMenu(!showProfileMenu);
                }
              }}
              className={`flex items-center gap-2 px-2 py-3 rounded-lg text-xs font-medium text-[#9B9B9B] hover:bg-[#222222] hover:text-white transition-all ${
                collapsed ? 'lg:w-10 lg:h-10 lg:justify-center' : 'w-full'
              }`}
            >
              <div className="w-6 h-6 rounded-full bg-emerald-800 text-white flex items-center justify-center font-bold shrink-0 relative">
                {user ? user.name.charAt(0).toUpperCase() : 'S'}
                {user?.subscription && (
                  <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-amber-500 rounded-full border border-neutral-900" />
                )}
              </div>
              {!collapsed && (
                <div className="flex flex-col items-start min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 w-full">
                    <span className="text-neutral-300 font-medium truncate">
                      {user ? user.email : 'Sign in'}
                    </span>
                    {user?.subscription?.planType === 'BUSINESS' && (
                      <span className="shrink-0 px-1 py-0.5 bg-amber-500/10 text-amber-500 text-[8px] font-black rounded border border-amber-500/20 tracking-tighter">PRO</span>
                    )}
                    {user?.subscription?.planType === 'ORGANIZATION' && (
                      <span className="shrink-0 px-1 py-0.5 bg-indigo-500/10 text-indigo-400 text-[8px] font-black rounded border border-indigo-500/20 tracking-tighter">ORG</span>
                    )}
                  </div>
                </div>
              )}
            </button>

            {/* Collapsed Profile Tooltip */}
            {collapsed && (
              <div className="absolute left-14 top-1/2 -translate-y-1/2 bg-neutral-900 text-white text-[11px] px-2.5 py-1.5 rounded-lg shadow-xl opacity-0 group-hover:opacity-100 transition-opacity hidden lg:block whitespace-nowrap z-50 pointer-events-none font-semibold">
                {user ? user.name : 'Sign In'}
                <div className="absolute left-0 top-1/2 -translate-x-1 -translate-y-1/2 w-2 h-2 bg-neutral-900 rotate-45" />
              </div>
            )}

            {user && showProfileMenu && (
              <div
                className={`absolute ${collapsed ? 'lg:left-16 bottom-0' : 'left-full bottom-0 ml-2'} w-48 rounded-xl border border-white/10 bg-neutral-900 shadow-2xl p-1.5 z-50 animate-in fade-in slide-in-from-left-2 duration-200`}
              >
                <button
                  type="button"
                  onClick={() => {
                    setShowProfileMenu(false);
                    onOpenSettings();
                    onCloseMobile();
                  }}
                  className="w-full text-left px-3 py-2 text-xs font-medium text-neutral-300 hover:bg-white/5 rounded-lg transition"
                >
                  Account Profile
                </button>
                <div className="my-1 border-t" style={{ borderColor: tokens.border }} />
                <button
                  type="button"
                  onClick={() => {
                    setShowProfileMenu(false);
                    onLogout();
                    onCloseMobile();
                  }}
                  className="w-full text-left px-3 py-2 text-xs font-medium text-rose-400 hover:bg-rose-500/10 rounded-lg transition"
                >
                  Sign Out
                </button>
              </div>
            )}
          </div>
        </div>

      </div>
    </aside>
  );
};
