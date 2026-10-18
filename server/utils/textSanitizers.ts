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

function findMatchingJsonBoundary(content: string, startIndex: number): number | null {
  const startChar = content[startIndex];
  const closingChar = startChar === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < content.length; index += 1) {
    const char = content[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === startChar) depth += 1;
    else if (char === closingChar) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return null;
}

export function extractJsonFragment(rawText: string): string | null {
  if (!rawText) return null;

  const cleaned = stripThinkingTags(rawText).text.trim();
  if (!cleaned) return null;

  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) {
    const candidate = fenced[1].trim();
    if (candidate) return candidate;
  }

  const candidateStarts = ['{', '['];
  for (const startChar of candidateStarts) {
    let startIndex = cleaned.indexOf(startChar);
    while (startIndex >= 0) {
      const endIndex = findMatchingJsonBoundary(cleaned, startIndex);
      if (endIndex !== null) {
        const candidate = cleaned.slice(startIndex, endIndex + 1).trim();
        if (candidate) return candidate;
      }
      startIndex = cleaned.indexOf(startChar, startIndex + 1);
    }
  }

  return null;
}

export function parseModelJson(rawText: string, fallback: any = {}): any {
  const extracted = extractJsonFragment(rawText ?? '');
  if (!extracted) return fallback;

  try {
    return JSON.parse(extracted);
  } catch {
    const stripped = extracted.trim().replace(/^\s*JSON\s*[:=]\s*/i, '');
    if (stripped !== extracted) {
      try {
        return JSON.parse(stripped);
      } catch {}
    }
    return fallback;
  }
}
