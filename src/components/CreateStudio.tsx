import React, { useState, useRef, useEffect, useCallback } from 'react';
import { FileTypeIcon } from './FileTypeIcon';
import { createPortal } from 'react-dom';
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
  Share2,
  PanelLeft,
  SquarePen,
  ArrowUp,
  Camera,
  Mic,
  Globe,
  BookOpen,
  Database,
  LayoutDashboard,
  Languages,
  HelpCircle,
  ExternalLink,
  LogOut,
  Copy, X, FolderUp, Coins,
} from 'lucide-react';
import { useBillingMe } from './PlanStatus';
import { LearningModeBanner, LearningModePicker, speakText, speechLang, useLearningMode, useSpeechInput } from './LearningMode';
import type { LearningSettings } from '../lib/learning/presets';
import { Message as MessageType, ChatAttachment, ResponseFeedbackDetails } from '../types';
import ChatMessage from './ChatMessage';
import logoUrl from '../assets/bwenge-logo.svg';

interface CreateStudioProps {
  messages: MessageType[];
  onSendMessage: (
    text: string,
    attachment?: File | ChatAttachment | Array<File | ChatAttachment>,
    options?: { answerLanguage?: string; learning?: LearningSettings },
  ) => void | Promise<void>;
  onNewChat: () => void;
  onLoadSession: (id: string) => void;
  onOpenSettings?: () => void;
  onOpenForms?: () => void;
  onDeleteChat?: () => void;
  onExportChat?: () => void;
  onShare?: () => void;
  onRenameChat?: (title: string) => void;
  activeSessionId?: string | null;
  currentChatTitle?: string;
  isTemporaryChat?: boolean;
  onToggleTemporaryChat?: () => void;
  onLogout?: () => void;
  isTyping?: boolean;
  onAbort?: () => void;
  selectedProvider?: string;
  onProviderChange?: (provider: string) => void;
  stagedAttachments?: Array<File | ChatAttachment>;
  attachmentError?: string;
  onStageAttachments?: (attachments: Array<File | ChatAttachment>) => void;
  onRemoveStagedAttachment?: (index: number) => void;
  onOpenSidebar?: () => void;
  onOpenScanner?: () => void;
  onPreviewDoc?: (doc: any) => void;
  onFeedback?: (messageId: string, rating: 'up' | 'down', details: ResponseFeedbackDetails) => void | Promise<void>;
  onRetry?: (messageId: string) => void;
  onUpgradeClick?: (jobId: string, service: string) => void;
  userName?: string;
  user?: any;
  onOpenLoginModal?: () => void;
}

