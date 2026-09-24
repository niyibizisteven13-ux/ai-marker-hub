import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Bell, Sparkles, Brain, Cpu, ShieldCheck, Database, Search } from 'lucide-react';
import type { ChatAttachment, ChatSession, Message } from '../types';

import ChatMessage from './ChatMessage';
import BwengeLoader from './BwengeLoader';
import { useStore } from '../store/useStore';

interface RightChatSidebarProps {
  messages: Message[];
  chatSessions?: ChatSession[];
  onSendMessage: (userText: string, attachment?: File | ChatAttachment | Array<File | ChatAttachment>) => void | Promise<void>;
  stagedAttachments?: Array<File | ChatAttachment>;
  onStageAttachments?: (attachments: Array<File | ChatAttachment>) => void;
  onRemoveStagedAttachment?: (index: number) => void;
  onClearStagedAttachments?: () => void;
  activeDocument?: unknown;
  setActiveDocument?: React.Dispatch<React.SetStateAction<unknown>>;
  onOpenScanner?: () => void;
  onNewChat?: () => void;
  onLoadSession?: (sessionId: string) => void;
  onClearChat?: () => void;
  onAttachClick?: () => void;
  isDegraded?: boolean;
  /** Set while a real request to the AI backend is in flight. */
  isTyping?: boolean;
}



interface RightChatSidebarProps {
  messages: Message[];
  chatSessions?: ChatSession[];
  onSendMessage: (userText: string, attachment?: File | ChatAttachment | Array<File | ChatAttachment>) => void | Promise<void>;
  stagedAttachments?: Array<File | ChatAttachment>;
  onStageAttachments?: (attachments: Array<File | ChatAttachment>) => void;
  onRemoveStagedAttachment?: (index: number) => void;
  onClearStagedAttachments?: () => void;
  activeDocument?: unknown;
  setActiveDocument?: React.Dispatch<React.SetStateAction<unknown>>;
  onOpenScanner?: () => void;
  onNewChat?: () => void;
  onLoadSession?: (sessionId: string) => void;
  onClearChat?: () => void;
  onAttachClick?: () => void;
  isDegraded?: boolean;
  /** Set while a real request to the AI backend is in flight. */
  isTyping?: boolean;
  onUpgradeClick?: (jobId: string, service: string) => void;
  selectedProvider?: string;
  onProviderChange?: (provider: string) => void;
  onInsightAction?: (action: string, context: any) => void;
}

/* ------------------------------------------------------------------ */
/*  Attachment helpers                                                 */
/* ------------------------------------------------------------------ */

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isFileObject(x: File | ChatAttachment): x is File {
  return typeof File !== 'undefined' && x instanceof File;
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|heic|heif)$/i;

function describeAttachment(att: File | ChatAttachment, previewUrl?: string) {
  if (isFileObject(att)) {
    return {
      name: att.name,
      sizeLabel: formatFileSize(att.size),
      isImage: att.type.startsWith('image/'),
      previewUrl,
      status: 'ready'
    };
  }
  const a: any = att;
  const name: string = a.name ?? a.fileName ?? 'Attachment';
  const mime: string = a.type ?? a.mimeType ?? '';
  const url: string | undefined = a.previewUrl ?? a.url ?? previewUrl;
  return {
    name,
    sizeLabel: typeof a.size === 'number' ? formatFileSize(a.size) : undefined,
    isImage: mime.startsWith('image/') || (!mime && IMAGE_EXT.test(name)),
    previewUrl: url,
    status: a.status || 'ready'
  };
}

