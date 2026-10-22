import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';

// Scanned / handwritten PDFs in chat: pages without a text layer reach the model as images (or OCR text when
// no image-reading model is configured). SYNTHETIC image-only PDF; a local fake Claude records the request.

async function imageOnlyPdf(pages: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (const text of pages) {
    const png = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="100%" height="100%" fill="white"/><text x="40" y="120" font-size="42" font-family="serif" fill="#123">${text}</text></svg>`)).png().toBuffer();
    const img = await doc.embedPng(png);
    doc.addPage([600, 800]).drawImage(img, { x: 0, y: 0, width: 600, height: 800 });
  }
  return Buffer.from(await doc.save());
}

const requests: any[] = [];
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (!req.url?.endsWith('/messages')) { res.writeHead(400, { 'content-type': 'application/json' }).end('{"error":{"message":"stub"}}'); return; }
    requests.push(JSON.parse(body));
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    send('message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 5, output_tokens: 1 } } });
    send('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
    send('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Question one asks you to solve y\' + 2ty = 2ty².' } });
    send('content_block_stop', { type: 'content_block_stop', index: 0 });
    send('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 9 } });
    send('message_stop', { type: 'message_stop' });
    res.end();
  });
}).listen(0);
await new Promise((r) => fake.once('listening', r));
const base = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
Object.assign(process.env, {
  AI_PROVIDER: 'gonkarouter', AI_AGENT_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: base,
  CLAUDE_AGENT_MODEL: 'claude-haiku-5-5', CLAUDE_FALLBACK_TO_GONKA: 'false', GONKA_API_KEY: 'test-gonka', GONKA_BASE_URL: `${base}/gonka/v1`,
});

const { ingestUploads } = await import('../server/services/ai/ingest.js');
const { FileStore } = await import('../server/services/ai/files/FileStore.js');
const { AiService, fileJobQueue } = await import('../server/services/AiService.js');
const { useToolAgent } = await import('../server/services/outputs/chatTurn.js');
const { planOutput } = await import('../server/services/outputs/planner.js');

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scanned-pdf-'));
const files = new FileStore({ dir: root, secret: 'test-secret-1234567890' });
const ctx = { userId: 'u-scan', files, services: {} } as any;
test.after(async () => { await fileJobQueue.stop(); fake.close(); await fs.rm(root, { recursive: true, force: true }); });

test('ingest: a PDF without a text layer becomes page images for a vision model, keeping its name', async () => {
  const pdf = await imageOnlyPdf(['Question one: solve y + 2ty = 2ty^2', 'Question two']);
  const r = await ingestUploads('answer that question', [{ type: 'document', base64: pdf.toString('base64'), mediaType: 'application/pdf', name: 'Mugenzi-synthetic.pdf' }], ctx, { vision: true });
  const imgs = r.parts.filter((p: any) => p.type === 'image_url') as any[];
  assert.equal(imgs.length, 2);
  for (const i of imgs) assert.match(i.image_url.url, /^data:image\/jpeg;base64,/);
  const jpeg = Buffer.from(imgs[0].image_url.url.split(',')[1], 'base64');
  const meta = await sharp(jpeg).metadata();
  assert.ok(Math.max(meta.width!, meta.height!) <= 1568, 'pages are capped at 1568 px');
  const text = (r.parts[0] as any).text as string;
  assert.match(text, /\[Attached file: Mugenzi-synthetic\.pdf \(fileId [^)]+\): a scanned or handwritten PDF with 2 pages/);
  assert.match(text, /Pages 1–2 are attached below as images/);
  assert.doesNotMatch(text, /upload-1|unsupported/);
  assert.equal(r.fileIds.length, 1);
});

test('ingest: without a vision model, scanned pages are OCR\'d and marked as unreliable', async () => {
  const pdf = await imageOnlyPdf(['Page A']);
  const seen: number[] = [];
  const r = await ingestUploads('read it', [{ type: 'document', base64: pdf.toString('base64'), mediaType: 'application/pdf', name: 'scan.pdf' }], ctx, {
    vision: false, ocr: async (png) => { seen.push(png.length); return { text: 'Page A', confidence: 88 }; },
  });
  assert.equal(r.parts.filter((p: any) => p.type === 'image_url').length, 0);
  assert.equal(seen.length, 1);
  assert.match((r.parts[0] as any).text, /machine OCR, which is unreliable for handwriting[\s\S]*Page 1 \(OCR confidence 88%\)[\s\S]*Page A/);
});

test('ingest: long scans are capped and the model is told which pages it sees', async () => {
  process.env.CHAT_MAX_SCANNED_PAGES = '8';
  const pdf = await imageOnlyPdf(Array.from({ length: 10 }, (_, i) => `Page ${i + 1}`));
  const r = await ingestUploads('summarise', [{ type: 'document', base64: pdf.toString('base64'), mediaType: 'application/pdf', name: 'long.pdf' }], ctx, { vision: true });
  assert.equal(r.parts.filter((p: any) => p.type === 'image_url').length, 8);
  assert.match((r.parts[0] as any).text, /Only the first 8 of 10 pages are included/);
});

test('chat: a scanned PDF goes to the agent path and reaches Claude as images, even for a plain question', async () => {
  const plain = planOutput({ message: 'answer that question' });
  const base = { intent: 'general_assist', service: 'general', isSmallTalk: false, requestedProvider: null, hasClaudeKey: true, aiProvider: 'gonkarouter', agentAvailable: true, plan: plain };
  assert.equal(useToolAgent(base), false, 'plain text without files keeps the legacy route');
  assert.equal(useToolAgent({ ...base, hasVisualFiles: true }), true, 'attached photos/PDFs need the agent path');

  const pdf = await imageOnlyPdf(['Question one', 'Question two', 'Question three']);
  const out: any = await AiService.getInstance().generalAssist({
    userId: 'u-scan-chat', planText: 'answer that question',
    messages: [{ role: 'user', content: 'answer that question' }],
    files: [{ type: 'document', base64: pdf.toString('base64'), mediaType: 'application/pdf', name: 'Mugenzi.pdf' }],
  });
  const req = requests.at(-1);
  assert.equal(req.model, 'claude-haiku-5-5', 'vision turns run on the image-reading agent model');
  const user = req.messages.at(-1).content as any[];
  assert.equal(user.filter((b) => b.type === 'image').length, 3, 'all three pages are sent as images');
  assert.equal(user.find((b) => b.type === 'image').source.media_type, 'image/jpeg');
  assert.match(JSON.stringify(user), /Mugenzi\.pdf \(fileId [^)]+\): a scanned or handwritten PDF with 3 pages/);
  assert.match(out.content[0].text, /Question one asks you to solve/);
});
