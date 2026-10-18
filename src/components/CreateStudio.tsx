import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Send,
  ChevronDown,
  MoreVertical,
  Plus,
  Sparkles,
  Square,
  Paperclip,
  Trash2,
  Eye,
  FileText,
  Download,
  Share2,
  PanelLeft,
  SquarePen,
  ArrowUp,
  Camera,
  Mic,
  Globe,
  BookOpen,
  Sprout,
  BarChart2,
  Languages,
  CheckCircle2,
  HelpCircle,
  ExternalLink,
  ShieldAlert,
  Moon,
  Sun,
  LogOut
} from 'lucide-react';
import { ChatSession, Message as MessageType, ChatAttachment } from '../types';
import ChatMessage from './ChatMessage';
import logoUrl from '../assets/bwenge-logo.svg';

interface CreateStudioProps {
  messages: MessageType[];
  sessions: ChatSession[];
  onSendMessage: (text: string, attachment?: File | ChatAttachment | Array<File | ChatAttachment>) => void | Promise<void>;
  onNewChat: () => void;
  onLoadSession: (id: string) => void;
  onOpenSettings?: () => void;
  onDeleteChat?: () => void;
  onExportChat?: () => void;
  onShare?: () => void;
  activeFormId?: string | null;
  isTyping?: boolean;
  onAbort?: () => void;
  selectedProvider?: string;
  onProviderChange?: (provider: string) => void;
  stagedAttachments?: Array<File | ChatAttachment>;
  onStageAttachments?: (attachments: Array<File | ChatAttachment>) => void;
  onRemoveStagedAttachment?: (index: number) => void;
  onOpenSidebar?: () => void;
  onOpenScanner?: () => void;
  onPreviewDoc?: (doc: any) => void;
  onFeedback?: (messageId: string, rating: 'up' | 'down') => void;
  onRetry?: (messageId: string) => void;
  onUpgradeClick?: (jobId: string, service: string) => void;
  userName?: string;
  user?: any;
  onOpenLoginModal?: () => void;
}

