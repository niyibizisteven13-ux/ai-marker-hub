import type { StreamEvent } from "../../src/components/ActivityLine";

export const clip = (s: string, n = 90) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

/**
 * Turns the streamed thinking summary into occasional one-line statuses:
 * waits for a complete sentence, sends only the latest one, and at most once per `minGapMs`.
 */
export function thinkingRelay(send: (e: StreamEvent) => void, minGapMs = 1200, now: () => number = Date.now) {
  let buf = "";
  let last = 0;
  return (chunk: string) => {
    buf += chunk;
    const parts = buf.split(/(?<=[.!?])\s+|\n+/);
    if (parts.length < 2) return; // sentence not finished yet
    buf = parts.pop()!; // keep the unfinished tail for next time
    const sentence = parts[parts.length - 1].trim();
    const t = now();
    if (sentence.length < 8 || t - last < minGapMs) return;
    last = t;
    send({ type: "status", label: clip(sentence) });
  };
}
