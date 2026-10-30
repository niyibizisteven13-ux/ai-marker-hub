import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import ExcelJS from 'exceljs';

// The Telegram bot end to end: real webhook route → router → the same assistant as the web chat, against a
// local fake Telegram Bot API (records every call, parses multipart uploads) and a local fake Claude
// (Anthropic SSE). No network, SYNTHETIC data.

type Call = { method: string; body: any; files: Record<string, { name: string; type: string; data: Buffer }> };
const calls: Call[] = [];
const claudeRequests: any[] = [];
const gonkaRequests: any[] = [];
const CSV = 'district,score\nGasabo,71\nHuye,64\nMusanze,58\n';
let msgSeq = 1000;

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve) => { const parts: Buffer[] = []; req.on('data', (c) => parts.push(c)); req.on('end', () => resolve(Buffer.concat(parts))); });
}

const telegram = http.createServer(async (req, res) => {
  const raw = await readBody(req);
  const url = req.url ?? '';
  if (url.startsWith('/file/')) { res.writeHead(200).end(CSV); return; }
  const method = url.split('/').pop()!;
  let body: any = {};
  const files: Call['files'] = {};
  const ct = String(req.headers['content-type'] ?? '');
  if (ct.startsWith('multipart/form-data')) {
    const form = await new Response(raw, { headers: { 'content-type': ct } }).formData();
    for (const [k, v] of form.entries()) {
      if (typeof v === 'string') body[k] = /^[[{]/.test(v) ? JSON.parse(v) : v;
      else files[k] = { name: (v as File).name, type: (v as File).type, data: Buffer.from(await (v as File).arrayBuffer()) };
    }
  } else if (raw.length) body = JSON.parse(raw.toString());
  calls.push({ method, body, files });
  const result = method === 'getFile' ? { file_id: body.file_id, file_path: 'documents/scores.csv', file_size: CSV.length }
    : method === 'getMe' ? { username: 'BwengeTestBot', is_bot: true }
      : ['sendMessage', 'sendPhoto', 'sendDocument'].includes(method) ? {
        message_id: ++msgSeq, chat: { id: body.chat_id },
        ...(method === 'sendPhoto' ? { photo: [{ file_id: files.photo ? `photo-${msgSeq}` : String(body.photo) }] } : {}),
        ...(method === 'sendDocument' ? { document: { file_id: `doc-${msgSeq}` } } : {}),
      } : true;
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, result }));
}).listen(0);

type Turn = { text?: string; tools?: Array<{ id: string; name: string; input: unknown }> };
const rows = [{ Category: 'A', Value: 10 }, { Category: 'B', Value: 20 }, { Category: 'C', Value: 15 }];
const src = [{ type: 'user', label: 'Values given by the user' }];
function script(p: any): Turn | 'fail' {
  const last = p.messages.at(-1);
  const lastText = JSON.stringify(last.content);
  if (Array.isArray(last.content) && last.content.some((b: any) => b.type === 'tool_result')) return { text: '## Done\n\nHere are your **chart** and *Excel workbook*:\n\n- B is highest (20)\n- A is lowest (10)' };
  if (/FAIL/.test(lastText)) return 'fail';
  if (/bar chart/.test(lastText)) return {
    text: 'Building them now.', tools: [
      { id: 'toolu_c', name: 'create_output', input: { spec: { kind: 'chart', title: 'Values by category', sources: src, chart: { type: 'bar', x: { field: 'Category', title: 'Category', type: 'nominal' }, y: { field: 'Value', title: 'Value', unit: 'none' }, data: rows, sourceNote: 'Values given by the user' } } } },
      { id: 'toolu_x', name: 'create_output', input: { spec: { kind: 'document', format: 'xlsx', title: 'Category values', sources: src, sheets: [{ name: 'Data', table: { columns: [{ key: 'Category', label: 'Category' }, { key: 'Value', label: 'Value' }], rows } }] } } },
    ],
  };
  return { text: `Statistics: mean score **64.3** across 3 districts. ${/scores\.csv/.test(lastText) ? '(read scores.csv)' : ''}` };
}

