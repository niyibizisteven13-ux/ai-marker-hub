import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import ExcelJS from 'exceljs';

// generalAssist (the web chat's agent path) end to end over HTTP against a local fake Anthropic Messages
// API speaking the real SSE stream format. Config mirrors production: AI_PROVIDER=gonkarouter for everyday
// chat, AI_AGENT_PROVIDER=anthropic with Claude Haiku for tool turns. No network, SYNTHETIC values.
const requests: any[] = [];
const gonkaRequests: any[] = [];
type Turn = { text?: string; tools?: Array<{ id: string; name: string; input: unknown }> };
const script: Turn[] = [];

function sse(res: http.ServerResponse, turn: Turn) {
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  send('message_start', { type: 'message_start', message: { id: `msg_${requests.length}`, type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 12, output_tokens: 1 } } });
  let i = 0;
  if (turn.text) {
    send('content_block_start', { type: 'content_block_start', index: i, content_block: { type: 'text', text: '' } });
    send('content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'text_delta', text: turn.text } });
    send('content_block_stop', { type: 'content_block_stop', index: i++ });
  }
  for (const t of turn.tools ?? []) {
    send('content_block_start', { type: 'content_block_start', index: i, content_block: { type: 'tool_use', id: t.id, name: t.name, input: {} } });
    const json = JSON.stringify(t.input);
    for (let k = 0; k < json.length; k += 40) send('content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: json.slice(k, k + 40) } });
    send('content_block_stop', { type: 'content_block_stop', index: i++ });
  }
  send('message_delta', { type: 'message_delta', delta: { stop_reason: turn.tools?.length ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 20 } });
  send('message_stop', { type: 'message_stop' });
  res.end();
}

const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (req.url === '/gonka/v1/chat/completions') { gonkaRequests.push(JSON.parse(body)); res.writeHead(400, { 'content-type': 'application/json' }).end('{"error":{"message":"test gonka stub"}}'); return; }
    if (req.url !== '/v1/messages') { res.writeHead(404).end(); return; }
    requests.push(JSON.parse(body));
    sse(res, script.shift() ?? { text: 'Done.' });
  });
}).listen(0);
await new Promise((r) => fake.once('listening', r));

Object.assign(process.env, {
  AI_PROVIDER: 'gonkarouter',
  AI_AGENT_PROVIDER: 'anthropic',
  ANTHROPIC_API_KEY: 'test-key-not-real',
  ANTHROPIC_BASE_URL: `http://127.0.0.1:${(fake.address() as AddressInfo).port}`,
  CLAUDE_AGENT_MODEL: 'claude-haiku-5-5',
  CLAUDE_FALLBACK_TO_GONKA: 'false',
  GONKA_BASE_URL: `http://127.0.0.1:${(fake.address() as AddressInfo).port}/gonka/v1`,
  GONKA_API_KEY: 'test-gonka-key',
});
const { AiService, fileJobQueue, fileStore } = await import('../server/services/AiService.js');
const ai = AiService.getInstance();
test.after(async () => { await fileJobQueue.stop(); fake.close(); });

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const rows = [{ Category: 'A', Value: 10 }, { Category: 'B', Value: 20 }, { Category: 'C', Value: 15 }];
const src = [{ type: 'user', label: 'Values given by the user' }];