export default function RightChatSidebar({
  messages,
  chatSessions = [],
  onSendMessage,
  stagedAttachments = [],
  onStageAttachments,
  onRemoveStagedAttachment,
  onClearStagedAttachments,
  setActiveDocument,
  onOpenScanner,
  onNewChat,
  onLoadSession,
  onClearChat,
  onAttachClick,
  isDegraded = false,
  isTyping = false,
  onUpgradeClick,
  selectedProvider = 'auto',
  onProviderChange,
  onInsightAction,
}: RightChatSidebarProps) {
  const [inputValue, setInputValue] = useState('');
  const [showMenu, setShowMenu] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showInsights, setShowInsights] = useState(false);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<File | ChatAttachment | null>(null);
  const [previewFileUrl, setPreviewFileUrl] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const dragCounter = useRef(0);
  const objectUrlsRef = useRef<string[]>([]);

  // Auto-grow the textarea as the person types, up to a sane cap.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [inputValue]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, isTyping]);

  // Build preview metadata for staged attachments, generating object URLs for
  // raw image Files and revoking them whenever the staged list changes.
  const attachmentPreviews = useMemo(() => {
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrlsRef.current = [];

    return stagedAttachments.map((att) => {
      let previewUrl: string | undefined;
      if (isFileObject(att) && att.type.startsWith('image/')) {
        previewUrl = URL.createObjectURL(att);
        objectUrlsRef.current.push(previewUrl);
      }
      return describeAttachment(att, previewUrl);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stagedAttachments]);

  useEffect(() => {
    return () => objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => {
    if (!previewFile || !(previewFile instanceof File)) {
      setPreviewFileUrl(null);
      return;
    }
    const url = URL.createObjectURL(previewFile);
    setPreviewFileUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [previewFile]);

  const canSend = inputValue.trim().length > 0 || stagedAttachments.length > 0;

  const handleSend = () => {
    if (!canSend) return;
    onSendMessage(inputValue.trim(), stagedAttachments.length > 0 ? stagedAttachments : undefined);
    setInputValue('');
    onClearStagedAttachments?.();
  };

  const handleAttachClick = () => {
    fileInputRef.current?.click();
    onAttachClick?.();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      onStageAttachments?.(files);
    }
    e.target.value = '';
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items || items.length === 0) return;
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length) onStageAttachments?.(files);
  };

  // Drag-and-drop attach, from anywhere over the sidebar.
  const handleDragEnter = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    dragCounter.current += 1;
    setIsDraggingFiles(true);
  };
  const handleDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
  };
  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setIsDraggingFiles(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDraggingFiles(false);
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length) onStageAttachments?.(files);
  };

  const submitFeedback = useStore((state) => state.submitFeedback);
  const agentStatus = useStore((state) => state.agentStatus);
  const oracleInsights = useStore((state) => state.oracleInsights);

  return (
    // FULL SIDEBAR CONTAINER (Glassmorphism theme, respect parent width)
    <aside
      className="relative h-full w-full bg-[#0D2B24]/40 backdrop-blur-md flex flex-col z-30 font-sans text-slate-100 overflow-hidden"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* 1. REMOVED INTERNAL HEADER - Controls now in TopNavbar */}

      {/* Full-sidebar drop overlay */}
      {isDraggingFiles && (
        <div className="absolute inset-0 z-40 m-3 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-emerald-500/30 bg-[#0A0D14]/95 backdrop-blur-sm">
          <span className="text-2xl">📎</span>
          <div className="text-xs font-medium text-slate-200">Drop files to attach</div>
          <div className="text-[10px] text-slate-500">PDF, Word, or image files</div>
        </div>
      )}

      {/* 2. CHAT MESSAGES STREAM - No top header, flows to top */}
      <main className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 scrollbar-thin scrollbar-thumb-emerald-500/10">

        {messages.length === 0 && (
          <div className="space-y-4">
            {/* Quick Actions Card Block */}
            <div className="space-y-2">
              <div className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase px-1">
                Quick Actions
              </div>

              <button
                type="button"
                onClick={handleAttachClick}
                className="w-full flex items-center gap-3.5 p-3 rounded-xl bg-[#121722]/80 border border-slate-800/80 hover:border-orange-500/40 hover:bg-[#161C2A] transition text-left group"
              >
                <div className="w-8 h-8 rounded-lg bg-slate-800/80 flex items-center justify-center text-slate-300 group-hover:text-white transition shrink-0">
                  📄
                </div>
                <div>
                  <div className="text-xs font-medium text-slate-200 group-hover:text-white">
                    Upload Student Paper
                  </div>
                  <div className="text-[11px] text-slate-500">Attach PDF, PNG, or JPEG</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => onOpenScanner?.()}
                className="w-full flex items-center gap-3.5 p-3 rounded-xl bg-[#121722]/80 border border-slate-800/80 hover:border-orange-500/40 hover:bg-[#161C2A] transition text-left group"
              >
                <div className="w-8 h-8 rounded-lg bg-slate-800/80 flex items-center justify-center text-slate-300 group-hover:text-white transition shrink-0">
                  📷
                </div>
                <div>
                  <div className="text-xs font-medium text-slate-200 group-hover:text-white">
                    Launch BwengeScan
                  </div>
                  <div className="text-[11px] text-slate-500">Scan handwritten work live</div>
                </div>
              </button>
            </div>
          </div>
        )}

        {messages.map((msg: any, idx: number) => (
          <ChatMessage
            key={msg.id ?? idx}
            message={msg}
            onPreviewDoc={setActiveDocument ? (doc) => setActiveDocument(doc) : undefined}
            onFeedback={submitFeedback}
            onUpgradeClick={onUpgradeClick}
          />
        ))}

        {isTyping && (
          <div className="flex flex-col gap-2">
            <BwengeLoader label={agentStatus || undefined} />
            {agentStatus && (
              <div className="flex justify-center gap-3 animate-in fade-in duration-500">
                <Search size={12} className={agentStatus.includes('NVIDIA') ? 'text-emerald-400 animate-pulse' : 'text-slate-700'} />
                <Brain size={12} className={agentStatus.includes('Claude') || agentStatus.includes('Orchestrator') ? 'text-amber-400 animate-pulse' : 'text-slate-700'} />
                <Cpu size={12} className={agentStatus.includes('Engine') || agentStatus.includes('NVIDIA') ? 'text-blue-400 animate-pulse' : 'text-slate-700'} />
                <ShieldCheck size={12} className={agentStatus.includes('Adversary') || agentStatus.includes('Critic') ? 'text-rose-400 animate-pulse' : 'text-slate-700'} />
                <Database size={12} className={agentStatus.includes('Memory') || agentStatus.includes('Registry') ? 'text-purple-400 animate-pulse' : 'text-slate-700'} />
              </div>
            )}
          </div>
        )}

        <div ref={chatEndRef} />
      </main>

      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.doc,.docx,.ppt,.pptx,.png,.jpg,.jpeg"
        onChange={handleFileChange}
        className="hidden"
      />
      {/* 3. IMMERSIVE FLOATING INPUT DOCK */}
      <footer className="p-4 sm:p-6 shrink-0 bg-[#0D2B24]/60 backdrop-blur-xl border-t border-white/5">
        <div className="max-w-[900px] mx-auto relative group/dock">
          {/* Subtle Glow Backdrop */}
          <div className="absolute inset-0 bg-emerald-500/5 blur-xl rounded-full opacity-0 group-focus-within/dock:opacity-100 transition-opacity duration-500" />

          <div className="relative bg-[#0D111A]/90 backdrop-blur-xl border border-white/5 rounded-[28px] p-2.5 shadow-2xl focus-within:ring-2 focus-within:ring-emerald-500/20 focus-within:border-emerald-500/30 transition-all duration-300">
            {attachmentPreviews.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2 px-2 pb-2 border-b border-white/5">
                {attachmentPreviews.map((meta, idx) => (
                  <div
                    key={idx}
                    className={`group flex items-center gap-2 rounded-xl border py-1.5 pl-2 pr-2.5 text-[11px] shadow-sm transition-all ${
                      meta.status === 'uploading'
                        ? 'border-amber-500/30 bg-amber-500/5 text-amber-200/70'
                        : meta.status === 'failed'
                        ? 'border-rose-500/30 bg-rose-500/5 text-rose-300'
                        : 'border-white/5 bg-white/5 text-slate-200'
                    }`}
                  >
                    {meta.status === 'uploading' ? (
                      <div className="h-4 w-4 border-2 border-amber-500/30 border-t-amber-500 rounded-full animate-spin mr-1" />
                    ) : meta.isImage && meta.previewUrl ? (
                      <img
                        src={meta.previewUrl}
                        alt=""
                        className="h-6 w-6 cursor-pointer rounded-lg object-cover"
                        onClick={() => setLightboxUrl(meta.previewUrl!)}
                      />
                    ) : (
                      <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-white/5 text-[10px]">
                        {meta.status === 'failed' ? '⚠️' : '📄'}
                      </span>
                    )}
                    <div className="max-w-[140px] truncate font-medium">
                      {meta.name}
                      {meta.status === 'uploading' && <span className="ml-1 text-[9px] opacity-60">...</span>}
                    </div>
                    <button
                      type="button"
                      onClick={() => onRemoveStagedAttachment?.(idx)}
                      className="ml-1 text-slate-500 hover:text-rose-400 transition-colors"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-end gap-2">
              <div className="flex-1 flex flex-col min-w-0">
                <textarea
                  ref={textareaRef}
                  rows={1}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  onPaste={handlePaste}
                  placeholder="Type a message or build a form..."
                  className="max-h-[300px] w-full bg-transparent text-sm text-slate-100 placeholder-slate-500 outline-none resize-none px-3 py-3 leading-relaxed"
                />
              </div>

              <div className="flex items-center gap-1.5 pb-1 pr-1">
                <button
                  type="button"
                  onClick={() => setShowInsights(!showInsights)}
                  className={`p-2 rounded-xl transition-all group relative ${showInsights ? 'bg-amber-500/20 text-amber-400' : 'text-amber-500 hover:bg-amber-500/10'}`}
                  title="Oracle Insights"
                >
                  <Bell className="w-4 h-4" />
                  <span className="absolute top-1 right-1 w-2 h-2 bg-rose-500 rounded-full border-2 border-[#0D111A] animate-bounce" />
                </button>

                <select
                  value={selectedProvider}
                  onChange={(e) => onProviderChange?.(e.target.value)}
                  className="bg-white/5 text-slate-400 text-[10px] border border-white/5 rounded-lg px-2 py-1 outline-none focus:border-emerald-500/30 transition-all cursor-pointer hover:bg-white/10 mr-1"
                >
                  <option value="auto">Auto</option>
                  <option value="gemini">Gemini</option>
                  <option value="nvidianim">NVIDIA</option>
                  <option value="ollama">Ollama</option>
                </select>

                <button
                  type="button"
                  onClick={handleAttachClick}
                  className="p-2.5 rounded-xl text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10 transition-all active:scale-90"
                  title="Attach files"
                >
                  <Plus className="w-5 h-5" />
                </button>

                <button
                  type="button"
                  onClick={handleSend}
                  disabled={!canSend}
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-all active:scale-95 ${
                    canSend
                      ? 'bg-emerald-500 hover:bg-emerald-400 text-white shadow-lg shadow-emerald-500/20'
                      : 'bg-white/5 text-slate-600 cursor-not-allowed'
                  }`}
                >
                  <span className="font-bold text-lg leading-none">➔</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="text-[10px] text-slate-600 text-center mt-3 tracking-widest uppercase font-medium">
          Powered by Bwenge Autonomous Agentic System
        </div>
      </footer>


      {/* History Drawer */}
      {showHistory && (
        <div className="absolute inset-0 z-40 flex flex-col bg-[#0A0D14]/98 p-4 backdrop-blur-sm">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">📜 Chat History</h3>
              <p className="text-[11px] text-slate-500">Reopen a previous marking session.</p>
            </div>
            <button
              type="button"
              onClick={() => setShowHistory(false)}
              className="rounded-lg bg-[#121722] px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 transition"
              aria-label="Close chat history"
            >
              ✕ Close
            </button>
          </div>

          <div className="mt-4 flex-1 space-y-2.5 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-slate-800">
            {chatSessions.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-800 bg-[#121722]/60 p-5 text-center text-xs text-slate-500">
                No saved sessions yet. Start a chat and it will show up here.
              </div>
            ) : (
              chatSessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => {
                    setShowHistory(false);
                    onLoadSession?.(session.id);
                  }}
                  className="w-full rounded-xl border border-slate-800 bg-[#121722]/80 px-4 py-3 text-left hover:border-orange-500/40 hover:bg-[#161C2A] transition"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="truncate text-xs font-medium text-slate-100">{session.title}</div>
                    <div className="shrink-0 text-[10px] text-slate-500">{session.messageCount} msgs</div>
                  </div>
                  <div className="mt-1 text-[10px] text-slate-500">{session.date}</div>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Image lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-8"
          onClick={() => setLightboxUrl(null)}
        >
          <img src={lightboxUrl} alt="Attachment preview" className="max-h-full max-w-full rounded-xl shadow-2xl" />
          <button
            type="button"
            onClick={() => setLightboxUrl(null)}
            className="absolute right-6 top-6 rounded-full bg-slate-900/80 p-2 text-slate-200 hover:bg-slate-800"
            aria-label="Close preview"
          >
            ✕
          </button>
        </div>
      )}

      {/* Oracle Insight Feed (V4) */}
      {showInsights && (
        <div className="absolute inset-0 z-50 flex flex-col bg-[#0A0D14]/98 p-4 backdrop-blur-md animate-in slide-in-from-right duration-300">
           <div className="flex items-center justify-between border-b border-white/5 pb-3">
            <div>
              <h3 className="text-sm font-bold text-amber-500 flex items-center gap-2">
                <Sparkles className="w-4 h-4 animate-pulse" /> Oracle Insights
              </h3>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold mt-0.5">Autonomous Pattern Detection</p>
            </div>
            <button
              type="button"
              onClick={() => setShowInsights(false)}
              className="text-slate-400 hover:text-white transition"
            >
              ✕
            </button>
          </div>

          <div className="mt-6 space-y-4 overflow-y-auto">
             {oracleInsights.length === 0 && (
                <div className="text-center py-10 opacity-30">
                   <div className="text-4xl mb-2">👁️</div>
                   <p className="text-[10px] font-bold uppercase tracking-widest">Watching for patterns...</p>
                </div>
             )}

             {oracleInsights.map((insight) => (
                <div key={insight.id} className={`p-4 rounded-2xl border animate-in slide-in-from-right duration-500 ${
                  insight.priority === 'high' ? 'bg-rose-500/5 border-rose-500/20' : 'bg-amber-500/5 border-amber-500/20'
                }`}>
                  <div className={`flex items-center gap-2 text-[10px] font-bold uppercase tracking-tighter mb-2 ${
                    insight.priority === 'high' ? 'text-rose-400' : 'text-amber-400'
                  }`}>
                    <div className={`w-1.5 h-1.5 rounded-full animate-ping ${
                      insight.priority === 'high' ? 'bg-rose-500' : 'bg-amber-500'
                    }`} />
                    {insight.title}
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed mb-3">
                    {insight.content}
                  </p>
                  <div className="flex items-center justify-between gap-2">
                    <button
                      onClick={() => onInsightAction?.(insight.action || 'VIEW DETAILS', insight)}
                      className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold transition ${
                        insight.priority === 'high' ? 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-400' : 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-400'
                      }`}
                    >
                      {insight.action || 'VIEW DETAILS'}
                    </button>
                    <span className="text-[9px] font-mono text-slate-600">{insight.timestamp}</span>
                  </div>
                </div>
             ))}

             {/* Legacy Static Example (Kept for visual density if feed is short) */}
             {oracleInsights.length < 2 && (
               <div className="p-4 rounded-2xl bg-emerald-500/5 border border-emerald-500/20 opacity-50 grayscale hover:grayscale-0 transition-all">
                  <div className="flex items-center gap-2 text-emerald-400 text-[10px] font-bold uppercase tracking-tighter mb-2">
                     Interdisciplinary Opportunity
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                     Bwenge detected a strong overlap between your current **Physics Waves** rubric and **Math Trigonometry**.
                  </p>
               </div>
             )}
          </div>
        </div>
      )}

      {previewFile && (
        <div className="fixed inset-0 z-50 bg-slate-950/95 backdrop-blur-md flex flex-col p-4 font-sans">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800 shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-orange-400 font-bold">📄</span>
              <span className="text-xs font-semibold text-slate-100 truncate max-w-[80vw]">
                {previewFile instanceof File ? previewFile.name : previewFile.name || 'Document Preview'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setPreviewFile(null)}
              className="px-3 py-1.5 text-xs text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-lg font-medium transition active:scale-95"
            >
              ✕ Close
            </button>
          </div>

          <div className="flex-1 my-3 rounded-2xl overflow-hidden border border-slate-800 bg-[#0B0E14] flex items-center justify-center">
            {(() => {
              const fileUrl = previewFile instanceof File
                ? previewFileUrl
                : previewFile.url || previewFile.previewUrl;

              const name = previewFile instanceof File
                ? previewFile.name
                : previewFile.name || 'Document Preview';

              const typeHint = previewFile instanceof File
                ? previewFile.type
                : (previewFile.mimeType || String(previewFile.type || '')).toLowerCase();

              const isPdf = typeHint === 'application/pdf' || name.toLowerCase().endsWith('.pdf');
              const isImage = typeHint?.startsWith('image/') || /\.(png|jpe?g|gif|webp|heic|heif)$/i.test(name);

              if (isPdf && fileUrl) {
                return (
                  <iframe
                    src={fileUrl}
                    title="PDF Submission Viewer"
                    className="w-full h-full border-none"
                  />
                );
              }

              if (isImage && fileUrl) {
                return (
                  <img
                    src={fileUrl}
                    alt="Submission Preview"
                    className="max-h-full max-w-full object-contain rounded-lg"
                  />
                );
              }

              if (!(previewFile instanceof File) && previewFile.htmlContent) {
                return (
                  <div
                    className="w-full h-full overflow-auto rounded-lg bg-white p-6 text-slate-900 dark:bg-slate-900 dark:text-slate-100"
                    dangerouslySetInnerHTML={{ __html: previewFile.htmlContent }}
                  />
                );
              }

              if (!(previewFile instanceof File) && previewFile.rawText) {
                return (
                  <div className="max-w-full w-full overflow-auto rounded-lg bg-slate-900 p-4 text-slate-200 text-sm whitespace-pre-wrap">
                    {previewFile.rawText}
                  </div>
                );
              }

              return (
                <div className="text-slate-400 text-xs text-center space-y-2 p-6">
                  <p>📄 Text extracted from <strong>{name}</strong></p>
                  <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl max-w-lg text-left text-slate-300 overflow-y-auto max-h-[60vh]">
                    {(previewFile instanceof File && previewFileUrl) ? (
                      <a
                        href={previewFileUrl}
                        download={name}
                        className="inline-flex items-center gap-2 rounded-lg border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-orange-300 hover:bg-orange-500/20"
                      >
                        Download {name}
                      </a>
                    ) : (
                      'Extracted Content Ready for AI Marking & Analysis.'
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

    </aside>
  );
}