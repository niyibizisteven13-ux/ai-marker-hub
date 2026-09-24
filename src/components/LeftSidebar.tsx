import React, { useState } from 'react';
import {
  Plus,
  X,
  Star,
  Settings,
  Trash2,
  Building2,
  Zap
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
      id: 'marking_hub' as NavigationTab,
      label: 'Studio Dashboard',
      emoji: '🎛️',
    },
    {
      id: 'documents' as NavigationTab,
      label: 'Create Content',
      emoji: '✨',
    },
    {
      id: 'results' as NavigationTab,
      label: 'Analytics Engine',
      emoji: '📊',
    },
  ];

  return (
    <aside
      className={`fixed md:static inset-y-0 left-0 z-50 flex flex-col h-screen transition-all duration-300 ease-in-out border-r shrink-0 select-none ${
        isMobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
      } ${
        collapsed ? 'md:w-16' : 'md:w-64'
      } w-64`}
      style={{ backgroundColor: tokens.bgSidebar, borderColor: tokens.border }}
    >
      <div className="flex flex-col h-full overflow-hidden">
        {/* Top Header: Branding & Toggle */}
        <div className={`flex items-center px-4 h-16 shrink-0 ${collapsed ? 'md:justify-center' : 'justify-between'} justify-between`}>
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 flex-shrink-0">
              <svg viewBox="0 0 220 220" className="w-full h-full">
                <circle cx="110" cy="110" r="110" fill="#0D2B24"/>
                <g transform="translate(110,110)">
                  <circle cx="-32" cy="-10" r="26" fill="#5DCAA5"/>
                  <circle cx="32" cy="-10" r="26" fill="#5DCAA5"/>
                </g>
              </svg>
            </div>
            <span className={`font-serif text-base tracking-tight text-white font-medium ${collapsed ? 'md:hidden' : 'block'}`}>Bwenge</span>
          </div>

          <div className="flex items-center">
            {/* Minimal Layout Split Toggler Icon */}
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="hidden md:block p-1 text-neutral-500 hover:text-neutral-200 rounded transition-colors"
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
              className="md:hidden p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/5 transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Action Operational Trigger Button */}
        <div className="px-4 mb-4">
          <button
            onClick={onNewChat}
            className={`w-full flex items-center justify-center space-x-2 py-2 bg-[#222222] hover:bg-neutral-800 text-neutral-200 hover:text-white rounded-xl text-sm font-medium border border-neutral-800/80 transition-colors ${collapsed ? 'px-0' : ''}`}
          >
            <span>➕</span>
            {!collapsed && <span>New Chat</span>}
          </button>
        </div>

        {/* Navigation Items */}
        <nav className={`flex-1 px-3 space-y-0.5 py-2 overflow-y-auto ${collapsed ? 'md:flex md:flex-col md:items-center' : ''}`}>
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <div key={item.id} className="relative group w-full flex justify-center">
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab(item.id);
                    onCloseMobile();
                  }}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
                    collapsed ? 'md:w-10 md:h-10 md:justify-center' : 'w-full'
                  } ${
                    isActive
                      ? 'bg-[#262626] text-white font-medium shadow-sm border border-white/5'
                      : 'text-[#9B9B9B] hover:bg-[#222222] hover:text-white'
                  }`}
                >
                  <span className={`text-base ${isActive ? 'opacity-100' : 'opacity-70'}`}>{item.emoji}</span>
                  <span className={`${collapsed ? 'md:hidden' : 'block'}`}>{item.label}</span>
                </button>

                {collapsed && (
                  <div className="absolute left-14 top-1/2 -translate-y-1/2 bg-neutral-900 text-white text-[11px] px-2.5 py-1.5 rounded-lg shadow-xl opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap hidden md:block z-50 pointer-events-none font-semibold">
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
              <div className="space-y-0.5 max-h-48 overflow-y-auto pr-1 scrollbar-hidden">
                {sessions.map((session) => (
                  <div key={session.id} className="group relative flex items-center">
                    <button
                      onClick={() => onLoadSession(session.id)}
                      className="flex-1 flex items-center gap-3 px-3 py-1.5 rounded-md hover:bg-[#222222] text-[#9B9B9B] hover:text-white truncate text-xs transition-colors text-left"
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
                        className="absolute right-2 opacity-0 group-hover:opacity-100 p-1 text-neutral-600 hover:text-rose-400 transition-all"
                        title="Delete chat"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </nav>

        {/* Bottom Section: Settings & Profile */}
        <div className={`p-3 border-t border-neutral-900 space-y-1 shrink-0 ${collapsed ? 'md:flex md:flex-col md:items-center' : ''}`}>

          <div className="relative group w-full flex justify-center">
            <button
              type="button"
              onClick={onOpenSettings}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium text-[#9B9B9B] hover:bg-[#222222] hover:text-white transition-all ${
                collapsed ? 'md:w-10 md:h-10 md:justify-center' : 'w-full'
              }`}
            >
              <span className="text-base opacity-70">⚙️</span>
              <span className={`${collapsed ? 'md:hidden' : 'block'}`}>Settings</span>
            </button>
            {collapsed && (
              <div className="absolute left-14 top-1/2 -translate-y-1/2 bg-neutral-900 text-white text-[11px] px-2.5 py-1.5 rounded-lg shadow-xl opacity-0 group-hover:opacity-100 transition-opacity hidden md:block whitespace-nowrap z-50 pointer-events-none font-semibold">
                Settings
                <div className="absolute left-0 top-1/2 -translate-x-1 -translate-y-1/2 w-2 h-2 bg-neutral-900 rotate-45" />
              </div>
            )}
          </div>

          <div className="relative group w-full flex justify-center">
            <button
              onClick={() => {
                if (!user) onOpenLoginModal();
                else setShowProfileMenu(!showProfileMenu);
              }}
              className={`flex items-center gap-2 px-2 py-3 rounded-lg text-xs font-medium text-[#9B9B9B] hover:bg-[#222222] hover:text-white transition-all ${
                collapsed ? 'md:w-10 md:h-10 md:justify-center' : 'w-full'
              }`}
            >
              <div className="w-6 h-6 rounded-full bg-emerald-800 text-white flex items-center justify-center font-bold shrink-0 relative">
                {user ? user.name.charAt(0).toUpperCase() : 'N'}
                {user?.subscription && (
                  <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-amber-500 rounded-full border border-neutral-900" />
                )}
              </div>
              {!collapsed && (
                <div className="flex flex-col items-start min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 w-full">
                    <span className="text-neutral-300 font-medium truncate">
                      {user ? user.email : 'niyibizi00003@gmail.com'}
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
              <div className="absolute left-14 top-1/2 -translate-y-1/2 bg-neutral-900 text-white text-[11px] px-2.5 py-1.5 rounded-lg shadow-xl opacity-0 group-hover:opacity-100 transition-opacity hidden md:block whitespace-nowrap z-50 pointer-events-none font-semibold">
                {user ? user.name : 'Sign In'}
                <div className="absolute left-0 top-1/2 -translate-x-1 -translate-y-1/2 w-2 h-2 bg-neutral-900 rotate-45" />
              </div>
            )}

            {user && showProfileMenu && (
              <div
                className={`absolute ${collapsed ? 'md:left-16 bottom-0' : 'left-full bottom-0 ml-2'} w-48 rounded-xl border border-white/10 bg-neutral-900 shadow-2xl p-1.5 z-50 animate-in fade-in slide-in-from-left-2 duration-200`}
              >
                <button
                  type="button"
                  onClick={() => {
                    setShowProfileMenu(false);
                    onOpenSettings();
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
                  }}
                  className="w-full text-left px-3 py-2 text-xs font-medium text-rose-400 hover:bg-rose-50 rounded-lg transition"
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