const claude = http.createServer(async (req, res) => {
  const p = JSON.parse((await readBody(req)).toString());
  if (req.url?.endsWith('/chat/completions') && /Learning mode/.test(JSON.stringify(p.messages?.[0] ?? ''))) {
    // Everyday chat runs on the OpenAI-compatible Gonka endpoint; answered here only for the learning-mode test.
    gonkaRequests.push(p);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ id: 'g', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: 'What denominator could both fractions share?' }, finish_reason: null }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ id: 'g', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 7 } })}\n\n`);
    res.end('data: [DONE]\n\n');
    return;
  }
  if (!req.url?.endsWith('/messages')) { res.writeHead(400, { 'content-type': 'application/json' }).end('{"error":{"message":"stub"}}'); return; }
  claudeRequests.push(p);
  const turn = script(p);
  if (turn === 'fail') { res.writeHead(500, { 'content-type': 'application/json' }).end('{"type":"error","error":{"type":"api_error","message":"boom"}}'); return; }
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  send('message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 5, output_tokens: 1 } } });
  let i = 0;
  if (turn.text) { send('content_block_start', { type: 'content_block_start', index: i, content_block: { type: 'text', text: '' } }); send('content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'text_delta', text: turn.text } }); send('content_block_stop', { type: 'content_block_stop', index: i++ }); }
  for (const t of turn.tools ?? []) { send('content_block_start', { type: 'content_block_start', index: i, content_block: { type: 'tool_use', id: t.id, name: t.name, input: {} } }); send('content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: JSON.stringify(t.input) } }); send('content_block_stop', { type: 'content_block_stop', index: i++ }); }
  send('message_delta', { type: 'message_delta', delta: { stop_reason: turn.tools?.length ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 9 } });
  send('message_stop', { type: 'message_stop' });
  res.end();
}).listen(0);
await Promise.all([new Promise((r) => telegram.once('listening', r)), new Promise((r) => claude.once('listening', r))]);
const port = (s: http.Server) => (s.address() as AddressInfo).port;

Object.assign(process.env, {
  TELEGRAM_BOT_TOKEN: 'test-bot-token', TELEGRAM_API_BASE: `http://127.0.0.1:${port(telegram)}`, TELEGRAM_BOT_USERNAME: 'BwengeTestBot',
  AI_PROVIDER: 'gonkarouter', AI_AGENT_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: `http://127.0.0.1:${port(claude)}`,
  CLAUDE_AGENT_MODEL: 'claude-haiku-5-5', CLAUDE_FALLBACK_TO_GONKA: 'false', AI_MAX_ATTEMPTS: '1',
  GONKA_API_KEY: 'test-gonka', GONKA_BASE_URL: `http://127.0.0.1:${port(claude)}/gonka/v1`,
});
delete process.env.TELEGRAM_BOT_SECRET_TOKEN;

const { default: telegramRoutes } = await import('../server/routes/telegramBotRoutes.js');
const { fileJobQueue } = await import('../server/services/AiService.js');
const { prisma } = await import('../server/db.js');
const { resetRouterState } = await import('../server/services/telegram/router.js');
const { markdownToHtml, markdownToMessages } = await import('../server/services/telegram/format.js');
const db = prisma as any;

const app = express();
app.use(express.json());
app.use('/api/telegram', telegramRoutes);
const server = app.listen(0);
test.after(async () => { await fileJobQueue.stop(); server.close(); telegram.close(); claude.close(); });

let updateId = Math.floor(Math.random() * 1e6);
const chat = 900000 + Math.floor(Math.random() * 99999);
const from = { id: chat, first_name: 'Aline', language_code: 'en' };
const post = (update: any) => fetch(`http://127.0.0.1:${port(server)}/api/telegram/webhook`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ update_id: ++updateId, ...update }) });
const sendText = (text: string, extra: any = {}) => post({ message: { message_id: ++msgSeq, chat: { id: chat, type: 'private' }, from, date: 0, text, ...extra } });
const tap = (data: string, messageId = 1) => post({ callback_query: { id: `cb${updateId}`, from, data, message: { message_id: messageId, chat: { id: chat, type: 'private' } } } });

