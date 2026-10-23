import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';
import ExcelJS from 'exceljs';
import type Anthropic from '@anthropic-ai/sdk';
import { FileStore } from '../server/services/ai/files/FileStore.js';
import { FileJobQueue } from '../server/services/ai/jobs/fileJobQueue.js';
import { createFileRouter } from '../server/services/ai/fileRouter.js';
import { AnthropicAdapter } from '../server/services/ai/providers/anthropicAdapter.js';
import { createAiAgent } from '../server/services/ai/createAiAgent.js';
import { buildToolkit } from '../server/services/ai/tools/index.js';
import type { AgentEvent, AttachmentRef } from '../server/services/ai/types.js';
import { createOutputService } from '../server/services/outputs/service.js';
import { planHint, planOutput } from '../server/services/outputs/planner.js';
import { fabricatedLinks, missingDeliverables, runDeliverableTurn, useToolAgent } from '../server/services/outputs/chatTurn.js';

// Web-chat deliverables end to end: model tool calls (scripted Anthropic client, no network) → real tools →
// real files in the file store → signed download route. SYNTHETIC values only.
const ACCEPTANCE = 'Make a bar chart comparing A=10, B=20, C=15 and give me an Excel file.';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-deliverables-'));
const fileStore = new FileStore({ dir: path.join(root, 'files'), secret: 'test-secret-1234567890' });
const queue = new FileJobQueue({ storageDir: path.join(root, 'jobs'), concurrency: 2, retryDelayMs: 20, maxActivePerUser: 50 });
const outputs = createOutputService({ fileStore, queue });
const services = { outputs: { create: outputs.create, waitReady: outputs.waitReady, readAnalysis: outputs.readAnalysis, attachmentRef: outputs.attachmentRef } };

const app = express();
app.use('/api/files', createFileRouter(fileStore));
const server = app.listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
test.after(async () => { server.close(); await queue.stop(); await new Promise((r) => setTimeout(r, 200)); await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

type Step = { text?: string; tools?: Array<{ id: string; name: string; input: unknown }> };
/** Scripted Messages API: each stream() call answers with the next step (text and/or tool_use blocks). */
function scriptedClaude(steps: Step[]) {
  const calls: any[] = [];
  const client = {
    messages: {
      stream(params: any) {
        calls.push(JSON.parse(JSON.stringify(params)));
        const step = steps.shift() ?? { text: 'Done.' };
        const content = [...(step.text ? [{ type: 'text', text: step.text }] : []), ...(step.tools ?? []).map((t) => ({ type: 'tool_use', ...t }))];
        return {
          async *[Symbol.asyncIterator]() { if (step.text) yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: step.text } }; },
          async finalMessage() { return { content, stop_reason: step.tools?.length ? 'tool_use' : 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } }; },
        };
      },
    },
  } as unknown as Pick<Anthropic, 'messages'>;
  return { client, calls };
}

const chartSpec = (unit: string | undefined) => ({
  kind: 'chart', title: 'Values by category', sources: [{ type: 'user', label: 'Values given by the user' }],
  chart: { type: 'bar', x: { field: 'Category', title: 'Category', type: 'nominal' }, y: { field: 'Value', title: 'Value', ...(unit ? { unit } : {}) }, data: [{ Category: 'A', Value: 10 }, { Category: 'B', Value: 20 }, { Category: 'C', Value: 15 }], sourceNote: 'Values given by the user' },
});
const xlsxSpec = {
  kind: 'document', format: 'xlsx', title: 'Category values', sources: [{ type: 'user', label: 'Values given by the user' }],
  sheets: [{ name: 'Data', table: { columns: [{ key: 'Category', label: 'Category' }, { key: 'Value', label: 'Value' }], rows: [{ Category: 'A', Value: 10 }, { Category: 'B', Value: 20 }, { Category: 'C', Value: 15 }] } }],
};

function agentWith(steps: Step[]) {
  const { client, calls } = scriptedClaude(steps);
  const agent = createAiAgent({ provider: new AnthropicAdapter({ client, name: 'Claude' }), model: 'claude-haiku-5-5', files: fileStore, services });
  return { agent, calls };
}

