# Integrating into your AiService

## 1. Install

1. Copy `src/ai/` to `server/services/ai/` (keep the folder together).
2. Copy `src/ui/AttachmentCards.tsx`, `SourceList.tsx`, `types.ts`, and `AiResponseView.tsx` into your components folder. **Do not copy `MarkdownRenderer.tsx`** (it is a test placeholder); `AiResponseView` imports your existing one.
3. `npm i @dagrejs/dagre @expo-google-fonts/inter @pdf-lib/fontkit @resvg/resvg-js ajv docx exceljs jszip mammoth pdf-lib pdf-parse pptxgenjs sanitize-html vega vega-lite` (Node 20.3 or newer).
4. Environment:
```
FILE_STORE_DIR=./data/generated        # persistent volume in production
FILE_URL_SECRET=<32+ random characters>
GONKA_API_KEY=...  GONKA_BASE_URL=...  GONKA_MODEL=zai-org/GLM-5.3-Flash
# optional image generation (OpenAI-compatible /images/generations)
IMAGE_API_KEY=  IMAGE_BASE_URL=  IMAGE_MODEL=
```

## 2. Create the agent once

```ts
// server/services/ai/agent.ts
import { createAiAgent, FileStore } from './index.js';
import { BWENGE_GENERAL_SYSTEM_PROMPT } from './prompts/bwengeGeneralPrompt.js';
import { KnowledgeRetrievalService } from '../KnowledgeRetrievalService.js';
import { ExecutionSandbox } from '../ExecutionSandbox.js';

export const fileStore = new FileStore({ dir: process.env.FILE_STORE_DIR ?? './data/generated', secret: process.env.FILE_URL_SECRET! });

export const agent = createAiAgent({
  provider: { name: 'GonkaRouter', baseUrl: process.env.GONKA_BASE_URL ?? 'https://api.gonkarouter.io/v1', apiKey: process.env.GONKA_API_KEY },
  model: process.env.GONKA_MODEL ?? 'zai-org/GLM-5.3-Flash',
  files: fileStore,
  temperature: 0.3,
  maxTokens: 8192,
  services: {
    // Map YOUR services to these small shapes (see ToolServices in types.ts). Leave out what you do not have.
    knowledge: {
      async search(query, { topK, userId }) {
        const hits = await KnowledgeRetrievalService.getInstance().search(query, { limit: topK, userId }); // adjust to your API
        return hits.map((h: any) => ({ text: h.text, title: h.title, publisher: h.publisher, year: h.year, page: h.page, table: h.table, url: h.url, score: h.score }));
      },
    },
    python: {
      async execute(code) {
        const r = await ExecutionSandbox.getInstance().callMcpTool('python/execute', { code });
        if (r.error) throw new Error(r.error.message);
        const out = r.result.output;
        return { stdout: typeof out === 'string' ? out : JSON.stringify(out) /* , files: [{ name, base64 }] if your sandbox can return files */ };
      },
    },
  },
});
```
The GonkaRouter request shape (OpenAI-compatible `/chat/completions` with SSE) is the assumption already noted in your code. Confirm the base URL, SSE framing, and tool-call support. If the gateway rejects `stream_options`, pass `includeUsage: false` in the provider options.

## 3. Mount downloads and cleanup

```ts
import { createFileRouter } from './services/ai/index.js';
app.use('/api/files', createFileRouter(fileStore, { getUserId: (req) => (req as any).user?.id }));
setInterval(() => fileStore.purgeExpired().catch(() => {}), 60 * 60 * 1000);
```

## 4. Replace the Gonka branch of `generalAssist`

Keep your memory and pinned-syllabus logic; replace the manual message and file handling:

```ts
if (useGonka) {
  const memoryContext = await memoryService.getLongTermContext(options.userId, currentQuery).catch(() => '');
  const system = BWENGE_GENERAL_SYSTEM_PROMPT + memoryContext +
    (options.pinnedSyllabus ? `\n\n[MASTER CONTEXT]: ${options.pinnedSyllabus}` : '');
  const history = options.messages.slice(0, -1).map((m) => ({ role: m.role as 'user' | 'assistant', text: extractPlainText(m.content) }));

  if (options.extractSchema) {
    // JSON extraction: no tools, then parse
    const r = await agent.run({ userId: options.userId, system: `${system}\n\nRespond with ONLY valid JSON matching: ${options.extractSchema}`, history, prompt: extractPlainText(options.messages.at(-1)!.content), uploads: options.files, toolNames: [] });
    return { ...this.parseModelJson(r.text), _usage: r.usage };
  }
  const r = await agent.run({
    userId: options.userId, system, history,
    prompt: extractPlainText(options.messages.at(-1)!.content),
    uploads: options.files?.map((f) => ({ type: f.type, base64: f.base64, mediaType: f.mediaType })),
    onEvent: options.onEvent,           // text, tool_call, tool_result, attachment, sources, turn_reset, usage, done
  });
  return { content: [{ type: 'text', text: r.text }], model: process.env.GONKA_MODEL, attachments: r.attachments, sources: r.sources, _usage: r.usage };
}
```
`options.tools` / `options.executeTool` from the old signature are no longer needed for Gonka: the registry holds the tools. To keep your own tools (for example `build_form`, `cross_reference_visuals`), add them with `agent.tools.add({ definition, execute })` using the `Tool` shape.

## 5. Stream events to the browser

Forward each `AgentEvent` over your existing SSE channel (the shapes match your old `{ type, data }`):

| Event | What the UI does |
|---|---|
| `text` | append `data.text` to the message |
| `turn_reset` | clear the text streamed in this turn (the model call is being retried) |
| `tool_call` / `tool_result` | optional "Working on it..." status line |
| `attachment` | add the file card (`AttachmentCards`) |
| `sources` | add source chips (`SourceList`) |
| `usage` / `done` | billing and finish |

## 6. Save messages with their files

Persist `attachments` (keep `id`, `name`, `mime`, `size`, `kind`, `previewId`) and `sources` with each assistant message. Download links are signed and expire quickly, so when loading a chat call:

```ts
const fresh = await fileStore.refresh(savedRef, userId);   // null if the file expired
```
Render with `<AiResponseView content=... attachments={fresh} sources=... animate={false} />` for history, and `animate` (default) for the message that is streaming now. Default file lifetime is 24 hours; pass `defaultTtlMs` to `FileStore` if chats should keep files longer (for example 30 days), and budget storage for that.

## 7. Keep your Anthropic loop? Use the same tools

```ts
const anthropicTools = agent.tools.toAnthropicTools();
executeTool: async (name, input) => (await agent.tools.get(name)!.execute(input, { userId, files: fileStore, services })).text
```
(Attachments created this way are not streamed as events unless you forward them yourself. Prefer moving everything to `AgentRuntime`.)

## 8. Production checklist

- [ ] `FILE_URL_SECRET` is random, 32+ characters, and not committed.
- [ ] Downloads are served only through `/api/files` (never statically from the storage folder).
- [ ] Rate-limit agent requests per user, and cap tool calls per message (`maxTurns` default 12).
- [ ] Storage quota per user and a cleanup job (`purgeExpired`).
- [ ] If student or personal data is involved, decide whether prompts may leave your chosen provider (see `AISERVICE_FIXES.md` item 7 about silent Gemini fallback).
- [ ] Run `npm run verify` after every dependency update.
