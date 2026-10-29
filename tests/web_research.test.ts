import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { AnthropicAdapter } from '../server/services/ai/providers/anthropicAdapter.js';
import { needsResearch } from '../server/services/ai/research.js';
import { viewPages } from '../server/services/ai/tools/documentTools.js';

// Research with sources: Claude's own web search and fetch on agent turns (never on structured output),
// paused server-tool turns resumed, citations turned into a numbered sources list, searches shown in the
// activity line. Research questions go to the agent. Library files' pages can be looked at.
// Fake Anthropic client; no network.

type Msg = { content: any[]; stop_reason: string; usage: any };
function fakeClient(replies: Msg[], seen: any[]) {
  return {
    messages: {
      stream(params: any) {
        seen.push(JSON.parse(JSON.stringify(params)));
        const msg = replies.shift()!;
        const events: any[] = [];
        msg.content.forEach((b, index) => {
          if (b.type === 'server_tool_use') {
            events.push({ type: 'content_block_start', index, content_block: { ...b, input: {} } });
            events.push({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } });
            events.push({ type: 'content_block_stop', index });
          } else if (b.type === 'text') {
            events.push({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
            events.push({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: b.text } });
            events.push({ type: 'content_block_stop', index });
          } else events.push({ type: 'content_block_start', index, content_block: b }, { type: 'content_block_stop', index });
        });
        return {
          async *[Symbol.asyncIterator]() { for (const e of events) yield e; },
          finalMessage: async () => ({ id: 'm', type: 'message', role: 'assistant', model: params.model, ...msg }),
        };
      },
    },
  } as any;
}
const usage = { input_tokens: 10, output_tokens: 5 };
const tool = { name: 'search_knowledge', description: 'x', parameters: { type: 'object', properties: {} } };
async function collect(it: AsyncGenerator<any>) { const out: any[] = []; for await (const c of it) out.push(c); return out; }

test('agent turns get web search and fetch; a paused search is resumed; citations become a sources list', async () => {
  const seen: any[] = [];
  const client = fakeClient([
    { stop_reason: 'pause_turn', usage, content: [
      { type: 'server_tool_use', id: 'srv_1', name: 'web_search', input: { query: 'Rwanda literacy rate 2024' } },
      { type: 'web_search_tool_result', tool_use_id: 'srv_1', content: [{ type: 'web_search_result', url: 'https://www.statistics.gov.rw/x', title: 'NISR' }] },
    ] },
    { stop_reason: 'end_turn', usage, content: [
      { type: 'text', text: 'The adult literacy rate was 76% in 2024.', citations: [{ type: 'web_search_result_location', url: 'https://www.statistics.gov.rw/x', title: 'NISR Labour Force Survey', cited_text: '76%' }] },
      { type: 'text', text: ' Another figure.', citations: [{ type: 'web_search_result_location', url: 'https://www.statistics.gov.rw/x', title: 'NISR' }, { type: 'web_search_result_location', url: 'https://worldbank.org/y', title: 'World Bank [data]' }] },
    ] },
  ], seen);
  const a = new AnthropicAdapter({ client, webTools: { maxUses: 3 } });
  const out = await collect(a.stream({ model: 'claude-x', messages: [{ role: 'user', content: 'What is the literacy rate?' }], tools: [tool as any] }));

  const types = seen[0].tools.map((t: any) => t.type ?? t.name);
  assert.deepEqual(types, ['search_knowledge', 'web_search_20260209', 'web_fetch_20260209']);
  assert.equal(seen[0].tools[1].max_uses, 3);
  assert.equal(seen.length, 2, 'the paused turn was resumed once');
  assert.equal(seen[1].messages.at(-1).role, 'assistant', 'the resume sends the paused turn back');
  assert.equal(seen[1].messages.at(-1).content[0].type, 'server_tool_use');
  assert.deepEqual(out.filter((c) => c.type === 'server_tool').map((c) => [c.name, c.input.query]), [['web_search', 'Rwanda literacy rate 2024']]);
  assert.deepEqual(out.filter((c) => c.type === 'server_tool_result').map((c) => [c.name, c.ok]), [['web_search', true]]);
  const text = out.filter((c) => c.type === 'text').map((c) => c.text).join('');
  assert.match(text, /76% in 2024/);
  assert.match(text, /\*\*Sources\*\*\n1\. \[NISR Labour Force Survey\]\(https:\/\/www\.statistics\.gov\.rw\/x\)\n2\. \[World Bank data\]\(https:\/\/worldbank\.org\/y\)$/);
  assert.deepEqual(out.find((c) => c.type === 'usage'), { type: 'usage', input: 20, output: 10 }, 'usage of both parts counted');
});

test('no web tools for structured output, for turns without tools, or when switched off', async () => {
  for (const [opts, req] of [
    [{ webTools: { maxUses: 5 } }, { tools: [tool], responseSchema: { type: 'object' } }],
    [{ webTools: { maxUses: 5 } }, {}],
    [{ webTools: false as const }, { tools: [tool] }],
  ] as const) {
    const seen: any[] = [];
    const a = new AnthropicAdapter({ ...opts, client: fakeClient([{ stop_reason: 'end_turn', usage, content: [{ type: 'text', text: '{}' }] }], seen) });
    await collect(a.stream({ model: 'm', messages: [{ role: 'user', content: 'x' }], ...(req as any) }));
    assert.ok(!(seen[0].tools ?? []).some((t: any) => /web_/.test(t.type ?? '')), JSON.stringify(req));
  }
});

test('research questions go to the agent; ordinary questions do not', () => {
  for (const q of ['What is the latest news about Rwanda education?', 'Research the causes of soil erosion and cite sources', 'Who is the current minister of education?', 'Find me articles on malaria vaccines', 'Shakisha amakuru mashya ku burezi', 'exchange rate of RWF today']) assert.equal(needsResearch(q), true, q);
  for (const q of ['Explain photosynthesis simply', 'Solve 3x + 7 = 22', 'hello', 'Write a poem about rain']) assert.equal(needsResearch(q), false, q);
});

test('view_pages opens public library files: PDF pages and photos', async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 3; i++) doc.addPage([400, 500]).drawText(`Library page ${i}`, { x: 40, y: 450, size: 14, font });
  const pdf = Buffer.from(await doc.save());
  const photo = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#eee' } }).png().toBuffer();
  const lib: Record<string, { name: string; mime: string; data: Buffer }> = { 'lib-pdf': { name: 'Notes.pdf', mime: 'application/pdf', data: pdf }, 'lib-img': { name: 'homework.png', mime: 'image/png', data: photo } };
  const ctx = {
    userId: 'u', files: { read: async () => { const e: any = new Error('nf'); e.code = 'not_found'; throw e; } },
    services: { datasets: { open: async (_u: string, id: string) => { if (!lib[id]) throw new Error('nope'); return lib[id]; } } },
  } as any;
  const pages = await viewPages.execute({ fileId: 'lib-pdf', fromPage: 2, toPage: 3 }, ctx);
  assert.equal(pages.images?.length, 2);
  assert.equal(pages.images![0].label, 'Notes.pdf, page 2');
  const img = await viewPages.execute({ fileId: 'lib-img', fromPage: 1 }, ctx);
  assert.equal(img.images?.length, 1);
  assert.match(img.text, /homework\.png as an image/);
  const none = await viewPages.execute({ fileId: 'other', fromPage: 1 }, ctx);
  assert.ok(none.isError);
});