async function until<T>(pick: () => T | undefined, ms = 20000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) { const v = pick(); if (v) return v; if (Date.now() > end) throw new Error(`timed out; last calls: ${calls.slice(-6).map((c) => c.method + ':' + String(c.body.text ?? c.body.caption ?? '').slice(0, 60)).join(' | ')}`); await new Promise((r) => setTimeout(r, 50)); }
}
const mark = () => calls.length;
const since = (n: number) => calls.slice(n);
const htmlBalanced = (h: string) => { const stack: string[] = []; for (const m of h.matchAll(/<(\/?)(b|i|s|u|code|pre|a|blockquote)\b[^>]*>/g)) { if (!m[1]) stack.push(m[2]); else if (stack.pop() !== m[2]) return false; } return stack.length === 0; };

test('format: Markdown becomes safe, balanced Telegram HTML; long answers split into valid messages', () => {
  const h = markdownToHtml('## Title\n\n**Bold** and _it_ with `a<b>` and [link](https://x.org)\n\n- one\n- two\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```js\nif (a < b) {}\n```\n<script>alert(1)</script>');
  assert.match(h, /^<b>Title<\/b>/);
  assert.match(h, /<code>a&lt;b&gt;<\/code>/);
  assert.match(h, /• one\n• two/);
  assert.match(h, /<pre>A  B\n─  ─\n1  2<\/pre>/);
  assert.match(h, /<pre><code class="language-js">if \(a &lt; b\) \{\}<\/code><\/pre>/);
  assert.doesNotMatch(h, /<script>/);
  assert.ok(htmlBalanced(h));
  const chunks = markdownToMessages(`**start**\n\n${'paragraph text '.repeat(200)}\n\n\`\`\`\n${'code line\n'.repeat(600)}\`\`\`\n\nend`);
  assert.ok(chunks.length > 2);
  for (const c of chunks) { assert.ok(c.length <= 4096, `chunk ${c.length}`); assert.ok(htmlBalanced(c), c.slice(0, 80)); }
});

test('home: /start shows the branded banner with the menu; menus and language switch edit in place', async () => {
  let n = mark();
  await sendText('/start');
  const home = await until(() => since(n).find((c) => c.method === 'sendPhoto'));
  assert.equal(home.files.photo.data.subarray(1, 4).toString(), 'PNG', 'banner image uploaded');
  assert.equal(home.body.parse_mode, 'HTML');
  assert.match(home.body.caption, /Muraho, Aline!|Welcome/);
  assert.match(home.body.caption, /📷 Scan papers with your camera/);
  const flat = home.body.reply_markup.inline_keyboard.flat();
  assert.deepEqual(flat.map((b: any) => b.callback_data ?? 'web_app'), ['m:create', 'm:mark', 'web_app', 'm:transcribe', 'm:library', 'fp:0', 'm:settings', 'm:help']);
  assert.equal(flat[2].web_app.url, 'https://www.bwenge.space/scanner.html', 'scan opens the Mini App directly');

  n = mark();
  await sendText('/start');
  const again = await until(() => since(n).find((c) => c.method === 'sendPhoto'));
  assert.match(String(again.body.photo), /^photo-\d+$/);
  assert.ok(!again.files.photo, 'later /start sends the cached file_id, not the bytes');

  n = mark();
  await post({ callback_query: { id: `cb${updateId}`, from, data: 'm:settings', message: { message_id: 76, chat: { id: chat, type: 'private' }, photo: [{ file_id: 'x' }], caption: 'menu' } } });
  const fromBanner = await until(() => since(n).find((c) => c.method === 'editMessageCaption'));
  assert.equal(fromBanner.body.message_id, 76);
  assert.match(fromBanner.body.caption, /Settings/);

  n = mark();
  await tap('m:create', 77);
  const guide = await until(() => since(n).find((c) => c.method === 'editMessageText'));
  assert.equal(guide.body.message_id, 77);
  assert.match(guide.body.text, /Charts and files/);
  assert.equal(guide.body.reply_markup.inline_keyboard.at(-1)[0].callback_data, 'm:home');

  n = mark();
  await tap('l:rw', 78);
  const settings = await until(() => since(n).find((c) => c.method === 'editMessageText' && /Igenamiterere/.test(c.body.text)));
  assert.match(JSON.stringify(settings.body.reply_markup), /✓ Kinyarwanda/);
  assert.ok(since(n).some((c) => c.method === 'answerCallbackQuery' && /Ururimi/.test(c.body.text)));
  assert.equal((await db.telegramSession.findUnique({ where: { chatId: String(chat) } })).language, 'rw');
  await tap('l:en', 78);
  await until(() => since(n).find((c) => c.method === 'editMessageText' && /Settings/.test(c.body.text)));
});

