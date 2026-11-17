/** The last finished question-and-answer of a chat, for suggesting the user's next message. Pure, so it can be tested. */
export interface TurnMessage { id: string; sender: 'user' | 'assistant'; text: string; isBusy?: boolean; isThinking?: boolean }
export interface FinishedTurn { key: string; user: string; assistant: string }

export function lastFinishedTurn(messages: TurnMessage[], typing: boolean): FinishedTurn | null {
  if (typing || messages.length < 2) return null;
  const last = messages[messages.length - 1];
  if (last.sender !== 'assistant' || last.isBusy || last.isThinking || !last.text?.trim()) return null;
  for (let i = messages.length - 2; i >= 0; i--) {
    if (messages[i].sender === 'user') return { key: `${messages[i].id}>${last.id}:${last.text.length}`, user: messages[i].text ?? '', assistant: last.text };
  }
  return null;
}

/** Tab on an empty box fills the suggestion; Enter on an empty box sends it; anything typed replaces it. */
export function suggestionAction(key: string, shift: boolean, input: string, suggestion: string | null): 'fill' | 'send' | null {
  if (!suggestion || input.trim() !== '' || shift) return null;
  if (key === 'Tab') return 'fill';
  if (key === 'Enter') return 'send';
  return null;
}

export const NEXT_PROMPT_OFF_KEY = 'bwenge.nextPrompt';
export const nextPromptEnabled = (): boolean => { try { return localStorage.getItem(NEXT_PROMPT_OFF_KEY) !== 'off'; } catch { return true; } };
export const setNextPromptEnabled = (on: boolean) => { try { localStorage.setItem(NEXT_PROMPT_OFF_KEY, on ? 'on' : 'off'); } catch { /* private window: the choice lasts until the page closes */ } };
