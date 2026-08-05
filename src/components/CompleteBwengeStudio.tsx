import React, { useState } from 'react';
import { 
  Sparkles, 
  Paperclip, 
  Send, 
  FileText, 
  CheckCircle2, 
  Copy, 
  Check, 
  ThumbsUp, 
  ThumbsDown, 
  Reply, 
  RotateCcw, 
  MoreVertical,
  Scan,
  X,
  Mic,
  Zap,
  Image as ImageIcon,
  Layers
} from 'lucide-react';

export default function CompleteBwengeStudio() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [inputText, setInputText] = useState('');
  const [attachments, setAttachments] = useState<Array<{ name: string; type: 'doc' | 'scan' }>>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [flashOn, setFlashOn] = useState(false);
  
  // Interactive Chat States
  type AssistantMessage = {
    id: number;
    sender: 'ai';
    type: 'text';
    statusSign: string;
    text: string;
    timestamp: string;
  };

  type UserMessage = {
    id: number;
    sender: 'user';
    type: 'file' | 'text';
    fileName?: string;
    fileSize?: string;
    text?: string;
    timestamp: string;
  };

  type StudioMessage = AssistantMessage | UserMessage;

  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ [key: number]: 'like' | 'dislike' }>({});
  const [replyTo, setReplyTo] = useState<string | null>(null);

  const [messages, setMessages] = useState<StudioMessage[]>([
    {
      id: 1,
      sender: 'user',
      type: 'file',
      fileName: 'Physics_HL_Paper1_Submission.pdf',
      fileSize: '2.4 MB',
      timestamp: '10:42 AM'
    },
    {
      id: 2,
      sender: 'ai',
      type: 'text',
      statusSign: 'Auto-Graded • IB Physics HL Rubric',
      text: "Based on the submitted paper, **Section A (Q1–Q4)** demonstrates strong mastery of thermodynamics calculations ($PV = nRT$). However, Question 3b lost 2 marks due to missing unit conversions from Celsius to Kelvin.",
      timestamp: '10:43 AM'
    }
  ]);

  // Handle File Upload Simulation
  const handleFileUpload = () => {
    setAttachments((prev) => [
      ...prev, 
      { name: 'Physics_Lab_Report.pdf', type: 'doc' }
    ]);
  };

  // Handle Document Scan Simulation
  const handleCaptureScan = () => {
    setIsScanning(false);
    setAttachments((prev) => [
      ...prev, 
      { name: `Scanned_Paper_${prev.length + 1}.png`, type: 'scan' }
    ]);
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  // Handle Copy Message
  const handleCopy = (id: number, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Handle Feedback
  const handleFeedback = (id: number, type: 'like' | 'dislike') => {
    setFeedback((prev) => ({
      ...prev,
      [id]: prev[id] === type ? undefined : type,
    }));
  };

  // Handle Send Message
  const handleSendMessage = () => {
    if (!inputText.trim() && attachments.length === 0) return;

    const newMsgId = messages.length + 1;
    let newMessages = [...messages];

    if (attachments.length > 0) {
      newMessages.push({
        id: newMsgId,
        sender: 'user',
        type: 'file',
        fileName: attachments[0].name,
        fileSize: '1.8 MB',
        timestamp: 'Just now'
      });
    }

    if (inputText.trim()) {
      newMessages.push({
        id: newMsgId + 1,
        sender: 'user',
        type: 'text',
        text: inputText,
        timestamp: 'Just now'
      });
    }

    setMessages(newMessages);
    setInputText('');
    setAttachments([]);
    setReplyTo(null);
  };

  const isSubmitable = inputText.trim().length > 0 || attachments.length > 0;

  return (
    <div className="flex flex-col h-screen w-full bg-[#121316] text-neutral-100 font-sans overflow-hidden">
      
      {/* 1. ULTRA-CLEAN HEADER */}
      <header className="h-12 px-4 flex items-center justify-between border-b border-white/5 bg-[#121316]/90 backdrop-blur-md z-30">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-amber-500/15 text-amber-400 flex items-center justify-center font-bold text-xs border border-amber-500/30">
            ✦
          </div>
          <span className="font-semibold text-xs tracking-wide text-neutral-200">Bwenge AI</span>
        </div>

        {/* Three-Dot Popover Menu */}
        <div className="relative">
          <button 
            onClick={() => setMenuOpen(!menuOpen)}
            className="p-1.5 rounded-full hover:bg-white/5 text-neutral-400 hover:text-white transition"
            aria-label="Menu"
          >
            <MoreVertical className="w-4 h-4" />
          </button>

          {menuOpen && (
            <div className="absolute right-0 mt-2 w-44 bg-[#1e2025] border border-white/10 rounded-2xl shadow-2xl py-1.5 z-50 text-xs animate-in fade-in">
              <button 
                onClick={() => setMenuOpen(false)}
                className="w-full flex items-center justify-between px-4 py-2.5 text-neutral-300 hover:bg-white/5 hover:text-amber-400"
              >
                <span className="flex items-center gap-2"><Layers className="w-3.5 h-3.5" /> Queue</span>
                <span className="bg-amber-500/20 text-amber-400 text-[10px] font-bold px-1.5 py-0.5 rounded-full">3</span>
              </button>
              <div className="h-px bg-white/5 my-1" />
              <button onClick={() => setMenuOpen(false)} className="w-full text-left px-4 py-2 text-neutral-300 hover:bg-white/5 hover:text-amber-400">Marking</button>
              <button onClick={() => setMenuOpen(false)} className="w-full text-left px-4 py-2 text-neutral-300 hover:bg-white/5 hover:text-amber-400">Create</button>
              <button onClick={() => setMenuOpen(false)} className="w-full text-left px-4 py-2 text-neutral-300 hover:bg-white/5 hover:text-amber-400">Results</button>
            </div>
          )}
        </div>
      </header>

      {/* 2. CHAT STREAM */}
      <main className="flex-1 overflow-y-auto p-4 space-y-6 pb-44 max-w-2xl mx-auto w-full">
        {messages.map((msg) => (
          <div key={msg.id} className="space-y-2">
            {msg.sender === 'user' && msg.type === 'file' && (
              <div className="flex justify-end">
                <div className="max-w-[85%] bg-[#1e2025] border border-white/10 rounded-2xl p-3.5 shadow-lg space-y-2">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
                      <FileText className="w-4 h-4" />
                    </div>
                    <div className="overflow-hidden">
                      <p className="text-xs font-semibold text-neutral-200 truncate">{msg.fileName}</p>
                      <p className="text-[10px] text-neutral-400">{msg.fileSize}</p>
                    </div>
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 ml-auto shrink-0" />
                  </div>
                </div>
              </div>
            )}

            {msg.sender === 'user' && msg.type === 'text' && (
              <div className="flex justify-end">
                <div className="max-w-[85%] bg-amber-500/10 border border-amber-500/20 text-neutral-100 rounded-2xl px-4 py-2.5 text-xs sm:text-sm">
                  {msg.text}
                </div>
              </div>
            )}

            {msg.sender === 'ai' && (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-[11px] text-amber-400 font-medium px-1">
                  <span className="w-4 h-4 rounded-full bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-[10px]">
                    ✦
                  </span>
                  <span>{msg.statusSign || 'Bwenge AI'}</span>
                </div>

                <div className="bg-[#1a1c22] border border-white/10 rounded-2xl p-4 shadow-xl space-y-3">
                  <div className="text-xs sm:text-sm text-neutral-200 leading-relaxed select-text selection:bg-amber-500/30 selection:text-amber-200">
                    {msg.text}
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-white/5 text-neutral-400">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleCopy(msg.id, msg.text)}
                        className="p-1.5 rounded-lg hover:bg-white/5 hover:text-white transition flex items-center gap-1 text-[11px]"
                        title="Copy text"
                      >
                        {copiedId === msg.id ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                            <span className="text-emerald-400 font-medium">Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>Copy</span>
                          </>
                        )}
                      </button>
                      <div className="w-px h-3 bg-white/10 mx-1" />
                      <button
                        onClick={() => handleFeedback(msg.id, 'like')}
                        className={`p-1.5 rounded-lg transition ${
                          feedback[msg.id] === 'like'
                            ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                            : 'hover:bg-white/5 hover:text-white'
                        }`}
                        title="Good response"
                      >
                        <ThumbsUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleFeedback(msg.id, 'dislike')}
                        className={`p-1.5 rounded-lg transition ${
                          feedback[msg.id] === 'dislike'
                            ? 'bg-red-500/15 text-red-400 border border-red-500/30'
                            : 'hover:bg-white/5 hover:text-white'
                        }`}
                        title="Bad response"
                      >
                        <ThumbsDown className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setReplyTo(msg.text.substring(0, 30) + '...')}
                        className="p-1.5 rounded-lg hover:bg-white/5 hover:text-white transition flex items-center gap-1 text-[11px]"
                        title="Reply"
                      >
                        <Reply className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Reply</span>
                      </button>
                      <button
                        className="p-1.5 rounded-lg hover:bg-white/5 hover:text-amber-400 transition"
                        title="Regenerate"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </main>

      {/* 3. EXPANDED INPUT CAPSULE (Pinned to Bottom) */}
      <div className="fixed bottom-0 inset-x-0 bg-gradient-to-t from-[#121316] via-[#121316]/95 to-transparent pt-3 pb-4 px-3 z-40">
        <div className="max-w-2xl mx-auto space-y-2">
          {replyTo && (
            <div className="flex items-center justify-between bg-[#1e2025] border border-amber-500/30 rounded-xl px-3 py-1.5 text-xs text-amber-300 animate-in fade-in">
              <div className="flex items-center gap-2 overflow-hidden">
                <Reply className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">Replying to: "{replyTo}"</span>
              </div>
              <button onClick={() => setReplyTo(null)} className="p-0.5 hover:text-white">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          <div className={`relative flex flex-col bg-[#1e2025] border transition-all duration-200 shadow-2xl ${
            isSubmitable ? 'border-amber-500/50 ring-2 ring-amber-500/20' : 'border-white/10 hover:border-white/20'
          } rounded-3xl p-3 space-y-2`}>
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 px-1 pb-1">
                {attachments.map((file, idx) => (
                  <div 
                    key={idx}
                    className="flex items-center gap-2 bg-[#2a2d35] border border-white/15 rounded-2xl px-3 py-1 text-xs text-neutral-200 animate-in fade-in zoom-in-95 duration-150"
                  >
                    {file.type === 'doc' ? (
                      <FileText className="w-4 h-4 text-amber-400" />
                    ) : (
                      <Scan className="w-4 h-4 text-emerald-400" />
                    )}
                    <span className="max-w-[140px] truncate text-xs font-medium">{file.name}</span>
                    <button 
                      onClick={() => removeAttachment(idx)}
                      className="p-0.5 rounded-full hover:bg-white/10 text-neutral-400 hover:text-white transition"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-end gap-3 px-1">
              <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Ask AI or attach submission..."
                rows={1}
                className="w-full bg-transparent text-sm sm:text-base text-neutral-100 placeholder-neutral-500 focus:outline-none resize-none min-h-[28px] max-h-36 py-1 scrollbar-none"
              />
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-white/10">
              <div className="flex items-center gap-1.5 text-neutral-300">
                <button 
                  onClick={handleFileUpload}
                  className="p-2 hover:text-amber-400 hover:bg-white/5 rounded-2xl transition flex items-center gap-1.5"
                  title="Attach File"
                >
                  <Paperclip className="w-4 h-4" />
                  <span className="text-xs hidden sm:inline font-medium">Attach</span>
                </button>
                <button 
                  onClick={() => setIsScanning(true)}
                  className="p-2 text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 rounded-2xl transition flex items-center gap-1.5 border border-amber-500/30"
                  title="Scan Document"
                >
                  <Scan className="w-4 h-4" />
                  <span className="text-xs font-semibold">Scanner</span>
                </button>
                <button 
                  className="p-2 hover:text-amber-400 hover:bg-white/5 rounded-2xl transition"
                  title="Voice Input"
                >
                  <Mic className="w-4 h-4" />
                </button>
              </div>

              <button
                onClick={handleSendMessage}
                disabled={!isSubmitable}
                className={`p-2.5 rounded-2xl transition-all duration-200 flex items-center justify-center shrink-0 ${
                  isSubmitable 
                    ? 'bg-amber-500 text-black shadow-lg shadow-amber-500/20 hover:bg-amber-400 scale-100' 
                    : 'bg-white/5 text-neutral-600 cursor-not-allowed scale-95'
                }`}
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {isScanning && (
        <div className="fixed inset-0 z-50 bg-black/90 flex flex-col justify-between p-4 animate-in fade-in duration-200">
          <div className="flex items-center justify-between text-white z-10">
            <button 
              onClick={() => setIsScanning(false)}
              className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition"
            >
              <X className="w-6 h-6" />
            </button>
            <span className="text-xs font-semibold tracking-wide uppercase text-neutral-300">Document Scanner</span>
            <button 
              onClick={() => setFlashOn(!flashOn)}
              className={`p-2 rounded-full transition ${flashOn ? 'bg-amber-500 text-black' : 'bg-white/10 text-white'}`}
            >
              <Zap className="w-5 h-5" />
            </button>
          </div>

          <div className="relative flex-1 my-4 border-2 border-dashed border-emerald-400/60 rounded-3xl overflow-hidden flex items-center justify-center bg-neutral-900/50">
            <div className="absolute inset-x-0 h-0.5 bg-emerald-400 shadow-[0_0_15px_#34d399] animate-bounce top-1/4" />
            <div className="absolute top-4 left-4 w-6 h-6 border-t-2 border-l-2 border-emerald-400" />
            <div className="absolute top-4 right-4 w-6 h-6 border-t-2 border-r-2 border-emerald-400" />
            <div className="absolute bottom-4 left-4 w-6 h-6 border-b-2 border-l-2 border-emerald-400" />
            <div className="absolute bottom-4 right-4 w-6 h-6 border-b-2 border-r-2 border-emerald-400" />

            <div className="text-center space-y-1 z-10 px-4">
              <p className="text-xs font-semibold text-emerald-400">Position paper inside frame</p>
              <p className="text-[11px] text-neutral-400">Auto-detecting edges...</p>
            </div>
          </div>

          <div className="flex items-center justify-around py-4 z-10">
            <div className="w-10 h-10" />
            <button 
              onClick={handleCaptureScan}
              className="w-16 h-16 rounded-full border-4 border-white flex items-center justify-center p-1 hover:scale-105 active:scale-95 transition"
            >
              <div className="w-full h-full rounded-full bg-amber-500" />
            </button>
            <button 
              onClick={() => setIsScanning(false)}
              className="p-2 text-xs text-neutral-400 hover:text-white"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
