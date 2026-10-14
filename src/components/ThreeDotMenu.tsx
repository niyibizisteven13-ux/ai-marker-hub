import React, { useState, useRef, useEffect } from 'react';
import { MoreVertical, Share2, Edit3, Download, Clock, Trash2, BookOpen, Languages, Shield, HelpCircle, LogOut, Check } from 'lucide-react';

interface ThreeDotMenuProps {
  isGuest?: boolean;
  isAdmin?: boolean;
  activeFormId?: string | null;
  onShare?: () => void;
  onRename?: () => void;
  onExport?: (format: 'pdf' | 'docx' | 'markdown') => void;
  onToggleTemporary?: () => void;
  isTemporary?: boolean;
  onDeleteChat?: () => void;
  onToggleSources?: () => void;
  showSources?: boolean;
  answerLanguage?: string;
  onAnswerLanguageChange?: (lang: string) => void;
  uiLanguage?: string;
  onUiLanguageChange?: (lang: string) => void;
  theme?: string;
  onThemeChange?: (theme: string) => void;
  onOpenTelegram?: () => void;
  onInstallApp?: () => void;
  onOpenHelp?: () => void;
  onLogout?: () => void;
  onReportCorrect?: () => void;
}

export const ThreeDotMenu: React.FC<ThreeDotMenuProps> = ({
  isGuest = false,
  isAdmin = false,
  activeFormId = null,
  onShare,
  onRename,
  onExport,
  onToggleTemporary,
  isTemporary = false,
  onDeleteChat,
  onToggleSources,
  showSources = true,
  answerLanguage = 'auto',
  onAnswerLanguageChange,
  uiLanguage = 'en',
  onUiLanguageChange,
  theme = 'dark',
  onThemeChange,
  onOpenTelegram,
  onInstallApp,
  onOpenHelp,
  onLogout,
  onReportCorrect,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [exportSubOpen, setExportSubOpen] = useState(false);
  const [langSubOpen, setLangSubOpen] = useState(false);
  const [uiLangSubOpen, setUiLangSubOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setExportSubOpen(false);
        setLangSubOpen(false);
        setUiLangSubOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label="More options"
        className="h-11 w-11 flex items-center justify-center rounded-xl text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--hover)] transition-colors"
      >
        <MoreVertical className="w-5 h-5" />
      </button>

      {isOpen && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-64 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-1.5 shadow-2xl z-50 text-xs text-[var(--text)] animate-in fade-in slide-in-from-top-2 duration-150"
        >
          {/* This chat group */}
          <div className="px-3 py-1 font-bold text-[var(--muted)] uppercase tracking-wider text-[10px]">
            This chat
          </div>
          {!isGuest ? (
            <button
              role="menuitem"
              onClick={() => { onShare?.(); setIsOpen(false); }}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-[var(--hover)] transition-colors"
            >
              <span className="flex items-center gap-2"><Share2 className="w-4 h-4 text-[var(--teal)]" /> Share</span>
              <span className="text-[10px] text-[var(--muted)]">Read-only link</span>
            </button>
          ) : (
            <div className="px-3 py-2 text-[var(--muted)] text-[11px]">Sign in to save and share</div>
          )}

          <button
            role="menuitem"
            onClick={() => { onRename?.(); setIsOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl hover:bg-[var(--hover)] transition-colors"
          >
            <Edit3 className="w-4 h-4 text-[var(--muted)]" /> Rename
          </button>

          <div className="relative">
            <button
              role="menuitem"
              onClick={() => setExportSubOpen(!exportSubOpen)}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-[var(--hover)] transition-colors"
            >
              <span className="flex items-center gap-2"><Download className="w-4 h-4 text-[var(--muted)]" /> Export</span>
              <span className="text-[10px] text-[var(--muted)]">▶</span>
            </button>
            {exportSubOpen && (
              <div className="absolute left-full top-0 ml-1 w-40 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1 shadow-xl">
                <button onClick={() => { onExport?.('markdown'); setIsOpen(false); }} className="w-full text-left px-3 py-2 rounded-lg hover:bg-[var(--hover)]">Markdown</button>
                <button onClick={() => { onExport?.('docx'); setIsOpen(false); }} className="w-full text-left px-3 py-2 rounded-lg hover:bg-[var(--hover)]">Word (.docx)</button>
                <button onClick={() => { onExport?.('pdf'); setIsOpen(false); }} className="w-full text-left px-3 py-2 rounded-lg hover:bg-[var(--hover)]">PDF</button>
              </div>
            )}
          </div>

          <button
            role="menuitemcheckbox"
            aria-checked={isTemporary}
            onClick={() => { onToggleTemporary?.(); }}
            className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-[var(--hover)] transition-colors"
          >
            <span className="flex items-center gap-2"><Clock className="w-4 h-4 text-[var(--muted)]" /> Temporary chat</span>
            <input type="checkbox" checked={isTemporary} readOnly className="accent-[var(--teal)] h-3.5 w-3.5" />
          </button>

          {!isGuest && (
            <button
              role="menuitem"
              onClick={() => { onDeleteChat?.(); setIsOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-[var(--danger)] hover:bg-[var(--hover)] transition-colors"
            >
              <Trash2 className="w-4 h-4" /> Delete chat
            </button>
          )}

          <div className="my-1 border-t border-[var(--border)]" />

          {/* Answers group */}
          <div className="px-3 py-1 font-bold text-[var(--muted)] uppercase tracking-wider text-[10px]">
            Answers
          </div>
          <button
            role="menuitemcheckbox"
            aria-checked={showSources}
            onClick={() => onToggleSources?.()}
            className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-[var(--hover)] transition-colors"
          >
            <span className="flex items-center gap-2"><BookOpen className="w-4 h-4 text-[var(--muted)]" /> Show sources</span>
            <input type="checkbox" checked={showSources} readOnly className="accent-[var(--teal)] h-3.5 w-3.5" />
          </button>

          <div className="relative">
            <button
              role="menuitem"
              onClick={() => setLangSubOpen(!langSubOpen)}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-[var(--hover)] transition-colors"
            >
              <span className="flex items-center gap-2"><Languages className="w-4 h-4 text-[var(--muted)]" /> Answer language</span>
              <span className="text-[10px] text-[var(--muted)] uppercase">{answerLanguage}</span>
            </button>
            {langSubOpen && (
              <div className="absolute left-full top-0 ml-1 w-44 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1 shadow-xl">
                {['auto', 'kinyarwanda', 'english', 'french'].map((l) => (
                  <button
                    key={l}
                    onClick={() => { onAnswerLanguageChange?.(l); setLangSubOpen(false); }}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-[var(--hover)] capitalize text-xs"
                  >
                    {l} {answerLanguage === l && <Check className="w-3.5 h-3.5 text-[var(--teal)]" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            role="menuitem"
            onClick={() => { onReportCorrect?.(); setIsOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl hover:bg-[var(--hover)] transition-colors"
          >
            <Shield className="w-4 h-4 text-[var(--muted)]" /> Report or correct
          </button>

          <div className="my-1 border-t border-[var(--border)]" />

          {/* App group */}
          <div className="px-3 py-1 font-bold text-[var(--muted)] uppercase tracking-wider text-[10px]">
            App
          </div>
          <div className="relative">
            <button
              role="menuitem"
              onClick={() => setUiLangSubOpen(!uiLangSubOpen)}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-[var(--hover)] transition-colors"
            >
              <span className="flex items-center gap-2"><Languages className="w-4 h-4 text-[var(--muted)]" /> UI Language</span>
              <span className="text-[10px] text-[var(--muted)] uppercase">{uiLanguage}</span>
            </button>
            {uiLangSubOpen && (
              <div className="absolute left-full top-0 ml-1 w-40 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1 shadow-xl">
                {[
                  { code: 'en', label: 'English' },
                  { code: 'rw', label: 'Kinyarwanda' },
                  { code: 'fr', label: 'Français' },
                ].map((item) => (
                  <button
                    key={item.code}
                    onClick={() => { onUiLanguageChange?.(item.code); setUiLangSubOpen(false); }}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-[var(--hover)] text-xs"
                  >
                    {item.label} {uiLanguage === item.code && <Check className="w-3.5 h-3.5 text-[var(--teal)]" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            role="menuitem"
            onClick={() => {
              window.location.href = 'mailto:support@bwenge.space?subject=Support%20Ticket%20-%20Bwenge%20AI%20Studio';
              setIsOpen(false);
            }}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl hover:bg-[var(--hover)] transition-colors"
          >
            <HelpCircle className="w-4 h-4 text-[var(--muted)]" /> Help & Support (Raise Ticket)
          </button>

          {!isGuest && onLogout && (
            <>
              <div className="my-1 border-t border-[var(--border)]" />
              <button
                role="menuitem"
                onClick={() => { onLogout(); setIsOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-[var(--danger)] hover:bg-[var(--hover)] transition-colors"
              >
                <LogOut className="w-4 h-4" /> Log out
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};
