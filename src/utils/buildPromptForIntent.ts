// src/utils/buildPromptForIntent.ts
//
// Decides the effective prompt to send to the model when the user's message may
// be vague or empty but an attachment is present. Mirrors the same default
// described in BWENGE_SYSTEM_PROMPT and buildBwengeGradingPrompt: a vague-but-
// present query plus a file should produce a request for a structured overview,
// not a stall for clarification.

const VAGUE_ATTACHMENT_PHRASES = [
  'what do you see',
  'what does this show',
  'check this out',
  'look at this',
  'take a look',
  'how do you see this',
  "what's in this",
  'what is in this',
  'what do you think',
];

function isVagueOrEmpty(query: string): boolean {
  const trimmed = query.trim();
  if (trimmed.length === 0) return true;
  if (trimmed.length <= 6) return true; // "hi", "??", "ok" etc.

  const lower = trimmed.toLowerCase();
  return VAGUE_ATTACHMENT_PHRASES.some((phrase) => lower.includes(phrase));
}

export interface BuildPromptForIntentOptions {
  userQuery: string | undefined | null;
  hasAttachment: boolean;
}

/**
 * Returns the effective prompt to send to the model.
 * - Vague/empty query + attachment present -> explicit structured-overview request.
 * - Specific query -> passed through unchanged.
 * - No query and no attachment -> empty string.
 */
export function buildPromptForIntent({
  userQuery,
  hasAttachment,
}: BuildPromptForIntentOptions): string {
  const trimmed = (userQuery ?? '').trim();

  if (hasAttachment && isVagueOrEmpty(trimmed)) {
    return [
      trimmed.length > 0 ? `User message: ${trimmed}` : 'User message: (no text provided)',
      "The user has attached a file and their message is vague or does not specify what they want. Give a structured overview of the attached file's contents rather than asking a clarifying question.",
    ].join('\n\n');
  }

  return trimmed;
}
