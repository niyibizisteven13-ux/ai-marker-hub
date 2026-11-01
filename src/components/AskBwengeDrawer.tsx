import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Sparkles, Square, X } from 'lucide-react';
import { authFetch } from '../utils/authFetch';
import { applyStatusEvent, applyToolEvent } from '../utils/toolSteps';
import { ActivityLine, type Step } from './ActivityLine';
import { AttachmentCards } from './AttachmentCards';
import MarkdownRenderer from './MarkdownRenderer';
import type { AttachmentRef } from './types';

/**
 * "Ask Bwenge" beside the work: the same assistant as the chat, opened on the form editor or the marked-exam
 * review page, which knows what is open there (surface + id). Changes it makes (a form edit, a new mark) are
 * reloaded by the page through onDone. Replies show the same live steps and file cards as the main chat.
 */

/** The chat renderer is styled for dark surfaces; on a white page its text and tables are recoloured. */
const LIGHT_MD = '[&_*]:!text-[#202124] [&_div:has(>table)]:!border-[#E0E0E0] [&_div:has(>table)]:!bg-white [&_div:has(>table)]:!shadow-none [&_th]:!border-[#E0E0E0] [&_th]:!bg-[#F8F9FA] [&_td]:!border-[#F1F3F4]';

interface Msg { role: 'user' | 'assistant'; text: string; steps: Step[]; files: AttachmentRef[]; busy?: boolean; startedAt: number; endedAt?: number; error?: boolean }

export function AskBwengeDrawer({ surface, surfaceId, title, suggestions, onDone, light = false }: {
  surface: 'form' | 'exam'; surfaceId: string; title: string; suggestions: string[]; onDone?: () => void; light?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs]);

  const send = async (q: string) => {
    const query = q.trim();
    if (!query || busy) return;
    const history = msgs.slice(-8).map((m) => ({ role: m.role, text: m.text }));
    setText('');
    setBusy(true);
    const started = Date.now();
    setMsgs((m) => [...m, { role: 'user', text: query, steps: [], files: [], startedAt: started }, { role: 'assistant', text: '', steps: [], files: [], busy: true, startedAt: started }]);
    const patch = (fn: (a: Msg) => Msg) => setMsgs((m) => m.map((x, i) => (i === m.length - 1 ? fn(x) : x)));
    const ctl = new AbortController();
    abort.current = ctl;
    let answer = '';
    let steps: Step[] = [];
    const files: AttachmentRef[] = [];
    try {
      const res = await authFetch('/api/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, history, surface, surfaceId }), signal: ctl.signal });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => null))?.error || 'Bwenge could not answer. Please try again.');
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          let ev: any;
          try { ev = JSON.parse(payload); } catch { continue; }
          if (ev.type === 'text' && typeof ev.text === 'string' && !ev.isThinking) answer += ev.text;
          else if (ev.type === 'reset') answer = '';
          else if (ev.type === 'status') steps = applyStatusEvent(steps, ev);
          else if (ev.type === 'tool_call' || ev.type === 'tool_result') steps = applyToolEvent(steps, ev);
          else if (ev.type === 'attachment' && ev.id && !files.some((f) => f.id === ev.id)) files.push(ev);
          else if (ev.type === 'error') throw new Error(ev.message || 'Bwenge could not answer.');
          patch((a) => ({ ...a, text: answer, steps, files: [...files] }));
        }
      }
      patch((a) => ({ ...a, busy: false, endedAt: Date.now(), steps: a.steps.map((s) => (s.status === 'running' ? { ...s, status: 'done' } : s)) }));
      onDone?.();
    } catch (e) {
      const stopped = ctl.signal.aborted;
      patch((a) => ({ ...a, busy: false, endedAt: Date.now(), error: !stopped, text: a.text || (stopped ? 'Stopped.' : (e as Error).message) }));
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  const shell = light ? 'bg-white text-[#202124] border-[#E0E0E0]' : 'bg-[#1B1B1B] text-neutral-100 border-white/10';
  const sub = light ? 'text-[#5F6368]' : 'text-neutral-400';
  const chip = light ? 'border-[#E0E0E0] hover:border-[var(--brand)] text-[#202124]' : 'border-white/10 hover:border-[var(--brand)]/60 text-neutral-200';
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
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {!msgs.length && (
              <div>
                <p className={`text-sm ${sub}`}>{surface === 'form' ? 'Change this form in plain words, check it before publishing, or ask about the responses.' : 'Ask about any student or question, change a mark with a reason, or get the files.'}</p>
                <div className="mt-3 flex flex-col gap-2">{suggestions.map((s) => <button key={s} type="button" onClick={() => void send(s)} className={`rounded-xl border px-3 py-2 text-left text-sm ${chip}`}>{s}</button>)}</div>
              </div>
            )}
            {msgs.map((m, i) => m.role === 'user'
              ? <div key={i} className="flex justify-end"><p className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm ${light ? 'bg-[#F1F3F4]' : 'bg-white/10'}`}>{m.text}</p></div>
              : (
                <div key={i} className={`text-sm ${m.error ? 'text-rose-400' : ''}`}>
                  <ActivityLine steps={m.steps} busy={!!m.busy} current={m.steps.filter((s) => s.status === 'running').at(-1)?.label ?? (m.busy && !m.text ? 'Working…' : undefined)} startedAt={m.startedAt} endedAt={m.endedAt} />
                  {m.text && <div className={light ? LIGHT_MD : ''}><MarkdownRenderer content={m.text} /></div>}
                  {m.files.length > 0 && <div className="mt-2"><AttachmentCards attachments={m.files} /></div>}
                </div>
              ))}
            <div ref={end} />
          </div>
          <form onSubmit={(e) => { e.preventDefault(); void send(text); }} className={`border-t p-3 ${light ? 'border-[#E0E0E0]' : 'border-white/10'}`}>
            <div className={`flex items-end gap-2 rounded-2xl border px-3 py-2 ${light ? 'border-[#DADCE0]' : 'border-white/10 bg-black/20'}`}>
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={1} placeholder={surface === 'form' ? 'e.g. add a question about monthly income in RWF' : 'e.g. why did C002 lose marks on question 3?'}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(text); } }}
                className="max-h-32 min-h-[24px] flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-neutral-500" />
              {busy
                ? <button type="button" onClick={() => abort.current?.abort()} aria-label="Stop" className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--brand)] text-white"><Square size={13} /></button>
                : <button type="submit" disabled={!text.trim()} aria-label="Send" className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--brand)] text-white disabled:opacity-40"><ArrowUp size={16} /></button>}
            </div>
          </form>
        </aside>
      )}
    </>
  );
}

export default AskBwengeDrawer;