function attachmentMeta(item: File | ChatAttachment) {
  const name = item instanceof File ? item.name : item.name || 'Attachment';
  const bytes = item instanceof File ? item.size : typeof item.size === 'number' ? item.size : 0;
  const size = bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : bytes ? `${bytes} B` : !(item instanceof File) ? item.size : '';
  return { name, size, type: name.split('.').pop()?.toUpperCase() || 'FILE' };
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
  onSendMessage,
  onNewChat,
  onLoadSession,
  onOpenSettings,
  onOpenForms,
  onDeleteChat,
  onExportChat,
  onShare,
  onRenameChat,
  activeSessionId,
  currentChatTitle = '',
  isTemporaryChat = false,
  onToggleTemporaryChat,
  onLogout,
  isTyping,
  onAbort,
  selectedProvider = 'auto',
  onProviderChange,
  stagedAttachments = [],
  attachmentError = '',
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
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 12 });
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [showSources, setShowSources] = useState(true);
  const [answerLanguage, setAnswerLanguage] = useState('Auto');
  const [learning, setLearning] = useLearningMode();
  const [speakReplies, setSpeakReplies] = useState(true);
  const voiceLang = speechLang(learning.mode === 'roleplay' ? learning.language : undefined, answerLanguage === 'Auto' ? undefined : answerLanguage);
  const speech = useSpeechInput(voiceLang, useCallback((t: string) => setInputValue((prev) => (prev.trim() ? `${prev.trim()} ${t}` : t)), []));
  const [isDraggingAttachments, setIsDraggingAttachments] = useState(false);

  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const plusMenuRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [zipping, setZipping] = useState(false);
  const billing = useBillingMe(true);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const [showNewResponsePill, setShowNewResponsePill] = useState(false);

  const positionMenu = useCallback(() => {
    const trigger = menuTriggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    setMenuPosition({ top: Math.min(rect.bottom + 8, window.innerHeight - 80), right: Math.max(12, window.innerWidth - rect.right) });
  }, []);

  // Close menus on pointerdown outside
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && menuOpen) {
        setMenuOpen(false);
        setRenameOpen(false);
        menuTriggerRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [menuOpen]);

  useEffect(() => {
    const handleOutside = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!menuRef.current?.contains(target) && !menuTriggerRef.current?.contains(target)) {
        setMenuOpen(false);
        setRenameOpen(false);
      }
      if (plusMenuRef.current && !plusMenuRef.current.contains(e.target as Node)) {
        setPlusMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', handleOutside);
    return () => document.removeEventListener('pointerdown', handleOutside);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    positionMenu();
    window.addEventListener('resize', positionMenu);
    window.addEventListener('scroll', positionMenu, true);
    return () => {
      window.removeEventListener('resize', positionMenu);
      window.removeEventListener('scroll', positionMenu, true);
    };
  }, [menuOpen, positionMenu]);

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
    onSendMessage(text, stagedAttachments, { answerLanguage, learning });
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

  // A whole folder (e.g. one sub-folder of page photos per student) is zipped in the browser and sent as one file.
  const handleFolderChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter((f) => !/(^|\/)\./.test((f as any).webkitRelativePath || f.name));
    e.target.value = '';
    if (!files.length) return;
    const total = files.reduce((a, f) => a + f.size, 0);
    if (total > 200 * 1024 * 1024) { window.alert('That folder is larger than 200 MB. Send it in parts.'); return; }
    setZipping(true);
    try {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      for (const f of files) zip.file((f as any).webkitRelativePath || f.name, f);
      const folder = ((files[0] as any).webkitRelativePath || 'folder').split('/')[0] || 'folder';
      const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
      onStageAttachments?.([new File([blob], `${folder}.zip`, { type: 'application/zip' })]);
    } finally {
      setZipping(false);
    }
  };

  const handleComposerPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files || []);
    if (files.length > 0) {
      e.preventDefault();
      onStageAttachments?.(files);
      return;
    }
    const pastedText = e.clipboardData.getData('text/plain') || '';
    if (pastedText.length > 10_000) {
      e.preventDefault();
      onStageAttachments?.([new File([pastedText], 'pasted-text.txt', { type: 'text/plain' })]);
    }
  };

  const handleComposerDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    setIsDraggingAttachments(false);
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length > 0) onStageAttachments?.(files);
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

  // Roleplay: read each finished reply aloud in the practice language.
  const wasTyping = useRef(false);
  useEffect(() => {
    if (wasTyping.current && !isTyping && learning.mode === 'roleplay' && speakReplies) {
      const last = [...messages].reverse().find((m) => m.sender === 'assistant');
      if (last?.text) speakText(last.text, voiceLang);
    }
    wasTyping.current = !!isTyping;
  }, [isTyping, messages, learning.mode, speakReplies, voiceLang]);

  const canSend = Boolean(inputValue.trim() || stagedAttachments.length > 0 || isTyping);

  return (
    <div
      className="relative flex h-full w-full flex-col overflow-hidden bg-[#262624] text-[#FAF9F5]"
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setIsDraggingAttachments(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setIsDraggingAttachments(false); }}
      onDrop={handleComposerDrop}
    >
      {isDraggingAttachments && <div className="absolute inset-3 z-40 flex items-center justify-center rounded-2xl border-2 border-dashed border-emerald-400/70 bg-[#141413]/95 text-sm font-medium text-emerald-200 pointer-events-none">Drop documents to attach</div>}
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
          {isTemporaryChat && <span className="hidden rounded-full border border-[#F0A12C]/25 bg-[#F0A12C]/10 px-2.5 py-1 text-[10px] font-semibold text-[#F6B94A] sm:inline-flex">Temporary</span>}
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

          {user ? (billing?.plan === 'PRO' || billing?.plan === 'INSTITUTION' ? null : (
            <button
              onClick={() => (window as any).openUpgradeModal?.()}
              className="hidden sm:flex bg-gradient-to-r from-amber-500/20 to-orange-600/10 hover:from-amber-500/30 hover:to-orange-600/20 text-amber-400 font-medium px-3.5 py-1.5 rounded-xl border border-amber-500/30 text-xs transition-all shadow-md items-center gap-1.5"
            >
              <Sparkles size={13} /> Upgrade
            </button>
          )) : (
            <button
              onClick={onOpenLoginModal}
              className="flex bg-[#D97757] hover:bg-[#c26647] text-white font-medium px-3.5 py-1.5 rounded-xl text-xs transition-all shadow-md items-center gap-1.5"
            >
              Sign in
            </button>
          )}

          {/* Three Dots Categorized Menu */}
          <div className="relative">
            <button
              ref={menuTriggerRef}
              type="button"
              onClick={() => {
                if (menuOpen) setRenameOpen(false);
                else positionMenu();
                setMenuOpen((prev) => !prev);
              }}
              aria-haspopup="dialog"
              aria-expanded={menuOpen}
              title="Conversation menu"
              className="flex h-11 w-11 lg:h-9 lg:w-9 items-center justify-center rounded-xl text-[#C2C0B6] hover:bg-white/10 hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F0A12C]/70"
              aria-label="More options"
            >
              <MoreVertical size={18} />
            </button>

            {menuOpen && typeof document !== 'undefined' && createPortal(
              <div ref={menuRef} role="dialog" aria-label="Conversation options" className="bwenge-menu-scroll bwenge-menu-enter fixed z-[9999] flex max-h-[min(72dvh,36rem)] w-[min(20rem,calc(100vw-1.5rem))] flex-col overflow-y-auto overscroll-contain rounded-2xl border border-white/10 bg-[#20201F] p-2 text-sm text-[#FAF9F5] shadow-[0_24px_80px_rgba(0,0,0,.65)] ring-1 ring-black/30 backdrop-blur-2xl" style={{ top: menuPosition.top, right: menuPosition.right }}>
                {/* This Chat Section */}
                <div className="px-3 pb-1.5 pt-2 font-bold text-[10px] tracking-[.14em] uppercase text-neutral-400">Conversation</div>
                <button
                  type="button"
                  onClick={() => {
                    onShare?.();
                    setMenuOpen(false);
                  }}
                  disabled={!messages.length || !onShare}
                  className="flex min-h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-neutral-200 transition-colors hover:bg-white/[.07] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F0A12C]/70 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Share2 className="h-4 w-4 text-[#4CE5D6]" /> Share conversation
                </button>
                {renameOpen ? (
                  <form
                    className="my-1 rounded-xl border border-white/10 bg-white/[.035] p-2.5"
                    onSubmit={(event) => {
                      event.preventDefault();
                      onRenameChat?.(renameValue);
                      setRenameOpen(false);
                      setMenuOpen(false);
                    }}
                  >
                    <label htmlFor="rename-chat-title" className="mb-2 block text-[11px] font-medium text-neutral-400">Conversation title</label>
                    <input
                      id="rename-chat-title"
                      autoFocus
                      maxLength={80}
                      value={renameValue}
                      onChange={(event) => setRenameValue(event.target.value)}
                      className="w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm text-white outline-none placeholder:text-neutral-600 focus:border-[#F0A12C]/60 focus:ring-2 focus:ring-[#F0A12C]/15"
                      placeholder="Add a title"
                    />
                    <div className="mt-2 flex justify-end gap-2">
                      <button type="button" onClick={() => setRenameOpen(false)} className="rounded-lg px-3 py-1.5 text-xs text-neutral-400 hover:bg-white/5 hover:text-white">Cancel</button>
                      <button type="submit" disabled={!renameValue.trim()} className="rounded-lg bg-[#F0A12C] px-3 py-1.5 text-xs font-semibold text-[#161513] hover:bg-[#F6B94A] disabled:opacity-40">Save title</button>
                    </div>
                  </form>
                ) : (
                  <button
                    type="button"
                    disabled={!activeSessionId || !onRenameChat}
                    onClick={() => { setRenameValue(currentChatTitle); setRenameOpen(true); }}
                    className="flex min-h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-neutral-200 transition-colors hover:bg-white/[.07] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F0A12C]/70 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <FileText className="h-4 w-4 text-[#F0A12C]" /> Rename conversation
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    onExportChat?.();
                    setMenuOpen(false);
                  }}
                  disabled={!messages.length}
                  className="flex min-h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-neutral-200 transition-colors hover:bg-white/[.07] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F0A12C]/70 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Copy className="h-4 w-4 text-[#4CE5D6]" /> Copy conversation
                </button>
                <button
                  type="button"
                  aria-pressed={isTemporaryChat}
                  onClick={onToggleTemporaryChat}
                  disabled={isTyping}
                  className={`flex min-h-10 w-full items-center justify-between rounded-xl px-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F0A12C]/70 disabled:cursor-not-allowed disabled:opacity-40 ${isTemporaryChat ? 'bg-[#F0A12C]/10 text-white' : 'text-neutral-200 hover:bg-white/[.07] hover:text-white'}`}
                >
                  <span className="flex items-center gap-3"><Sparkles className="h-4 w-4 text-[#B28AFF]" /> Temporary chat</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${isTemporaryChat ? 'bg-[#F0A12C]/20 text-[#F6B94A]' : 'bg-white/[.07] text-neutral-400'}`}>{isTemporaryChat ? 'On' : 'Off'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (messages.length && !window.confirm('Delete this conversation and remove it from recent chats?')) return;
                    onDeleteChat?.();
                    setMenuOpen(false);
                  }}
                  disabled={!messages.length || isTyping}
                  className="flex min-h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-[#F28B82] transition-colors hover:bg-rose-500/10 hover:text-[#FFAAA3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300/50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Trash2 className="h-4 w-4" /> Delete conversation
                </button>

                <div className="my-2 border-t border-white/[.08]"></div>

                {/* Answers Section */}
                <div className="px-3 pb-1.5 pt-1 font-bold text-[10px] tracking-[.14em] uppercase text-neutral-400">Answer preferences</div>
                <button
                  type="button"
                  aria-pressed={showSources}
                  onClick={() => setShowSources(!showSources)}
                  className="flex min-h-10 w-full items-center justify-between rounded-xl px-3 text-left text-neutral-200 transition-colors hover:bg-white/[.07] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F0A12C]/70"
                >
                  <span className="flex items-center gap-3"><BookOpen className="h-4 w-4 text-[#4CE5D6]" /> Show sources</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${showSources ? 'bg-emerald-400/15 text-emerald-300' : 'bg-white/[.07] text-neutral-400'}`}>
                    {showSources ? 'On' : 'Off'}
                  </span>
                </button>
                <label className="flex min-h-10 items-center justify-between gap-3 rounded-xl px-3 text-neutral-200 hover:bg-white/[.07]">
                  <span className="flex items-center gap-3"><Languages className="h-4 w-4 text-[#F0A12C]" /> Answer language</span>
                  <select
                    value={answerLanguage}
                    onChange={(e) => setAnswerLanguage(e.target.value)}
                    className="max-w-32 rounded-lg border border-white/10 bg-[#151514] px-2.5 py-1.5 text-xs text-neutral-200 outline-none focus:border-[#F0A12C]/60 focus:ring-2 focus:ring-[#F0A12C]/15"
                  >
                    <option value="Auto">Auto</option>
                    <option value="Kinyarwanda">Kinyarwanda</option>
                    <option value="English">English</option>
                    <option value="French">French</option>
                  </select>
                </label>

                <div className="my-2 border-t border-white/[.08]"></div>

                {/* App Section */}
                <div className="px-3 pb-1.5 pt-1 font-bold text-[10px] tracking-[.14em] uppercase text-neutral-400">App</div>
                <button
                  type="button"
                  onClick={() => {
                    onOpenSettings?.();
                    setMenuOpen(false);
                  }}
                  className="flex min-h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-neutral-200 transition-colors hover:bg-white/[.07] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F0A12C]/70"
                >
                  <Globe className="h-4 w-4 text-[#4CE5D6]" /> Language & theme settings
                </button>
                <button
                  type="button"
                  onClick={() => { onOpenForms?.(); setMenuOpen(false); }}
                  className="flex min-h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-neutral-200 transition-colors hover:bg-white/[.07] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F0A12C]/70"
                >
                  <FileText className="h-4 w-4 text-[#F0A12C]" /> Open Agent & forms workspace
                </button>
                <a
                  href="https://t.me/Bwengebot"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-neutral-200 transition-colors hover:bg-white/[.07] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F0A12C]/70"
                >
                  <ExternalLink className="h-4 w-4 text-sky-300" /> Open Telegram
                </a>
                <button
                  type="button"
                  onClick={() => {
                    window.location.href = 'mailto:support@bwenge.space?subject=Support%20Ticket%20-%20Bwenge%20AI%20Studio';
                    setMenuOpen(false);
                  }}
                  className="flex min-h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-neutral-200 transition-colors hover:bg-white/[.07] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F0A12C]/70"
                >
                  <HelpCircle className="h-4 w-4 text-[#F0A12C]" /> Help & support
                </button>
                {user && onLogout && (
                  <button
                    type="button"
                    onClick={() => { onLogout(); setMenuOpen(false); }}
                    className="flex min-h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-[#F28B82] transition-colors hover:bg-rose-500/10 hover:text-[#FFAAA3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300/50"
                  >
                    <LogOut className="h-4 w-4" /> Sign out
                  </button>
                )}
              </div>,
              document.body,
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
                  onClick={() => onSendMessage("Which datasets are available, and what are the most important insights in them?")}
                  className="p-3.5 rounded-2xl border border-white/10 bg-[#30302E]/80 hover:bg-[#30302E] hover:border-emerald-500/40 transition-all flex flex-col gap-1.5 shadow-sm group"
                >
                  <div className="flex items-center gap-2 text-emerald-400 font-semibold text-xs">
                    <Database size={16} /> Explore a dataset
                  </div>
                  <p className="text-[11px] text-[#C2C0B6] group-hover:text-[#FAF9F5] leading-relaxed">
                    Search, read and analyse curated data
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
                  onClick={() => onSendMessage("Create an interactive HTML dashboard that demonstrates student performance: class A averaged 62%, 68% and 74% in terms 1 to 3, and class B 58%, 61% and 70%. Include KPIs, a chart, a table and the key insights.")}
                  className="p-3.5 rounded-2xl border border-white/10 bg-[#30302E]/80 hover:bg-[#30302E] hover:border-teal-500/40 transition-all flex flex-col gap-1.5 shadow-sm group"
                >
                  <div className="flex items-center gap-2 text-teal-400 font-semibold text-xs">
                    <LayoutDashboard size={16} /> Build a live dashboard
                  </div>
                  <p className="text-[11px] text-[#C2C0B6] group-hover:text-[#FAF9F5] leading-relaxed">
                    Turn figures into an interactive HTML page
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
                    Draft and translate in English, French & Kinyarwanda
                  </p>
                </button>
              </div>
            </div>
          ) : (
            messages.map((msg, idx) => (
              <ChatMessage
                key={msg.id ?? idx}
                message={{
                  ...msg,
                  sources: showSources ? msg.sources : [],
                  citations: showSources ? msg.citations : [],
                  sourcesUsed: showSources ? (msg as any).sourcesUsed : [],
                }}
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
        accept=".pdf,.doc,.docx,.odt,.rtf,.ppt,.pptx,.xls,.xlsx,.ods,.csv,.tsv,.txt,.md,.json,.js,.jsx,.ts,.tsx,.py,.java,.cpp,.c,.h,.html,.css,.xml,.yaml,.yml,.sql,.png,.jpg,.jpeg,.webp,.gif,.heic,.heif,.tif,.tiff,.zip,image/*"
        onChange={handleFileChange}
        className="hidden"
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        {...({ webkitdirectory: '', directory: '' } as any)}
        onChange={(e) => void handleFolderChange(e)}
        className="hidden"
      />

      {/* Composer Footer */}
      <footer className="shrink-0 bg-[#262624] px-3 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))]">
        <div className="mx-auto w-full max-w-2xl relative">
          <LearningModeBanner value={learning} onExit={() => setLearning({ mode: 'normal' })} speak={speakReplies} onToggleSpeak={() => { setSpeakReplies((v) => !v); window.speechSynthesis?.cancel(); }}
            onFeedback={() => onSendMessage('End the roleplay and give me my feedback.', [], { answerLanguage, learning })} />
          <div className="rounded-[28px] border border-white/10 bg-[#30302E] p-3 shadow-[0_4px_24px_rgba(0,0,0,0.25)]">
            {stagedAttachments.length > 0 && (
              <div className="mb-2.5 flex flex-wrap gap-2 overflow-x-auto pb-1">
                {stagedAttachments.map((meta: any, idx: number) => (
                  <div
                    key={`${attachmentMeta(meta).name}-${idx}`}
                    className="flex max-w-full items-center gap-2 rounded-xl border border-white/10 bg-white/5 py-1.5 px-2.5 text-xs text-[#FAF9F5]"
                  >
                    <FileTypeIcon name={attachmentMeta(meta).name} size="sm" />
                    <span className="max-w-[180px] min-w-0 truncate" title={attachmentMeta(meta).name}>{attachmentMeta(meta).name}</span>
                    <span className="shrink-0 rounded bg-white/[.07] px-1 py-0.5 text-[9px] font-semibold text-neutral-400">{attachmentMeta(meta).type}</span>
                    {attachmentMeta(meta).size && <span className="shrink-0 text-[10px] text-neutral-500">{attachmentMeta(meta).size}</span>}
                    <button
                      type="button"
                      onClick={() => onRemoveStagedAttachment?.(idx)}
                      className="ml-1 h-7 w-7 flex items-center justify-center text-[#9C9A92] hover:text-rose-400 transition-colors"
                      aria-label={`Remove ${attachmentMeta(meta).name}`}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {attachmentError && <p role="alert" className="mb-2 px-2 text-xs text-rose-300">{attachmentError}</p>}

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
                  <div className="absolute bottom-full left-0 mb-2 w-52 rounded-2xl border border-white/15 bg-[#212121] shadow-2xl z-50 py-1.5 text-xs text-[#FAF9F5] animate-in fade-in slide-in-from-bottom-1">
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
                    <button
                      type="button"
                      onClick={() => {
                        folderInputRef.current?.click();
                        setPlusMenuOpen(false);
                      }}
                      className="w-full flex items-center px-3.5 py-2.5 hover:bg-white/5 text-left text-neutral-200"
                    >
                      <FolderUp className="mr-3 w-4 h-4 text-violet-300" /> Upload Folder
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
                  onPaste={handleComposerPaste}
                  placeholder={typeof window !== 'undefined' && window.innerWidth < 640 ? 'Ask Bwenge anything…' : 'Ask anything, or attach files and datasets…'}
                  className="w-full bg-transparent border-0 resize-none text-base leading-6 text-[#FAF9F5] placeholder-[#9C9A92] outline-none px-1 py-1 max-h-40 scrollbar-hidden"
                />
              </div>

              {/* Mic & Send Buttons */}
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    if (speech.listening) { speech.stop(); return; }
                    if (!speech.start()) window.alert('Voice input is not available in this browser. Try Chrome or Edge, or type your message.');
                  }}
                  className={`flex h-9 w-9 items-center justify-center rounded-full border transition-colors ${
                    speech.listening
                      ? 'border-rose-500 bg-rose-500/20 text-rose-400 animate-pulse'
                      : 'border-white/10 text-[#C2C0B6] hover:bg-white/5 hover:text-white'
                  }`}
                  title={speech.listening ? 'Stop listening' : 'Speak your message'}
                  aria-pressed={speech.listening}
                  aria-label={speech.listening ? 'Stop voice input' : 'Voice input'}
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
                <LearningModePicker value={learning} onChange={setLearning} />
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

          {/* Credits left (plan) and disclaimer */}
          <div className="mt-2 flex items-center justify-between gap-3 px-1 text-[10.5px] text-[#9C9A92] select-none">
            {billing ? (
              <span className="flex min-w-0 items-center gap-1.5">
                <Coins size={11} className="shrink-0 text-[#D97757]" />
                <span className="truncate">
                  {Math.max(0, billing.usage.day.limit - billing.usage.day.used)} of {billing.usage.day.limit} credits left today
                  {billing.wallet > 0 ? ` · ${billing.wallet.toLocaleString('en-US')} GO` : ''}
                </span>
                {(billing.plan === 'FREE' || billing.plan === 'GO') && <a href="/upgrade" className="shrink-0 font-semibold text-[#D97757] hover:underline">Upgrade</a>}
              </span>
            ) : <span />}
            <span className="hidden shrink-0 sm:inline">{zipping ? 'Packing folder…' : 'Bwenge can make mistakes. Check important information.'}</span>
            {zipping && <span className="shrink-0 sm:hidden">Packing folder…</span>}
          </div>
        </div>
      </footer>
    </div>
  );
}
