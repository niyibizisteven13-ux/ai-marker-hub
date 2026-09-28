/**
 * Strips <think>...</think> / <thinking>...</thinking> reasoning blocks
 * that some models (notably open-weight reasoning models served through
 * routers like GonkaRouter) emit inline in their output. These are meant
 * for internal reasoning, not for the end user, and must never reach a
 * Telegram message or any other user-facing surface.
 *
 * Shared rather than duplicated per-caller: any new surface that routes
 * through a reasoning-tag-emitting model (web chat, a future WhatsApp
 * channel, etc.) should import this instead of writing its own regex.
 */

export interface StripThinkingTagsResult extends String {
  text: string;
  thinkingText?: string;
}

export function stripThinkingTags(text: any): StripThinkingTagsResult {
  const str = typeof text === 'string' ? text : String(text || '');
  if (!str) {
    const empty = new String('') as StripThinkingTagsResult;
    empty.text = '';
    empty.thinkingText = undefined;
    return empty;
  }

  let thinkingText: string | undefined = undefined;

  // 1. Check for closed tag: <think>...</think> or <thinking>...</thinking>
  const closedMatch = str.match(/<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/i);
  if (closedMatch) {
    thinkingText = closedMatch[1].trim();
  }

  let cleaned = str.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '');

  // 2. Check for unclosed tag: <think>...
  if (/<think(?:ing)?>/i.test(cleaned)) {
    const unclosedMatch = cleaned.match(/<think(?:ing)?>([\s\S]*?)(?:\n\n|$)/i);
    if (unclosedMatch) {
      if (!thinkingText) thinkingText = unclosedMatch[1].trim();
    }
    // If followed by \n\n, strip from <think> up to \n\n
    if (/<think(?:ing)?>[\s\S]*?\n\n/i.test(cleaned)) {
      cleaned = cleaned.replace(/<think(?:ing)?>[\s\S]*?\n\n/gi, '');
    } else {
      // Otherwise strip to end of string
      cleaned = cleaned.replace(/<think(?:ing)?>[\s\S]*$/gi, '');
    }
  }

  const finalText = cleaned.trim();
  const result = new String(finalText) as StripThinkingTagsResult;
  result.text = finalText;
  result.thinkingText = thinkingText || undefined;
  return result;
}
