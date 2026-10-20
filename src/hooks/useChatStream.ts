import { useCallback, useEffect, useRef, useState } from "react";
import type { GeneratedFile, Phase, Step, StreamEvent } from "../components/ActivityLine";

export interface ChatStreamState {
  phase: Phase;
  text: string;
  /** The one line describing what is happening right now. Cleared when answer text starts. */
  current?: string;
  steps: Step[];
  files: GeneratedFile[];
  error?: string;
  startedAt: number;
  endedAt?: number;
}

const INITIAL: ChatStreamState = { phase: "idle", text: "", steps: [], files: [], startedAt: 0 };

/**
 * Streams one assistant reply over SSE (fetch + ReadableStream, so POST works).
 */
export function useChatStream() {
  const [state, setState] = useState<ChatStreamState>(INITIAL);
  const abortRef = useRef<AbortController | null>(null);
  const bufferRef = useRef("");
  const rafRef = useRef<number | null>(null);

  const flush = useCallback(() => {
    rafRef.current = null;
    const chunk = bufferRef.current;
    if (!chunk) return;
    bufferRef.current = "";
    setState((s) => ({ ...s, phase: "streaming", current: undefined, text: s.text + chunk }));
  }, []);

  const scheduleFlush = useCallback(() => {
    if (rafRef.current === null) rafRef.current = requestAnimationFrame(flush);
  }, [flush]);

  const apply = useCallback(
    (ev: StreamEvent) => {
      switch (ev.type) {
        case "status":
          setState((s) => ({ ...s, current: ev.label }));
          break;
        case "text_delta":
          bufferRef.current += ev.text;
          scheduleFlush();
          break;
        case "tool_start":
          setState((s) => ({
            ...s,
            current: ev.label,
            steps: [...s.steps, { id: ev.id, name: ev.name, label: ev.label, status: "running" }],
          }));
          break;
        case "tool_end":
          setState((s) => ({
            ...s,
            current: undefined,
            steps: s.steps.map((st) =>
              st.id === ev.id ? { ...st, status: ev.ok ? "done" : "error", summary: ev.summary } : st
            ),
          }));
          break;
        case "file_created":
          setState((s) => ({ ...s, files: [...s.files, { id: ev.id, name: ev.name, url: ev.url, mime: ev.mime }] }));
          break;
        case "error":
          setState((s) => ({ ...s, phase: "error", current: undefined, error: ev.message, endedAt: Date.now() }));
          break;
        case "done":
          flush();
          setState((s) =>
            s.phase === "error" ? s : { ...s, phase: "done", current: undefined, endedAt: s.endedAt ?? Date.now() }
          );
          break;
      }
    },
    [flush, scheduleFlush]
  );

  const send = useCallback(
    async (url: string, body: unknown, init?: RequestInit) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      bufferRef.current = "";
      setState({ ...INITIAL, phase: "thinking", startedAt: Date.now() });

      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify(body),
          signal: controller.signal,
          ...init,
        });
        if (!res.ok || !res.body) throw new Error(`Request failed (${res.status})`);

        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += value;
          const frames = buf.split("\n\n");
          buf = frames.pop() ?? "";
          for (const frame of frames) {
            const line = frame.split("\n").find((l) => l.startsWith("data: "));
            if (!line) continue;
            const data = line.slice(6);
            if (data === "[DONE]") {
              apply({ type: "done" });
              continue;
            }
            try {
              apply(JSON.parse(data) as StreamEvent);
            } catch {
              /* ignore malformed frame */
            }
          }
        }
        apply({ type: "done" });
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          flush();
          setState((s) => ({ ...s, phase: "stopped", current: undefined, endedAt: Date.now() }));
        } else {
          apply({ type: "error", message: (err as Error).message || "Something went wrong" });
        }
      }
    },
    [apply, flush]
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);
  const reset = useCallback(() => setState(INITIAL), []);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    []
  );

  return { ...state, isBusy: state.phase === "thinking" || state.phase === "streaming", send, stop, reset };
}

export default useChatStream;
