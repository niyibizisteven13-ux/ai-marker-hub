import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { PDFDocument, StandardFonts } from 'pdf-lib';

// Datasets from Admin → Datasets & Curations used by every user's assistant: published by default, hidden when
// switched off, folders/files switched off for AI stay out. The agent lists, browses, reads and analyses
// them (fake Claude scripts the tool calls). SYNTHETIC data only.

const requests: any[] = [];
const toolText = (block: any) => (typeof block.content === 'string' ? block.content : (block.content ?? []).map((c: any) => c.text ?? '').join(''));

/** Scripted agent: list → browse (search) → read → analyze → answer from the analysis table. */
function script(p: any): { text?: string; tool?: { name: string; input: unknown } } {
  const last = p.messages.at(-1);
  const results = Array.isArray(last.content) ? last.content.filter((b: any) => b.type === 'tool_result') : [];
  if (!results.length) return { tool: { name: 'list_datasets', input: {} } };
  const text = toolText(results[0]);
  const prevTool = p.messages.at(-2).content.find((b: any) => b.type === 'tool_use')?.name;
  if (prevTool === 'list_datasets') return { tool: { name: 'browse_dataset', input: { datasetId: /Agriculture Survey \(datasetId ([^)]+)\)/.exec(text)![1], search: 'yields' } } };
  if (prevTool === 'browse_dataset') return { tool: { name: 'read_dataset_file', input: { fileId: /fileId ([\w-]+)/.exec(text)![1] } } };
  if (prevTool === 'read_dataset_file') {
    const id = /"repository_file","id":"([\w-]+)"/.exec(text)![1];
    return { tool: { name: 'analyze_data', input: { title: 'Maize yield by district', source: { type: 'repository_file', id }, operations: [{ op: 'groupby', by: ['district'], metrics: [{ column: 'yield', agg: 'mean' }] }] } } };
  }
  return { text: `Average maize yield by district (from Agriculture/2024/yields.csv):\n\n${text.includes('Gasabo') ? 'Gasabo and Huye compared' : 'no table'}` };
}

