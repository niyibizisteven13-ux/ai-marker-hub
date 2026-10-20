import { Router, Request, Response } from 'express';
import Anthropic from "@anthropic-ai/sdk";
import type { StreamEvent } from "../../src/components/ActivityLine";
import { clip, thinkingRelay } from "../services/ai/thinkingRelay.js";

const router = Router();

const HAS_KEY = Boolean(process.env.ANTHROPIC_API_KEY);
const client = HAS_KEY ? new Anthropic() : null;
const MODEL = process.env.CLAUDE_MODEL ?? "claude-sonnet-5-5";
const SHOW_THINKING = process.env.SHOW_THINKING !== "0";

const SYSTEM = [
  "You are Bwenge, a helpful assistant.",
  "Every tool call must include a `status`: one short present-tense line (max 8 words) saying what you are doing for this user,",
  "written in the same language the user is writing in. Be specific, e.g. the student's name or the topic being searched.",
].join(" ");

const STATUS_PROP = {
  status: { type: "string", description: "Short present-tense line shown to the user while this runs, in their language." },
};

const TOOLS: Anthropic.Tool[] = [
  {
    name: "grade_submission",
    description: "Grade a student's submission against a marking scheme and return marks and feedback.",
    input_schema: {
      type: "object",
      properties: { ...STATUS_PROP, student: { type: "string" }, submission: { type: "string" }, scheme: { type: "string" } },
      required: ["status", "submission"],
    },
  },
];

const TOOL_IMPL: Record<string, (input: any) => Promise<string>> = {
  grade_submission: async (input) => {
    return JSON.stringify({ marks: 17, outOf: 20, feedback: "Strong working, minor unit omission.", received: String(input?.submission ?? "").length });
  },
};

function openSSE(res: Response) {
  res.status(200).set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  return (ev: StreamEvent) => {
    res.write(`data: ${JSON.stringify(ev)}\n\n`);
    (res as any).flush?.();
  };
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });

async function runMock(send: (e: StreamEvent) => void, signal: AbortSignal) {
  const say = async (label: string, ms: number) => (send({ type: "status", label }), sleep(ms, signal));
  await sleep(1500, signal);
  await say("The student answered 6 of 8 questions.", 1800);
  await say("Comparing the working against the marking scheme.", 1800);
  send({ type: "tool_start", id: "t1", name: "grade_submission", label: "Grading student submission" });
  await sleep(3500, signal);
  send({ type: "tool_end", id: "t1", ok: true, summary: "Scored 17 / 20" });
  await say("Two marks were lost for missing units.", 1600);
  const words = "Student scored 17 out of 20. The method was strong, but the final step lost a mark for a missing unit. Showing the working more clearly next time will help.".split(" ");
  for (const w of words) {
    if (signal.aborted) return;
    send({ type: "text_delta", text: w + " " });
    await sleep(45, signal);
  }
}

async function runClaude(messages: Anthropic.MessageParam[], send: (e: StreamEvent) => void, signal: AbortSignal) {
  for (let round = 0; round < 8 && !signal.aborted; round++) {
    const relay = thinkingRelay(send);
    const stream = client!.messages.stream(
      {
        model: MODEL,
        max_tokens: 16000,
        system: SYSTEM,
        messages,
        tools: TOOLS,
        ...(SHOW_THINKING ? { thinking: { type: "adaptive", display: "summarized" } as any } : {}),
      },
      { signal }
    );

    stream.on("streamEvent", (ev) => {
      if (ev.type === "content_block_delta" && ev.delta.type === "thinking_delta") relay(ev.delta.thinking);
    });
    stream.on("text", (t) => send({ type: "text_delta", text: t }));

    const msg = await stream.finalMessage();
    if (msg.stop_reason !== "tool_use") return;

    messages.push({ role: "assistant", content: msg.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of msg.content) {
      if (block.type !== "tool_use") continue;
      const input = block.input as { status?: string };
      send({ type: "tool_start", id: block.id, name: block.name, label: clip(input.status ?? block.name) });
      try {
        const out = await TOOL_IMPL[block.name](block.input);
        send({ type: "tool_end", id: block.id, ok: true });
        results.push({ type: "tool_result", tool_use_id: block.id, content: out });
      } catch (e) {
        send({ type: "tool_end", id: block.id, ok: false, summary: (e as Error).message });
        results.push({ type: "tool_result", tool_use_id: block.id, content: `Error: ${(e as Error).message}`, is_error: true });
      }
    }
    messages.push({ role: "user", content: results });
  }
}

router.post("/chat", async (req: Request, res: Response) => {
  const send = openSSE(res);
  const controller = new AbortController();
  res.on("close", () => controller.abort());

  const heartbeat = setInterval(() => res.write(": ping\n\n"), 15000);
  try {
    const messages: Anthropic.MessageParam[] = req.body?.messages ?? [{ role: "user", content: String(req.body?.text ?? "") }];
    if (HAS_KEY) await runClaude(messages, send, controller.signal);
    else await runMock(send, controller.signal);
    send({ type: "done" });
  } catch (e) {
    if (!controller.signal.aborted) send({ type: "error", message: (e as Error).message });
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
});

export default router;