// ── Registration and routing ────────────────────────────────────────────────
test('tools: output tools are registered by default, exposed to Claude with schemas, and can be switched off', async () => {
  assert.equal(process.env.ENABLE_OUTPUT_ENGINE_TOOLS, undefined, 'default (unset) means enabled');
  const names = buildToolkit(services).names();
  for (const n of ['create_output', 'analyze_data', 'create_spreadsheet', 'create_chart']) assert.ok(names.includes(n), n);
  assert.ok(!buildToolkit({}).names().includes('create_output'), 'needs the outputs service');
  process.env.ENABLE_OUTPUT_ENGINE_TOOLS = 'false';
  try { assert.ok(!buildToolkit(services).names().includes('create_output')); } finally { delete process.env.ENABLE_OUTPUT_ENGINE_TOOLS; }

  const { agent, calls } = agentWith([{ text: 'Hello.' }]);
  await agent.run({ userId: 'reg-user', system: 'sys', prompt: 'hi' });
  const sent = calls[0].tools.find((t: any) => t.name === 'create_output');
  assert.ok(sent, 'create_output is sent to the Messages API');
  assert.equal(sent.input_schema.type, 'object');
  assert.deepEqual(calls[0].tool_choice, { type: 'auto' });
  assert.equal(calls[0].model, 'claude-haiku-5-5');
  assert.match(calls[0].system, /create_output/, 'capabilities prompt names the tool');
});

test('routing: file/chart requests reach the tool agent even when AI_PROVIDER=gonkarouter and no Claude key', () => {
  const base = { intent: 'general_assist', service: 'general', isSmallTalk: false, requestedProvider: null, hasClaudeKey: false, aiProvider: 'gonkarouter', agentAvailable: true };
  const plan = planOutput({ message: ACCEPTANCE });
  assert.equal(useToolAgent({ ...base, plan }), true, 'the reported failure: this used to take the tool-less legacy stream');
  assert.equal(useToolAgent({ ...base, plan: planOutput({ message: 'What is photosynthesis?' }) }), false, 'everyday chat unchanged');
  assert.equal(useToolAgent({ ...base, hasClaudeKey: true, aiProvider: undefined, plan: planOutput({ message: 'What is photosynthesis?' }) }), true, 'original Claude rule kept');
  assert.equal(useToolAgent({ ...base, requestedProvider: 'ollama', plan }), false, 'explicit local provider honoured');
  assert.equal(useToolAgent({ ...base, agentAvailable: false, plan }), false, 'no agent model configured');
  assert.equal(useToolAgent({ ...base, intent: 'grading', plan }), false);
});

test('planner: the acceptance prompt asks for two deliverables and the hint names both', () => {
  const plan = planOutput({ message: ACCEPTANCE });
  assert.equal(plan.artifact, true);
  assert.deepEqual(plan.deliverables, [{ output: 'chart', format: 'svg' }, { output: 'document', format: 'xlsx' }]);
  const hint = planHint(plan);
  assert.match(hint, /2 deliverables/);
  assert.match(hint, /chart \(SVG\)/);
  assert.match(hint, /XLSX file/);
  assert.doesNotMatch(hint, /at most one/i);
  // Mentioning a format is not asking for a file.
  for (const q of ['Summarize this PDF for me', 'What is an Excel file?', 'Explain how a bar chart works']) assert.deepEqual(planOutput({ message: q }).deliverables, [], q);
  for (const q of ['Export the marks to Excel', 'Put these values in a spreadsheet', 'Draw a pie chart of A=1, B=2']) assert.ok(planOutput({ message: q }).deliverables.length, q);
});

