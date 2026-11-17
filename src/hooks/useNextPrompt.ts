import { useEffect, useMemo, useRef, useState } from 'react';
import { authFetch } from '../utils/authFetch';
import { lastFinishedTurn, type TurnMessage } from '../utils/nextPrompt';

/**
 * A suggestion for the user's next message, asked for once when an answer has finished (never while it is being written).
 * Nothing is shown if the user turned it off, the chat is empty, or the server has nothing good to suggest.
 */
export function useNextPrompt({ messages, isTyping, enabled }: { messages: TurnMessage[]; isTyping: boolean; enabled: boolean }) {
  const turn = useMemo(() => (enabled ? lastFinishedTurn(messages, isTyping) : null), [messages, isTyping, enabled]);
  const [got, setGot] = useState<{ key: string; text: string } | null>(null);
  const asked = useRef('');
  useEffect(() => {
    if (!turn || asked.current === turn.key) return;
    asked.current = turn.key;
    const ac = new AbortController();
    authFetch('/api/ai/next-prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lastUser: turn.user.slice(0, 600), lastAssistant: turn.assistant.slice(-1500) }), signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => { if (b && typeof b.suggestion === 'string' && b.suggestion) setGot({ key: turn.key, text: b.suggestion }); })
      .catch(() => undefined);
    return () => ac.abort();
  }, [turn]);
  // only valid for the answer it was made for: a new question or a new chat clears it at once
  return turn && got && got.key === turn.key ? got.text : null;
}
