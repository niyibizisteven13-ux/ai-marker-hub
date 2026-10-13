# Bwenge AI capabilities

A tested capability layer for the Bwenge AI service. It gives your model (GonkaRouter / GLM, or any OpenAI-compatible model) the same kinds of abilities that make assistants like Claude useful in practice: it can **create downloadable files, draw, chart, diagram, read uploads, search your knowledge base with citations, run calculations, and work in multi-step tool loops**.

> Honest scope: this does not copy any model's intelligence. It is the **tool layer around the model**: files, drawing, reading, sources, retries, security. How well the AI writes, reasons, and draws still depends on the model you connect. The layer is what turns "text in, text out" into "text in, finished files out".

## What your AI can do now

| Ability | Tool the model calls | What the user gets |
|---|---|---|
| Word, PDF, HTML, Markdown documents (reports, letters, lesson plans, exam papers) | `create_document` | Downloadable files; one spec can produce several formats |
| Excel workbooks and CSV with live formulas (`=SUM(B2:B10)`), number formats, frozen header | `create_spreadsheet` | `.xlsx` / `.csv` |
| PowerPoint decks (bullets, two columns, tables, images, quotes, speaker notes) | `create_presentation` | `.pptx` |
| Text and code files (py, js, ts, sql, json, html, css, md, csv, ...) | `create_text_file` | Download |
| ZIP bundles of earlier files | `create_archive` | `.zip` |
| Illustrations, icons, logos, posters, plans (vector) | `create_drawing` (SVG) | `.svg` + PNG preview |
| Data charts (bar, line, area, scatter, stacked, grouped, heatmap, box plot, histogram) | `create_chart` (Vega-Lite) | `.svg` + PNG preview |
| Flowcharts, process maps, org charts, decision trees (automatic layout) | `create_diagram` | `.svg` + PNG preview |
| Realistic or painted pictures | `generate_image` (needs an image provider) | PNG/JPEG |
| Read uploads: PDF, DOCX, XLSX, PPTX, CSV, text, HTML, images | automatic + `read_attachment` | Text in the model's context |
| Answer from your documents with citations | `search_knowledge` (your retrieval service) | `[1] Title, Publisher, 2022, p. 12` + source chips |
| Web search and page reading | `web_search`, `fetch_url` (your search service) | Untrusted-data wrapped results |
| Exact calculations, statistics, data cleaning, generating files from code | `run_python` (your sandbox) | stdout + files |
| Embed a chart or drawing inside a document, PDF, or slide | `fileId` in an image block | One finished file |

Everything the AI creates is stored privately per user, expires automatically, and is downloaded through short-lived signed links.

## Architecture

```
UI (AiResponseView + AttachmentCards + SourceList)
        ^ SSE events: text, tool_call, tool_result, attachment, sources, turn_reset, usage, done
Express: /api/files/:id (signed or session download)           <- createFileRouter
        |
createAiAgent()  --> ingestUploads (extract PDF/DOCX/XLSX text, images as vision parts)
        |           --> capabilities prompt (teaches WHEN/HOW to use tools)
AgentRuntime  (one loop for every provider: stream, tool calls, parallel tools, retries, idle timeout, turn limits)
        |
OpenAICompatibleAdapter  (GonkaRouter / NVIDIA NIM / OpenRouter / OpenAI; SSE + JSON fallback)
        |
ToolRegistry + tools   (JSON-schema validated; errors go back to the model so it can fix and retry)
        |
Generators: docx, pdf (pdf-lib + Inter), xlsx (exceljs), pptx (pptxgenjs), csv, zip
Drawing: SVG sanitizer, resvg PNG, Vega-Lite charts, dagre diagrams
FileStore: private, expiring, HMAC-signed links
```

## Quick start

```ts
import { createAiAgent, FileStore, createFileRouter } from './ai';

const files = new FileStore({ dir: './data/generated', secret: process.env.FILE_URL_SECRET! });
const agent = createAiAgent({
  provider: { name: 'GonkaRouter', baseUrl: process.env.GONKA_BASE_URL!, apiKey: process.env.GONKA_API_KEY },
  model: 'zai-org/GLM-5.3-Flash',
  files,
  services: { knowledge, python, webSearch },   // all optional
});
app.use('/api/files', createFileRouter(files, { getUserId: (req) => req.user?.id }));

const result = await agent.run({ userId, system: BWENGE_GENERAL_SYSTEM_PROMPT, prompt: 'Make a Term 2 report with a chart', onEvent });
// result.text, result.attachments, result.sources, result.usage
```
See `INTEGRATION.md` for the exact changes to your `AiService.ts`.

## How it was verified (all run in a sandbox; see `npm run verify`)

- **55 automated tests pass**, and both TypeScript configs compile cleanly.
- Every generated file is **re-opened by an independent reader**: DOCX via mammoth, XLSX via exceljs (formulas intact), PPTX via zip + slide XML (embedded media found), PDF via pdf-parse and pdf-lib (accents such as "élève" survive).
- **Visual checks** (see `samples/`): the PDF page, flowchart, chart, drawing, and the DOCX, PPTX, and XLSX files rendered through LibreOffice and inspected. This caught a real bug: PDF font subsetting dropped most letters when rendered even though text extraction looked fine. It is fixed and guarded by a regression test.
- **Security tests**: 10 hostile SVG samples (scripts, event handlers, foreignObject, external images and URLs, entity bombs, animation) are neutralised; path traversal in ZIP names, forged or expired signed links, other users' files, CSV formula injection, and XSS in HTML output are blocked.
- **Agent loop tests against a mock streaming server**: split `<think>` tags, fragmented tool-call JSON, parallel tools, bad JSON and invalid arguments recovered by the model, 429/5xx retries, no retry on 401, stalled-stream timeout with reset, plain-JSON gateways, turn limit with a final answer, and an end-to-end run that reads an uploaded PDF and returns a downloadable workbook.

Not verified here: the real GonkaRouter API (your code comments say its request and response shapes are an assumption), Microsoft Office rendering (LibreOffice only), and any real model's output quality.

## Limits you should know

- Fonts: Inter (Latin). English, French, and Kinyarwanda are fine; Arabic, CJK, and emoji become `?` in PDFs. Italic is shown as regular in PDFs.
- No OCR for scanned PDFs (the model is told so; send photos to a vision model instead). No in-place editing of an existing Word file: the AI reads it and creates a new updated file.
- Math: LaTeX is not typeset. Use charts, tables, or images for formulas.
- PDF layout is deliberately simple (single column, tables, images, lists, quotes, code blocks).
- `generate_image` only appears when you provide an image provider.
- Local disk storage is fine for one server. For several servers use shared storage (S3 or similar) by replacing the three disk calls in `FileStore`.

## Known dependency advisories (`npm audit --omit=dev`, October 2026)

Seven moderate or high advisories, all in transitive packages: `image-size` (via `pptxgenjs`; denial of service in JXL, HEIF, and ICNS parsers, which this code never feeds because images are checked to be PNG or JPEG first), `uuid` (via `exceljs`; only affects calls that pass a buffer), `sprintf-js` (via `mammoth` through `argparse`). Run `npm audit` in CI, and upgrade when fixed versions ship.

## Adding a tool

```ts
const myTool: Tool = {
  definition: { name: 'create_certificate', description: '...', parameters: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } } },
  async execute(input, ctx) { /* build a file */ const f = await saveFile(ctx, {...}); return { text: `Created ${f.name}`, attachments: [f] }; },
};
registry.add(myTool);
```
Validation, timeouts, error handling, events, and attachments are handled for you.