test('acceptance: "bar chart + Excel" gives live progress, a formatted answer, a chart photo and a real .xlsx', async () => {
  const n = mark();
  await sendText('Make a bar chart comparing A=10, B=20, C=15 and give me an Excel file.');
  const doc = await until(() => since(n).find((c) => c.method === 'sendDocument'));
  const turn = since(n);
  const progress = turn.find((c) => c.method === 'sendMessage')!;
  assert.match(progress.body.text, /Working on it/);
  const edits = turn.filter((c) => c.method === 'editMessageText');
  assert.ok(edits.some((e) => /Creating chart: Values by category/.test(e.body.text)), 'tool steps shown live');
  const final = edits.at(-1)!;
  assert.match(final.body.text, /^<b>Done<\/b>/);
  assert.match(final.body.text, /<b>chart<\/b> and <i>Excel workbook<\/i>/);
  assert.match(final.body.text, /• B is highest/);
  assert.match(final.body.text, /2 files below/);
  assert.ok(htmlBalanced(final.body.text));
  assert.deepEqual(final.body.reply_markup.inline_keyboard[0].map((b: any) => b.callback_data), ['a:regen', 'fp:0', 'm:home']);
  assert.equal(claudeRequests.at(-1).model, 'claude-haiku-5-5', 'runs on the configured Claude model');

  const photo = turn.find((c) => c.method === 'sendPhoto')!;
  assert.ok(photo, 'chart sent as a photo');
  assert.equal(photo.files.photo.data.subarray(1, 4).toString(), 'PNG');
  assert.match(photo.body.caption, /📊 <b>Values by category<\/b>/);
  assert.equal(doc.files.document.name, 'Category values.xlsx');
  assert.match(doc.body.caption, /Excel workbook/);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(doc.files.document.data as any);
  assert.deepEqual(wb.getWorksheet('Data')!.getSheetValues().filter(Boolean).map((r: any) => r.slice(1)), [['Category', 'Value'], ['A', 10], ['B', 20], ['C', 15]]);
  const session = await db.telegramSession.findUnique({ where: { chatId: String(chat) } });
  assert.equal(session.history.at(-2).text, 'Make a bar chart comparing A=10, B=20, C=15 and give me an Excel file.', 'history persisted');
});

