import React, { useRef, useState } from 'react';
import { Paperclip, Scan, Mic, Send, Sparkles } from 'lucide-react';
import { GeminiFileCard } from './GeminiFileCard';

interface ChatAttachment {
  id: string;
  name: string;
  size: string;
  type: string;
  previewContent?: string;
}

interface Message {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  attachment?: ChatAttachment;
  timestamp: string;
}

interface RightSidebarProps {
  messages: Message[];
  onSendMessage: (userText: string, file?: File) => void;
  activeDocument?: any;
  setActiveDocument: React.Dispatch<React.SetStateAction<any>>;
}

export const RightSidebar: React.FC<RightSidebarProps> = ({
  messages,
  onSendMessage,
  activeDocument,
  setActiveDocument,
}) => {
  const [inputText, setInputText] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        <span className="text-[10px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full font-medium">
          Ready
        </span>
      </header>

      <main className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => {
          const isUser = msg.sender === 'user';
          return (
            <div key={msg.id} className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} w-full`}>
              {msg.attachment && (
                <GeminiFileCard
                  attachment={msg.attachment}
                  onStartMarking={() => onSendMessage(`Start marking ${msg.attachment?.name}`, undefined)}
                  onOpenDesktopView={() => setActiveDocument(msg.attachment)}
                />
              )}

              {msg.text && (
                <div
                  className={`max-w-[85%] text-xs p-3.5 rounded-2xl shadow-sm leading-relaxed ${
                    isUser
                      ? 'bg-orange-500/20 border border-orange-500/30 text-slate-100 rounded-tr-xs'
                      : 'bg-slate-900 border border-slate-800 text-slate-200 rounded-tl-xs space-y-2'
                  }`}
                >
                  {!isUser && (
                    <div className="flex items-center gap-1 text-orange-400 font-semibold text-[10px] mb-1">
                      <Sparkles className="w-3 h-3" />
                      <span>Bwenge AI</span>
                    </div>
                  )}
                  <p>{msg.text}</p>
                </div>
              )}

              <span className="text-[9px] text-slate-500 mt-1 px-1">{msg.timestamp}</span>
            </div>
          );
        })}
      </main>

      {selectedFile && (
        <div className="px-4 py-2 bg-slate-900 border-t border-slate-800 flex items-center justify-between text-xs text-orange-400">
          <span className="truncate">📎 {selectedFile.name}</span>
          <button onClick={() => setSelectedFile(null)} className="text-slate-500 hover:text-slate-300">
            ✕
          </button>
        </div>
      )}

      <footer className="p-3 border-t border-slate-800/80 bg-slate-900/90 backdrop-blur-xl shrink-0">
        <form onSubmit={handleSubmit} className="flex flex-col gap-2 bg-slate-950 border border-slate-800 rounded-3xl p-2.5 focus-within:border-orange-500/50 transition-all shadow-xl">
          <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" />

          <textarea
            rows={1}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
            placeholder="Ask AI or attach document..."
            className="w-full bg-transparent text-xs text-slate-100 placeholder-slate-500 resize-none focus:outline-none px-2"
          />

          <div className="flex items-center justify-between pt-1 border-t border-slate-900">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 px-3 py-1.5 rounded-full text-xs transition-colors"
              >
                <Paperclip className="w-3.5 h-3.5 text-orange-400" />
                <span>Attach</span>
              </button>

              <button
                type="button"
                className="flex items-center gap-1.5 bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 border border-orange-500/20 px-3 py-1.5 rounded-full text-xs font-medium transition-colors"
              >
                <Scan className="w-3.5 h-3.5" />
                <span>Scanner</span>
              </button>

              <button type="button" className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-900 rounded-full transition-colors">
                <Mic className="w-4 h-4" />
              </button>
            </div>

            <button
              type="submit"
              className="p-2 bg-gradient-to-tr from-orange-500 to-amber-500 text-white rounded-xl hover:opacity-90 active:scale-95 transition-all shadow-md shadow-orange-500/20"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        </form>
      </footer>
    </div>
  );
};