test('web chat tool turn: Claude Haiku receives the tools, its tool calls run, real chart + xlsx are attached', async () => {
  const user = `claude-chat-${Date.now()}`;
  script.push(
    { text: 'Creating the chart and the workbook.', tools: [
      { id: 'toolu_1', name: 'create_output', input: { spec: { kind: 'chart', title: 'Values', sources: src, chart: { type: 'bar', x: { field: 'Category', title: 'Category', type: 'nominal' }, y: { field: 'Value', title: 'Value', unit: 'none' }, data: rows, sourceNote: 'Values given by the user' } } } },
      { id: 'toolu_2', name: 'create_output', input: { spec: { kind: 'document', format: 'xlsx', title: 'Values', sources: src, sheets: [{ name: 'Data', table: { columns: [{ key: 'Category', label: 'Category' }, { key: 'Value', label: 'Value' }], rows } }] } } },
    ] },
    { text: 'Your bar chart and Excel workbook are attached.' },
  );
  const events: any[] = [];
  const out: any = await ai.generalAssist({ userId: user, messages: [{ role: 'user', content: 'Make a bar chart comparing A=10, B=20, C=15 and give me an Excel file.' }], onEvent: (e) => events.push(e) });

  // The request reached Claude Haiku (not Gonka) with the output tools and the delivery rules.
  assert.equal(requests.length, 2);
  assert.equal(requests[0].model, 'claude-haiku-5-5');
  assert.equal(out.model, 'claude-haiku-5-5');
  assert.ok(requests[0].tools.some((t: any) => t.name === 'create_output'));
  assert.match(JSON.stringify(requests[0].system), /2 deliverables/);
  assert.match(JSON.stringify(requests[0].system), /never tell the user to save or rename/);
  // The follow-up call carries both tool results.
  const results = requests[1].messages.at(-1).content.filter((b: any) => b.type === 'tool_result');
  assert.deepEqual(results.map((b: any) => b.tool_use_id), ['toolu_1', 'toolu_2']);
  for (const r of results) assert.match(typeof r.content === 'string' ? r.content : JSON.stringify(r.content), /Created/);

  // Real files reached the chat stream as attachments.
  const atts = events.filter((e) => e.type === 'attachment').map((e) => e.data);
  assert.deepEqual(atts.map((a: any) => a.mime).sort(), ['image/svg+xml', XLSX_MIME].sort());
  assert.equal(out.attachments.length, 2);
  const book = atts.find((a: any) => a.mime === XLSX_MIME);
  const { data } = await fileStore.readSigned(book.id, ...(new URL(book.url, 'http://x').search.slice(1).split('&').map((kv) => kv.split('=')[1]) as [string, string]));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as any);
  assert.deepEqual(wb.getWorksheet('Data')!.getSheetValues().filter(Boolean).map((r: any) => r.slice(1)), [['Category', 'Value'], ['A', 10], ['B', 20], ['C', 15]]);
  assert.ok(!events.some((e) => e.type === 'turn_reset'), 'no corrective retry needed');
  assert.doesNotMatch(out.content[0].text, /Not created/);
});

test('web chat tool turn: a model that answers with CSV instead of calling tools gets one corrective turn', async () => {
  const user = `claude-csv-${Date.now()}`;
  requests.length = 0;
  script.push(
    { text: '```csv\nCategory,Value\nA,10\nB,20\nC,15\n```\nCopy this into a file and save it as values.xlsx.' },
    { tools: [{ id: 'toolu_9', name: 'create_output', input: { spec: { kind: 'document', format: 'xlsx', title: 'Values', sources: src, sheets: [{ name: 'Data', table: { columns: [{ key: 'Category', label: 'Category' }, { key: 'Value', label: 'Value' }], rows } }] } } }] },
    { text: 'The workbook is attached. The chart could not be made in this reply.' },
  );
  const events: any[] = [];
  const out: any = await ai.generalAssist({ userId: user, messages: [{ role: 'user', content: 'Make a bar chart comparing A=10, B=20, C=15 and give me an Excel file.' }], onEvent: (e) => events.push(e) });
  assert.ok(events.some((e) => e.type === 'turn_reset'), 'CSV answer is cleared on the client');
  assert.match(JSON.stringify(requests[1].messages.at(-1)), /Delivery check[\s\S]*chart \(SVG\) and XLSX file/);
  assert.equal(out.attachments.length, 1);
  assert.equal(out.attachments[0].mime, XLSX_MIME);
  // The chart was never produced: the answer says so instead of pretending.
  assert.match(out.content[0].text, /Not created: chart \(SVG\)\. No download is available for it/);
});

test('everyday chat is not routed to Claude or forced through tools', async () => {
  requests.length = 0;
  // The Gonka stub answers 400, so the call fails; what matters is where it went.
  await assert.rejects(ai.generalAssist({ userId: 'u-prose', messages: [{ role: 'user', content: 'What is photosynthesis?' }] }));
  assert.equal(requests.length, 0, 'no Claude call for a plain question');
  assert.equal(gonkaRequests.length, 1, 'plain questions stay on the Gonka chat model');
  assert.doesNotMatch(JSON.stringify(gonkaRequests[0].messages[0]), /Deliverables for this turn/);
});