function ModePicker({ selected, onSelect }: { selected: string; onSelect: (val: string) => void }) {
  const [open, setOpen] = useState(false);
  const modes = [
    { id: 'auto', label: 'Auto (Balanced)', short: 'Auto' },
    { id: 'fast', label: 'Fast (Real-time)', short: 'Fast' },
    { id: 'deep', label: 'Deep (Reasoning)', short: 'Deep' },
  ];

  const selectedMode = modes.find((m) => m.id === selected) || modes[0];
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutside = (e: PointerEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener('pointerdown', handleOutside);
    }
    return () => document.removeEventListener('pointerdown', handleOutside);
  }, [open]);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-[#C2C0B6] hover:bg-white/5 transition-colors border border-white/10 bg-[#30302E]"
      >
        <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
        <span>{selectedMode.short}</span>
        <ChevronDown size={12} className="opacity-60" />
      </button>

      {open && (
        <div className="absolute bottom-full right-0 mb-2 w-48 rounded-2xl border border-white/15 bg-[#30302E] shadow-2xl p-1 z-50 animate-in fade-in slide-in-from-bottom-2 duration-150">
          {modes.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                onSelect(m.id);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-2 rounded-xl text-xs font-medium transition-colors ${
                selected === m.id ? 'bg-[#5DCAA5]/20 text-white' : 'text-[#C2C0B6] hover:bg-white/5 hover:text-white'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function CreateStudio({
  messages,
  sessions,
  onSendMessage,
  onNewChat,
  onLoadSession,
  onOpenSettings,
  onDeleteChat,
  onExportChat,
  onShare,
  activeFormId,
  isTyping,
  onAbort,
  selectedProvider = 'auto',
  onProviderChange,
  stagedAttachments = [],
  onStageAttachments,
  onRemoveStagedAttachment,
  onOpenSidebar,
  onOpenScanner,
  onPreviewDoc,
  onFeedback,
  onRetry,
  onUpgradeClick,
  userName,
  user,
  onOpenLoginModal,
}: CreateStudioProps) {
  const [inputValue, setInputValue] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [showSources, setShowSources] = useState(true);
  const [answerLanguage, setAnswerLanguage] = useState('Auto');
  const [isRecording, setIsRecording] = useState(false);

  const menuRef = useRef<HTMLDivElement>(null);
  const plusMenuRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const [showNewResponsePill, setShowNewResponsePill] = useState(false);

  // Close menus on pointerdown outside
  useEffect(() => {
    const handleOutside = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
      if (plusMenuRef.current && !plusMenuRef.current.contains(e.target as Node)) {
        setPlusMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', handleOutside);
    return () => document.removeEventListener('pointerdown', handleOutside);
  }, []);

  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  useEffect(() => {
    resize();
  }, [inputValue, resize]);

  const handleSend = () => {
    const text = inputValue.trim();
    if (!text && stagedAttachments.length === 0) return;
    onSendMessage(text, stagedAttachments);
    setInputValue('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    stickToBottomRef.current = true;
    setShowNewResponsePill(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const isDesktop = window.matchMedia('(min-width: 1024px)').matches;
    if (isDesktop && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      onStageAttachments?.(files);
    }
    e.target.value = '';
  };

  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const isNearBottom = distanceToBottom <= 80;
    stickToBottomRef.current = isNearBottom;
    setShowNewResponsePill(!isNearBottom);
  };

  useEffect(() => {
    if (stickToBottomRef.current && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({
        top: scrollContainerRef.current.scrollHeight,
        behavior: 'auto',
      });
    }
  }, [messages, isTyping]);

  const firstUserMessage = messages.find((m) => m.sender === 'user')?.text || '';
  const truncatedTitle = firstUserMessage.length > 40 ? firstUserMessage.slice(0, 40) + '...' : firstUserMessage;

  const getGreeting = () => {
    const hour = new Date().getHours();
    const kinyarwandaGreeting = hour < 12 ? 'Mwaramutse' : 'Mwiriwe';
    const firstName = userName || (user?.name ? user.name.split(' ')[0] : null);
    return firstName ? `${kinyarwandaGreeting}, ${firstName}` : kinyarwandaGreeting;
  };

  const canSend = Boolean(inputValue.trim() || stagedAttachments.length > 0 || isTyping);

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-[#262624] text-[#FAF9F5]">
      {/* Header */}
      <header className="flex h-[calc(56px+env(safe-area-inset-top,0px))] shrink-0 items-center justify-between border-b border-white/[0.06] bg-[#212121]/95 px-3 pt-[env(safe-area-inset-top,0px)] backdrop-blur-md">
        {/* Left: Menu button on mobile */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenSidebar}
            className="flex h-11 w-11 items-center justify-center rounded-xl text-[#C2C0B6] hover:bg-white/10 hover:text-white transition-colors lg:hidden"
            aria-label="Open navigation menu"
          >
            <PanelLeft className="h-5 w-5" />
          </button>
          <div className="hidden lg:flex items-center gap-2">
            <span className="text-sm font-semibold tracking-tight text-[#FAF9F5]">
              {messages.length > 0 && truncatedTitle ? truncatedTitle : 'New Chat'}
            </span>
          </div>
        </div>

        {/* Center: Truncated conversation title on mobile */}
        <div className="flex-1 px-2 text-center lg:hidden truncate">
          {messages.length > 0 && truncatedTitle && (
            <span className="text-sm font-medium text-[#FAF9F5] truncate">{truncatedTitle}</span>
          )}
        </div>

        {/* Right: Mode Picker, Upgrade / Sign in, More Menu */}
        <div className="flex items-center gap-2">
          <ModePicker selected={selectedProvider} onSelect={(val) => onProviderChange?.(val)} />

          <button
            type="button"
            onClick={onNewChat}
            className="flex h-11 w-11 items-center justify-center rounded-xl text-[#C2C0B6] hover:bg-white/10 hover:text-white transition-colors lg:hidden"
            aria-label="New chat"
            title="New chat"
          >
            <SquarePen className="h-5 w-5" />
          </button>

          {user ? (
            <button
              onClick={() => (window as any).openUpgradeModal?.()}
              className="hidden sm:flex bg-gradient-to-r from-amber-500/20 to-orange-600/10 hover:from-amber-500/30 hover:to-orange-600/20 text-amber-400 font-medium px-3.5 py-1.5 rounded-xl border border-amber-500/30 text-xs transition-all shadow-md items-center gap-1.5"
            >
              ⭐ Upgrade
            </button>
          ) : (
            <button
              onClick={onOpenLoginModal}
              className="flex bg-[#D97757] hover:bg-[#c26647] text-white font-medium px-3.5 py-1.5 rounded-xl text-xs transition-all shadow-md items-center gap-1.5"
            >
              Sign in
            </button>
          )}

          {/* Three Dots Categorized Menu */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((prev) => !prev)}
              className="flex h-11 w-11 lg:h-9 lg:w-9 items-center justify-center rounded-xl text-[#C2C0B6] hover:bg-white/10 hover:text-white transition-colors focus:outline-none"
              aria-label="More options"
            >
              <MoreVertical size={18} />
            </button>

            {menuOpen && (
              <div className="absolute right-0 mt-2 w-64 rounded-2xl border border-white/15 bg-[#30302E] shadow-2xl z-50 py-2 text-xs text-[#FAF9F5] animate-in fade-in slide-in-from-top-1 duration-150">
                {/* This Chat Section */}
                <div className="px-3 py-1 font-bold text-[10px] tracking-wider uppercase text-neutral-400">This Chat</div>
                <button
                  onClick={() => {
                    if (activeFormId) onShare?.();
                    setMenuOpen(false);
                  }}
                  className="w-full flex items-center px-3.5 py-2 hover:bg-white/5 transition-colors text-left text-neutral-200"
                >
                  <Share2 className="mr-3 w-4 h-4 text-emerald-400" /> Share Chat
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                  }}
                  className="w-full flex items-center px-3.5 py-2 hover:bg-white/5 transition-colors text-left text-neutral-200"
                >
                  <FileText className="mr-3 w-4 h-4 text-amber-400" /> Rename Chat
                </button>
                <button
                  onClick={() => {
                    onExportChat?.();
                    setMenuOpen(false);
                  }}
                  className="w-full flex items-center px-3.5 py-2 hover:bg-white/5 transition-colors text-left text-neutral-200"
                >
                  <Download className="mr-3 w-4 h-4 text-teal-400" /> Export (PDF, DOCX)
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                  }}
                  className="w-full flex items-center px-3.5 py-2 hover:bg-white/5 transition-colors text-left text-neutral-200"
                >
                  <Sparkles className="mr-3 w-4 h-4 text-purple-400" /> Temporary chat (Not saved)
                </button>
                <button
                  onClick={() => {
                    onDeleteChat?.();
                    setMenuOpen(false);
                  }}
                  className="w-full flex items-center px-3.5 py-2 hover:bg-rose-500/10 hover:text-rose-400 transition-colors text-left text-rose-400"
                >
                  <Trash2 className="mr-3 w-4 h-4" /> Delete Chat
                </button>

                <div className="border-t border-white/10 my-1.5"></div>

                {/* Answers Section */}
                <div className="px-3 py-1 font-bold text-[10px] tracking-wider uppercase text-neutral-400">Answers</div>
                <button
                  onClick={() => setShowSources(!showSources)}
                  className="w-full flex items-center justify-between px-3.5 py-2 hover:bg-white/5 transition-colors text-left text-neutral-200"
                >
                  <span className="flex items-center"><BookOpen className="mr-3 w-4 h-4 text-blue-400" /> Show Sources</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${showSources ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/10 text-neutral-400'}`}>
                    {showSources ? 'On' : 'Off'}
                  </span>
                </button>
                <div className="px-3.5 py-2 flex items-center justify-between text-neutral-200 hover:bg-white/5">
                  <span className="flex items-center"><Languages className="mr-3 w-4 h-4 text-amber-400" /> Answer Language</span>
                  <select
                    value={answerLanguage}
                    onChange={(e) => setAnswerLanguage(e.target.value)}
                    className="bg-[#212121] text-xs text-neutral-200 border border-white/15 rounded px-2 py-1 outline-none"
                  >
                    <option value="Auto">Auto</option>
                    <option value="Kinyarwanda">Kinyarwanda</option>
                    <option value="English">English</option>
                    <option value="French">French</option>
                  </select>
                </div>
                <button
                  onClick={() => {
                    alert('Report or correct feedback submitted to correction loop.');
                    setMenuOpen(false);
                  }}
                  className="w-full flex items-center px-3.5 py-2 hover:bg-white/5 transition-colors text-left text-neutral-200"
                >
                  <ShieldAlert className="mr-3 w-4 h-4 text-orange-400" /> Report or Correct
                </button>

                <div className="border-t border-white/10 my-1.5"></div>

                {/* App Section */}
                <div className="px-3 py-1 font-bold text-[10px] tracking-wider uppercase text-neutral-400">App</div>
                <button
                  onClick={() => {
                    onOpenSettings?.();
                    setMenuOpen(false);
                  }}
                  className="w-full flex items-center px-3.5 py-2 hover:bg-white/5 transition-colors text-left text-neutral-200"
                >
                  <Globe className="mr-3 w-4 h-4 text-teal-400" /> Language & Theme Settings
                </button>
                <a
                  href="https://t.me/BwengeBot"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center px-3.5 py-2 hover:bg-white/5 transition-colors text-left text-neutral-200"
                >
                  <ExternalLink className="mr-3 w-4 h-4 text-sky-400" /> Open on Telegram
                </a>
                <button
                  onClick={() => {
                    window.location.href = 'mailto:support@bwenge.space?subject=Support%20Ticket%20-%20Bwenge%20AI%20Studio';
                    setMenuOpen(false);
                  }}
                  className="w-full flex items-center px-3.5 py-2 hover:bg-white/5 transition-colors text-left text-neutral-200"
                >
                  <HelpCircle className="mr-3 w-4 h-4 text-yellow-400" /> Help & Support (Raise Ticket)
                </button>
                {user && (
                  <button
                    onClick={() => {
                      window.location.reload();
                      setMenuOpen(false);
                    }}
                    className="w-full flex items-center px-3.5 py-2 hover:bg-rose-500/10 hover:text-rose-400 transition-colors text-left text-rose-400"
                  >
                    <LogOut className="mr-3 w-4 h-4" /> Log Out
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Conversation or Empty State */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-hidden relative"
      >
        <div className="mx-auto w-full max-w-2xl flex flex-col gap-6 px-4 py-6">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-10 md:py-16 animate-in fade-in duration-300">
              {/* Logo Mark */}
              <div className="w-12 h-12 rounded-2xl bg-[#0D2B24] flex items-center justify-center overflow-hidden border border-emerald-500/30 shadow-lg mb-4">
                <img src={logoUrl} alt="Bwenge Logo" className="w-full h-full object-cover" />
              </div>

              {/* Greeting */}
              <h1 className="font-serif text-[26px] sm:text-[32px] font-normal tracking-tight text-[#FAF9F5] mb-6">
                {getGreeting()}
              </h1>

              {/* 4 Starter Cards by Task */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-lg text-left">
                <button
                  type="button"
                  onClick={() => onSendMessage("Show me Rwanda's census and spatial data summary for recent economic development.")}
                  className="p-3.5 rounded-2xl border border-white/10 bg-[#30302E]/80 hover:bg-[#30302E] hover:border-emerald-500/40 transition-all flex flex-col gap-1.5 shadow-sm group"
                >
                  <div className="flex items-center gap-2 text-emerald-400 font-semibold text-xs">
                    <BarChart2 size={16} /> Rwanda's data
                  </div>
                  <p className="text-[11px] text-[#C2C0B6] group-hover:text-[#FAF9F5] leading-relaxed">
                    Explore Rwanda census & spatial statistics
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => onSendMessage("Auto-grade this student exam paper using the attached rubric and provide detailed feedback.")}
                  className="p-3.5 rounded-2xl border border-white/10 bg-[#30302E]/80 hover:bg-[#30302E] hover:border-amber-500/40 transition-all flex flex-col gap-1.5 shadow-sm group"
                >
                  <div className="flex items-center gap-2 text-amber-400 font-semibold text-xs">
                    <FileText size={16} /> Mark an exam
                  </div>
                  <p className="text-[11px] text-[#C2C0B6] group-hover:text-[#FAF9F5] leading-relaxed">
                    Auto-grade student paper with rubric
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => onSendMessage("Give me farming advice and crop disease & soil advisory for agricultural yield in East Africa.")}
                  className="p-3.5 rounded-2xl border border-white/10 bg-[#30302E]/80 hover:bg-[#30302E] hover:border-teal-500/40 transition-all flex flex-col gap-1.5 shadow-sm group"
                >
                  <div className="flex items-center gap-2 text-teal-400 font-semibold text-xs">
                    <Sprout size={16} /> Farming advice
                  </div>
                  <p className="text-[11px] text-[#C2C0B6] group-hover:text-[#FAF9F5] leading-relaxed">
                    Crop disease & soil advisory for East Africa
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => onSendMessage("Help me write or translate technical and official documents between Kinyarwanda, English, and French.")}
                  className="p-3.5 rounded-2xl border border-white/10 bg-[#30302E]/80 hover:bg-[#30302E] hover:border-purple-500/40 transition-all flex flex-col gap-1.5 shadow-sm group"
                >
                  <div className="flex items-center gap-2 text-purple-400 font-semibold text-xs">
                    <Languages size={16} /> Write or translate
                  </div>
                  <p className="text-[11px] text-[#C2C0B6] group-hover:text-[#FAF9F5] leading-relaxed">
                    Translate between Kinyarwanda, English & French
                  </p>
                </button>
              </div>
            </div>
          ) : (
            messages.map((msg, idx) => (
              <ChatMessage
                key={msg.id ?? idx}
                message={msg}
                onPreviewDoc={onPreviewDoc}
                onFeedback={onFeedback}
                onRetry={onRetry}
                onUpgradeClick={onUpgradeClick}
              />
            ))
          )}

        </div>

        {/* New Response Pill */}
        {showNewResponsePill && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-20">
            <button
              type="button"
              onClick={() => {
                stickToBottomRef.current = true;
                setShowNewResponsePill(false);
                scrollContainerRef.current?.scrollTo({
                  top: scrollContainerRef.current.scrollHeight,
                  behavior: 'smooth',
                });
              }}
              className="flex items-center gap-1.5 rounded-full bg-[#30302E] border border-white/15 px-4 py-2 text-xs font-semibold text-[#FAF9F5] shadow-2xl hover:bg-white/10 transition-all"
            >
              <span>↓ New response</span>
            </button>
          </div>
        )}
      </div>

      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="*/*"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Composer Footer */}
      <footer className="shrink-0 bg-[#262624] px-3 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))]">
        <div className="mx-auto w-full max-w-2xl relative">
          <div className="rounded-[28px] border border-white/10 bg-[#30302E] p-3 shadow-[0_4px_24px_rgba(0,0,0,0.25)]">
            {stagedAttachments.length > 0 && (
              <div className="mb-2.5 flex flex-wrap gap-2 overflow-x-auto pb-1">
                {stagedAttachments.map((meta: any, idx: number) => (
                  <div
                    key={idx}
                    className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 py-1.5 px-2.5 text-xs text-[#FAF9F5]"
                  >
                    <span>📄</span>
                    <span className="max-w-[140px] truncate">{meta.name}</span>
                    <button
                      type="button"
                      onClick={() => onRemoveStagedAttachment?.(idx)}
                      className="ml-1 h-7 w-7 flex items-center justify-center text-[#9C9A92] hover:text-rose-400 transition-colors"
                      aria-label="Remove attachment"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-end gap-2">
              {/* Plus Button with Menu Popover */}
              <div className="relative" ref={plusMenuRef}>
                <button
                  type="button"
                  onClick={() => setPlusMenuOpen((prev) => !prev)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 text-[#C2C0B6] hover:bg-white/5 hover:text-white transition-colors"
                  title="Add attachments or scan"
                >
                  <Plus size={18} />
                </button>

                {plusMenuOpen && (
                  <div className="absolute bottom-full left-0 mb-2 w-48 rounded-2xl border border-white/15 bg-[#212121] shadow-2xl z-50 py-1.5 text-xs text-[#FAF9F5] animate-in fade-in slide-in-from-bottom-1">
                    <button
                      type="button"
                      onClick={() => {
                        fileInputRef.current?.click();
                        setPlusMenuOpen(false);
                      }}
                      className="w-full flex items-center px-3.5 py-2.5 hover:bg-white/5 text-left text-neutral-200"
                    >
                      <Paperclip className="mr-3 w-4 h-4 text-amber-400" /> Upload File
                    </button>
                    {onOpenScanner && <button
                      type="button"
                      onClick={() => {
                        onOpenScanner?.();
                        setPlusMenuOpen(false);
                      }}
                      className="w-full flex items-center px-3.5 py-2.5 hover:bg-white/5 text-left text-neutral-200"
                    >
                      <Camera className="mr-3 w-4 h-4 text-emerald-400" /> Camera Scan
                    </button>}
                    <button
                      type="button"
                      onClick={() => {
                        setInputValue((prev) => prev + '[Paste Text Here] ');
                        setPlusMenuOpen(false);
                      }}
                      className="w-full flex items-center px-3.5 py-2.5 hover:bg-white/5 text-left text-neutral-200"
                    >
                      <FileText className="mr-3 w-4 h-4 text-sky-400" /> Paste Text
                    </button>
                  </div>
                )}
              </div>

              {/* Textarea Input */}
              <div className="flex-1 flex flex-col min-w-0">
                <textarea
                  ref={textareaRef}
                  rows={1}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Message Bwenge (Kinyarwanda or English)..."
                  className="w-full bg-transparent border-0 resize-none text-base leading-6 text-[#FAF9F5] placeholder-[#9C9A92] outline-none px-1 py-1 max-h-40 scrollbar-hidden"
                />
              </div>

              {/* Mic & Send Buttons */}
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setIsRecording(!isRecording);
                    if (!isRecording) {
                      setInputValue((prev) => prev + '(Voice recording in Kinyarwanda...) ');
                    }
                  }}
                  className={`flex h-9 w-9 items-center justify-center rounded-full border transition-colors ${
                    isRecording
                      ? 'border-rose-500 bg-rose-500/20 text-rose-400 animate-pulse'
                      : 'border-white/10 text-[#C2C0B6] hover:bg-white/5 hover:text-white'
                  }`}
                  title="Voice input (Kinyarwanda)"
                  aria-label="Voice input"
                >
                  <Mic size={16} />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (isTyping) onAbort?.();
                    else handleSend();
                  }}
                  disabled={!canSend}
                  className={`flex h-9 w-9 items-center justify-center rounded-full transition-all ${
                    canSend
                      ? 'bg-[#D97757] text-white shadow-md active:scale-95'
                      : 'bg-[#D97757]/40 text-white/50 cursor-not-allowed'
                  }`}
                  aria-label={isTyping ? 'Stop generating' : 'Send message'}
                >
                  {isTyping ? <Square size={16} fill="currentColor" /> : <ArrowUp size={18} strokeWidth={2.5} />}
                </button>
              </div>
            </div>

            {/* Sources Toggle and Answer In Language under box */}
            <div className="mt-2.5 pt-2 border-t border-white/5 flex items-center justify-between text-[11px] text-neutral-400">
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 cursor-pointer hover:text-white transition-colors">
                  <input
                    type="checkbox"
                    checked={showSources}
                    onChange={(e) => setShowSources(e.target.checked)}
                    className="rounded bg-black/40 border-white/20 text-amber-500 focus:ring-0"
                  />
                  <span>Show Sources</span>
                </label>
              </div>

              <div className="flex items-center gap-1.5">
                <span>Answer in:</span>
                <select
                  value={answerLanguage}
                  onChange={(e) => setAnswerLanguage(e.target.value)}
                  className="bg-[#212121] text-[11px] text-neutral-200 border border-white/15 rounded px-2 py-0.5 outline-none"
                >
                  <option value="Auto">Auto</option>
                  <option value="Kinyarwanda">Kinyarwanda</option>
                  <option value="English">English</option>
                  <option value="French">French</option>
                </select>
              </div>
            </div>
          </div>

          {/* Footer Disclaimer */}
          <div className="mt-2 text-center text-[10px] text-[#9C9A92] font-sans tracking-tight select-none">
            Bwenge can make mistakes. Check important information.
          </div>
        </div>
      </footer>
    </div>
  );
}
