/**
 * A chat request that was stopped by a plan limit (e.g. marking scripts with no credits left). After the user
 * pays, "continue", "give me the result" or "I paid" runs it again, so they do not have to upload the scripts
 * twice. Kept in memory for two hours; large inline uploads are dropped (files uploaded first are kept by id).
 */

export interface PendingRequest { body: Record<string, unknown>; at: number; label: string }

const TTL_MS = 2 * 3600_000;
const MAX_INLINE_BYTES = 25 * 1024 * 1024;
const pending = new Map<string, PendingRequest>();

/** Fields replayed on resume; history and per-turn settings come from the new request. */
const KEEP = ['query', 'attachmentText', 'attachmentName', 'attachmentMimeType', 'attachmentBase64', 'attachments', 'attachmentIds', 'examContext', 'pinnedSyllabus', 'service', 'jobId'] as const;

export function rememberBlocked(userId: string, body: Record<string, unknown>, label = 'your request') {
  const kept: Record<string, unknown> = {};
  for (const k of KEEP) if (body[k] !== undefined) kept[k] = body[k];
  const inline = JSON.stringify([kept.attachments ?? '', kept.attachmentBase64 ?? '']).length;
  if (inline > MAX_INLINE_BYTES) { delete kept.attachments; delete kept.attachmentBase64; }
  pending.set(userId, { body: kept, at: Date.now(), label });
  if (pending.size > 500) pending.delete(pending.keys().next().value!);
}

export function peekPending(userId: string): PendingRequest | null {
  const p = pending.get(userId);
  if (!p) return null;
  if (Date.now() - p.at > TTL_MS) { pending.delete(userId); return null; }
  return p;
}

const RESUME = /^\s*(?:ok(?:ay)?[,!. ]*)?(?:continue|resume|go on|go ahead|try again|retry|done|unlock(?:ed)?|i(?:'ve| have)? (?:paid|upgraded|bought)|paid|(?:now )?(?:please )?(?:give|show|send) (?:me )?(?:the |my )?(?:marked )?(?:results?|marks|papers?|scripts?)(?: (?:now|then|please))*)\b/i;

/** The pending request, if this message asks to carry on with it (and carries no new files). */
export function takeResumable(userId: string, message: string, hasNewFiles: boolean): PendingRequest | null {
  if (hasNewFiles || message.length > 120 || !RESUME.test(message)) return null;
  const p = peekPending(userId);
  if (p) pending.delete(userId);
  return p;
}

export const clearPending = (userId: string) => { pending.delete(userId); };
export const resetPending = () => pending.clear();
