/**
 * Classifies a chat message so the caller can decide how to route it —
 * NOT a source of truth for grading. It never generates feedback, scores,
 * or analysis. Real grading must always go through the actual AI providers
 * on the server (`/api/ai/chat`, `/api/mark-script`, etc.).
 */

export type MessageIntent = 'greeting' | 'grading_request' | 'general';

const GREETING_PATTERN = /^(hey|hi|hello|yo|sup|how are you|who are you|how's it going|good morning|good afternoon|good evening)[.! ]*$/i;


const GRADING_KEYWORDS = /\b(grade|mark|marking|score|evaluate|assess|review|feedback|rubric|submission)\b/i;

export function classifyIntent(userText: string, hasActiveDocument: boolean): MessageIntent {
  const trimmed = userText.trim();
  if (!trimmed) return 'general';

  if (GREETING_PATTERN.test(trimmed)) {
    return 'greeting';
  }

  // Only auto-route to grading if the query is long enough or contains keywords.
  // This allows short questions like "who is you" to stay in general chat mode.
  const isExplicitGrading = GRADING_KEYWORDS.test(trimmed);
  const isLikelyAnalysis = hasActiveDocument && (trimmed.length > 25 || /\?$/.test(trimmed));

  if (isExplicitGrading || isLikelyAnalysis) {
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
  const greetings = [
    "Hello! I'm Bwenge AI, your expert pedagogical assistant.",
    "Greetings! I'm ready to help you with grading or academic analysis.",
    "Hey there! How can I assist you in your teaching today?"
  ];
  const randomGreeting = greetings[Math.floor(Math.random() * greetings.length)];

  if (activeDocumentName) {
    return `${randomGreeting} **${activeDocumentName}** is currently loaded. Would you like me to grade it, or shall we discuss the content first?`;
  }
  return `${randomGreeting} Simply upload a student paper or launch the scanner to get started.`;
}

