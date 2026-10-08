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
} from 'lucide-react';
import { ChatSession, Message as MessageType, ChatAttachment } from '../types';
import ChatMessage from './ChatMessage';
import BwengeLoader from './BwengeLoader';
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
}

function ModelPicker({ selected, onSelect }: { selected: string; onSelect: (val: string) => void }) {
  const [open, setOpen] = useState(false);
  const models = [
    { id: 'gonkarouter', label: 'GonkaRouter — GLM-5.3-Flash (Primary)', short: 'GonkaRouter' },
  ];

  const selectedModel = models.find((m) => m.id === selected) || models[0];
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
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-[#C2C0B6] hover:bg-white/5 transition-colors"
      >
        <span>{selectedModel.short}</span>
        <ChevronDown size={12} className="opacity-60" />
      </button>

      {open && (
        <div className="absolute bottom-full right-0 mb-2 w-48 rounded-2xl border border-white/15 bg-[#30302E] shadow-2xl p-1 z-50 animate-in fade-in slide-in-from-bottom-2 duration-150">
          {models.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                onSelect(m.id);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-2 rounded-xl text-xs font-medium transition-colors ${
                selected === m.id ? 'bg-[#D97757]/20 text-white' : 'text-[#C2C0B6] hover:bg-white/5 hover:text-white'
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
}: CreateStudioProps) {
  const [inputValue, setInputValue] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const [showNewResponsePill, setShowNewResponsePill] = useState(false);

  // Close more menu on pointerdown outside
  useEffect(() => {
    const handleOutside = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    if (menuOpen) {
      document.addEventListener('pointerdown', handleOutside);
    }
    return () => document.removeEventListener('pointerdown', handleOutside);
  }, [menuOpen]);

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
    const timeOfDay = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
    const firstName = userName ? userName.split(' ')[0] : 'there';
    return `Good ${timeOfDay}, ${firstName}`;
  };

  const canSend = Boolean(inputValue.trim() || stagedAttachments.length > 0 || isTyping);

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-[#262624] text-[#FAF9F5]">
      {/* Header */}
      <header className="flex h-[calc(56px+env(safe-area-inset-top,0px))] shrink-0 items-center justify-between border-b border-white/[0.06] bg-[#212121]/95 px-3 pt-[env(safe-area-inset-top,0px)] backdrop-blur-md">
        {/* Left: Menu button on mobile, logo on desktop */}
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
            <div className="w-7 h-7 rounded-xl bg-[#0D2B24] flex items-center justify-center overflow-hidden shrink-0 border border-emerald-500/20">
              <img src={logoUrl} alt="Bwenge" className="w-full h-full object-cover" />
            </div>
            <span className="text-sm font-bold tracking-tight text-[#FAF9F5]">Bwenge Studio</span>
          </div>
        </div>

        {/* Center: Truncated conversation title on mobile when messages exist */}
        <div className="flex-1 px-2 text-center lg:hidden truncate">
          {messages.length > 0 && truncatedTitle && (
            <span className="text-sm font-medium text-[#FAF9F5] truncate">{truncatedTitle}</span>
          )}
        </div>

        {/* Right: New chat, Upgrade, More */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onNewChat}
            className="flex h-11 w-11 items-center justify-center rounded-xl text-[#C2C0B6] hover:bg-white/10 hover:text-white transition-colors lg:hidden"
            aria-label="New chat"
            title="New chat"
          >
            <SquarePen className="h-5 w-5" />
          </button>

          <button
            onClick={() => (window as any).openUpgradeModal?.()}
            className="hidden sm:flex bg-gradient-to-r from-amber-500/20 to-orange-600/10 hover:from-amber-500/30 hover:to-orange-600/20 text-amber-400 font-medium px-3.5 py-1.5 rounded-xl border border-amber-500/30 text-xs transition-all shadow-md items-center gap-1.5"
          >
            ⭐ Upgrade
          </button>

          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((prev) => !prev)}
              className="flex h-11 w-11 lg:h-9 lg:w-9 items-center justify-center rounded-xl text-[#C2C0B6] hover:bg-white/10 hover:text-white transition-colors focus:outline-none"
              aria-label="More options"
            >
              <MoreVertical size={18} />
            </button>

            {menuOpen && (
              <div className="absolute right-0 mt-2 w-56 rounded-2xl border border-white/15 bg-[#30302E] shadow-2xl z-50 py-1.5 text-xs text-[#FAF9F5] animate-in fade-in slide-in-from-top-1 duration-150">
                <button
                  onClick={() => {
                    if (activeFormId) onShare?.();
                    setMenuOpen(false);
                  }}
                  disabled={!activeFormId}
                  className={`w-full flex items-center px-3.5 py-2.5 transition-colors text-left ${
                    activeFormId ? 'hover:bg-white/5 text-emerald-400' : 'opacity-40 cursor-not-allowed'
                  }`}
                >
                  <Share2 className="mr-3 w-4 h-4" />
                  {activeFormId ? 'Share USSD Instructions' : 'Share (create form first)'}
                </button>
                <div className="border-t border-white/10 my-1"></div>
                <button
                  onClick={() => {
                    onExportChat?.();
                    setMenuOpen(false);
                  }}
                  className="w-full flex items-center px-3.5 py-2.5 hover:bg-white/5 transition-colors text-left"
                >
                  <Download className="mr-3 w-4 h-4" /> Export Chat
                </button>
                <button
                  onClick={() => {
                    onDeleteChat?.();
                    setMenuOpen(false);
                  }}
                  className="w-full flex items-center px-3.5 py-2.5 hover:bg-rose-500/10 hover:text-rose-400 transition-colors text-left text-rose-400"
                >
                  <Trash2 className="mr-3 w-4 h-4" /> Clear All Messages
                </button>
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
            <div className="flex flex-col items-center justify-center text-center py-12 md:py-20 animate-in fade-in duration-300">
              {/* Logo Mark */}
              <div className="w-12 h-12 rounded-2xl bg-[#0D2B24] flex items-center justify-center overflow-hidden border border-emerald-500/30 shadow-lg mb-6">
                <img src={logoUrl} alt="Bwenge Logo" className="w-full h-full object-cover" />
              </div>

              {/* Greeting */}
              <h1 className="font-serif text-[26px] sm:text-[30px] font-normal tracking-tight text-[#FAF9F5] mb-5">
                {getGreeting()}
              </h1>

              <div className="flex flex-wrap items-center justify-center gap-2.5 max-w-xl">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="h-9 rounded-lg border border-white/10 bg-[#30302E] px-3.5 text-xs text-[#C2C0B6] hover:bg-white/10 hover:text-white transition-all flex items-center gap-2"
                >
                  <span>Upload paper</span>
                </button>

                <button
                  type="button"
                  onClick={() => onOpenScanner?.()}
                  className="h-9 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 text-xs font-semibold text-amber-300 hover:bg-amber-500/20 transition-all flex items-center gap-2"
                >
                  <span>📷 LiveScanner</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onSendMessage('Build an interactive Scholarship & AI Fellowship Application Form with candidate eligibility questions, GPA, technical skills, and essay prompts.');
                  }}
                  className="h-9 rounded-lg border border-[#D97757]/40 bg-[#D97757]/15 px-3.5 text-xs font-semibold text-[#FAF9F5] hover:bg-[#D97757]/25 transition-all flex items-center gap-2"
                >
                  <span>📋 Create Form</span>
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

          {isTyping && (
            <div className="flex flex-col gap-2">
              <BwengeLoader />
            </div>
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
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 text-[#C2C0B6] hover:bg-white/5 hover:text-white transition-colors cursor-pointer" onClick={() => fileInputRef.current?.click()} title="Attach file">
                <Plus size={18} />
              </div>

              <div className="flex-1 flex flex-col min-w-0">
                <textarea
                  ref={textareaRef}
                  rows={1}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Message Bwenge"
                  className="w-full bg-transparent border-0 resize-none text-base leading-6 text-[#FAF9F5] placeholder-[#9C9A92] outline-none px-1 py-1 max-h-40 scrollbar-hidden"
                />
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <ModelPicker selected={selectedProvider} onSelect={(val) => onProviderChange?.(val)} />

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
          </div>

          <div className="mt-1.5 text-center text-[9px] text-[#9C9A92] tracking-[0.2em] font-mono uppercase select-none hidden sm:block">
            Powered by Bwenge Autonomous Agentic System
          </div>
        </div>
      </footer>
    </div>
  );
}
