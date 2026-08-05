import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatAttachment, ChatSession, Message } from '../types';

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
}: RightChatSidebarProps) {
  const [inputValue, setInputValue] = useState('');
  const [showMenu, setShowMenu] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
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

  return (
    // FULL SIDEBAR CONTAINER (Locks to right edge, contains everything cleanly)
    <aside
      className="fixed top-0 right-0 h-screen w-[420px] bg-[#0A0D14] border-l border-slate-800/80 flex flex-col z-30 shadow-2xl font-sans text-slate-100"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Full-sidebar drop overlay */}
      {isDraggingFiles && (
        <div className="absolute inset-0 z-40 m-3 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-orange-500/60 bg-[#0A0D14]/95 backdrop-blur-sm">
          <span className="text-2xl">📎</span>
          <div className="text-xs font-medium text-slate-200">Drop files to attach</div>
          <div className="text-[10px] text-slate-500">PDF, Word, or image files</div>
        </div>
      )}

      {/* 1. HEADER (Contained inside the sidebar) */}
      <header className="h-14 px-4 border-b border-slate-800/80 flex items-center justify-between bg-[#0D111A] shrink-0">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-orange-500 animate-pulse motion-reduce:animate-none" />
          <span className="text-orange-500 text-sm font-bold">✦</span>
          <span className="text-xs font-semibold tracking-wide text-slate-200">Bwenge AI</span>
        </div>

        <div className="flex items-center gap-2">
          {isDegraded && (
            <span className="text-[10px] font-medium text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2.5 py-0.5 rounded-full">
              Degraded Mode
            </span>
          )}

          <button
            type="button"
            onClick={() => onNewChat?.()}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/60 transition w-7 h-7 flex items-center justify-center"
            title="New Chat"
            aria-label="New chat"
          >
            +
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => setShowMenu((v) => !v)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/60 transition w-7 h-7 flex items-center justify-center"
              aria-label="More options"
            >
              ⋮
            </button>

            {showMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
                <div className="absolute right-0 top-9 w-40 bg-[#121722] border border-slate-800 rounded-xl p-1 text-xs shadow-xl z-50">
                  <button
                    onClick={() => {
                      setShowMenu(false);
                      setShowHistory(true);
                    }}
                    className="w-full text-left px-3 py-1.5 text-slate-300 hover:bg-slate-800/60 rounded-lg flex items-center gap-2"
                  >
                    📜 Chat History
                  </button>
                  <div className="my-1 border-t border-slate-800/80" />
                  <button
                    onClick={() => {
                      setShowMenu(false);
                      onClearChat?.();
                    }}
                    className="w-full text-left px-3 py-1.5 text-rose-400 hover:bg-slate-800/60 rounded-lg flex items-center gap-2"
                  >
                    🗑️ Clear Chat
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* 2. CHAT MESSAGES STREAM */}
      <main className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin scrollbar-thumb-slate-800">
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

        {messages.map((msg: any, idx: number) => {
          const isUser = msg.sender === 'user';
          const text: string = msg.text ?? msg.content ?? '';
          const attachments: any[] = msg.attachments ?? [];

          return (
            <div key={msg.id ?? idx} className={`flex gap-2.5 text-xs ${isUser ? 'justify-end' : 'justify-start'}`}>
              {!isUser && (
                <div className="w-6 h-6 rounded-lg bg-orange-500/20 border border-orange-500/30 flex items-center justify-center text-orange-400 font-bold text-[10px] shrink-0 mt-0.5">
                  ✦
                </div>
              )}
              <div className={`max-w-[85%] space-y-1.5 ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
                {text && (
                  <div
                    className={`p-3 rounded-2xl leading-relaxed whitespace-pre-wrap ${
                      isUser
                        ? 'bg-slate-800 text-slate-100 rounded-tr-xs shadow-sm'
                        : 'bg-[#121722]/90 text-slate-200 border border-slate-800/80 rounded-tl-xs shadow-md'
                    }`}
                  >
                    {text}
                  </div>
                )}

                {attachments.length > 0 && (
                  <div className="flex flex-col gap-2 w-full">
                    {attachments.map((att: any, aIdx: number) => {
                      const meta = describeAttachment(att);
                      const fileUrl = isFileObject(att)
                        ? URL.createObjectURL(att)
                        : att.url || att.previewUrl || att;
                      const fileName = meta.name || 'WhatsApp_Image_2026.jpeg';

                      return (
                        <div
                          key={aIdx}
                          className="my-2 flex items-center justify-between p-2.5 rounded-xl bg-[#0D111A] border border-slate-700/60 hover:border-orange-500/50 transition group"
                        >
                          <div className="flex items-center gap-2.5 min-w-0 pr-2">
                            <div className="w-9 h-9 rounded-lg bg-orange-500/10 border border-orange-500/20 flex items-center justify-center shrink-0 overflow-hidden">
                              {meta.isImage ? (
                                <img src={fileUrl} alt="Thumbnail" className="w-full h-full object-cover" />
                              ) : (
                                <span className="text-orange-400 font-bold text-xs">📄</span>
                              )}
                            </div>

                            <div className="flex flex-col min-w-0">
                              <span className="text-xs font-medium text-slate-200 truncate group-hover:text-orange-400 transition">
                                {fileName}
                              </span>
                              <span className="text-[10px] text-slate-500">Tap to inspect submission</span>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => setPreviewFile(att)}
                            className="px-3 py-1.5 rounded-lg bg-orange-500/10 hover:bg-orange-500 text-orange-400 hover:text-white border border-orange-500/30 text-[11px] font-semibold flex items-center gap-1 shrink-0 transition active:scale-95"
                          >
                            <span>👁️</span> View
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {isTyping && (
          <div className="flex gap-2.5 justify-start text-xs">
            <div className="w-6 h-6 rounded-lg bg-orange-500/20 border border-orange-500/30 flex items-center justify-center text-orange-400 font-bold text-[10px] shrink-0 mt-0.5">
              ✦
            </div>
            <div className="bg-[#121722]/90 border border-slate-800/80 px-3 py-2.5 rounded-2xl rounded-tl-xs flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-orange-500 animate-bounce motion-reduce:animate-none" />
              <span className="h-1.5 w-1.5 rounded-full bg-orange-500 animate-bounce [animation-delay:0.15s] motion-reduce:animate-none" />
              <span className="h-1.5 w-1.5 rounded-full bg-orange-500 animate-bounce [animation-delay:0.3s] motion-reduce:animate-none" />
            </div>
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
      {/* 3. INPUT DOCK */}
      <footer className="p-3 pb-5 shrink-0 bg-[#0A0D14]">
        <div className="bg-[#121722]/95 border border-slate-800 rounded-2xl p-3 shadow-xl focus-within:border-slate-700 transition">
          {attachmentPreviews.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2 border-b border-slate-800/80 pb-2">
              {attachmentPreviews.map((meta, idx) => (
                <div
                  key={idx}
                  className="group flex items-center gap-2 rounded-xl border border-slate-700/70 bg-slate-800/80 py-1 pl-1.5 pr-2 text-[11px] text-slate-200 shadow-sm"
                >
                  {meta.isImage && meta.previewUrl ? (
                    <img
                      src={meta.previewUrl}
                      alt=""
                      className="h-6 w-6 cursor-pointer rounded-md object-cover"
                      onClick={() => setLightboxUrl(meta.previewUrl!)}
                    />
                  ) : (
                    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-700 text-[10px]">
                      📄
                    </span>
                  )}
                  <div className="leading-tight">
                    <div className="max-w-[110px] truncate font-medium">{meta.name}</div>
                    {meta.sizeLabel && <div className="text-[9.5px] text-slate-500">{meta.sizeLabel}</div>}
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemoveStagedAttachment?.(idx)}
                    aria-label={`Remove ${meta.name}`}
                    className="ml-0.5 text-slate-500 opacity-0 transition group-hover:opacity-100 hover:text-rose-400"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

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
            placeholder="Ask Bwenge to review a submission, attach a rubric, or process a scan…"
            className="max-h-[200px] w-full bg-transparent text-xs text-slate-100 placeholder-slate-500 outline-none resize-none px-1 py-1 leading-relaxed"
          />

          <div className="flex items-center justify-between pt-2 mt-1 border-t border-slate-800/60">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleAttachClick}
                className="inline-flex h-8 items-center gap-1.5 px-3 rounded-lg text-xs font-medium leading-none text-slate-300 bg-slate-800/60 hover:bg-slate-800 border border-slate-700/40 transition active:scale-95"
              >
                📎 Attach
              </button>

              <button
                type="button"
                onClick={() => onOpenScanner?.()}
                className="inline-flex h-8 items-center gap-1.5 px-3 rounded-lg text-xs font-medium leading-none text-slate-300 bg-slate-800/60 hover:bg-slate-800 border border-slate-700/40 transition active:scale-95"
              >
                📷 Scanner
              </button>
            </div>

            <button
              type="button"
              onClick={handleSend}
              disabled={!canSend}
              aria-label="Send message"
              className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg font-bold text-xs transition active:scale-95 ${
                canSend
                  ? 'bg-orange-500 hover:bg-orange-600 text-white shadow-md'
                  : 'bg-slate-800 text-slate-600 cursor-not-allowed'
              }`}
            >
              ➔
            </button>
          </div>
        </div>

        <div className="text-[10px] text-slate-500 text-center mt-2">
          Enter to send · Shift + Enter for a new line
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