import React, { useEffect, useRef, useState } from 'react';
import { Paperclip, Scan, Mic, Send } from 'lucide-react';
import type { ChatAttachment, Message } from '../types';
import ChatMessage from './ChatMessage';

interface RightSidebarProps {
  messages: Message[];
  onSendMessage: (userText: string, attachment?: File | ChatAttachment | ChatAttachment[]) => void;
  activeDocument?: any;
  setActiveDocument: React.Dispatch<React.SetStateAction<any>>;
  isAiThinking?: boolean;
  aiServiceState?: 'ready' | 'degraded' | 'offline';
  onOpenScanner?: () => void;
}

export const RightSidebar: React.FC<RightSidebarProps> = ({
  messages,
  onSendMessage,
  activeDocument,
  setActiveDocument,
  isAiThinking = false,
  aiServiceState = 'ready',
  onOpenScanner,
}) => {
  const [inputText, setInputText] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() && !selectedFile) return;

    onSendMessage(inputText.trim(), selectedFile || undefined);
    setInputText('');
    setSelectedFile(null);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
    }
  };

  return (
    <div className="flex flex-col h-full w-full bg-slate-950 text-slate-100">
      <header className="p-3.5 border-b border-slate-800/80 bg-slate-900/90 backdrop-blur-md flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-gradient-to-tr from-orange-500 to-amber-500 flex items-center justify-center text-white font-bold text-xs shadow-md shadow-orange-500/20">
            ✦
          </div>
          <h1 className="text-xs font-semibold text-slate-100 tracking-wide">Bwenge AI Assistant</h1>
        </div>
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium transition ${
          isAiThinking
            ? 'bg-orange-500/15 border border-orange-500/25 text-orange-300'
            : aiServiceState === 'ready'
            ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
            : aiServiceState === 'degraded'
            ? 'bg-amber-500/10 border border-amber-500/25 text-amber-300'
            : 'bg-slate-700/20 border border-slate-600 text-slate-200'
        }`}>
          {isAiThinking
            ? 'Analyzing scanned document...'
            : aiServiceState === 'ready'
            ? 'Ready'
            : aiServiceState === 'degraded'
            ? 'Degraded'
            : 'Offline'}
        </span>
      </header>

      <main className="flex-1 min-h-0 overflow-y-auto px-4 py-5 pb-6 space-y-4 scrollbar-thin scrollbar-thumb-slate-700/80">
        {messages.map((msg) => (
          <ChatMessage
            key={msg.id}
            message={msg}
          />
        ))}
        <div ref={chatEndRef} />
      </main>

      {selectedFile && (
        <div className="px-4 py-2 bg-slate-900 border-t border-slate-800 flex items-center justify-between text-xs text-orange-400">
          <span className="truncate">📎 {selectedFile.name}</span>
          <button onClick={() => setSelectedFile(null)} className="text-slate-500 hover:text-slate-300">
            ✕
          </button>
        </div>
      )}

      <footer className="sticky bottom-0 z-10 border-t border-slate-800/80 bg-slate-950/95 backdrop-blur-sm p-4">
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 bg-slate-900/95 border border-slate-800/90 rounded-3xl p-3 shadow-[0_25px_50px_-35px_rgba(0,0,0,0.7)]">
          <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" />

          <textarea
            rows={2}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
            placeholder="Ask Bwenge to review a submission, upload a rubric, or attach a file..."
            className="w-full min-h-[72px] resize-none rounded-3xl border border-slate-800/80 bg-slate-950/90 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/10"
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-2 rounded-full border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200 transition hover:border-orange-500/40 hover:text-orange-200"
              >
                <Paperclip className="w-3.5 h-3.5 text-orange-400" />
                Attach
              </button>

              <button
                type="button"
                onClick={onOpenScanner}
                className="inline-flex items-center gap-2 rounded-full border border-orange-500/20 bg-orange-500/10 px-3 py-2 text-xs text-orange-300 transition hover:bg-orange-500/20"
              >
                <Scan className="w-3.5 h-3.5" />
                Scanner
              </button>
            </div>

            <button
              type="submit"
              className="inline-flex h-11 min-w-[3rem] items-center justify-center rounded-3xl bg-gradient-to-tr from-orange-500 to-amber-500 px-4 text-white shadow-lg shadow-orange-500/20 transition hover:opacity-95 active:scale-[0.98]"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </form>
      </footer>
    </div>
  );
};
