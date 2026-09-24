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
  Share2
} from "lucide-react";
import { ChatSession, Message as MessageType } from '../types';
import ChatMessage from './ChatMessage';
import BwengeLoader from './BwengeLoader';

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
}

function ModelPicker({ selected, onSelect }: { selected: string, onSelect: (val: string) => void }) {
  const [open, setOpen] = useState(false);
  const models = [
    { id: 'auto', label: "Bwenge — Balanced (Auto)" },
    { id: 'gemini', label: "Gemini — Fast" },
    { id: 'nvidianim', label: "NVIDIA — Research" },
    { id: 'ollama', label: "Ollama — Local" }
  ];

  const selectedModel = models.find(m => m.id === selected) || models[0];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors bg-[#222222] border border-neutral-800/40 hover:bg-neutral-800 text-neutral-300"
      >
        {selectedModel.label}
        <ChevronDown size={12} className="opacity-40" />
      </button>
      {open && (
        <ul className="absolute bottom-full mb-2 left-0 w-56 rounded-xl border border-neutral-800/80 shadow-2xl overflow-hidden z-50 bg-[#1A1A1A]">
          {models.map((m) => (
            <li key={m.id}>
              <button
                onClick={() => {
                  onSelect(m.id);
                  setOpen(false);
                }}
                className="w-full text-left px-4 py-2.5 text-xs text-neutral-400 hover:bg-white/5 hover:text-white transition-colors"
                style={{ fontWeight: m.id === selected ? 600 : 400 }}
              >
                {m.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function CreateStudio({
  messages,
  onSendMessage,
  onNewChat,
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
  onRemoveStagedAttachment
}: CreateStudioProps) {
  const [inputValue, setInputValue] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useEffect(resize, [inputValue, resize]);

  useEffect(() => {
    if (messages.length > 0) {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isTyping]);

  const handleSend = () => {
    const trimmed = inputValue.trim();
    if ((!trimmed && stagedAttachments.length === 0) || isTyping) return;
    onSendMessage(trimmed, stagedAttachments.length > 0 ? stagedAttachments : undefined);
    setInputValue("");
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      onStageAttachments?.(files);
    }
    e.target.value = '';
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full w-full bg-[#141414] overflow-hidden antialiased relative">
      <header className="flex-shrink-0 w-full flex justify-end items-center p-4 z-30">
        <div className="flex items-center gap-3">
          <button
            onClick={() => (window as any).openUpgradeModal?.()}
            className="bg-gradient-to-r from-amber-500/20 to-orange-600/10 hover:from-amber-500/30 hover:to-orange-600/20 text-amber-400 font-medium px-3.5 py-1.5 rounded-xl border border-amber-500/30 text-xs transition-all shadow-md shadow-orange-950/20 flex items-center gap-1.5"
          >
            ⭐ Upgrade
          </button>

          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((prev) => !prev)}
              className="p-1.5 rounded-xl text-neutral-500 hover:text-neutral-200 transition-colors focus:outline-none"
            >
              <MoreVertical size={18} />
            </button>

            {menuOpen && (
              <div className="absolute right-0 mt-2 w-52 bg-[#1a1a1a] border border-neutral-800 rounded-xl shadow-2xl z-50 py-1 text-xs text-neutral-300 animate-in fade-in slide-in-from-top-1 duration-200">
                <button
                  onClick={() => { if (activeFormId) onShare?.(); setMenuOpen(false); }}
                  disabled={!activeFormId}
                  className={`w-full flex items-center px-3 py-2.5 transition-colors text-left ${activeFormId ? 'hover:bg-neutral-800 hover:text-white text-emerald-400' : 'opacity-40 cursor-not-allowed'}`}
                >
                  <Share2 className="mr-3 w-4 h-4" /> {activeFormId ? 'Share USSD Instructions' : 'Share (create form first)'}
                </button>
                <div className="border-t border-neutral-800/80 my-1"></div>
                <button onClick={() => setMenuOpen(false)} className="w-full flex items-center px-3 py-2.5 hover:bg-neutral-800 hover:text-white transition-colors text-left">
                  <Eye className="mr-3 w-4 h-4" /> View Metadata Details
                </button>
                <button onClick={() => setMenuOpen(false)} className="w-full flex items-center px-3 py-2.5 hover:bg-neutral-800 hover:text-white transition-colors text-left">
                  <FileText className="mr-3 w-4 h-4" /> Set Grading Rubric
                </button>
                <button onClick={() => { onExportChat?.(); setMenuOpen(false); }} className="w-full flex items-center px-3 py-2.5 hover:bg-neutral-800 hover:text-white transition-colors text-left">
                  <Download className="mr-3 w-4 h-4" /> Export Chat (Markdown)
                </button>
                <div className="border-t border-neutral-800/80 my-1"></div>
                <button onClick={() => { onDeleteChat?.(); setMenuOpen(false); }} className="w-full flex items-center px-3 py-2.5 hover:bg-neutral-800 text-rose-400 transition-colors text-left">
                  <Trash2 className="mr-3 w-4 h-4" /> Clear All Messages
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 relative overflow-hidden flex flex-col items-center">
        {messages.length === 0 && (
          <div className="w-full max-w-2xl px-4 flex-1 flex flex-col justify-center py-10 animate-in fade-in slide-in-from-bottom-6 duration-700 select-none">
            <div className="text-center space-y-4">
              <h1 className="text-3xl font-normal font-serif tracking-tight text-[#f0f0f0]">Bwenge AI Workspace</h1>
              <p className="text-sm text-neutral-400 max-w-md mx-auto leading-relaxed">
                Hey there! How can I assist you in your teaching today? Simply upload a student paper or launch the scanner to get started.
              </p>
            </div>
          </div>
        )}

        {messages.length > 0 && (
          <div className="w-full max-w-2xl px-4 flex-1 overflow-y-auto scrollbar-hidden py-6 flex flex-col gap-6 transition-all duration-500 scroll-smooth">
            {messages.map((m, idx) => (
              <ChatMessage key={m.id || idx} message={m} />
            ))}
            {isTyping && (
              <div className="flex justify-start animate-in fade-in duration-300">
                <BwengeLoader />
              </div>
            )}
            <div ref={chatEndRef} className="h-4" />
          </div>
        )}
      </main>

      <footer className="flex-shrink-0 w-full bg-[#141414] px-4 pb-6 pt-4 flex justify-center z-20">
        <div className="w-full max-w-2xl flex flex-col gap-3">
          {stagedAttachments.length > 0 && (
            <div className="flex flex-wrap gap-2 px-1 pb-1 animate-in fade-in zoom-in-95 duration-200">
              {stagedAttachments.map((att, idx) => (
                <div key={idx} className="flex items-center gap-2 bg-[#2a2d35] border border-white/10 rounded-2xl px-3 py-1 text-[11px] text-neutral-300">
                  <span className="max-w-[140px] truncate">{(att as any).name}</span>
                  <button onClick={() => onRemoveStagedAttachment?.(idx)} className="p-0.5 hover:text-rose-400 transition-colors">✕</button>
                </div>
              ))}
            </div>
          )}
          <div className="relative group">
            <div className="absolute -inset-1 bg-[#5DCAA5]/10 blur-2xl rounded-[32px] opacity-0 group-focus-within:opacity-100 transition-opacity duration-700 pointer-events-none" />
            <div className="relative bg-[#1A1A1A] border border-neutral-800/80 rounded-[24px] shadow-2xl shadow-black/40 focus-within:border-neutral-700/60 focus-within:ring-1 focus-within:ring-neutral-800/40 transition-all duration-300 p-2.5">
              <textarea
                ref={textareaRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Message Bwenge or start from a suggestion..."
                rows={1}
                className="w-full bg-transparent border-0 resize-none text-base focus:ring-0 focus:outline-none px-3 py-2 text-white placeholder-neutral-600 focus:placeholder-neutral-700 font-sans tracking-wide min-h-[44px] max-h-[200px] scrollbar-hidden"
              />
              <div className="flex items-center justify-between px-2 pb-1 pt-2 border-t border-white/5">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-2 text-[10px] text-neutral-400 hover:text-white px-3 py-1.5 rounded-xl hover:bg-[#222222] transition-colors font-bold uppercase tracking-widest border border-transparent hover:border-neutral-800"
                  >
                    <Paperclip size={14} /> <span className="hidden sm:inline">ATTACH</span>
                  </button>
                  <span className="h-4 w-px bg-white/5 mx-1" />
                  <ModelPicker selected={selectedProvider} onSelect={(val) => onProviderChange?.(val)} />
                </div>
                <button
                  onClick={() => { if (isTyping) onAbort?.(); else handleSend(); }}
                  disabled={(!inputValue.trim() && stagedAttachments.length === 0 && !isTyping)}
                  className={`p-2 rounded-xl transition-all duration-300 transform active:scale-90 ${isTyping ? 'bg-neutral-800 text-[#5DCAA5] border border-neutral-700' : (inputValue.trim() || stagedAttachments.length > 0) ? 'bg-[#1F3D35] text-[#5DCAA5] shadow-lg shadow-black/20 scale-100' : 'bg-white/5 text-neutral-600 scale-95 cursor-not-allowed'}`}
                >
                  {isTyping ? <Square size={16} fill="currentColor" /> : <Send size={18} strokeWidth={2.5} />}
                </button>
              </div>
            </div>
          </div>
          <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" multiple />
          <div className="text-center text-[9px] text-neutral-600 tracking-[0.2em] font-mono uppercase select-none">
            Powered by Bwenge Autonomous Agentic System
          </div>
        </div>
      </footer>
    </div>
  );
}
