import React, { useState, useRef, useEffect, useCallback } from 'react';
import RecordingBar from './RecordingBar';
import { AttachmentCard, PreviewDialog, attachmentSource, type PreviewSource } from './FilePreview';
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
  HelpCircle,
  ExternalLink,
  LogOut,
  Copy, X, FolderUp, Coins, Monitor, ClipboardPaste,
} from 'lucide-react';
import { creditMeter, useBillingMe } from './PlanStatus';
import { useNextPrompt } from '../hooks/useNextPrompt';
import { nextPromptEnabled, setNextPromptEnabled, suggestionAction } from '../utils/nextPrompt';
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
  onOpenPublicLibrary: () => void;
  onOpenBiz: () => void;
  onOpenFormsLibrary: () => void;
  onOpenTasks: () => void;
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

const sourceOf = attachmentSource;

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
  // The answer language follows the language you write in; there is no picker for it any more.
  const answerLanguage = 'Auto';
  const [learning, setLearning] = useLearningMode();
  const [speakReplies, setSpeakReplies] = useState(true);
  const voiceLang = speechLang(learning.mode === 'roleplay' ? learning.language : undefined, answerLanguage === 'Auto' ? undefined : answerLanguage);
  const speech = useSpeechInput(voiceLang, useCallback((t: string) => setInputValue((prev) => (prev.trim() ? `${prev.trim()} ${t}` : t)), []));
  // What the box held before dictation, so Cancel puts it back.
  const beforeVoice = useRef<string | null>(null);
  const [previewing, setPreviewing] = useState<PreviewSource | null>(null);
  const [voiceUnsupported, setVoiceUnsupported] = useState(false);
  const [isDraggingAttachments, setIsDraggingAttachments] = useState(false);

  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const plusMenuRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // The box is a slim single line while you read an answer, and opens up when you click into it or start typing.
  const [focused, setFocused] = useState(false);
  const [suggestOn, setSuggestOn] = useState(nextPromptEnabled);
  const suggestion = useNextPrompt({ messages: messages as any, isTyping: !!isTyping, enabled: suggestOn && !isTemporaryChat });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [zipping, setZipping] = useState(false);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const plusPanelRef = useRef<HTMLDivElement>(null);
  const plusButtonRef = useRef<HTMLButtonElement>(null);
  const [pasteDialog, setPasteDialog] = useState<string | null>(null);
  const canScreenshot = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia && !/Android|iPhone|iPad/i.test(navigator.userAgent);
  const isTouch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
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
    // Grows with the message up to about 40% of the screen, then scrolls inside (like Claude).
    el.style.height = `${Math.min(el.scrollHeight, Math.max(160, Math.round(window.innerHeight * 0.4)))}px`;
  }, []);

  useEffect(() => {
    resize();
  }, [inputValue, resize]);

  const handleSend = () => {
    const text = inputValue.trim();
    if (!text && stagedAttachments.length === 0) return;
    if (speech.listening) speech.stop();
    beforeVoice.current = null;
    onSendMessage(text, stagedAttachments, { answerLanguage, learning });
    setInputValue('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    // Ready for the next message without another click (desktop; on phones the keyboard would pop up).
    if (window.matchMedia('(min-width: 1024px)').matches) window.setTimeout(() => textareaRef.current?.focus(), 0);
    stickToBottomRef.current = true;
    setShowNewResponsePill(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Like a code editor's ghost text: Tab fills the suggested next message, Enter sends it (only while the box is empty).
    const act = suggestionAction(e.key, e.shiftKey, inputValue, suggestion);
    if (act === 'fill' && suggestion) { e.preventDefault(); setInputValue(suggestion); return; }
    if (act === 'send' && suggestion && !isTyping && window.matchMedia('(min-width: 1024px)').matches) { e.preventDefault(); onSendMessage(suggestion, stagedAttachments, { answerLanguage, learning }); stickToBottomRef.current = true; return; }
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

  // Capture the screen (or a window/tab) once and attach it as a PNG, like Claude's "Take a screenshot".
  const takeScreenshot = async () => {
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      await video.play();
      await new Promise((r) => setTimeout(r, 250));
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      canvas.getContext('2d')?.drawImage(video, 0, 0);
      const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      if (blob) onStageAttachments?.([new File([blob], `screenshot-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`, { type: 'image/png' })]);
    } catch { /* cancelled by the user */ } finally {
      stream?.getTracks().forEach((t) => t.stop());
    }
  };

  const closePlusMenu = (restoreFocus = true) => {
    setPlusMenuOpen(false);
    if (restoreFocus) plusButtonRef.current?.focus();
  };

  // Arrow keys move through the menu, Escape closes it and returns focus to the "+" button.
  const handlePlusMenuKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); closePlusMenu(); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    const items = Array.from(plusPanelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') || []);
    if (!items.length) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : e.key === 'ArrowDown' ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
    items[next].focus();
  };
  useEffect(() => {
    if (plusMenuOpen) requestAnimationFrame(() => plusPanelRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
  }, [plusMenuOpen]);

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

  // The header slides away while you read down a conversation and comes back when you scroll up (or reach the top).
  const [headerHidden, setHeaderHidden] = useState(false);
  const lastScrollTop = useRef(0);
  const userScrollUntil = useRef(0);          // set while the reader is scrolling by hand (wheel, touch, keys), so the page's own scrolling to the newest message never hides the header
  const markUserScroll = () => { userScrollUntil.current = Date.now() + 300; };
  useEffect(() => { if (messages.length === 0) setHeaderHidden(false); }, [messages.length]);
  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const top = el.scrollTop; const delta = top - lastScrollTop.current; lastScrollTop.current = top;
    if (messages.length > 0) {
      if (top < 48) setHeaderHidden(false);
      else if (delta > 10 && Date.now() < userScrollUntil.current) setHeaderHidden(true);
      else if (delta < -10) setHeaderHidden(false);
    }
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
  // Slim once there is a conversation and you are not writing: just the line, the plus, the mic and send.
  const compact = messages.length > 0 && !focused && !inputValue && stagedAttachments.length === 0 && !speech.listening && !plusMenuOpen && learning.mode === 'normal';

  return (
    <div
      className="relative flex h-full w-full flex-col overflow-hidden bg-[var(--app-bg)] text-[var(--app-text)]"
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setIsDraggingAttachments(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setIsDraggingAttachments(false); }}
      onDrop={handleComposerDrop}
    >
      {isDraggingAttachments && <div className="absolute inset-3 z-40 flex items-center justify-center rounded-2xl border-2 border-dashed border-emerald-400/70 bg-[var(--app-sunken)]/95 text-sm font-medium text-emerald-200 pointer-events-none">Drop documents to attach</div>}
      {/* Header */}
      <header
        style={{ marginTop: headerHidden ? 'calc(-44px - env(safe-area-inset-top, 0px))' : 0, opacity: headerHidden ? 0 : 1 }}
        aria-hidden={headerHidden}
        className="flex h-[calc(44px+env(safe-area-inset-top,0px))] shrink-0 items-center justify-between bg-[var(--app-bg)] px-2 pt-[env(safe-area-inset-top,0px)] transition-[margin-top,opacity] duration-200"
      >
        {/* Left: Menu button on mobile */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenSidebar}
            className="flex h-11 w-11 items-center justify-center rounded-xl text-[var(--app-muted)] hover:bg-white/10 hover:text-white transition-colors lg:hidden"
            aria-label="Open navigation menu"
          >
            <PanelLeft className="h-5 w-5" />
          </button>
          <div className="hidden lg:flex items-center gap-2">
            <span className="text-[13px] font-medium tracking-tight text-[var(--app-muted)]">
              {messages.length > 0 && truncatedTitle ? truncatedTitle : 'New Chat'}
            </span>
          </div>
        </div>

        {/* Center: Truncated conversation title on mobile */}
        <div className="flex-1 px-2 text-center lg:hidden truncate">
          {messages.length > 0 && truncatedTitle && (
            <span className="text-[13px] font-medium text-[var(--app-muted)] truncate">{truncatedTitle}</span>
          )}
        </div>

        {/* Right: Mode Picker, Upgrade / Sign in, More Menu */}
        <div className="flex items-center gap-2">
          {isTemporaryChat && <span className="hidden rounded-full border border-[#F0A12C]/25 bg-[#F0A12C]/10 px-2.5 py-1 text-[10px] font-semibold text-[#F6B94A] sm:inline-flex">Temporary</span>}
          <button
            type="button"
            onClick={onNewChat}
            className="flex h-11 w-11 items-center justify-center rounded-xl text-[var(--app-muted)] hover:bg-white/10 hover:text-white transition-colors lg:hidden"
            aria-label="New chat"
            title="New chat"
          >
            <SquarePen className="h-5 w-5" />
          </button>

          {!user && (
            <button
              onClick={onOpenLoginModal}
              className="flex bg-[var(--brand)] hover:bg-[var(--brand-strong)] text-white font-medium px-3.5 py-1.5 rounded-xl text-xs transition-all shadow-md items-center gap-1.5"
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
              className="flex h-11 w-11 lg:h-9 lg:w-9 items-center justify-center rounded-xl text-[var(--app-muted)] hover:bg-white/10 hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F0A12C]/70"
              aria-label="More options"
            >
              <MoreVertical size={18} />
            </button>

            {menuOpen && typeof document !== 'undefined' && createPortal(
              <div ref={menuRef} role="dialog" aria-label="Conversation options" className="bwenge-menu-scroll bwenge-menu-enter fixed z-[9999] flex max-h-[min(72dvh,36rem)] w-[min(20rem,calc(100vw-1.5rem))] flex-col overflow-y-auto overscroll-contain rounded-2xl border border-white/10 bg-[var(--app-panel-2)] p-2 text-sm text-[var(--app-text)] shadow-[0_24px_80px_rgba(0,0,0,.65)] ring-1 ring-black/30 backdrop-blur-2xl" style={{ top: menuPosition.top, right: menuPosition.right }}>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 hover:bg-white/10">
                  <input type="checkbox" className="h-3.5 w-3.5 accent-[var(--brand)]" checked={suggestOn} onChange={(e) => { setSuggestOn(e.target.checked); setNextPromptEnabled(e.target.checked); }} />
                  <span>Suggest my next message</span>
                </label>
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
                  <Share2 className="h-4 w-4 text-[#4CE5D6]" /> <span className="flex-1">Share conversation<span className="block text-[11px] text-neutral-500">HTML page with the files Bwenge made</span></span>
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
        onWheel={markUserScroll}
        onTouchMove={markUserScroll}
        onKeyDown={markUserScroll}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-hidden relative"
      >
        <div className={`mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6 ${messages.length === 0 ? 'min-h-full justify-center' : ''}`}>
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-4 text-center sm:py-10 lg:py-16 animate-in fade-in duration-300">
              {/* Logo Mark */}
              <div className="w-12 h-12 rounded-2xl bg-[#0D2B24] flex items-center justify-center overflow-hidden border border-emerald-500/30 shadow-lg mb-4">
                <img src={logoUrl} alt="Bwenge Logo" className="w-full h-full object-cover" />
              </div>

              <h1 className="font-display text-[26px] font-normal tracking-tight text-[var(--app-text)] sm:text-[32px]">
                What’s on your mind?
              </h1>
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
              className="flex items-center gap-1.5 rounded-full bg-[var(--app-panel)] border border-white/15 px-4 py-2 text-xs font-semibold text-[var(--app-text)] shadow-2xl hover:bg-white/10 transition-all"
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
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
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

      {pasteDialog !== null && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Paste text as attachment"
          onKeyDown={(e) => { if (e.key === 'Escape') setPasteDialog(null); }}>
          <div className="w-full max-w-lg rounded-2xl border border-white/15 bg-[var(--app-panel-2)] p-4 shadow-2xl">
            <h2 className="mb-2 text-sm font-semibold text-[var(--app-text)]">Paste text as attachment</h2>
            <textarea autoFocus value={pasteDialog} onChange={(e) => setPasteDialog(e.target.value)} rows={10} placeholder="Paste or type the text here…"
              className="w-full resize-none rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-[var(--app-text)] outline-none focus:border-white/30" />
            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs text-[var(--app-muted)]">{pasteDialog.length.toLocaleString()} characters</span>
              <div className="flex gap-2">
                <button type="button" onClick={() => setPasteDialog(null)} className="rounded-full border border-white/10 px-4 py-1.5 text-xs text-neutral-300 hover:bg-white/5">Cancel</button>
                <button type="button" disabled={!pasteDialog.trim()}
                  onClick={() => { onStageAttachments?.([new File([pasteDialog], `pasted-text-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}.txt`, { type: 'text/plain' })]); setPasteDialog(null); }}
                  className="rounded-full bg-white px-4 py-1.5 text-xs font-medium text-black disabled:opacity-40">Attach</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Composer Footer */}
      <footer className="shrink-0 bg-[var(--app-bg)] px-3 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))]">
        <div className="mx-auto w-full max-w-2xl relative">
          <LearningModeBanner value={learning} onExit={() => setLearning({ mode: 'normal' })} speak={speakReplies} onToggleSpeak={() => { setSpeakReplies((v) => !v); window.speechSynthesis?.cancel(); }}
            onFeedback={() => onSendMessage('End the roleplay and give me my feedback.', [], { answerLanguage, learning })} />
          <div
            onFocusCapture={() => setFocused(true)}
            onBlurCapture={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false); }}
            className={`border border-white/10 bg-[var(--app-panel)] shadow-[0_4px_24px_rgba(0,0,0,0.25)] transition-[padding,border-radius] duration-200 ${compact ? 'rounded-full px-2 py-1.5' : 'rounded-[28px] p-3'}`}
          >
            {stagedAttachments.length > 0 && (
              <div className="mb-2.5 flex gap-2.5 overflow-x-auto px-1 pb-1 pt-2">
                {stagedAttachments.map((meta: any, idx: number) => {
                  const src = sourceOf(meta);
                  return <AttachmentCard key={`${src.name}-${idx}`} src={src} onOpen={() => setPreviewing(src)} onRemove={onRemoveStagedAttachment ? () => onRemoveStagedAttachment(idx) : undefined} size={104} />;
                })}
              </div>
            )}
            {attachmentError && <p role="alert" className="mb-2 px-2 text-xs text-rose-300">{attachmentError}</p>}
            {voiceUnsupported && <p role="alert" className="mb-2 flex items-center gap-2 px-2 text-xs text-amber-200">Voice input needs Chrome, Edge or Safari. You can type, or use your phone keyboard's microphone.<button type="button" onClick={() => setVoiceUnsupported(false)} className="text-neutral-400 hover:text-white" aria-label="Dismiss"><X size={12} /></button></p>}
            {speech.error && <p role="alert" className="mb-2 flex items-center gap-2 px-2 text-xs text-amber-200">{speech.error}<button type="button" onClick={speech.clearError} className="text-neutral-400 hover:text-white" aria-label="Dismiss"><X size={12} /></button></p>}
            {speech.listening && (
              <RecordingBar interim={speech.interim}
                onCancel={() => { speech.abort(); if (beforeVoice.current !== null) setInputValue(beforeVoice.current); beforeVoice.current = null; }}
                onDone={() => { speech.stop(); beforeVoice.current = null; textareaRef.current?.focus(); }} />
            )}

            <div className="flex items-end gap-2">
              {/* Plus Button with Menu Popover */}
              <div className="relative" ref={plusMenuRef}>
                <button
                  ref={plusButtonRef}
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={plusMenuOpen}
                  aria-label="Add files and more"
                  onClick={() => setPlusMenuOpen((prev) => !prev)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 text-[var(--app-muted)] hover:bg-white/5 hover:text-white transition-colors"
                  title="Add files and more"
                >
                  <Plus size={18} className={`transition-transform duration-150 ${plusMenuOpen ? 'rotate-45' : ''}`} />
                </button>

                {plusMenuOpen && (
                  <div
                    ref={plusPanelRef}
                    role="menu"
                    aria-label="Add to message"
                    onKeyDown={handlePlusMenuKey}
                    className="absolute bottom-full left-0 mb-2 w-64 rounded-2xl border border-white/15 bg-[var(--app-panel-2)] shadow-2xl z-50 py-1.5 text-sm text-[var(--app-text)] animate-in fade-in slide-in-from-bottom-2"
                  >
                    {([
                      { key: 'files', icon: <Paperclip className="w-4 h-4 text-amber-400" />, label: 'Add files or photos', hint: 'PDF, Word, slides, sheets, images', run: () => fileInputRef.current?.click(), show: true },
                      { key: 'camera', icon: <Camera className="w-4 h-4 text-emerald-400" />, label: 'Take a photo', hint: 'Use your camera', run: () => cameraInputRef.current?.click(), show: isTouch },
                      { key: 'shot', icon: <Monitor className="w-4 h-4 text-sky-400" />, label: 'Take a screenshot', hint: 'Capture a screen or window', run: () => void takeScreenshot(), show: canScreenshot },
                      { key: 'folder', icon: <FolderUp className="w-4 h-4 text-violet-300" />, label: 'Add a folder', hint: 'Sent as one ZIP', run: () => folderInputRef.current?.click(), show: !isTouch },
                      { key: 'scan', icon: <Camera className="w-4 h-4 text-emerald-400" />, label: 'Mark papers with the camera', hint: 'Scan and grade student work', run: () => onOpenScanner?.(), show: !!onOpenScanner },
                      { key: 'text', icon: <ClipboardPaste className="w-4 h-4 text-sky-400" />, label: 'Paste text as attachment', hint: 'Keeps long text out of your message', run: () => setPasteDialog(''), show: true },
                    ] as const).filter((i) => i.show).map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        role="menuitem"
                        onClick={() => { closePlusMenu(false); item.run(); }}
                        className="w-full flex items-center gap-3 px-3.5 py-2 hover:bg-white/5 focus:bg-white/10 focus:outline-none text-left text-neutral-200"
                      >
                        <span className="shrink-0">{item.icon}</span>
                        <span className="min-w-0">
                          <span className="block leading-tight">{item.label}</span>
                          <span className="block text-[11px] leading-tight text-[var(--app-muted)]">{item.hint}</span>
                        </span>
                      </button>
                    ))}
                    <p className="border-t border-white/10 mt-1 px-3.5 pt-2 pb-1 text-[11px] text-[var(--app-muted)]">Up to 10 files per message. You can also drag files here or paste them.</p>
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
                  placeholder={suggestion && !isTyping ? suggestion : messages.length > 0 ? 'Reply to Bwenge…' : typeof window !== 'undefined' && window.innerWidth < 640 ? 'Ask Bwenge anything…' : 'Ask anything, or attach files and datasets…'}
                  aria-describedby={suggestion && !inputValue ? 'next-prompt-hint' : undefined}
                  className="w-full bg-transparent border-0 resize-none text-base leading-6 text-[var(--app-text)] placeholder-[var(--app-faint)] outline-none px-1 py-1 scrollbar-hidden"
                />
              </div>
              {suggestion && !inputValue && !isTyping && (
                <button
                  type="button"
                  id="next-prompt-hint"
                  onClick={() => { setInputValue(suggestion); window.setTimeout(() => textareaRef.current?.focus(), 0); }}
                  className="mb-0.5 hidden h-8 shrink-0 items-center gap-1 rounded-full border border-white/10 px-2.5 text-[11px] font-semibold text-[var(--app-muted)] hover:bg-white/5 hover:text-white sm:inline-flex"
                  title="Use the suggested message (Tab)"
                >
                  <kbd className="rounded border border-white/15 px-1 text-[10px]">Tab</kbd> use
                </button>
              )}
              {suggestion && !inputValue && !isTyping && (
                <button
                  type="button"
                  onClick={() => { setInputValue(suggestion); window.setTimeout(() => textareaRef.current?.focus(), 0); }}
                  className="mb-0.5 inline-flex h-8 shrink-0 items-center rounded-full border border-white/10 px-2.5 text-[11px] font-semibold text-[var(--app-muted)] hover:bg-white/5 sm:hidden"
                  aria-label="Use the suggested message"
                >
                  Use
                </button>
              )}

              {/* Mic & Send Buttons */}
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    if (speech.listening) { speech.stop(); beforeVoice.current = null; return; }
                    beforeVoice.current = inputValue;
                    if (!speech.start()) { beforeVoice.current = null; setVoiceUnsupported(true); }
                  }}
                  className={`flex h-9 w-9 items-center justify-center rounded-full border transition-colors ${
                    speech.listening
                      ? 'border-rose-500 bg-rose-500/20 text-rose-400 animate-pulse'
                      : 'border-white/10 text-[var(--app-muted)] hover:bg-white/5 hover:text-white'
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
                      ? 'bg-[var(--brand)] text-white shadow-md active:scale-95'
                      : 'bg-[var(--brand)]/40 text-white/50 cursor-not-allowed'
                  }`}
                  aria-label={isTyping ? 'Stop generating' : 'Send message'}
                >
                  {isTyping ? <Square size={16} fill="currentColor" /> : <ArrowUp size={18} strokeWidth={2.5} />}
                </button>
              </div>
            </div>

            {/* Under the box (only while you are writing): the learning mode picker */}
            {!compact && (
              <div className="mt-2.5 pt-2 border-t border-white/5 flex items-center justify-between text-[11px] text-neutral-400">
                <div className="flex items-center gap-3">
                  <LearningModePicker value={learning} onChange={setLearning} />
                </div>

              </div>
            )}
          </div>

          {/* Credits left (plan) and disclaimer */}
          <div className="mt-2 flex items-center justify-between gap-3 px-1 text-[10.5px] text-[var(--app-faint)] select-none">
            {billing ? (
              <span className="flex min-w-0 items-center gap-1.5">
                <Coins size={11} className="shrink-0 text-[var(--brand)]" />
                <span className="truncate">
                  {creditMeter(billing.usage).label}
                  {billing.wallet > 0 ? ` · ${billing.wallet.toLocaleString('en-US')} top-up` : ''}
                </span>
                {(billing.plan === 'FREE' || billing.plan === 'GO') && <a href="/upgrade" className="shrink-0 font-semibold text-[var(--brand)] hover:underline">Upgrade</a>}
              </span>
            ) : <span />}
            <span className="hidden shrink-0 sm:inline">{zipping ? 'Packing folder…' : 'Bwenge can make mistakes. Check important information.'}</span>
            {zipping && <span className="shrink-0 sm:hidden">Packing folder…</span>}
          </div>
        </div>
      </footer>
      {previewing && <PreviewDialog src={previewing} onClose={() => setPreviewing(null)} />}
    </div>
  );
}
