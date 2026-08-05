import React, { useState } from 'react';
import { 
  Paperclip, 
  Camera, 
  Send, 
  MoreVertical, 
  FileText, 
  CheckCircle2, 
  Sparkles, 
  Eye, 
  RotateCcw,
  Layers
} from 'lucide-react';
import DocumentScanner from './DocumentScanner';

export default function ModernBwengeStudio() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [activeDocument, setActiveDocument] = useState<any>(null);
  const [scannerOpen, setScannerOpen] = useState(false);

  // Trigger inline upload simulation
  const handleUpload = () => {
    setActiveDocument({
      name: 'Student_Submission.pdf',
      size: '2.4 MB',
      pages: 4
    });
  };

  return (
    <div className="flex flex-col h-screen w-full bg-[#121316] text-neutral-100 font-sans overflow-hidden">
      
      {/* 1. ULTRA-CLEAN HEADER */}
      <header className="h-12 px-4 flex items-center justify-between border-b border-white/5 bg-[#121316]/90 backdrop-blur-md z-30">
        {/* Brand Logo */}
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
            <div className="absolute right-0 mt-2 w-44 bg-[#1e2025] border border-white/10 rounded-2xl shadow-2xl py-1.5 z-50 text-xs">
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

      {/* 2. MAIN CANVAS / CHAT STREAM */}
      <main className="flex-1 overflow-y-auto p-4 space-y-4 pb-28">
        
        {!activeDocument ? (
          /* Empty State Canvas */
          <div className="h-full flex flex-col justify-center items-center text-center p-6 space-y-2">
            <div className="w-10 h-10 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-neutral-500">
              <Sparkles className="w-5 h-5 text-amber-500/80" />
            </div>
          </div>
        ) : (
          /* Inline Uploaded Document Card & AI Thread */
          <div className="space-y-4 animate-in fade-in">
            <div className="bg-[#1e2025] border border-white/10 rounded-2xl p-3.5 shadow-xl space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 overflow-hidden">
                  <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
                    <FileText className="w-4 h-4" />
                  </div>
                  <div className="overflow-hidden">
                    <h3 className="text-xs font-semibold text-neutral-200 truncate">{activeDocument.name}</h3>
                    <p className="text-[10px] text-neutral-400">{activeDocument.size} • {activeDocument.pages} pages</p>
                  </div>
                </div>
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2 pt-1 border-t border-white/5">
                <button className="flex-1 py-1.5 bg-amber-500 text-black font-medium text-xs rounded-xl flex items-center justify-center gap-1.5 transition hover:bg-amber-400">
                  <Sparkles className="w-3.5 h-3.5" /> Auto-Grade
                </button>
                <button className="px-3 py-1.5 bg-white/5 text-neutral-300 text-xs rounded-xl flex items-center gap-1 border border-white/10 transition hover:bg-white/10">
                  <Eye className="w-3.5 h-3.5" /> View
                </button>
                <button 
                  onClick={() => setActiveDocument(null)} 
                  className="p-1.5 bg-white/5 text-neutral-400 hover:text-red-400 rounded-xl border border-white/10 transition"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* AI Assistant Message Bubble */}
            <div className="flex items-start gap-2.5 max-w-[95%]">
              <div className="w-5 h-5 rounded-full bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 text-[10px] shrink-0 mt-0.5">
                ✦
              </div>
              <div className="space-y-2">
                <p className="text-xs text-neutral-200 leading-relaxed">
                  Document ready for evaluation.
                </p>
              </div>
            </div>
          </div>
        )}

      </main>

      {/* 3. GEMINI-STYLE CAPSULE INPUT BAR */}
      <div className="fixed bottom-0 inset-x-0 bg-gradient-to-t from-[#121316] via-[#121316]/95 to-transparent pt-3 pb-4 px-3 z-40">
        <div className="max-w-lg mx-auto">
          <div className="relative flex items-center bg-[#1e2025] border border-white/10 rounded-full shadow-2xl px-3 py-1.5">
            
            {/* Embedded Attachment & Camera Controls */}
            <div className="flex items-center gap-1 text-neutral-400 pr-2 border-r border-white/10">
              <button 
                onClick={handleUpload} 
                className="p-1.5 hover:text-amber-400 rounded-full transition" 
                title="Upload Document"
              >
                <Paperclip className="w-4 h-4" />
              </button>
              <button 
                onClick={() => setScannerOpen(true)}
                className="p-1.5 hover:text-amber-400 rounded-full transition" 
                title="Scan Document"
              >
                <Camera className="w-4 h-4" />
              </button>
            </div>
            
            {/* Input Field */}
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Type a message..."
              className="w-full bg-transparent text-xs text-neutral-100 placeholder-neutral-500 focus:outline-none pl-3 pr-2 py-1"
            />

            {/* Send Button */}
            <button className="p-1.5 bg-amber-500 text-black rounded-full hover:bg-amber-400 transition shrink-0 shadow-md">
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {scannerOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="absolute inset-0" onClick={() => setScannerOpen(false)} />
          <div className="relative w-full max-w-3xl h-[80vh] rounded-3xl overflow-hidden border border-white/10 shadow-2xl bg-[#101113]">
            <DocumentScanner
              onClose={() => setScannerOpen(false)}
              onSavePages={(pages) => {
                if (!pages || pages.length === 0) {
                  setScannerOpen(false);
                  return;
                }
                setActiveDocument({
                  name: `Scan_${pages.length}_pages.jpg`,
                  size: `${(pages.length * 1.8).toFixed(1)} MB`,
                  pages: pages.length,
                });
                setScannerOpen(false);
              }}
            />
          </div>
        </div>
      )}

    </div>
  );
}
