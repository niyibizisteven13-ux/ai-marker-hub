import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Square } from 'lucide-react';
import { authFetch } from '../utils/authFetch';
import { applyStatusEvent, applyToolEvent } from '../utils/toolSteps';
import { ActivityLine, type Step } from './ActivityLine';
import { AttachmentCards } from './AttachmentCards';
import MarkdownRenderer from './MarkdownRenderer';
import type { AttachmentRef } from './types';

/**
 * The Bwenge assistant beside the work: one chat engine and one thread view, used by the form and exam drawers and by the MySEB dashboard panel.
 * It talks to the same endpoint as the main chat and tells the server which page it is on (surface + id), so the assistant knows what "this" is.
 * Replies show the same live steps and file cards as the main chat.
 */
export type AgentSurface = 'form' | 'exam' | 'myseb';
export interface AgentMsg { role: 'user' | 'assistant'; text: string; steps: Step[]; files: AttachmentRef[]; busy?: boolean; startedAt: number; endedAt?: number; error?: boolean }

/** The chat renderer is styled for dark surfaces; on a white page its text and tables are recoloured. */
export const LIGHT_MD = '[&_*]:!text-[#202124] [&_div:has(>table)]:!border-[#E0E0E0] [&_div:has(>table)]:!bg-white [&_div:has(>table)]:!shadow-none [&_th]:!border-[#E0E0E0] [&_th]:!bg-[#F8F9FA] [&_td]:!border-[#F1F3F4]';

export function useAgentChat({ surface, surfaceId, onDone, context }: { context?: string; surface?: AgentSurface; surfaceId?: string; onDone?: () => void }) {
  const [msgs, setMsgs] = useState<AgentMsg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs]);

  useEffect(() => () => abort.current?.abort(), []);

  const send = async (q: string) => {
    const query = q.trim();
    if (!query || busy) return;
    const history = msgs.slice(-8).map((m) => ({ role: m.role, text: m.text }));
    setText('');
    setBusy(true);
    const started = Date.now();
    setMsgs((m) => [...m, { role: 'user', text: query, steps: [], files: [], startedAt: started }, { role: 'assistant', text: '', steps: [], files: [], busy: true, startedAt: started }]);
    const patch = (fn: (a: AgentMsg) => AgentMsg) => setMsgs((m) => m.map((x, i) => (i === m.length - 1 ? fn(x) : x)));
    const ctl = new AbortController();
    abort.current = ctl;
    let answer = '';
    let steps: Step[] = [];
    const files: AttachmentRef[] = [];
    try {
      const res = await authFetch('/api/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: context ? context + '\n\n' + query : query, history, surface, ...(surfaceId ? { surfaceId } : {}) }), signal: ctl.signal });
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
  return { msgs, text, setText, busy, send, stop: () => abort.current?.abort(), end };
}
export type AgentChatState = ReturnType<typeof useAgentChat>;

/** The messages (or, when there are none, the intro and the suggested questions). */
export function AgentThread({ chat, light, intro, suggestions }: { chat: AgentChatState; light: boolean; intro: string; suggestions: string[] }) {
  const sub = light ? 'text-[#5F6368]' : 'text-neutral-400';
  const chip = light ? 'border-[#E0E0E0] hover:border-[var(--brand)] text-[#202124]' : 'border-white/10 hover:border-[var(--brand)]/60 text-neutral-200';
  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4" aria-live="polite">
      {!chat.msgs.length && (
        <div>
          <p className={`text-sm ${sub}`}>{intro}</p>
          <div className="mt-3 flex flex-col gap-2">{suggestions.map((s) => <button key={s} type="button" onClick={() => void chat.send(s)} className={`rounded-xl border px-3 py-2 text-left text-sm ${chip}`}>{s}</button>)}</div>
        </div>
      )}
      {chat.msgs.map((m, i) => m.role === 'user'
        ? <div key={i} className="flex justify-end"><p className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm ${light ? 'bg-[#F1F3F4]' : 'bg-white/10'}`}>{m.text}</p></div>
        : (
          <div key={i} className={`text-sm ${m.error ? 'text-rose-400' : ''}`}>
            <ActivityLine steps={m.steps} busy={!!m.busy} current={m.steps.filter((s) => s.status === 'running').at(-1)?.label ?? (m.busy && !m.text ? 'Working…' : undefined)} startedAt={m.startedAt} endedAt={m.endedAt} />
            {m.text && <div className={light ? LIGHT_MD : ''}><MarkdownRenderer content={m.text} /></div>}
            {m.files.length > 0 && <div className="mt-2"><AttachmentCards attachments={m.files} /></div>}
          </div>
        ))}
      <div ref={chat.end} />
    </div>
  );
}

/** The box to type in, with Send and Stop. */
export function AgentComposer({ chat, light, placeholder }: { chat: AgentChatState; light: boolean; placeholder: string }) {
  return (
    <form onSubmit={(e) => { e.preventDefault(); void chat.send(chat.text); }} className={`border-t p-3 ${light ? 'border-[#E0E0E0]' : 'border-white/10'}`}>
      <div className={`flex items-end gap-2 rounded-2xl border px-3 py-2 ${light ? 'border-[#DADCE0]' : 'border-white/10 bg-black/20'}`}>
        <textarea value={chat.text} onChange={(e) => chat.setText(e.target.value)} rows={1} placeholder={placeholder} aria-label="Message Bwenge"
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void chat.send(chat.text); } }}
          className="max-h-32 min-h-[24px] flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-neutral-500" />
        {chat.busy
          ? <button type="button" onClick={chat.stop} aria-label="Stop" className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--brand)] text-white"><Square size={13} /></button>
          : <button type="submit" disabled={!chat.text.trim()} aria-label="Send" className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--brand)] text-white disabled:opacity-40"><ArrowUp size={16} /></button>}
      </div>
    </form>
  );
}