test('files: a CSV without caption gets quick actions; the action runs the assistant on the file', async () => {
  let n = mark();
  await post({ message: { message_id: ++msgSeq, chat: { id: chat, type: 'private' }, from, date: 0, document: { file_id: 'csv-file-1', file_name: 'scores.csv', mime_type: 'text/csv', file_size: CSV.length } } });
  const prompt = await until(() => since(n).find((c) => c.method === 'sendMessage' && /scores\.csv/.test(c.body.text)));
  const actions = prompt.body.reply_markup.inline_keyboard.flat().map((b: any) => b.callback_data);
  assert.deepEqual(actions, ['q:sum', 'q:chart', 'q:stats']);
  assert.ok(since(n).some((c) => c.method === 'getFile'));

  n = mark();
  await tap('q:stats', prompt.body.message_id ?? 1);
  const answer = await until(() => since(n).find((c) => c.method === 'editMessageText' && /Statistics: mean score/.test(c.body.text)));
  assert.match(answer.body.text, /<b>64\.3<\/b>/);
  assert.match(answer.body.text, /read scores\.csv/, 'the model received the file content');
  assert.match(JSON.stringify(claudeRequests.at(-1).messages), /\[Attached file: scores\.csv \(fileId /);
});

test('my files: list with send buttons; another user\'s file is refused', async () => {
  let n = mark();
  await sendText('/files');
  const list = await until(() => since(n).find((c) => c.method === 'sendMessage' && /My files/.test(c.body.text)));
  assert.match(list.body.text, /Category values/);
  assert.match(list.body.text, /Values by category/);
  const send = list.body.reply_markup.inline_keyboard.flat().find((b: any) => /^f:/.test(b.callback_data));
  n = mark();
  await tap(send.callback_data);
  await until(() => since(n).find((c) => c.method === 'sendDocument' || c.method === 'sendPhoto'));

  const other = await db.generatedArtifact.create({ data: { id: '0f8c1a2e-1111-4222-8333-' + String(Date.now()).slice(-12).padStart(12, '0'), userId: 'someone-else', kind: 'chart', format: 'svg', title: 'Secret', status: 'ready', revision: 1, rootId: 'x', spec: {}, sources: [], warnings: [], shareMode: 'private' } });
  n = mark();
  await tap(`f:${other.id}`);
  const refused = await until(() => since(n).find((c) => c.method === 'answerCallbackQuery'));
  assert.equal(refused.body.show_alert, true);
  assert.ok(!since(n).some((c) => c.method === 'sendDocument' || c.method === 'sendPhoto'));
});

test('robustness: failures show a retry card; duplicates and unaddressed group messages are ignored', async () => {
  let n = mark();
  await sendText('Make a chart FAIL please');
  const err = await until(() => since(n).find((c) => c.method === 'editMessageText' && /Something went wrong/.test(c.body.text)));
  assert.deepEqual(err.body.reply_markup.inline_keyboard[0].map((b: any) => b.callback_data), ['a:regen', 'm:home']);
  assert.doesNotMatch(err.body.text, /boom|api_error|Claude|HTTP/i, 'no provider details leak');

  n = mark();
  const update = { update_id: ++updateId, message: { message_id: ++msgSeq, chat: { id: chat, type: 'private' }, from, date: 0, text: '/help' } };
  for (let i = 0; i < 2; i++) await fetch(`http://127.0.0.1:${port(server)}/api/telegram/webhook`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(update) });
  await until(() => since(n).find((c) => c.method === 'sendMessage'));
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(since(n).filter((c) => c.method === 'sendMessage').length, 1, 'redelivered update handled once');

  n = mark();
  await post({ message: { message_id: ++msgSeq, chat: { id: -5, type: 'group' }, from, date: 0, text: 'random group chatter' } });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(since(n).length, 0, 'group chatter ignored');
  await post({ message: { message_id: ++msgSeq, chat: { id: -5, type: 'group' }, from, date: 0, text: '@BwengeTestBot /help' } });
  await until(() => since(n).find((c) => c.method === 'sendMessage' && String(c.body.chat_id) === '-5'));
  resetRouterState();
});

test('scanner: /scan opens the Mini App in private chats and a signed link in groups', async () => {
  let n = mark();
  await sendText('/scan');
  const card = await until(() => since(n).find((c) => c.method === 'sendMessage' && /Document scanner/.test(c.body.text)));
  assert.match(card.body.text, /edges are found for you/);
  const open = card.body.reply_markup.inline_keyboard[0][0];
  assert.deepEqual(open.web_app, { url: 'https://www.bwenge.space/scanner.html' });

  n = mark();
  await post({ message: { message_id: ++msgSeq, chat: { id: -5, type: 'group' }, from, date: 0, text: '/scan@BwengeTestBot' } });
  const groupCard = await until(() => since(n).find((c) => c.method === 'sendMessage' && String(c.body.chat_id) === '-5'));
  const link = groupCard.body.reply_markup.inline_keyboard[0][0];
  assert.match(link.url, /^https:\/\/www\.bwenge\.space\/scanner\.html\?token=[\w-]{16}$/, 'web_app buttons are not allowed in groups');
  assert.match(groupCard.body.text, /30 minutes/);
});

test('scanner: uploads are signed (Mini App initData or link token) and arrive as a PDF the AI reads as page images', async () => {
  const crypto = await import('node:crypto');
  const { PDFDocument } = await import('pdf-lib');
  const sharp = (await import('sharp')).default;
  const { issueScanToken, verifyInitData } = await import('../server/services/telegram/scanSession.js');
  const sign = (fields: Record<string, string>, token = 'test-bot-token') => {
    const check = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
    return new URLSearchParams({ ...fields, hash: crypto.createHmac('sha256', secret).update(check).digest('hex') }).toString();
  };
  const now = Math.floor(Date.now() / 1000);
  const initData = sign({ auth_date: String(now), query_id: 'q1', user: JSON.stringify({ id: chat, first_name: 'Aline' }) });
  assert.equal(verifyInitData(initData), String(chat));
  assert.equal(verifyInitData(initData.replace('Aline', 'Eve')), null, 'tampered data is rejected');
  assert.equal(verifyInitData(sign({ auth_date: String(now - 3 * 86400), user: JSON.stringify({ id: chat }) })), null, 'stale data is rejected');
  assert.equal(verifyInitData(initData, 'another-bot-token'), null);

  // SYNTHETIC two-page scan without a text layer, as the scanner page builds it.
  const doc = await PDFDocument.create();
  for (const t of ['Q1: 2x + 3 = 7', 'Q2: x = 2']) {
    const png = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="100%" height="100%" fill="white"/><text x="40" y="120" font-size="40" fill="#123">${t}</text></svg>`)).png().toBuffer();
    doc.addPage([600, 800]).drawImage(await doc.embedPng(png), { x: 0, y: 0, width: 600, height: 800 });
  }
  const pdf = Buffer.from(await doc.save());
  const upload = (pathSuffix: string, headers: Record<string, string> = {}) => {
    const form = new FormData();
    form.append('file', new Blob([pdf], { type: 'application/pdf' }), 'Aline Uwase.pdf');
    return fetch(`http://127.0.0.1:${port(server)}/api/telegram/scan-upload${pathSuffix}`, { method: 'POST', body: form, headers });
  };

  assert.equal((await upload('', { 'X-Telegram-Init-Data': initData.replace('Aline', 'Eve') })).status, 401);
  assert.equal((await upload('/not-a-token')).status, 401);

  let n = mark();
  const res = await upload('', { 'X-Telegram-Init-Data': initData });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { success: true, pages: 2 });
  const sent = await until(() => since(n).find((c) => c.method === 'sendDocument'));
  assert.equal(String(sent.body.chat_id), String(chat));
  assert.equal(sent.files.document.name, 'Aline Uwase.pdf');
  assert.match(sent.body.caption, /📷 <b>Aline Uwase\.pdf<\/b>/);
  assert.match(sent.body.caption, /Scanned PDF · 2 pages/);
  assert.deepEqual(sent.body.reply_markup.inline_keyboard.flat().map((b: any) => b.callback_data), ['q:sum', 'q:tr', 'q:mark']);

  // Three PDFs go to the assistant together below; the Free plan allows 2 attachments per message, PRO 10.
  const owner = (await db.telegramSession.findUnique({ where: { chatId: String(chat) } })).userId;
  await db.subscription.create({ data: { id: `sub-${Date.now()}`, userId: owner, planType: 'PRO', status: 'ACTIVE', startDate: new Date(), endDate: new Date(Date.now() + 86_400_000) } });

  // A /scan link token works for several uploads (one PDF per student) until it expires.
  const token = issueScanToken(String(chat));
  for (let i = 0; i < 2; i++) assert.equal((await upload(`/${token}`)).status, 200);

  n = mark();
  await tap('q:sum', sent.body.message_id ?? 1);
  await until(() => since(n).find((c) => c.method === 'editMessageText' && /Statistics: mean score/.test(c.body.text)));
  assert.ok(since(n).some((c) => c.method === 'editMessageReplyMarkup'), 'the used quick actions are removed');
  const user = claudeRequests.at(-1).messages.at(-1).content as any[];
  assert.ok(user.filter((b) => b.type === 'image').length >= 2, 'the scanned pages reach the model as images');
  assert.match(JSON.stringify(user), /Aline Uwase\.pdf/);
  resetRouterState();
});