// ── Tool-call execution end to end ──────────────────────────────────────────
test('acceptance: Claude tool calls create a real bar chart and a real .xlsx with A=10, B=20, C=15, downloadable', async () => {
  const user = `chat-user-${Date.now()}`;
  const { agent, calls } = agentWith([
    // Malformed first attempt (quantitative axis without a unit) must come back as a tool error, not a file.
    { text: 'Creating your chart and workbook.', tools: [{ id: 'tu_1', name: 'create_output', input: { spec: chartSpec(undefined) } }] },
    { tools: [{ id: 'tu_2', name: 'create_output', input: { spec: chartSpec('none') } }, { id: 'tu_3', name: 'create_output', input: { spec: xlsxSpec } }] },
    { text: 'Here are your bar chart and Excel workbook.' },
  ]);
  const events: AgentEvent[] = [];
  const r = await agent.run({ userId: user, system: 'You are Bwenge.', prompt: ACCEPTANCE, onEvent: (e) => events.push(e) });

  // Follow-up calls carry the tool results back to the model.
  assert.equal(calls.length, 3);
  const results2 = calls[1].messages.at(-1).content.filter((b: any) => b.type === 'tool_result');
  assert.equal(results2[0].tool_use_id, 'tu_1');
  assert.match(results2[0].content, /rejected[\s\S]*unit/);
  const results3 = calls[2].messages.at(-1).content.filter((b: any) => b.type === 'tool_result');
  assert.deepEqual(results3.map((b: any) => b.tool_use_id), ['tu_2', 'tu_3']);
  for (const b of results3) assert.match(b.content, /^Created /);

  // Exactly two real attachments, emitted to the chat stream.
  assert.equal(r.attachments.length, 2);
  assert.equal(events.filter((e) => e.type === 'attachment').length, 2);
  const chart = r.attachments.find((a) => a.mime === 'image/svg+xml')!;
  const book = r.attachments.find((a) => a.mime === XLSX_MIME)!;
  assert.ok(chart && book, r.attachments.map((a) => a.mime).join(','));
  assert.ok(book.name.endsWith('.xlsx'));
  assert.ok(chart.previewUrl, 'PNG preview for the chat');

  // Working signed downloads through the existing /api/files route.
  const xr = await fetch(`${base}${book.url}`);
  assert.equal(xr.status, 200);
  assert.equal(xr.headers.get('content-type'), XLSX_MIME);
  const bytes = Buffer.from(await xr.arrayBuffer());
  assert.equal(bytes.subarray(0, 2).toString('latin1'), 'PK');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as any);
  const ws = wb.getWorksheet('Data')!;
  const rows = ws.getSheetValues().filter(Boolean).map((row: any) => row.slice(1));
  assert.deepEqual(rows, [['Category', 'Value'], ['A', 10], ['B', 20], ['C', 15]]);
  assert.equal(typeof ws.getCell('B2').value, 'number', 'values are numbers, not text');

  const cr = await fetch(`${base}${chart.url}`);
  assert.equal(cr.status, 200);
  assert.match(cr.headers.get('content-type')!, /^image\/svg\+xml/);
  const svg = await cr.text();
  assert.match(svg, /^<svg[\s\S]*<\/svg>\s*$/);
  for (const t of ['Values by category', '>A<', '>B<', '>C<', 'Source: Values given by the user']) assert.ok(svg.includes(t), `chart has ${t}`);
  // Exactly three bars carrying the user's values, with heights in proportion 10 : 20 : 15.
  const bars = [...svg.matchAll(/<path aria-label="Category: (\w); Value: (\d+)" role="graphics-symbol" d="M[\d.]+,[\d.]+h[\d.]+v([\d.]+)/g)].map((m) => [m[1], Number(m[2]), Number(m[3])] as const);
  assert.deepEqual(bars.map(([c, v]) => [c, v]), [['A', 10], ['B', 20], ['C', 15]]);
  assert.ok(Math.abs(bars[0][2] / bars[1][2] - 0.5) < 1e-6 && Math.abs(bars[2][2] / bars[1][2] - 0.75) < 1e-6, 'bar heights match the values');
  const pr = await fetch(`${base}${chart.previewUrl}`);
  assert.equal(pr.status, 200);
  assert.equal(pr.headers.get('content-type'), 'image/png');

  // The stored artifacts are owned, persisted and carry the user's values.
  const stored = await outputs.list(user);
  assert.equal(stored.length, 2);
  assert.ok(stored.every((a: any) => a.status === 'ready' && a.owner === user && a.sha256));

  // Links are signed: tampering or another file id is refused.
  assert.equal((await fetch(`${base}${book.url.replace(/sig=[^&]+/, 'sig=deadbeef')}`)).status, 403);
  assert.ok(Date.parse(book.expiresAt) - Date.now() <= 7 * 24 * 3600 * 1000 + 5000, 'bounded link lifetime');
});

test('malformed arguments and generation failures are reported as tool errors, never as files', async () => {
  const user = `chat-fail-${Date.now()}`;
  const { agent, calls } = agentWith([
    { tools: [
      { id: 'm1', name: 'create_output', input: {} },
      { id: 'm2', name: 'create_output', input: { spec: { kind: 'image', title: 'A photo', sources: [], prompt: 'a cow' } } },
      { id: 'm3', name: 'create_output', input: { spec: { ...xlsxSpec, sheets: [] } } },
      // Valid shape, but the referenced analysis does not exist: generation fails at the source check.
      { id: 'm4', name: 'create_output', input: { spec: { ...chartSpec('none'), chart: { ...chartSpec('none').chart, data: undefined, fromAnalysis: { artifactId: '00000000-0000-4000-8000-000000000000', result: 0 } } } } },
    ] },
    { text: 'Sorry, those could not be created.' },
  ]);
  const r = await agent.run({ userId: user, system: 'sys', prompt: 'make files' });
  const res = calls[1].messages.at(-1).content.filter((b: any) => b.type === 'tool_result');
  assert.match(res[0].content, /ERROR: invalid arguments for create_output/);
  assert.match(res[1].content, /ERROR: invalid arguments[\s\S]*kind/, 'image output is not offered to the model');
  assert.match(res[2].content, /needs sheets/);
  assert.match(res[3].content, /does not exist or you do not have access/);
  assert.equal(r.attachments.length, 0);
});

test('a stored file that no longer matches its artifact is not delivered', async () => {
  const user = `chat-tamper-${Date.now()}`;
  const { artifact: queued } = await outputs.create(user, xlsxSpec);
  assert.equal(await outputs.attachmentRef(queued), null, 'not deliverable before it is ready');
  const artifact = await outputs.waitReady(user, queued.id);
  assert.equal(artifact.status, 'ready');
  assert.ok(await outputs.attachmentRef(artifact));
  await fs.writeFile(path.join(root, 'files', artifact.fileId), 'col1,col2\nA,10\n');
  assert.equal(await outputs.attachmentRef(artifact), null);
  const { agent, calls } = agentWith([{ tools: [{ id: 't1', name: 'create_output', input: { spec: xlsxSpec } }] }, { text: 'It failed.' }]);
  const r = await agent.run({ userId: user, system: 'sys', prompt: 'excel please' });
  assert.match(calls[1].messages.at(-1).content[0].content, /failed validation/);
  assert.equal(r.attachments.length, 0);
});

// ── Delivery check around the chat turn ─────────────────────────────────────
const ref = (mime: string, n = 1): AttachmentRef => ({ id: `f${n}`, name: `f${n}`, mime, size: 10, kind: 'document', url: `/api/files/f${n}?exp=1&sig=x`, expiresAt: new Date().toISOString() });

test('delivery check: a CSV-instead-of-file answer is discarded and retried; a real failure is stated honestly', async () => {
  const plan = planOutput({ message: ACCEPTANCE });
  assert.deepEqual(missingDeliverables(plan, [ref('image/svg+xml')]), [{ output: 'document', format: 'xlsx' }]);

  const events: AgentEvent[] = [];
  const corrections: string[] = [];
  const ok = await runDeliverableTurn({
    plan, onEvent: (e) => events.push(e),
    run: async (c) => {
      if (!c) return { text: '```csv\nCategory,Value\nA,10\n```\nSave this as data.xlsx.', attachments: [] };
      corrections.push(c.note);
      return { text: 'Here are your files.', attachments: [ref('image/svg+xml', 1), ref(XLSX_MIME, 2)] };
    },
  });
  assert.equal(events[0].type, 'turn_reset', 'client clears the CSV text');
  assert.match(corrections[0], /chart \(SVG\) and XLSX file/);
  assert.match(corrections[0], /never tell them to rename/);
  assert.equal(ok.missing.length, 0);
  assert.equal(ok.text, 'Here are your files.');

  const failed = await runDeliverableTurn({ plan, run: async () => ({ text: 'I could not create the workbook: the generator failed.', attachments: [ref('image/svg+xml')] }) });
  assert.deepEqual(failed.missing, [{ output: 'document', format: 'xlsx' }]);
  assert.match(failed.text, /Not created: XLSX file\. No download is available/);

  const prose = await runDeliverableTurn({ plan: planOutput({ message: 'What is photosynthesis?' }), run: async () => ({ text: 'It is…', attachments: [] }) });
  assert.equal(prose.text, 'It is…', 'non-artifact turns are untouched');
});

test('delivery check: invented download links are flagged; real attachment links are not', () => {
  const real = ref(XLSX_MIME);
  assert.deepEqual(fabricatedLinks(`[Download](${real.url})`, [real]), []);
  assert.deepEqual(fabricatedLinks('[Download the workbook](https://example.com/data.xlsx)', [real]), ['https://example.com/data.xlsx']);
  assert.deepEqual(fabricatedLinks('See /api/files/abc?exp=1&sig=2', [real]), ['/api/files/abc?exp=1&sig=2']);
});

test('planner: 3D requests become an interactive model (create_3d_model), not a flat drawing', () => {
  for (const message of ['generate 3 dimensianal structure of heart in arifact', 'Create a 3D model of a plant cell', 'show me the heart in three-dimensional form', 'build a ball-and-stick model of glucose', 'Make a rotatable model of the solar system']) {
    const p = planOutput({ message });
    assert.equal(p.output, 'model3d', message);
    assert.deepEqual(p.tools, ['create_3d_model']);
    assert.deepEqual(p.deliverables, [{ output: 'model3d', format: 'scene' }]);
    assert.match(planHint(p), /create_3d_model/);
    assert.deepEqual(missingDeliverables(p, [ref('image/svg+xml')]), p.deliverables, 'an SVG drawing does not count as the 3D model');
    assert.deepEqual(missingDeliverables(p, [ref('application/vnd.bwenge.scene+json')]), []);
  }
  for (const message of ['What is a molecule?', 'show me how to rotate a matrix by 90 degrees', 'Give me a walkthrough of the code', 'draw a flowchart of photosynthesis']) {
    assert.notEqual(planOutput({ message }).output, 'model3d', message);
  }
});
