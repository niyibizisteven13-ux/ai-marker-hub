/**
 * Classifies a chat message so the caller can decide how to route it —
 * NOT a source of truth for grading. It never generates feedback, scores,
 * or analysis. Real grading must always go through the actual AI providers
 * on the server (`/api/ai/chat`, `/api/mark-script`, etc.).
 */

export type MessageIntent = 'greeting' | 'grading_request' | 'general';

const GREETING_PATTERN = /^(hey(\s+(you|there|budd?y))?|hi(\s+there)?|hello|yo+|sup|good\s(morning|afternoon|evening)|how\sare\syou|how\sare\syou\sdoing|what('?s| is)\sup)[.! ]*$/i;

const GRADING_KEYWORDS = /\b(grade|mark|marking|score|evaluate|assess|review|feedback|rubric|submission)\b/i;

export function classifyIntent(userText: string, hasActiveDocument: boolean): MessageIntent {
  const trimmed = userText.trim();
  if (!trimmed) return 'general';

  if (GREETING_PATTERN.test(trimmed)) {
    return 'greeting';
  }

  if (hasActiveDocument || GRADING_KEYWORDS.test(trimmed)) {
    return 'grading_request';
  }

  return 'general';
}

/**
 * Optional, non-fabricating UX nicety: a short local reply for pure small
 * talk, so the app doesn't need to round-trip to the model (or dump the
 * full welcome block) just to say hello back. Only used for `greeting`
 * intent — everything else must go through the real backend.
 */
export function localGreetingReply(activeDocumentName?: string): string {
  if (activeDocumentName) {
    return `Hey! **${activeDocumentName}** is loaded — want me to grade it against a rubric, or just summarize it first?`;
  }
  return 'Hey! Attach a student paper or launch the scanner whenever you’re ready to grade something.';
}
