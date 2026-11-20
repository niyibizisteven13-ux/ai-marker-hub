import { useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { AgentComposer, AgentThread, useAgentChat } from './AgentChat';

/**
 * "Ask Bwenge" beside the work: the same assistant as the chat, opened on the form editor or the marked-exam
 * review page, which knows what is open there (surface + id). Changes it makes (a form edit, a new mark) are
 * reloaded by the page through onDone. The chat engine and thread view are shared (AgentChat.tsx).
 */
export function AskBwengeDrawer({ surface, surfaceId, title, suggestions, onDone, light = false }: {
  surface: 'form' | 'exam'; surfaceId: string; title: string; suggestions: string[]; onDone?: () => void; light?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const chat = useAgentChat({ surface, surfaceId, onDone });
  const shell = light ? 'bg-white text-[#202124] border-[#E0E0E0]' : 'bg-[#1B1B1B] text-neutral-100 border-white/10';
  const sub = light ? 'text-[#5F6368]' : 'text-neutral-400';
  return (
    <>
      {!open && (
        <button type="button" onClick={() => setOpen(true)} className="fixed bottom-5 right-5 z-[60] inline-flex items-center gap-2 rounded-full bg-[var(--brand)] px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-black/25 hover:bg-[var(--brand-strong)]">
          <Sparkles size={16} /> Ask Bwenge
        </button>
      )}
      {open && (
        <aside className={`fixed inset-y-0 right-0 z-[60] flex w-full max-w-[420px] flex-col border-l shadow-2xl ${shell}`} aria-label="Ask Bwenge">
          <header className={`flex items-center gap-2 border-b px-4 py-3 ${light ? 'border-[#E0E0E0]' : 'border-white/10'}`}>
            <Sparkles size={16} className="text-[var(--brand)]" />
            <div className="min-w-0 flex-1"><p className="text-sm font-semibold">Ask Bwenge</p><p className={`truncate text-xs ${sub}`}>{title}</p></div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className={`rounded-full p-1.5 ${light ? 'hover:bg-black/5' : 'hover:bg-white/10'}`}><X size={16} /></button>
          </header>
          <AgentThread chat={chat} light={light} suggestions={suggestions}
            intro={surface === 'form' ? 'Change this form in plain words, check it before publishing, or ask about the responses.' : 'Ask about any student or question, change a mark with a reason, or get the files.'} />
          <AgentComposer chat={chat} light={light} placeholder={surface === 'form' ? 'e.g. add a question about monthly income in RWF' : 'e.g. why did C002 lose marks on question 3?'} />
        </aside>
      )}
    </>
  );
}

export default AskBwengeDrawer;
