import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  Settings,
  Trash2,
  MessageSquare,
  GraduationCap,
  BarChart3,
  Shield,
  FolderOpen,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  SquarePen,
  ChevronsUpDown,
  LogOut,
  UserRound,
  LogIn,
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
  /** Opens the "My files" library of AI-generated outputs. */
  onOpenLibrary?: () => void;
  onLogout: () => void;
  user: User | null;
  sessions: ChatSession[];
  onLoadSession: (id: string) => void;
  onNewChat: () => void;
  onDeleteSession?: (id: string) => void;
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
}

const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D97757]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#1F1E1D]';

/** Label shown beside an icon-only control when the desktop sidebar is collapsed. */
const CollapsedTip: React.FC<{ show: boolean; label: string }> = ({ show, label }) =>
  show ? (
    <span
      role="tooltip"
      className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 hidden -translate-y-1/2 whitespace-nowrap rounded-md border border-white/10 bg-[#141413] px-2.5 py-1.5 text-xs font-medium text-white opacity-0 shadow-xl transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 lg:block"
    >
      {label}
    </span>
  ) : null;

/** Groups chats by recency: Today, Yesterday, Previous 7 days, Previous 30 days, Older. */
function groupSessions(sessions: ChatSession[]): { label: string; items: ChatSession[] }[] {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const day = 86_400_000;
  const buckets: [string, number][] = [
    ['Today', startOfToday.getTime()],
    ['Yesterday', startOfToday.getTime() - day],
    ['Previous 7 days', startOfToday.getTime() - 7 * day],
    ['Previous 30 days', startOfToday.getTime() - 30 * day],
    ['Older', -Infinity],
  ];
  const groups = new Map<string, ChatSession[]>(buckets.map(([label]) => [label, []]));
  for (const s of sessions) {
    const t = Date.parse(s.date);
    const label = Number.isNaN(t) ? 'Older' : buckets.find(([, from]) => t >= from)![0];
    groups.get(label)!.push(s);
  }
  return [...groups].filter(([, items]) => items.length).map(([label, items]) => ({ label, items }));
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

const PLAN_BADGE: Record<string, { label: string; className: string }> = {
  BUSINESS: { label: 'Pro', className: 'border-amber-400/25 bg-amber-400/10 text-amber-300' },
  PRO: { label: 'Pro', className: 'border-amber-400/25 bg-amber-400/10 text-amber-300' },
  ORGANIZATION: { label: 'Org', className: 'border-indigo-400/25 bg-indigo-400/10 text-indigo-300' },
};

export const LeftSidebar: React.FC<LeftSidebarProps> = ({
  activeTab,
  setActiveTab,
  collapsed,
  setCollapsed,
  onOpenLoginModal = () => {},
  onOpenSettings = () => {},
  onOpenAdmin,
  onOpenLibrary,
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
  const [query, setQuery] = useState('');
  const profileRef = useRef<HTMLDivElement>(null);

  // The mobile drawer always shows the full layout; "collapsed" only applies on desktop.
  const c = collapsed;

  useEffect(() => {
    if (!showProfileMenu) return;
    const onDown = (e: MouseEvent) => {
      if (!profileRef.current?.contains(e.target as Node)) setShowProfileMenu(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setShowProfileMenu(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [showProfileMenu]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return groupSessions(q ? sessions.filter((s) => s.title.toLowerCase().includes(q)) : sessions);
  }, [sessions, query]);

  const navItems: { id: NavigationTab; label: string; icon: React.ElementType }[] = [
    { id: 'documents', label: 'Chat', icon: MessageSquare },
    { id: 'marking_hub', label: 'Agent', icon: GraduationCap },
    { id: 'results', label: 'Results', icon: BarChart3 },
  ];

  const go = (fn: () => void) => () => {
    fn();
    onCloseMobile();
  };

  const rowBase = `group/row relative flex items-center gap-3 rounded-lg text-[15px] lg:text-[13.5px] transition-colors duration-150 ${FOCUS_RING}`;
  const rowSize = c ? 'h-10 w-full px-3 lg:w-10 lg:justify-center lg:px-0' : 'h-10 w-full px-3 lg:h-9';
  const label = c ? 'truncate lg:hidden' : 'truncate';
  const plan = user?.subscription?.planType ? PLAN_BADGE[user.subscription.planType] : undefined;

  return (
    <aside
      aria-label="Main navigation"
      className={`fixed lg:relative inset-y-0 left-0 z-50 flex flex-col h-dvh lg:h-screen transition-[width,transform] duration-300 ease-in-out motion-reduce:transition-none border-r shrink-0 select-none ${
        isMobileOpen ? 'translate-x-0 shadow-2xl shadow-black/50 lg:shadow-none' : '-translate-x-full lg:translate-x-0'
      } ${c ? 'lg:w-[68px]' : 'lg:w-[272px]'} w-[86vw] max-w-[300px]`}
      style={{ backgroundColor: tokens.bgSidebar, borderColor: tokens.border }}
    >
      <div className={`flex h-full flex-col overflow-hidden ${c ? 'lg:overflow-visible' : ''} pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)]`}>
        {/* Brand + collapse */}
        <div className={`flex h-16 shrink-0 items-center justify-between px-4 ${c ? 'lg:justify-center lg:px-0' : ''}`}>
          <div className={`flex min-w-0 items-center gap-2.5 ${c ? 'lg:hidden' : ''}`}>
            <div className="h-8 w-8 shrink-0 overflow-hidden rounded-[10px] ring-1 ring-white/10 shadow-md shadow-black/30">
              <img src={logoUrl} alt="" className="h-full w-full object-cover" />
            </div>
            <div className="min-w-0 leading-tight">
              <div className="font-serif text-[17px] font-medium tracking-tight text-white">Bwenge</div>
              <div className="text-[11px] text-[#9C9A92]">Education · Research · Data</div>
            </div>
          </div>

          <div className="group relative hidden lg:block">
            <button
              type="button"
              onClick={() => setCollapsed(!c)}
              className={`grid h-9 w-9 place-items-center rounded-lg text-[#9C9A92] transition-colors hover:bg-white/[0.06] hover:text-white ${FOCUS_RING}`}
              aria-label={c ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-expanded={!c}
            >
              {c ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            </button>
            <CollapsedTip show={c} label="Expand sidebar" />
          </div>

          <button
            type="button"
            onClick={onCloseMobile}
            className={`grid h-11 w-11 place-items-center rounded-lg text-[#9C9A92] transition-colors hover:bg-white/[0.06] hover:text-white lg:hidden ${FOCUS_RING}`}
            aria-label="Close navigation drawer"
          >
            <X size={20} />
          </button>
        </div>

        {/* New chat */}
        <div className={`shrink-0 px-3 pb-3 ${c ? 'lg:flex lg:justify-center' : ''}`}>
          <div className="group relative">
            <button
              type="button"
              onClick={go(onNewChat)}
              aria-label="New chat"
              className={`flex items-center justify-center gap-2 rounded-xl bg-[#D97757] font-medium text-white shadow-sm shadow-[#D97757]/20 transition-colors hover:bg-[#C96442] active:bg-[#B85A3A] ${FOCUS_RING} ${
                c ? 'h-11 w-full text-[15px] lg:h-10 lg:w-10' : 'h-11 w-full text-[15px] lg:h-10 lg:text-sm'
              }`}
            >
              <SquarePen size={16} aria-hidden="true" />
              <span className={c ? 'lg:hidden' : ''}>New chat</span>
            </button>
            <CollapsedTip show={c} label="New chat" />
          </div>
        </div>

        {/* Workspace navigation */}
        <nav aria-label="Workspace" className={`shrink-0 space-y-0.5 px-3 ${c ? 'lg:flex lg:flex-col lg:items-center' : ''}`}>
          {navItems.map((item) => {
            const active = activeTab === item.id;
            const Icon = item.icon;
            return (
              <div key={item.id} className="group relative w-full lg:w-auto">
                <button
                  type="button"
                  onClick={go(() => setActiveTab(item.id))}
                  aria-current={active ? 'page' : undefined}
                  aria-label={item.label}
                  className={`${rowBase} ${rowSize} ${c ? '' : 'lg:w-full'} ${
                    active ? 'bg-white/[0.07] font-medium text-white' : 'text-[#C2C0B6] hover:bg-white/[0.04] hover:text-white'
                  }`}
                >
                  {active && <span aria-hidden="true" className={`absolute top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-[#D97757] ${c ? 'left-0 lg:-left-3' : '-left-3'}`} />}
                  <Icon size={17} className={`shrink-0 ${active ? 'text-[#D97757]' : 'text-[#9C9A92] group-hover/row:text-[#C2C0B6]'}`} aria-hidden="true" />
                  <span className={label}>{item.label}</span>
                </button>
                <CollapsedTip show={c} label={item.label} />
              </div>
            );
          })}

          {user && onOpenLibrary && (
            <div className="group relative w-full lg:w-auto">
              <button
                type="button"
                onClick={go(onOpenLibrary)}
                aria-label="My files"
                className={`${rowBase} ${rowSize} ${c ? '' : 'lg:w-full'} text-[#C2C0B6] hover:bg-white/[0.04] hover:text-white`}
              >
                <FolderOpen size={17} className="shrink-0 text-[#9C9A92] group-hover/row:text-[#C2C0B6]" aria-hidden="true" />
                <span className={label}>My files</span>
              </button>
              <CollapsedTip show={c} label="My files" />
            </div>
          )}
        </nav>

        {/* Chat history */}
        <div className={`mt-4 flex min-h-0 flex-1 flex-col ${c ? 'lg:hidden' : ''}`}>
          {sessions.length > 0 ? (
            <>
              <div className="flex shrink-0 items-center justify-between px-5 pb-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#9C9A92]">Recent chats</span>
                <span className="rounded-full bg-white/[0.05] px-1.5 py-px text-[10px] tabular-nums text-[#9C9A92]">{sessions.length}</span>
              </div>
              {sessions.length > 5 && (
                <div className="shrink-0 px-3 pb-2">
                  <label className="flex h-9 items-center gap-2 rounded-lg border border-white/[0.08] bg-black/20 px-2.5 text-[#9C9A92] focus-within:border-[#D97757]/50">
                    <Search size={14} aria-hidden="true" />
                    <input
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search chats"
                      aria-label="Search chats"
                      className="min-w-0 flex-1 bg-transparent text-[13px] text-white placeholder:text-[#9C9A92]/70 focus:outline-none [&::-webkit-search-cancel-button]:appearance-none"
                    />
                    {query && (
                      <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="grid h-6 w-6 place-items-center rounded text-[#9C9A92] hover:bg-white/[0.06] hover:text-white">
                        <X size={13} />
                      </button>
                    )}
                  </label>
                </div>
              )}
              <div className="sidebar-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-3">
                {groups.length === 0 && <p className="px-2 py-6 text-center text-xs text-[#9C9A92]">No chats match “{query}”.</p>}
                {groups.map((g) => (
                  <section key={g.label} className="mb-3 last:mb-0" aria-label={g.label}>
                    <h3 className="px-2 pb-1 pt-1 text-[11px] font-medium text-[#9C9A92]/80">{g.label}</h3>
                    <ul className="space-y-px">
                      {g.items.map((s) => (
                        <li key={s.id} className="group/chat relative">
                          <button
                            type="button"
                            onClick={go(() => onLoadSession(s.id))}
                            title={s.title}
                            className={`flex h-10 w-full items-center rounded-lg px-2 text-left text-[14px] text-[#C2C0B6] transition-colors hover:bg-white/[0.04] hover:text-white lg:h-8 lg:text-[13px] ${FOCUS_RING} ${
                              onDeleteSession ? 'pr-10 lg:pr-2 lg:group-hover/chat:pr-9 lg:group-focus-within/chat:pr-9' : ''
                            }`}
                          >
                            <span className="truncate">{s.title || 'Untitled chat'}</span>
                          </button>
                          {onDeleteSession && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteSession(s.id);
                              }}
                              aria-label={`Delete chat “${s.title}”`}
                              title="Delete chat"
                              className={`absolute right-1 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-[#9C9A92] transition-opacity hover:bg-rose-500/10 hover:text-rose-400 lg:h-7 lg:w-7 lg:opacity-0 lg:group-hover/chat:opacity-100 lg:focus:opacity-100 ${FOCUS_RING}`}
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </>
          ) : (
            <div className="mx-3 rounded-xl border border-dashed border-white/[0.08] px-4 py-5 text-center">
              <MessageSquare size={18} className="mx-auto mb-2 text-[#9C9A92]" aria-hidden="true" />
              <p className="text-[13px] text-[#C2C0B6]">No chats yet</p>
              <p className="mt-0.5 text-xs text-[#9C9A92]">Your conversations will appear here.</p>
            </div>
          )}
        </div>
        {c && <div className="hidden flex-1 lg:block" />}

        {/* Footer: settings, admin, account */}
        <div className={`shrink-0 space-y-0.5 border-t px-3 pb-3 pt-2 ${c ? 'lg:flex lg:flex-col lg:items-center' : ''}`} style={{ borderColor: tokens.border }}>
          <div className="group relative w-full lg:w-auto">
            <button
              type="button"
              onClick={go(onOpenSettings)}
              aria-label="Settings"
              className={`${rowBase} ${rowSize} ${c ? '' : 'lg:w-full'} text-[#C2C0B6] hover:bg-white/[0.04] hover:text-white`}
            >
              <Settings size={17} className="shrink-0 text-[#9C9A92] group-hover/row:text-[#C2C0B6]" aria-hidden="true" />
              <span className={label}>Settings</span>
            </button>
            <CollapsedTip show={c} label="Settings" />
          </div>

          {user?.role === 'ADMIN' && onOpenAdmin && (
            <div className="group relative w-full lg:w-auto">
              <button
                type="button"
                onClick={go(onOpenAdmin)}
                aria-label="Open admin dashboard"
                className={`${rowBase} ${rowSize} ${c ? '' : 'lg:w-full'} text-emerald-300 hover:bg-emerald-400/[0.08]`}
              >
                <Shield size={17} className="shrink-0" aria-hidden="true" />
                <span className={label}>Admin dashboard</span>
              </button>
              <CollapsedTip show={c} label="Admin dashboard" />
            </div>
          )}

          <div ref={profileRef} className="group relative w-full pt-1 lg:w-auto">
            {user ? (
              <button
                type="button"
                onClick={() => setShowProfileMenu((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={showProfileMenu}
                aria-label={`Account menu for ${user.name}`}
                className={`flex items-center gap-2.5 rounded-xl text-left transition-colors hover:bg-white/[0.05] ${FOCUS_RING} ${
                  showProfileMenu ? 'bg-white/[0.05]' : ''
                } ${c ? 'w-full p-2 lg:h-10 lg:w-10 lg:justify-center lg:p-0' : 'w-full p-2'}`}
              >
                <span className="relative grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-[#5DCAA5] to-[#1F3D35] text-[12px] font-semibold text-white ring-1 ring-white/10">
                  {user.avatarUrl ? <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" /> : initials(user.name || user.email)}
                </span>
                <span className={`min-w-0 flex-1 ${c ? 'lg:hidden' : ''}`}>
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-medium text-white">{user.name || user.email}</span>
                    {plan && <span className={`shrink-0 rounded border px-1 py-px text-[9px] font-semibold uppercase tracking-wide ${plan.className}`}>{plan.label}</span>}
                  </span>
                  <span className="block truncate text-[11.5px] text-[#9C9A92]">{user.email}</span>
                </span>
                <ChevronsUpDown size={15} className={`shrink-0 text-[#9C9A92] ${c ? 'lg:hidden' : ''}`} aria-hidden="true" />
              </button>
            ) : (
              <button
                type="button"
                onClick={go(onOpenLoginModal)}
                aria-label="Sign in"
                className={`flex items-center justify-center gap-2 rounded-xl border border-white/10 text-sm font-medium text-white transition-colors hover:bg-white/[0.05] ${FOCUS_RING} ${
                  c ? 'h-11 w-full lg:h-10 lg:w-10' : 'h-11 w-full lg:h-10'
                }`}
              >
                <LogIn size={16} aria-hidden="true" />
                <span className={c ? 'lg:hidden' : ''}>Sign in</span>
              </button>
            )}
            {!showProfileMenu && <CollapsedTip show={c} label={user ? user.name || user.email : 'Sign in'} />}

            {user && showProfileMenu && (
              <div
                role="menu"
                className={`absolute bottom-full z-50 mb-2 w-60 overflow-hidden rounded-xl border border-white/10 bg-[#141413] p-1.5 shadow-2xl shadow-black/60 animate-in fade-in slide-in-from-bottom-2 duration-150 ${
                  c ? 'left-0 right-0 w-auto lg:bottom-0 lg:left-full lg:right-auto lg:mb-0 lg:ml-3 lg:w-60' : 'left-0 right-0 w-auto'
                }`}
              >
                <div className="px-2.5 pb-2 pt-1.5">
                  <div className="truncate text-[13px] font-medium text-white">{user.name}</div>
                  <div className="truncate text-xs text-[#9C9A92]">{user.email}</div>
                </div>
                <div className="my-1 border-t" style={{ borderColor: tokens.border }} />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setShowProfileMenu(false);
                    onOpenSettings();
                    onCloseMobile();
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-[#C2C0B6] transition-colors hover:bg-white/[0.06] hover:text-white"
                >
                  <UserRound size={15} aria-hidden="true" /> Account profile
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setShowProfileMenu(false);
                    onLogout();
                    onCloseMobile();
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-rose-400 transition-colors hover:bg-rose-500/10"
                >
                  <LogOut size={15} aria-hidden="true" /> Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
};