test('mark: /mark opens the Mark app; its upload starts marking in the chat with explicit roles, instructions and live progress', async () => {
  let n = mark();
  await sendText('/mark');
  const card = await until(() => since(n).find((c) => c.method === 'sendMessage' && /Mark exams/.test(c.body.text)));
  assert.match(card.body.text, /one tap per page/);
  assert.deepEqual(card.body.reply_markup.inline_keyboard[0][0].web_app, { url: 'https://www.bwenge.space/scanner.html?mode=mark' });
  n = mark();
  await tap('m:mark');
  await until(() => since(n).find((c) => /editMessage|sendMessage/.test(c.method) && /Open Mark/.test(JSON.stringify(c.body.reply_markup ?? {}))));
  n = mark();
  await post({ message: { message_id: ++msgSeq, chat: { id: -6, type: 'group' }, from, date: 0, text: '/mark@BwengeTestBot' } });
  const groupCard = await until(() => since(n).find((c) => c.method === 'sendMessage' && String(c.body.chat_id) === '-6'));
  assert.match(groupCard.body.reply_markup.inline_keyboard[0][0].url, /^https:\/\/www\.bwenge\.space\/scanner\.html\?mode=mark&token=[\w-]{16}$/);

  const { issueScanToken } = await import('../server/services/telegram/scanSession.js');
  const { setBridgeDeps } = await import('../server/services/telegram/agentBridge.js');
  const { telegramApi } = await import('../server/services/telegram/api.js');
  const { fileStore } = await import('../server/services/AiService.js');
  let seen: any = null;
  setBridgeDeps({
    api: telegramApi(), fileStore, editIntervalMs: 10,
    assist: async () => { throw new Error('marking must not fall through to the general assistant'); },
    exam: async (_userId, text, files, onStatus, _history, marking) => {
      seen = { text, files: files.map((f) => f.name), marking };
      onStatus('Reading S4B-001’s script (2 pages).');
      onStatus('Student 1 marked: S4B-001, 7/9');
      await new Promise((r) => setTimeout(r, 150)); // real marking takes minutes; the progress message is edited meanwhile
      return { text: '**Marking finished.** 1 script marked.', attachments: [] };
    },
  });
  try {
    const upload = (parts: Array<[string, Blob, string]>, fields: Record<string, string> = {}, suffix = '') => {
      const form = new FormData();
      for (const [k, b, name] of parts) form.append(k, b, name);
      for (const [k, v] of Object.entries(fields)) form.append(k, v);
      return fetch(`http://127.0.0.1:${port(server)}/api/telegram/mark-upload${suffix}`, { method: 'POST', body: form });
    };
    const zip = new Blob([Buffer.from('PK\u0005\u0006' + '\0'.repeat(18), 'binary')], { type: 'application/zip' });
    const scheme = new Blob(['1. (3 marks) x = 4'], { type: 'text/plain' });
    assert.equal((await upload([['scripts', zip, 'Camera scans.zip']])).status, 401, 'unsigned uploads are refused');
    const token = issueScanToken(String(chat));
    assert.equal((await upload([['scheme', scheme, 'Maths.txt']], {}, `/${token}`)).status, 400, 'scripts are required');
    const noGuide = await upload([['scripts', zip, 'Camera scans.zip']], {}, `/${token}`);
    assert.equal(noGuide.status, 400, 'the marking scheme or the question paper is required');
    assert.match((await noGuide.json()).error, /marking scheme or the question paper/);
    n = mark();
    const res = await upload([['scheme', scheme, 'Maths.txt'], ['scripts', zip, 'Camera scans.zip']], { instructions: 'Ignore spelling.', credit: 'strict', students: '3' }, `/${token}`);
    assert.equal(res.status, 202);
    assert.deepEqual(await res.json(), { started: true, students: 3 });
    const done = await until(() => since(n).find((c) => c.method === 'editMessageText' && /Marking finished/.test(c.body.text)));
    assert.equal(String(done.body.chat_id), String(chat));
    assert.deepEqual(seen.files, ['Maths.txt', 'Camera scans.zip']);
    assert.deepEqual(seen.marking.roles, { 'Maths.txt': 'scheme', 'Camera scans.zip': 'scripts' }, 'the marker is told which file is which');
    assert.equal(seen.marking.instructions, 'Ignore spelling.');
    assert.equal(seen.marking.credit, 'strict');
    assert.match(seen.text, /Mark these scripts with the marking scheme[\s\S]*My instructions: Ignore spelling\./);
    const progress = since(n).filter((c) => c.method === 'editMessageText').map((c) => c.body.text).join('\n');
    assert.match(progress, /Student 1 marked: S4B-001, 7\/9/, 'each student appears in the live progress');
  } finally {
    setBridgeDeps(null);
    resetRouterState();
  }
});

