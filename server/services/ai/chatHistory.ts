/**
 * Fits a whole conversation into the model's context. The newest turns are kept word for word (long ones
 * trimmed in the middle); turns that no longer fit are condensed into one "earlier in this conversation"
 * note at the start, so the model still knows what was asked, attached and decided at the beginning.
 */

export interface ChatTurn { role: 'user' | 'assistant'; text: string }

export interface FitOptions {
  /** Characters of recent turns kept word for word (about 4 characters per token). */
  budget?: number;
  /** Longest single turn kept; longer turns keep their start and end. */
  perTurn?: number;
  /** Characters for the condensed note about older turns. */
  digestBudget?: number;
  /** Characters kept from each older turn in the note. */
  digestPerTurn?: number;
}

const DEFAULTS: Required<FitOptions> = { budget: 120_000, perTurn: 16_000, digestBudget: 16_000, digestPerTurn: 320 };

/** Most turns accepted from a client; anything older is dropped before fitting. */
export const MAX_HISTORY_TURNS = 400;

function trimMiddle(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.7);
  const tail = max - head;
  return `${text.slice(0, head)}\n[… ${text.length - max} characters of this message left out …]\n${text.slice(text.length - tail)}`;
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/** Cleans a client-sent history: known roles, string text, at most MAX_HISTORY_TURNS of the newest turns. */
export function sanitizeHistory(raw: unknown): ChatTurn[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((h): h is { role: string; text: string } => !!h && typeof h === 'object' && typeof (h as { text?: unknown }).text === 'string' && ((h as { role?: unknown }).role === 'user' || (h as { role?: unknown }).role === 'assistant'))
    .map((h) => ({ role: h.role as ChatTurn['role'], text: h.text }))
    .filter((h) => h.text.trim() !== '')
    .slice(-MAX_HISTORY_TURNS);
}

export function fitHistory(turns: ChatTurn[], opts: FitOptions = {}): ChatTurn[] {
  const o = { ...DEFAULTS, ...opts };
  const kept: ChatTurn[] = [];
  let used = 0;
  let i = turns.length - 1;
  for (; i >= 0; i--) {
    const text = trimMiddle(turns[i].text, o.perTurn);
    // Always keep the last exchange, even when it alone is over budget.
    if (used + text.length > o.budget && kept.length >= 2) break;
    kept.unshift({ role: turns[i].role, text });
    used += text.length;
  }
  if (i < 0) return kept;

  // The opening request usually sets the task ("mark these with this scheme"), so it is always in the note.
  const line = (t: ChatTurn, max: number) => `- ${t.role === 'user' ? 'User' : 'Assistant'}: ${oneLine(t.text, max)}`;
  const firstUser = turns.findIndex((t, k) => k <= i && t.role === 'user');
  const opening = firstUser >= 0 ? line(turns[firstUser], Math.max(o.digestPerTurn, 1_500)) : '';
  // Then older turns, one line each, newest first until the note is full, then back in order.
  const lines: string[] = [];
  let noteUsed = opening.length;
  let j = i;
  for (; j > firstUser; j--) {
    const l = line(turns[j], o.digestPerTurn);
    if (noteUsed + l.length > o.digestBudget) break;
    lines.unshift(l);
    noteUsed += l.length + 1;
  }
  const skipped = j - firstUser;
  const body = [opening, ...(skipped > 0 ? [`- (${skipped} message${skipped === 1 ? '' : 's'} left out)`] : []), ...lines].filter(Boolean);
  const note = `[Earlier in this conversation (condensed). Use it to stay consistent with what was already said, attached and decided.]\n${body.join('\n')}`;
  if (kept[0]?.role === 'user') return [{ role: 'user', text: `${note}\n\n${kept[0].text}` }, ...kept.slice(1)];
  return [{ role: 'user', text: note }, ...kept];
}
