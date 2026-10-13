import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { FileStore } from '../src/ai/files/FileStore.js';
import { createFileRouter } from '../src/ai/fileRouter.js';
import { extractText } from '../src/ai/files/extract.js';
import { generateDocx } from '../src/ai/files/generators/docx.js';
import { generatePdf } from '../src/ai/files/generators/pdf.js';
import { generateXlsx } from '../src/ai/files/generators/xlsx.js';
import { generatePptx } from '../src/ai/files/generators/pptx.js';
import { ingestUploads } from '../src/ai/ingest.js';
import { buildCapabilitiesPrompt } from '../src/ai/capabilitiesPrompt.js';
import { createAiAgent } from '../src/ai/createAiAgent.js';
import { buildToolkit, delta, makeCtx, mockServer, send, sse, tempStore } from './helpers.js';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });
const noImages = async () => null;
const binary = (res: any, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('FileStore', () => {
  it('enforces ownership, expiry, size and signed-url integrity', async () => {
    const t = await tempStore(); cleanups.push(t.cleanup);
    const meta = await t.store.put({ userId: 'a', name: 'x.txt', mime: 'text/plain', kind: 'text', data: Buffer.from('hello') });
    expect((await t.store.read(meta.id, 'a')).data.toString()).toBe('hello');
    await expect(t.store.read(meta.id, 'b')).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.store.read('../../etc/passwd', 'a')).rejects.toMatchObject({ code: 'not_found' });

    const url = new URL('http://x' + t.store.signedUrl(meta.id));
    const exp = url.searchParams.get('exp')!, sig = url.searchParams.get('sig')!;
    expect((await t.store.readSigned(meta.id, exp, sig)).meta.id).toBe(meta.id);
    await expect(t.store.readSigned(meta.id, exp, sig.slice(0, -2) + 'xx')).rejects.toMatchObject({ code: 'bad_signature' });
    await expect(t.store.readSigned(meta.id, String(Number(exp) + 1), sig)).rejects.toMatchObject({ code: 'bad_signature' });
    const old = new URL('http://x' + t.store.signedUrl(meta.id, -1000));
    await expect(t.store.readSigned(meta.id, old.searchParams.get('exp')!, old.searchParams.get('sig')!)).rejects.toMatchObject({ code: 'bad_signature' });

    const short = await t.store.put({ userId: 'a', name: 's.txt', mime: 'text/plain', kind: 'text', data: Buffer.from('x'), ttlMs: -1 });
    await expect(t.store.meta(short.id)).rejects.toMatchObject({ code: 'expired' });
    expect(await t.store.purgeExpired()).toBe(1);

    const ref = t.store.toRef(meta);
    const fresh = await t.store.refresh({ id: ref.id }, 'a');
    expect(fresh?.id).toBe(meta.id);
    expect(fresh?.url).toContain('sig=');
    expect(await t.store.refresh({ id: ref.id }, 'b')).toBeNull();
    expect(await t.store.refresh({ id: short.id }, 'a')).toBeNull();

    const tiny = new FileStore({ dir: t.dir, secret: 'another-secret-another-secret', maxFileBytes: 4 });
    await expect(tiny.put({ userId: 'a', name: 'big', mime: 'text/plain', kind: 'text', data: Buffer.alloc(10) })).rejects.toMatchObject({ code: 'too_large' });
    expect(() => new FileStore({ dir: t.dir, secret: 'short' })).toThrow(/secret/);
  });
});