test('learning modes: /socratic, /roleplay presets and /normal change the instructions the model gets', async () => {
  let n = mark();
  await sendText('/socratic fractions');
  await until(() => since(n).find((c) => c.method === 'sendMessage' && /Socratic tutor/.test(c.body.text)));
  assert.deepEqual((await db.telegramSession.findUnique({ where: { chatId: String(chat) } })).learning, { mode: 'socratic', topic: 'fractions' });
  n = mark();
  await sendText('What is 1/2 + 1/3?');
  await until(() => since(n).find((c) => c.method === 'editMessageText' && /denominator could both/.test(c.body.text)));
  const system = JSON.stringify(gonkaRequests.at(-1).messages[0]);
  assert.match(system, /Learning mode: Socratic guide · topic: fractions/);
  assert.match(system, /Do not give the final answer/);

  n = mark();
  await sendText('/roleplay');
  const menu = await until(() => since(n).find((c) => c.method === 'sendMessage' && c.body.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data?.startsWith('lm:')));
  const preset = menu.body.reply_markup.inline_keyboard.find((r: any) => r[0].callback_data === 'lm:french-market')[0];
  n = mark();
  await tap(preset.callback_data, menu.body.message_id ?? 1);
  await until(() => since(n).find((c) => c.method === 'sendMessage' && /hello/i.test(c.body.text)));
  const learning = (await db.telegramSession.findUnique({ where: { chatId: String(chat) } })).learning;
  assert.equal(learning.mode, 'roleplay');
  assert.equal(learning.language, 'French');

  n = mark();
  await sendText('/normal');
  await until(() => since(n).find((c) => c.method === 'sendMessage'));
  assert.equal((await db.telegramSession.findUnique({ where: { chatId: String(chat) } })).learning?.mode ?? 'normal', 'normal');
  resetRouterState();
});

test('limits: over the daily credit limit, the bot answers with a limit card and an Upgrade button', async () => {
  const session = await db.telegramSession.findUnique({ where: { chatId: String(chat) } });
  await db.subscription.deleteMany({ where: { userId: session.userId } });
  await db.usageRecord.create({ data: { id: `ur-${Date.now()}`, userId: session.userId, kind: 'chat', credits: 25, model: 'gonka', inputTokens: 0, outputTokens: 0, costUsd: 0, channel: 'telegram', createdAt: new Date() } });
  const n = mark();
  await sendText('Explain photosynthesis please');
  const limit = await until(() => since(n).find((c) => c.method === 'sendMessage' && /Limit reached/.test(c.body.text)));
  assert.match(limit.body.text, /today's 20 credits/);
  const buttons = limit.body.reply_markup.inline_keyboard.flat();
  assert.match(buttons[0].url, /\/upgrade\?reason=limit$/);
  assert.equal(buttons[1].callback_data, 'm:home');
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(!since(n).some((c) => c.method === 'sendMessage' && /Working on it/.test(c.body.text)), 'no AI turn starts');
  resetRouterState();
});
