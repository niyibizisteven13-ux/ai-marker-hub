import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { Document as DocxDocument, Packer, Paragraph, HeadingLevel, Table, TableRow, TableCell } from 'docx';
import PptxGenJS from 'pptxgenjs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { prisma } from '../server/db.js';
import { FileStore } from '../server/services/ai/files/FileStore.js';
import { FileJobQueue } from '../server/services/ai/jobs/fileJobQueue.js';
import { createKnowledgeService, type Embedder, type UploadItem } from '../server/services/knowledge/service.js';
import { normalizeRelativePath, validateFileType, nextFreeName } from '../server/services/knowledge/paths.js';
import { retrieveKnowledgeChunks } from '../server/services/KnowledgeRetrievalService.js';
import { toKnowledgePassage } from '../server/services/knowledge/citations.js';

// SYNTHETIC fixtures generated here; no user documents. The database is the app's local fallback (no DATABASE_URL).
const db = prisma as any;
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-test-'));
const fileStore = new FileStore({ dir: path.join(root, 'files'), secret: 'test-secret-1234567890' });
const queue = new FileJobQueue({ storageDir: path.join(root, 'jobs'), concurrency: 2, retryDelayMs: 20, maxActivePerUser: 50 });

const embed = { available: true, fail: false, calls: 0 };
const vec = (t: string) => { const v = new Array(32).fill(0); for (const w of t.toLowerCase().split(/\W+/)) if (w) v[[...w].reduce((a, c) => a + c.charCodeAt(0), 0) % 32] += 1; return v; };
const embedder: Embedder = {
  isAvailable: () => embed.available,
  async getEmbeddings(texts) { embed.calls++; if (embed.fail) throw new Error('provider down'); return texts.map(vec); },
};
const ocrCalls: number[] = [];
const svc = createKnowledgeService({ fileStore, queue, embedder, ocr: async (png) => { ocrCalls.push(png.length); return { text: 'Scanned household survey shows 4512 families', confidence: 91 }; }, tmpDir: path.join(root, 'tmp'), maxFileBytes: 20 * 1024 * 1024, defaultQuotaBytes: 50 * 1024 * 1024, segmentBudgetMs: 60_000 });