const claude = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (!req.url?.endsWith('/messages')) { res.writeHead(400, { 'content-type': 'application/json' }).end('{"error":{"message":"stub"}}'); return; }
    const p = JSON.parse(body);
    requests.push(p);
    const turn = script(p);
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    send('message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: p.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 5, output_tokens: 1 } } });
    if (turn.text) {
      send('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
      send('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: turn.text } });
      send('content_block_stop', { type: 'content_block_stop', index: 0 });
    } else {
      send('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: `toolu_${requests.length}`, name: turn.tool!.name, input: {} } });
      send('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(turn.tool!.input) } });
      send('content_block_stop', { type: 'content_block_stop', index: 0 });
    }
    send('message_delta', { type: 'message_delta', delta: { stop_reason: turn.text ? 'end_turn' : 'tool_use', stop_sequence: null }, usage: { output_tokens: 9 } });
    send('message_stop', { type: 'message_stop' });
    res.end();
  });
}).listen(0);
await new Promise((r) => claude.once('listening', r));
const base = `http://127.0.0.1:${(claude.address() as AddressInfo).port}`;
Object.assign(process.env, {
  AI_PROVIDER: 'gonkarouter', AI_AGENT_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: base,
  CLAUDE_AGENT_MODEL: 'claude-haiku-5-5', CLAUDE_FALLBACK_TO_GONKA: 'false', GONKA_API_KEY: 'test-gonka', GONKA_BASE_URL: `${base}/gonka/v1`,
});

const { prisma } = await import('../server/db.js');
const { knowledgeService, startEducationRuntime } = await import('../server/services/educationRuntime.js');
const { AiService, fileJobQueue } = await import('../server/services/AiService.js');
const { retrieveKnowledgeChunks } = await import('../server/services/KnowledgeRetrievalService.js');
const { toKnowledgePassage } = await import('../server/services/knowledge/citations.js');
const { asksAboutDatasets, publishedKnowledgeBaseIds, resetPublishedCache } = await import('../server/services/knowledge/published.js');
const { buildKnowledgeAccessWhere } = await import('../server/services/ai/dataScope.js');
const { useToolAgent } = await import('../server/services/outputs/chatTurn.js');
const { planOutput } = await import('../server/services/outputs/planner.js');
const db = prisma as any;
await startEducationRuntime();

const tag = randomUUID().slice(0, 8);
const admin = `admin-ds-${tag}`;
const user = `user-ds-${tag}`;
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dataset-ai-'));
test.after(async () => { await fileJobQueue.stop(); claude.close(); await fs.rm(root, { recursive: true, force: true }); });

const CSV = 'district,crop,yield\nGasabo,maize,3.0\nGasabo,maize,3.4\nHuye,maize,2.0\nHuye,maize,2.6\nMusanze,beans,1.5\n';
async function pdf(text: string) {
  const d = await PDFDocument.create();
  d.addPage([595, 842]).drawText(text, { x: 50, y: 760, size: 14, font: await d.embedFont(StandardFonts.Helvetica), maxWidth: 480 });
  return Buffer.from(await d.save());
}
async function upload(repoId: string, list: Array<[string, Buffer | string]>) {
  const dir = path.join(root, randomUUID());
  await fs.mkdir(dir);
  const items = await Promise.all(list.map(async ([rel, data], i) => {
    const p = path.join(dir, `${i}.part`);
    const b = typeof data === 'string' ? Buffer.from(data) : data;
    await fs.writeFile(p, b);
    return { tempPath: p, name: rel.split('/').pop()!, relativePath: rel, size: b.length };
  }));
  await knowledgeService.ingest(admin, repoId, { items });
  for (let i = 0; i < 400; i++) {
    const s = await knowledgeService.statistics(admin, repoId);
    if (!['uploaded', 'queued', 'extracting', 'chunking', 'embedding', 'indexing'].some((k) => s.byStatus[k])) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('indexing did not finish');
}

const hidden = await knowledgeService.createRepository(admin, { name: 'Staff Records', description: 'Not published.' });
const repo = await knowledgeService.createRepository(admin, { name: 'Agriculture Survey', description: 'Seasonal agriculture survey, synthetic test data.', settings: { assistant: true } });
await upload(repo.id, [
  ['Agriculture/2024/yields.csv', CSV],
  ['Agriculture/2024/summary.pdf', await pdf(`Season A ${tag} report: maize harvest improved in Gasabo thanks to irrigation.`)],
  ['Private/salaries.csv', 'name,salary\nA,100\n'],
]);
const privateDir = await db.repositoryDirectory.findFirst({ where: { repositoryId: repo.id, path: 'Private' } });
await knowledgeService.updateDirectory(admin, privateDir.id, { aiEnabled: false });
const yields = await db.repositoryFile.findFirst({ where: { repositoryId: repo.id, path: 'Agriculture/2024/yields.csv' } });
const salaries = await db.repositoryFile.findFirst({ where: { repositoryId: repo.id, path: 'Private/salaries.csv' } });

test('published datasets: any user can list, browse and search them; unpublished ones and AI-disabled folders stay hidden', async () => {
  const catalog = await knowledgeService.assistantCatalog(user);
  assert.ok(!catalog.some((d) => d.id === hidden.id), 'repositories are private until published');
  assert.ok((await knowledgeService.assistantCatalog(admin)).some((d) => d.id === hidden.id), 'the owner\'s assistant can still use them');
  const mine = catalog.find((d) => d.id === repo.id)!;
  assert.ok(mine, 'a normal user sees the admin dataset');
  assert.deepEqual(mine.folders, ['Agriculture']);
  assert.equal(mine.files, 2);
  assert.deepEqual(mine.types, { csv: 1, pdf: 1 });

  const top = await knowledgeService.assistantBrowse(user, repo.id, { path: '' });
  assert.deepEqual(top.folders.map((f) => [f.path, f.files]), [['Agriculture', 2]]);
  const year = await knowledgeService.assistantBrowse(user, repo.id, { path: 'Agriculture/2024' });
  assert.deepEqual(year.files.map((f) => f.path), ['Agriculture/2024/summary.pdf', 'Agriculture/2024/yields.csv']);
  const found = await knowledgeService.assistantBrowse(user, repo.id, { search: 'csv' });
  assert.deepEqual(found.files.map((f) => f.path), ['Agriculture/2024/yields.csv'], 'search skips the AI-disabled folder');
  await assert.rejects(knowledgeService.assistantBrowse(user, repo.id, { path: 'Private' }), /No folder/);
  await assert.rejects(knowledgeService.assistantRead(user, salaries.id), /not available to the assistant/);
});

test('read: spreadsheets as columns + rows, PDFs page by page, with the analysis hint', async () => {
  const table = await knowledgeService.assistantRead(user, yields.id);
  assert.deepEqual(table.sheets[0].columns, ['district', 'crop', 'yield']);
  assert.equal(table.sheets[0].totalRows, 5);
  assert.match(table.text, /district,crop,yield\nGasabo,maize,3\.0?\n/);
  const doc = await db.repositoryFile.findFirst({ where: { repositoryId: repo.id, path: 'Agriculture/2024/summary.pdf' } });
  const page = await knowledgeService.assistantRead(user, doc.id);
  assert.match(page.text, /--- Page 1 ---\nSeason A [\s\S]*irrigation/);
  assert.equal(page.pages, 1);
});

test('search_knowledge reaches published datasets for every user, with the source file', async () => {
  // The local test database does not evaluate relation filters, so the access rule itself is checked here;
  // Postgres applies it in production.
  assert.ok((await publishedKnowledgeBaseIds()).includes(repo.knowledgeBaseId));
  assert.deepEqual(buildKnowledgeAccessWhere(user, [], [repo.knowledgeBaseId]).OR.at(-1), { knowledgeBaseId: { in: [repo.knowledgeBaseId] } });
  assert.equal(buildKnowledgeAccessWhere(user, []).OR.length, 3, 'without published datasets the rule is unchanged');
  const hits = await retrieveKnowledgeChunks(`Season A ${tag} irrigation`, { userId: user, limit: 5 });
  const passage = hits.map((h: any) => toKnowledgePassage(h)).find((p) => p.path === 'Agriculture/2024/summary.pdf');
  assert.ok(passage, 'the dataset passage is retrievable by a normal user');
  assert.ok(passage!.fileId);
  const fromThisRepo = (hits: any[]) => hits.map((h) => toKnowledgePassage(h)).filter((p) => p.fileId && [yields.id, salaries.id, passage!.fileId].includes(p.fileId));
  assert.equal(fromThisRepo(await retrieveKnowledgeChunks('salary name', { userId: user, limit: 10 })).length, 0, 'AI-disabled files are not indexed');
});

test('agent: a normal user\'s data question runs on Claude Haiku and lists → browses → reads → analyses the dataset', async () => {
  resetPublishedCache();
  const question = 'What is the average maize yield per district in the agriculture survey?';
  assert.equal(await asksAboutDatasets(question), true);
  assert.equal(await asksAboutDatasets('Agriculture Survey please'), true, 'dataset names count');
  assert.equal(await asksAboutDatasets('hello, how are you?'), false);
  const plan = planOutput({ message: 'tell me about the Agriculture Survey' });
  const route = { intent: 'general_assist', service: 'general', isSmallTalk: false, requestedProvider: null, hasClaudeKey: true, aiProvider: 'gonkarouter', agentAvailable: true, plan };
  assert.equal(useToolAgent({ ...route, asksAboutDatasets: true }), true, 'dataset questions take the tool path');

  requests.length = 0;
  const out: any = await AiService.getInstance().generalAssist({ userId: user, planText: question, messages: [{ role: 'user', content: question }] });
  assert.equal(requests[0].model, 'claude-haiku-5-5');
  const names = requests[0].tools.map((t: any) => t.name);
  for (const n of ['list_datasets', 'browse_dataset', 'read_dataset_file', 'search_knowledge', 'analyze_data']) assert.ok(names.includes(n), `${n} offered`);
  assert.match(requests[0].system.map?.((b: any) => b.text).join('') ?? String(requests[0].system), /Public library/);

  const results = requests.slice(1).map((r) => toolText(r.messages.at(-1).content.find((b: any) => b.type === 'tool_result')));
  assert.match(results[0], /Agriculture Survey \(datasetId .*2 files/);
  assert.match(results[1], /Agriculture\/2024\/yields\.csv · CSV/);
  assert.match(results[2], /columns: district, crop, yield/);
  assert.match(results[3], /Gasabo/);
  assert.match(results[3], /3\.2/, 'the analysis engine computed the Gasabo mean (3.0 and 3.4)');
  assert.match(results[3], /2\.3/, 'Huye mean (2.0 and 2.6)');
  assert.match(out.content[0].text, /Gasabo and Huye compared/);
});

test('public library: questions from the library panel and topic questions the library can answer take the tool path', async () => {
  resetPublishedCache();
  assert.equal(await asksAboutDatasets('Summarise this file\n\n[Public library: file "Agriculture/2024/summary.pdf" in "Agriculture Survey" (fileId x)]'), true);
  // No data words and no dataset name: only the index knows the library covers it.
  const topic = `What helped the maize harvest in Season A ${tag}?`;
  assert.equal(await asksAboutDatasets(topic), false, 'without the user the words alone do not decide');
  assert.equal(await asksAboutDatasets(topic, user), true, 'the library holds a matching passage');
  assert.equal(await asksAboutDatasets('hello, how are you?', user), false);
});

test('public library: a whole library file is readable for whole-document analysis, with page marks', async () => {
  const doc = await db.repositoryFile.findFirst({ where: { repositoryId: repo.id, path: 'Agriculture/2024/summary.pdf' } });
  const full = await knowledgeService.assistantFullText(user, doc.id);
  assert.equal(full.repository, 'Agriculture Survey');
  assert.match(full.text, /irrigation[\s\S]*-- 1 of 1 --/);
  await assert.rejects(knowledgeService.assistantFullText(user, salaries.id), /not available to the assistant/);
  const { analyzeDocument } = await import('../server/services/ai/tools/documentTools.js');
  const seen: string[] = [];
  const out = await analyzeDocument.execute({ fileId: doc.id, task: 'What improved the harvest?' }, {
    userId: user, files: { read: async () => { const e: any = new Error('nf'); e.code = 'not_found'; throw e; } },
    services: { llm: { complete: async (r: any) => { seen.push(r.prompt); return 'Irrigation improved the maize harvest in Gasabo (p. 1).'; } }, datasets: { fullText: (u: string, id: string) => knowledgeService.assistantFullText(u, id) } },
  } as any);
  assert.ok(!out.isError, out.text);
  assert.match(out.text, /Agriculture Survey\/Agriculture\/2024\/summary\.pdf/);
  assert.match(out.text, /Irrigation improved .*\(p\. 1\)/);
  assert.match(seen[0], /\[Page 1\]/);
});

test('switching the dataset off hides it from other users\' assistants; the owner keeps access', async () => {
  await knowledgeService.updateRepository(admin, repo.id, { settings: { assistant: false } });
  assert.ok(!(await knowledgeService.assistantCatalog(user)).some((d) => d.id === repo.id));
  await assert.rejects(knowledgeService.assistantRead(user, yields.id), /not found/i);
  assert.ok(!(await publishedKnowledgeBaseIds()).includes(repo.knowledgeBaseId), 'its knowledge base leaves the published set, so search stops returning it');
  assert.ok((await knowledgeService.assistantCatalog(admin)).some((d) => d.id === repo.id), 'the owner still sees it');
  await knowledgeService.updateRepository(admin, repo.id, { settings: { assistant: true } });
});