describe('download route', () => {
  it('serves signed downloads with safe headers and blocks tampering and strangers', async () => {
    const t = await tempStore(); cleanups.push(t.cleanup);
    const app = express();
    app.use('/api/files', createFileRouter(t.store, { getUserId: (req) => (req.headers['x-user'] as string) || undefined }));
    const doc = await t.store.put({ userId: 'u1', name: 'Report \u00e9t\u00e9.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'document', data: Buffer.from('DOCX') });
    const svg = await t.store.put({ userId: 'u1', name: 'pic.svg', mime: 'image/svg+xml', kind: 'drawing', data: Buffer.from('<svg viewBox="0 0 1 1"/>') });

    const r = await request(app).get(t.store.signedUrl(doc.id)).buffer(true).parse(binary);
    expect(r.status).toBe(200);
    expect(r.headers['content-disposition']).toMatch(/^attachment;/);
    expect(r.headers['content-disposition']).toContain("filename*=UTF-8''Report%20%C3%A9t%C3%A9.docx");
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['content-security-policy']).toContain('sandbox');
    expect(r.body.toString()).toBe('DOCX');

    const s = await request(app).get(t.store.signedUrl(svg.id));
    expect(s.headers['content-disposition']).toMatch(/^inline;/);

    expect((await request(app).get(`/api/files/${doc.id}`)).status).toBe(401);
    expect((await request(app).get(`/api/files/${doc.id}`).set('x-user', 'u2')).status).toBe(403);
    expect((await request(app).get(`/api/files/${doc.id}`).set('x-user', 'u1')).status).toBe(200);
    expect((await request(app).get(t.store.signedUrl(doc.id).replace(/sig=.{4}/, 'sig=AAAA'))).status).toBe(403);
    expect((await request(app).get('/api/files/not-a-uuid')).status).toBe(401);
    expect((await request(app).get('/api/files/00000000-0000-4000-8000-000000000000').set('x-user', 'u1')).status).toBe(404);
  });
});

describe('extractText', () => {
  it('reads PDF, DOCX, XLSX, PPTX, CSV, HTML and refuses unknown binaries', async () => {
    const spec = { title: 'T', blocks: [{ type: 'paragraph' as const, text: 'Kinyarwanda: Muraho. Fran\u00e7ais: \u00e9l\u00e8ve.' }] };
    const pdf = await extractText({ name: 'a.pdf', data: await generatePdf(spec, noImages) });
    expect(pdf.text).toContain('Muraho');
    expect(pdf.text).toContain('\u00e9l\u00e8ve');
    expect((await extractText({ name: 'a.docx', data: await generateDocx(spec, noImages) })).text).toContain('Muraho');
    const xl = await extractText({ name: 'a.xlsx', data: await generateXlsx({ sheets: [{ name: 'S', columns: [{ header: 'N' }, { header: 'V' }], rows: [['a', 1], ['t', '=SUM(B2:B2)']] }] }) });
    expect(xl.text).toContain('Sheet: S');
    expect(xl.text).toContain('a\t1');
    expect((await extractText({ name: 'a.pptx', data: await generatePptx({ title: 'Deck', slides: [{ layout: 'bullets', title: 'Hi', bullets: ['one'] }] }, noImages) })).text).toContain('Hi');
    expect((await extractText({ name: 'a.csv', data: Buffer.from('\ufeffa,b\n1,2') })).text).toBe('a,b\n1,2');
    expect((await extractText({ name: 'a.html', data: Buffer.from('<p>Hello <b>you</b></p><script>bad()</script>') })).text).toBe('Hello you');
    expect((await extractText({ name: 'x.png', data: Buffer.from('x') })).kind).toBe('image');
    expect((await extractText({ name: 'x.bin', data: Buffer.from([0, 1, 2, 3, 0]) })).kind).toBe('unsupported');
    const broken = await extractText({ name: 'bad.pdf', data: Buffer.from('not a pdf') });
    expect(broken.kind).toBe('unsupported');
    const empty = await PDFDocument.create(); empty.addPage(); empty.embedStandardFont?.(StandardFonts.Helvetica);
    expect((await extractText({ name: 'blank.pdf', data: Buffer.from(await empty.save()) })).note).toMatch(/no extractable text/);
  });
});

describe('ingestUploads', () => {
  it('stores files, extracts document text, and passes images as vision parts', async () => {
    const t = await tempStore(); cleanups.push(t.cleanup);
    const docx = await generateDocx({ title: 'Scheme', blocks: [{ type: 'paragraph', text: 'Rubric: 5 marks for method.' }] }, noImages);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const r = await ingestUploads('Mark this', [
      { type: 'document', mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', name: 'rubric.docx', base64: docx.toString('base64') },
      { type: 'image', mediaType: 'image/png', name: 'script.png', base64: png.toString('base64') },
      { type: 'document', mediaType: 'application/octet-stream', name: 'weird.bin', base64: Buffer.from([0, 0, 0]).toString('base64') },
    ], makeCtx(t.store));
    expect(r.parts[0]).toMatchObject({ type: 'text' });
    const text = (r.parts[0] as any).text as string;
    expect(text).toContain('Mark this');
    expect(text).toContain('Rubric: 5 marks for method.');
    expect(text).toContain('untrusted data');
    expect(text).toContain('Upload notes');
    expect(r.parts[1]).toMatchObject({ type: 'image_url' });
    expect(r.fileIds).toHaveLength(3); // unsupported files are kept (the model is told they could not be read)
    expect(r.warnings.join(' ')).toMatch(/weird\.bin|Unsupported/);
    expect((await t.store.read(r.fileIds[0], 'u1')).meta.name).toBe('rubric.docx');
  });
});

describe('capabilities prompt', () => {
  it('only describes tools that exist', () => {
    const base = buildCapabilitiesPrompt({ tools: buildToolkit().names(), locale: 'rw', now: new Date('2026-10-12') });
    expect(base).toContain('Current date: 2026-10-12');
    expect(base).toContain('Kinyarwanda');
    expect(base).toContain('create_document');
    expect(base).not.toContain('search_knowledge FIRST');
    const full = buildCapabilitiesPrompt({ tools: [...buildToolkit({ knowledge: { search: async () => [] }, python: { execute: async () => ({ stdout: '' }) } }).names()] });
    expect(full).toContain('search_knowledge FIRST');
    expect(full).toContain('run_python');
  });
});

describe('createAiAgent end to end', () => {
  it('reads an uploaded PDF, calls tools, and returns downloadable files', async () => {
    const t = await tempStore(); cleanups.push(t.cleanup);
    const server = await mockServer([
      (_r, body, res) => {
        // The model must receive extracted PDF text (not binary garbage), the capabilities prompt, and tool schemas.
        const sys = body.messages[0].content as string;
        const user = body.messages.at(-1).content;
        const userText = typeof user === 'string' ? user : user[0].text;
        expect(sys).toContain('You are Bwenge');
        expect(sys).toContain('# Working with tools');
        expect(userText).toContain('Total marks: 20');
        expect(body.tools.map((x: any) => x.function.name)).toEqual(expect.arrayContaining(['create_spreadsheet', 'create_chart', 'create_drawing']));
        sse(res);
        send(res, delta({ tool_calls: [{ index: 0, id: 'a', function: { name: 'create_spreadsheet', arguments: JSON.stringify({ workbook: { sheets: [{ name: 'Marks', columns: [{ header: 'Student' }, { header: 'Mark' }], rows: [['Amina', 18], ['Total', '=SUM(B2:B2)']] }] } }) } }] }));
        res.end();
      },
      (_r, _b, res) => { sse(res); send(res, delta({ content: 'I made a mark sheet from your PDF.' })); res.end(); },
    ]);
    cleanups.push(server.close);

    const agent = createAiAgent({ provider: { name: 'Mock', baseUrl: server.url, apiKey: 'k' }, model: 'm', files: t.store, runtime: { retryDelayMs: 5 } });
    const pdf = await generatePdf({ title: 'Exam', blocks: [{ type: 'paragraph', text: 'Total marks: 20. Amina scored 18.' }] }, noImages);
    const events: string[] = [];
    const out = await agent.run({
      userId: 'u1', system: 'You are Bwenge.', prompt: 'Make a mark sheet', locale: 'en',
      uploads: [{ type: 'document', mediaType: 'application/pdf', name: 'exam.pdf', base64: pdf.toString('base64') }],
      onEvent: (e) => events.push(e.type),
    });
    expect(out.text).toBe('I made a mark sheet from your PDF.');
    expect(out.attachments.map((a) => a.name)).toEqual(['Marks.xlsx']);
    expect(out.fileIds).toHaveLength(1);
    expect(events).toContain('attachment');
    expect(events.at(-1)).toBe('done');
    const app = express(); app.use('/api/files', createFileRouter(t.store));
    const dl = await request(app).get(out.attachments[0].url).buffer(true).parse(binary);
    expect(dl.status).toBe(200);
    expect(dl.body.subarray(0, 2).toString()).toBe('PK');
  });
});