test.after(async () => { await queue.stop(); await new Promise((r) => setTimeout(r, 200)); await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

// ── Fixtures ────────────────────────────────────────────────────────────────
async function pdf(pages: string[]) {
  const d = await PDFDocument.create();
  const font = await d.embedFont(StandardFonts.Helvetica);
  for (const t of pages) d.addPage([595, 842]).drawText(t, { x: 50, y: 760, size: 14, font, maxWidth: 480, lineHeight: 18 });
  return Buffer.from(await d.save());
}
async function scannedPdf() {
  const png = await sharp({ create: { width: 800, height: 1100, channels: 3, background: '#fff' } }).composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1100"><text x="80" y="200" font-size="40">Scanned page</text></svg>'), top: 0, left: 0 }]).png().toBuffer();
  const d = await PDFDocument.create();
  const p = d.addPage([400, 550]);
  p.drawImage(await d.embedPng(png), { x: 0, y: 0, width: 400, height: 550 });
  return Buffer.from(await d.save());
}
async function docx() {
  const doc = new DocxDocument({ sections: [{ children: [
    new Paragraph({ text: 'Algebra Exercises', heading: HeadingLevel.HEADING_1 }),
    new Paragraph('Solve quadratic equations by factorisation.'),
    new Paragraph({ text: 'Answers', heading: HeadingLevel.HEADING_2 }),
    new Table({ rows: [new TableRow({ children: [new TableCell({ children: [new Paragraph('x')] }), new TableCell({ children: [new Paragraph('7')] })] })] }),
  ] }] });
  return Buffer.from(await Packer.toBuffer(doc));
}
async function xlsx() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Households');
  ws.addRow(['district', 'households', 'electricity']);
  ws.addRow(['Gasabo', 1200, 'yes']);
  ws.addRow(['Huye', 830, 'partial']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
async function pptx() {
  const P = ((PptxGenJS as any).default ?? PptxGenJS) as typeof PptxGenJS;
  const p = new P();
  p.addSlide().addText('Microeconomics: demand curves', { x: 1, y: 1 });
  p.addSlide().addText('Elasticity of supply', { x: 1, y: 1 });
  return Buffer.from((await p.write({ outputType: 'nodebuffer' })) as ArrayBuffer);
}
/** Minimal stored (uncompressed) ZIP writer that keeps entry names exactly as given. */
function rawZip(entries: Array<[string, string]>): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const locals: Buffer[] = [], centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const n = Buffer.from(name), d = Buffer.from(text), c = crc(d);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(c, 14); lh.writeUInt32LE(d.length, 18); lh.writeUInt32LE(d.length, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(c, 16); ch.writeUInt32LE(d.length, 20); ch.writeUInt32LE(d.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, n, d); centrals.push(ch, n);
    offset += 30 + n.length + d.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
const png = () => sharp({ create: { width: 300, height: 200, channels: 3, background: '#fff' } }).png().toBuffer();

async function items(list: Array<[string, Buffer | string]>): Promise<UploadItem[]> {
  const dir = path.join(root, 'up', randomUUID());
  await fs.mkdir(dir, { recursive: true });
  return Promise.all(list.map(async ([rel, data], i) => {
    const p = path.join(dir, `${i}.part`);
    const b = typeof data === 'string' ? Buffer.from(data) : data;
    await fs.writeFile(p, b);
    return { tempPath: p, name: rel.split('/').pop()!, relativePath: rel, size: b.length };
  }));
}

async function settle(repoId: string, owner: string) {
  for (let i = 0; i < 600; i++) {
    const s = await svc.statistics(owner, repoId);
    const busy = ['uploaded', 'queued', 'extracting', 'chunking', 'embedding', 'indexing'].reduce((a, k) => a + (s.byStatus[k] ?? 0), 0);
    if (!busy) return s;
    await new Promise((r) => setTimeout(r, 50));
  }
  const left = await db.repositoryFile.findMany({ where: { repositoryId: repoId } });
  throw new Error(`indexing did not settle: ${JSON.stringify(left.map((f: any) => [f.path, f.indexStatus, f.indexJobId]))}`);
}
const fileByPath = async (repoId: string, p: string) => db.repositoryFile.findFirst({ where: { repositoryId: repoId, path: p } });
const chunksOf = async (documentId: string | null) => (documentId ? db.documentChunk.findMany({ where: { documentId } }) : []);

// ── Paths and types ──────────────────────────────────────────────────────────
test('paths: traversal, absolute, drive letters, null bytes and dot segments are rejected; separators normalised', () => {
  assert.deepEqual(normalizeRelativePath('Rwanda Education\\Mathematics/Senior_One.pdf'), ['Rwanda Education', 'Mathematics', 'Senior_One.pdf']);
  for (const bad of ['../evil.txt', 'a/../../b', '/etc/passwd', 'C:\\Windows\\x', '\\\\server\\share', 'a/./b', 'a\u0000b', 'a/<b>.txt', '']) assert.throws(() => normalizeRelativePath(bad), undefined, bad);
  assert.throws(() => normalizeRelativePath(Array.from({ length: 40 }, () => 'd').join('/')), /nested/);
  assert.throws(() => validateFileType('report.pdf', Buffer.from('hello')), /does not contain what its extension says/);
  assert.throws(() => validateFileType('tool.exe', Buffer.from('MZ\u0090')), /executable/);
  assert.throws(() => validateFileType('notes.txt', Buffer.from([0x4d, 0x5a, 0, 0])), /executable|not a text file/);
  assert.equal(validateFileType('data.csv', Buffer.from('a,b\n1,2')), 'text/csv');
  assert.equal(validateFileType('blob.xyz', Buffer.from('anything')), 'text/plain');
  assert.equal(nextFreeName('report.pdf', (n) => n === 'report (1).pdf'), 'report (2).pdf');
});

// ── Repository, folders, folder upload, indexing, search ─────────────────────
test('repository: nested folders, folder upload keeps the tree, every format indexed with locations, searchable', async () => {
  const admin = `admin-${randomUUID()}`;
  const repo = await svc.createRepository(admin, { name: 'Bwenge AI Knowledge Repository' });
  assert.ok(repo.knowledgeBaseId, 'a knowledge base is linked automatically');
  const research = await svc.createDirectory(admin, repo.id, null, 'Research');
  await assert.rejects(svc.createDirectory(admin, repo.id, null, 'Research'), /already exists/);
  await svc.createDirectory(admin, repo.id, research.id, 'Drafts');

  const up = await svc.ingest(admin, repo.id, {
    items: await items([
      ['Rwanda Education/Mathematics/Senior_One.pdf', await pdf(['Senior one syllabus: fractions and ratios.', 'Page two covers photosynthesis in plants.'])],
      ['Rwanda Education/Mathematics/Algebra_Exercises.docx', await docx()],
      ['Rwanda Education/Mathematics/statistics.csv', 'district,score\nGasabo,71\nHuye,64\n'],
      ['Rwanda Education/Economics/datasets/household_survey.xlsx', await xlsx()],
      ['Rwanda Education/Economics/Microeconomics.pptx', await pptx()],
      ['Rwanda Education/Economics/scan.png', await png()],
      ['Rwanda Education/National_Reports/scanned_report.pdf', await scannedPdf()],
      ['Research/references.txt', 'Reference list: Kigali water quality study 2021.'],
      ['README.md', '# Repository\nOverview of the knowledge repository.\n## Usage\nAsk Bwenge about any file.'],
      ['Research/data.json', '{"title":"Survey","rows":3}'],
      ['../escape.txt', 'nope'],
      ['Research/bad.pdf', 'not a pdf'],
    ]),
    emptyFolders: ['Rwanda Education/Empty Folder'],
  });
  assert.equal(up.summary.created, 10);
  assert.deepEqual(up.results.filter((r) => r.status === 'rejected').map((r) => r.path).sort(), ['../escape.txt', 'Research/bad.pdf']);
  assert.ok(up.indexJobId);

  const tree = await svc.tree(admin, repo.id);
  assert.deepEqual(tree.directories.map((d) => d.path), ['Research', 'Research/Drafts', 'Rwanda Education', 'Rwanda Education/Economics', 'Rwanda Education/Economics/datasets', 'Rwanda Education/Empty Folder', 'Rwanda Education/Mathematics', 'Rwanda Education/National_Reports']);
  const empty = tree.directories.find((d) => d.path === 'Rwanda Education/Empty Folder')!;
  assert.equal(empty.files, 0, 'empty folders are kept');
  const math = tree.directories.find((d) => d.path === 'Rwanda Education/Mathematics')!;
  const listing = await svc.contents(admin, repo.id, math.id, { sort: 'name' });
  assert.deepEqual(listing.files.map((f) => f.name), ['Algebra_Exercises.docx', 'Senior_One.pdf', 'statistics.csv']);
  assert.deepEqual(listing.breadcrumbs.map((b) => b.name), ['Bwenge AI Knowledge Repository', 'Rwanda Education', 'Mathematics']);
  assert.equal((await svc.contents(admin, repo.id, null)).folders.map((f) => f.name).join(','), 'Research,Rwanda Education');

  const stats = await settle(repo.id, admin);
  assert.equal(stats.files, 10);
  const status = async (p: string) => (await fileByPath(repo.id, p)).indexStatus;
  for (const p of ['Rwanda Education/Mathematics/Senior_One.pdf', 'Rwanda Education/Mathematics/Algebra_Exercises.docx', 'Rwanda Education/Mathematics/statistics.csv', 'Rwanda Education/Economics/datasets/household_survey.xlsx', 'Rwanda Education/Economics/Microeconomics.pptx', 'Rwanda Education/Economics/scan.png', 'Rwanda Education/National_Reports/scanned_report.pdf', 'Research/references.txt', 'README.md', 'Research/data.json']) {
    assert.equal(await status(p), 'indexed', p);
  }

  // Chunks carry their location and a link back to the source.
  const pdfFile = await fileByPath(repo.id, 'Rwanda Education/Mathematics/Senior_One.pdf');
  const pdfChunks = await chunksOf(pdfFile.documentId);
  const page2 = pdfChunks.find((c: any) => c.text.includes('photosynthesis'));
  assert.equal(page2.pageNumber, 2);
  const meta = JSON.parse(page2.metadata);
  assert.deepEqual([meta.fileId, meta.path, meta.page, meta.extractionMethod, meta.sourceUrl], [pdfFile.id, pdfFile.path, 2, 'pdf_text', `/api/knowledge/sources/${pdfFile.id}?page=2`]);
  assert.ok(page2.embedding, 'embedded with the configured provider');
  assert.equal(page2.knowledgeBaseId, repo.knowledgeBaseId);
  const xl = await fileByPath(repo.id, 'Rwanda Education/Economics/datasets/household_survey.xlsx');
  const xlChunk = (await chunksOf(xl.documentId))[0];
  assert.match(xlChunk.text, /Sheet "Households" columns: district \| households \| electricity\nRow 2: district=Gasabo; households=1200; electricity=yes/);
  assert.equal(JSON.parse(xlChunk.metadata).sheet, 'Households');
  const sheets = await db.spreadsheetSheet.findMany({ where: { documentId: xl.documentId } });
  assert.equal(sheets.length, 1, 'structured table rows are stored');
  assert.equal((await db.spreadsheetRow.findMany({ where: { sheetId: sheets[0].id } })).length, 2);
  const slides = await chunksOf((await fileByPath(repo.id, 'Rwanda Education/Economics/Microeconomics.pptx')).documentId);
  assert.deepEqual(slides.map((c: any) => [c.pageNumber, c.section]).sort(), [[1, 'Slide 1'], [2, 'Slide 2']]);
  const docxChunks = await chunksOf((await fileByPath(repo.id, 'Rwanda Education/Mathematics/Algebra_Exercises.docx')).documentId);
  assert.ok(docxChunks.some((c: any) => c.section === 'Answers' && /x \| 7/.test(c.text)), 'docx headings become sections and tables keep their cells');
  const scanned = await fileByPath(repo.id, 'Rwanda Education/National_Reports/scanned_report.pdf');
  assert.equal(scanned.extractionMethod, 'ocr', 'a PDF page without text is OCR-ed');
  assert.equal((await fileByPath(repo.id, 'Rwanda Education/Economics/scan.png')).extractionMethod, 'ocr');

  // Search by name and by content (with page and excerpt).
  const s1 = await svc.search(admin, repo.id, { query: 'photosynthesis' });
  assert.equal(s1.content[0].path, 'Rwanda Education/Mathematics/Senior_One.pdf');
  assert.equal(s1.content[0].page, 2);
  assert.match(s1.content[0].excerpt, /photosynthesis/);
  assert.equal(s1.method, 'hybrid');
  const s2 = await svc.search(admin, repo.id, { query: 'household', scope: 'names' });
  assert.deepEqual(s2.files.map((f: any) => f.name), ['household_survey.xlsx']);
  const s3 = await svc.search(admin, repo.id, { query: 'Gasabo', scope: 'content', directoryId: math.id });
  assert.deepEqual([...new Set(s3.content.map((c: any) => c.name))], ['statistics.csv'], 'scoped to a folder');

  // The existing retrieval used by chat finds repository content for its owner.
  const hits = await retrieveKnowledgeChunks('photosynthesis plants', { userId: admin, knowledgeBaseId: repo.knowledgeBaseId!, threshold: 0.01 });
  const hit = hits.find((h: any) => JSON.parse(h.chunk.metadata).fileId === pdfFile.id)!;
  assert.ok(hit);
  // What the chat cites for that hit: path, page and a link that opens the original.
  const passage = toKnowledgePassage(hit as any);
  assert.deepEqual([passage.title, passage.page, passage.url], ['Rwanda Education/Mathematics/Senior_One.pdf', 2, `/api/knowledge/sources/${pdfFile.id}?page=2`]);
  const sheetPassage = toKnowledgePassage({ chunk: xlChunk });
  assert.equal(sheetPassage.table, 'Sheet Households, rows 2-3');
});

test('updates: unchanged uploads add nothing, replaced content re-indexes, copies share the index, deletes clean up', async () => {
  const admin = `admin-${randomUUID()}`;
  const repo = await svc.createRepository(admin, { name: 'Versions' });
  await svc.ingest(admin, repo.id, { items: await items([['notes/biology.txt', 'Mitochondria produce energy.']]) });
  await settle(repo.id, admin);
  const f1 = await fileByPath(repo.id, 'notes/biology.txt');
  const chunks1 = await chunksOf(f1.documentId);

  const again = await svc.ingest(admin, repo.id, { items: await items([['notes/biology.txt', 'Mitochondria produce energy.']]) });
  assert.equal(again.results[0].status, 'unchanged');
  assert.equal(again.indexJobId, null);
  assert.equal((await chunksOf(f1.documentId)).length, chunks1.length, 'no duplicate index entries');

  const renamed = await svc.ingest(admin, repo.id, { items: await items([['notes/biology.txt', 'Different text about ribosomes.']]) });
  assert.deepEqual([renamed.results[0].status, renamed.results[0].path], ['renamed', 'notes/biology (1).txt'], 'default conflict policy keeps both');
  const replaced = await svc.ingest(admin, repo.id, { items: await items([['notes/biology.txt', 'Chloroplasts capture light.']]), onConflict: 'replace' });
  assert.equal(replaced.results[0].status, 'replaced');
  await settle(repo.id, admin);
  const f2 = await fileByPath(repo.id, 'notes/biology.txt');
  assert.equal(f2.version, 2);
  assert.equal(f2.documentId, f1.documentId, 'the same document is updated in place');
  const texts = (await chunksOf(f2.documentId)).map((c: any) => c.text).join(' ');
  assert.match(texts, /Chloroplasts/);
  assert.doesNotMatch(texts, /Mitochondria/, 'old content is no longer indexed');
  const skipped = await svc.ingest(admin, repo.id, { items: await items([['notes/biology.txt', 'x']]), onConflict: 'skip' });
  assert.equal(skipped.results[0].status, 'skipped');

  // Copy: identical bytes share storage and index (no duplicate chunks).
  const archive = await svc.createDirectory(admin, repo.id, null, 'archive');
  const copy = await svc.copyFile(admin, f2.id, archive.id);
  await settle(repo.id, admin);
  const c = await db.repositoryFile.findUnique({ where: { id: copy.file.id } });
  assert.deepEqual([c.indexStatus, c.duplicateOfId, c.storageKey], ['duplicate', f2.id, f2.storageKey]);
  await svc.deleteFile(admin, f2.id);
  assert.equal((await chunksOf(f2.documentId)).length, 0, 'deleting a file removes its indexed content');
  assert.equal(await fileStore.meta(f2.storageKey).then(() => 'kept'), 'kept', 'bytes kept while the copy uses them');
  await settle(repo.id, admin);
  const c2 = await db.repositoryFile.findUnique({ where: { id: copy.file.id } });
  assert.equal(c2.indexStatus, 'indexed', 'the copy is indexed itself once the original is gone');
  await svc.deleteFile(admin, c2.id);
  await assert.rejects(fileStore.meta(f2.storageKey), 'bytes removed with the last reference');
});

test('organising: rename and move files and folders, recursive delete, pagination and sorting', async () => {
  const admin = `admin-${randomUUID()}`;
  const repo = await svc.createRepository(admin, { name: 'Org' });
  await svc.ingest(admin, repo.id, { items: await items(Array.from({ length: 25 }, (_, i) => [`bulk/f${String(i).padStart(2, '0')}.txt`, 'x'.repeat(i + 1)] as [string, string])) });
  await svc.ingest(admin, repo.id, { items: await items([['a/b/c/deep.txt', 'deep content'], ['a/top.txt', 'top']]) });
  await settle(repo.id, admin);
  const bulkDir = await db.repositoryDirectory.findFirst({ where: { repositoryId: repo.id, path: 'bulk' } });
  const page2 = await svc.contents(admin, repo.id, bulkDir.id, { sort: 'size', order: 'desc', limit: 10, offset: 10 });
  assert.equal(page2.total, 25);
  assert.deepEqual(page2.files.map((f) => f.sizeBytes), [15, 14, 13, 12, 11, 10, 9, 8, 7, 6]);
  assert.equal(page2.hasMore, true);

  const a = await db.repositoryDirectory.findFirst({ where: { repositoryId: repo.id, path: 'a' } });
  const abc = await db.repositoryDirectory.findFirst({ where: { repositoryId: repo.id, path: 'a/b/c' } });
  await assert.rejects(svc.updateDirectory(admin, a.id, { parentId: abc.id }), /into itself/);
  await svc.updateDirectory(admin, a.id, { name: 'Alpha' });
  const deep = await fileByPath(repo.id, 'Alpha/b/c/deep.txt');
  assert.ok(deep, 'descendant paths follow a folder rename');
  assert.equal((await db.document.findUnique({ where: { id: deep.documentId } })).name, 'Alpha/b/c/deep.txt');
  await svc.updateFile(admin, deep.id, { name: 'renamed.txt', directoryId: null });
  assert.ok(await fileByPath(repo.id, 'renamed.txt'));
  const moved = await svc.bulk(admin, repo.id, { action: 'move', fileIds: [(await fileByPath(repo.id, 'Alpha/top.txt')).id], targetDirectoryId: bulkDir.id });
  assert.equal(moved.results[0].ok, true);
  await assert.rejects(svc.deleteDirectory(admin, bulkDir.id, false), /recursive=true/);
  const del = await svc.deleteDirectory(admin, bulkDir.id, true);
  assert.equal(del.deletedFiles, 26);
  assert.equal((await svc.statistics(admin, repo.id)).files, 1);
  // Survives a "restart": a new service instance over the same database sees the same tree.
  const fresh = createKnowledgeService({ fileStore, queue: new FileJobQueue({ storageDir: path.join(root, 'jobs2') }), embedder });
  assert.deepEqual((await fresh.tree(admin, repo.id)).directories.map((d) => d.path), ['Alpha', 'Alpha/b', 'Alpha/b/c']);
});

test('indexing states: missing embeddings stay recoverable, provider failures can be retried, broken files fail clearly', async () => {
  const admin = `admin-${randomUUID()}`;
  const repo = await svc.createRepository(admin, { name: 'States' });
  embed.available = false;
  await svc.ingest(admin, repo.id, { items: await items([['policy.txt', 'Teachers must record attendance daily.']]) });
  await settle(repo.id, admin);
  let f = await fileByPath(repo.id, 'policy.txt');
  assert.equal(f.indexStatus, 'pending_embeddings');
  assert.match(f.indexError, /no embedding provider is configured/);
  assert.equal((await svc.search(admin, repo.id, { query: 'attendance', scope: 'content' })).content.length, 1, 'keyword-searchable meanwhile');
  embed.available = true;
  embed.fail = true;
  await svc.reindexFile(admin, f.id);
  await settle(repo.id, admin);
  f = await fileByPath(repo.id, 'policy.txt');
  assert.equal(f.indexStatus, 'partial_failure');
  embed.fail = false;
  const calls = embed.calls;
  await svc.resumePending();
  await svc.reindexRepository(admin, repo.id, { onlyFailed: true });
  await settle(repo.id, admin);
  f = await fileByPath(repo.id, 'policy.txt');
  assert.equal(f.indexStatus, 'indexed');
  assert.ok(embed.calls > calls);
  assert.ok((await chunksOf(f.documentId)).every((c: any) => c.embedding), 'embeddings filled in without duplicating chunks');
  assert.equal((await chunksOf(f.documentId)).length, 1);

  await svc.ingest(admin, repo.id, { items: await items([['broken.pdf', Buffer.from('%PDF-1.4\nthis is not really a pdf')], ['broken.docx', Buffer.from('PK\u0003\u0004garbage')], ['archive.bin', Buffer.from([1, 2, 3, 4])]]) });
  await settle(repo.id, admin);
  const broken = await fileByPath(repo.id, 'broken.pdf');
  assert.deepEqual([broken.indexStatus, broken.indexError], ['failed', 'The PDF could not be read (it may be damaged).']);
  assert.equal((await fileByPath(repo.id, 'broken.docx')).indexStatus, 'failed');
  assert.equal((await fileByPath(repo.id, 'archive.bin')).indexStatus, 'unsupported', 'unknown formats are stored, not indexed');
  const sub = await svc.createDirectory(admin, repo.id, null, 'private');
  await svc.ingest(admin, repo.id, { directoryId: sub.id, items: await items([['salaries.txt', 'confidential']]) });
  await settle(repo.id, admin);
  await svc.updateDirectory(admin, sub.id, { aiEnabled: false });
  await settle(repo.id, admin);
  const sal = await fileByPath(repo.id, 'private/salaries.txt');
  assert.equal(sal.indexStatus, 'excluded', 'folders can be kept out of the AI');
  assert.equal(sal.documentId, null);
});

test('previews: paged text, tables, sheets, PDF pages, sanitised HTML, slides, images, archives', async () => {
  const admin = `admin-${randomUUID()}`;
  const repo = await svc.createRepository(admin, { name: 'Previews' });
  const zip = new JSZip();
  zip.file('inner/a.txt', 'alpha');
  await svc.ingest(admin, repo.id, { items: await items([
    ['long.txt', 'line\n'.repeat(30_000)], ['s.csv', 'a,b\n1,2\n3,4\n'], ['w.xlsx', await xlsx()], ['d.pdf', await pdf(['First page', 'Second page'])],
    ['page.html', '<h1>Title</h1><script>alert(1)</script><p onclick="x()">Body <a href="javascript:evil()">link</a></p><iframe src="https://x"></iframe>'],
    ['d.json', '{"a":1}'], ['p.pptx', await pptx()], ['i.png', await png()], ['z.zip', await zip.generateAsync({ type: 'nodebuffer' })], ['doc.docx', await docx()], ['x.bin', Buffer.from([0, 1, 2])],
  ]) });
  await settle(repo.id, admin);
  const id = async (p: string) => (await fileByPath(repo.id, p)).id;
  const t1: any = await svc.preview(admin, await id('long.txt'), { limit: 1000 });
  assert.equal(t1.text.length, 1000);
  assert.equal(t1.nextOffset, 1000);
  const t2: any = await svc.preview(admin, await id('long.txt'), { offset: t1.nextOffset, limit: 1000 });
  assert.equal(t2.offset, 1000);
  const csv: any = await svc.preview(admin, await id('s.csv'));
  assert.deepEqual([csv.columns, csv.rows], [['a', 'b'], [['1', '2'], ['3', '4']]]);
  const xl: any = await svc.preview(admin, await id('w.xlsx'), { sheet: 'Households' });
  assert.deepEqual(xl.columns, ['district', 'households', 'electricity']);
  const p2: any = await svc.preview(admin, await id('d.pdf'), { page: 2 });
  assert.deepEqual([p2.kind, p2.page, p2.pages], ['pdf', 2, 2]);
  assert.match(p2.text, /Second page/);
  const img = await svc.renderImage(admin, await id('d.pdf'), 2);
  assert.equal((await sharp(img).metadata()).format, 'png');
  const html: any = await svc.preview(admin, await id('page.html'));
  assert.doesNotMatch(html.html, /script|onclick|iframe|javascript:/i);
  assert.match(html.html, /<h1>Title<\/h1>/);
  assert.deepEqual((await svc.preview(admin, await id('d.json')) as any).json, { a: 1 });
  assert.deepEqual((await svc.preview(admin, await id('p.pptx')) as any).slides.map((s: any) => s.text), ['Microeconomics: demand curves', 'Elasticity of supply']);
  const im: any = await svc.preview(admin, await id('i.png'));
  assert.equal(im.kind, 'image');
  assert.match(im.ocrText, /household survey/);
  assert.deepEqual((await svc.preview(admin, await id('z.zip')) as any).entries.map((e: any) => e.path), ['inner/', 'inner/a.txt']);
  assert.match((await svc.preview(admin, await id('doc.docx')) as any).html, /<h1>Algebra Exercises<\/h1>/);
  assert.equal((await svc.preview(admin, await id('x.bin')) as any).kind, 'unavailable');
});

test('archives: safe extraction keeps folders; traversal entries and zip bombs are refused', async () => {
  const admin = `admin-${randomUUID()}`;
  const repo = await svc.createRepository(admin, { name: 'Archives' });
  // JSZip cleans names when creating archives, so the hostile archive is written byte by byte.
  const good = rawZip([['pack/readme.txt', 'Packed notes about soil erosion.'], ['pack/empty/', ''], ['../../escape.txt', 'escape'], ['/abs.txt', 'abs']]);
  const bomb = new JSZip();
  bomb.file('zeros.txt', Buffer.alloc(3 * 1024 * 1024, 48));
  await svc.ingest(admin, repo.id, { items: await items([['good.zip', good], ['bomb.zip', await bomb.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })]]) });
  await settle(repo.id, admin);
  const out = await svc.extractArchive(admin, (await fileByPath(repo.id, 'good.zip')).id, {});
  assert.ok(out.results.some((r) => r.path === 'pack/readme.txt' && r.status === 'created'));
  assert.deepEqual(out.results.filter((r) => r.status === 'rejected').map((r) => r.path).sort(), ['../../escape.txt', '/abs.txt']);
  assert.ok((await svc.tree(admin, repo.id)).directories.some((d) => d.path === 'pack/empty'));
  await settle(repo.id, admin);
  assert.equal((await fileByPath(repo.id, 'pack/readme.txt')).indexStatus, 'indexed');
  await assert.rejects(svc.extractArchive(admin, (await fileByPath(repo.id, 'bomb.zip')).id, {}), /zip bomb/);
});

test('access control: other admins see nothing, organisation members share, sources follow retrieval rights', async () => {
  const owner = `admin-${randomUUID()}`, stranger = `admin-${randomUUID()}`, colleague = `admin-${randomUUID()}`;
  const orgId = randomUUID();
  await db.organizationMember.create({ data: { id: randomUUID(), organizationId: orgId, userId: owner, role: 'ADMIN' } });
  await db.organizationMember.create({ data: { id: randomUUID(), organizationId: orgId, userId: colleague, role: 'TEACHER' } });
  await assert.rejects(svc.createRepository(stranger, { name: 'X', organizationId: orgId }), /not a member/);
  const repo = await svc.createRepository(owner, { name: 'Shared', organizationId: orgId });
  const priv = await svc.createRepository(owner, { name: 'Private' });
  await svc.ingest(owner, priv.id, { items: await items([['secret.txt', 'secret exam answers']]) });
  await settle(priv.id, owner);
  const secret = await fileByPath(priv.id, 'secret.txt');
  for (const fn of [() => svc.repoFor(stranger, priv.id), () => svc.tree(stranger, priv.id), () => svc.getFile(stranger, secret.id), () => svc.preview(stranger, secret.id), () => svc.deleteFile(stranger, secret.id), () => svc.openDownload(stranger, secret.id), () => svc.search(stranger, priv.id, { query: 'secret' })]) {
    await assert.rejects(fn(), /not found/i);
  }
  assert.equal((await svc.listRepositories(stranger)).length, 0);
  assert.ok(await svc.tree(colleague, repo.id), 'organisation members can manage shared repositories');
  await assert.rejects(svc.tree(colleague, priv.id), /not found/i);
  await assert.rejects(svc.openSource(colleague, secret.id), /not found/i, 'no source access without retrieval rights');
  assert.ok((await svc.openSource(owner, secret.id)).file);
  await db.document.update({ where: { id: secret.documentId }, data: { globalApproved: true } });
  await db.knowledgeBase.update({ where: { id: priv.knowledgeBaseId }, data: { globalApproved: true } });
  assert.ok((await svc.openSource(stranger, secret.id)).file, 'globally approved sources are open to every signed-in user');
  const job = (await svc.reindexFile(owner, secret.id)).jobId!;
  await assert.rejects(svc.jobStatus(stranger, job), /not found/i);
  assert.ok((await svc.jobStatus(owner, job)).job);
});

test('storage: streamed writes hash correctly, ranges read only what is asked, quota is enforced', async () => {
  const big = path.join(root, 'big.bin');
  await fs.writeFile(big, Buffer.alloc(3 * 1024 * 1024, 7));
  const meta = await fileStore.putFile({ userId: 'u', name: 'big.bin', mime: 'application/octet-stream', kind: 'document', sourcePath: big, maxBytes: 10 * 1024 * 1024 });
  const { createHash } = await import('node:crypto');
  assert.equal(meta.sha256, createHash('sha256').update(await fs.readFile(big)).digest('hex'));
  assert.equal((await fileStore.readRange(meta.id, 'u', 10, 5)).data.length, 5);
  await assert.rejects(fileStore.putFile({ userId: 'u', name: 'big.bin', mime: 'x', kind: 'document', sourcePath: big, maxBytes: 1024 }), /larger than/);
  const admin = `admin-${randomUUID()}`;
  const repo = await svc.createRepository(admin, { name: 'Quota', quotaBytes: 100 });
  const r = await svc.ingest(admin, repo.id, { items: await items([['a.txt', 'x'.repeat(80)], ['b.txt', 'y'.repeat(80)]]) });
  assert.deepEqual(r.results.map((x) => x.status), ['created', 'rejected']);
  assert.match(r.results[1].reason!, /quota/i);
});

test('view-only Datasets & Curations: any user sees published datasets read-only, never unpublished ones or AI-off folders', async () => {
  const admin = `admin-${randomUUID()}`, judge = `judge-${randomUUID()}`;
  const pub = await svc.createRepository(admin, { name: 'NISR microdata' });
  const priv = await svc.createRepository(admin, { name: 'Drafts' });
  await svc.ingest(admin, pub.id, { items: await items([['LFS 2023/ddi.xml', '<codeBook><stdyDscr>Labour Force Survey 2023</stdyDscr></codeBook>'], ['LFS 2023/notes.txt', 'district unemployment notes'], ['internal/review.txt', 'not for publication']]) });
  await svc.ingest(admin, priv.id, { items: await items([['draft.txt', 'unpublished draft']]) });
  await settle(pub.id, admin);
  await settle(priv.id, admin);
  await svc.updateRepository(admin, pub.id, { settings: { assistant: true } });
  // Published datasets are shared state (other test files read the same store): always clean up.
  try {
  const internal = (await svc.tree(admin, pub.id)).directories.find((d: any) => d.name === 'internal')!;
  await svc.updateDirectory(admin, internal.id, { aiEnabled: false });

  const repos = (await svc.viewRepositories(judge)).filter((r: any) => [pub.id, priv.id].includes(r.id));
  assert.deepEqual(repos.map((r: any) => r.name), ['NISR microdata'], 'only published datasets are listed');
  assert.equal(repos[0].statistics.files, 2, 'files in AI-off folders are not counted');
  const tree = await svc.tree(judge, pub.id, 'view');
  assert.deepEqual(tree.directories.map((d: any) => d.name), ['LFS 2023']);
  const top = await svc.contents(judge, pub.id, null, {}, 'view');
  assert.deepEqual(top.folders.map((d: any) => d.name), ['LFS 2023']);
  const xml = await fileByPath(pub.id, 'LFS 2023/ddi.xml');
  assert.ok((await svc.preview(judge, xml.id, {}, 'view')).file, 'files can be previewed');
  assert.ok((await svc.openDownload(judge, xml.id, undefined, 'view')).file, 'and downloaded');
  const hiddenFile = await fileByPath(pub.id, 'internal/review.txt');
  await assert.rejects(svc.preview(judge, hiddenFile.id, {}, 'view'), /not found/i);
  await assert.rejects(svc.contents(judge, pub.id, internal.id, {}, 'view'), /not found/i);
  const found = await svc.search(judge, pub.id, { query: 'review', scope: 'names' }, 'view');
  assert.equal(found.files.length, 0, 'search never returns hidden files');
  await assert.rejects(svc.tree(judge, priv.id, 'view'), /not found/i, 'unpublished datasets stay private');
  // View mode never grants management: the admin API calls still refuse the judge.
  for (const fn of [() => svc.tree(judge, pub.id), () => svc.deleteFile(judge, xml.id), () => svc.updateRepository(judge, pub.id, { name: 'x' }), () => svc.reindexRepository(judge, pub.id)]) {
    await assert.rejects(fn(), /not found/i);
  }
  } finally {
    await svc.deleteRepository(admin, pub.id).catch(() => undefined);
    await svc.deleteRepository(admin, priv.id).catch(() => undefined);
  }
});

test('view-only Datasets & Curations router exposes reads only', async () => {
  const { curationViewRouter } = await import('../server/routes/knowledgeRepositoryRoutes.js');
  const methods = new Set((curationViewRouter as any).stack.flatMap((l: any) => Object.keys(l.route?.methods ?? {})));
  assert.deepEqual([...methods], ['get']);
});
