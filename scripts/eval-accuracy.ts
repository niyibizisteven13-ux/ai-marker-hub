/**
 * How well is handwriting read, and what is each step worth?
 *
 *   npm run eval:accuracy                         real pages in evals/handwriting, as they are
 *   npm run eval:accuracy -- --degrade            also under phone-photo conditions, with and without the cleanup
 *   npm run eval:accuracy -- --chat               through the chat path (what a user's photo gets) instead of the marking pipeline
 *   npm run eval:accuracy -- --degrade --conditions desk_shadow,dim,blurred
 *   npm run eval:accuracy -- --limit 5            only the first 5 pages (each reading costs a model call)
 *
 * Pages: evals/handwriting/<name>.jpg + <name>.txt (the exact text), and optionally <name>.json:
 *   { "tags": ["pencil", "maths"], "language": "rw" }
 * Tags and language are only labels for the report; they change nothing about how a page is read.
 * See evals/handwriting/README.md.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { readingTarget, userChatAvailable } from '../server/services/AiService.js';
import { documentText, processDocument } from '../server/services/documents/pipeline.js';
import { enhancePhoto } from '../server/services/documents/photo.js';
import { CONDITIONS, formatReport, runCases, type Condition, type EvalCase, type Reader } from '../server/services/documents/evalKit.js';
import { shutdownOcr } from '../server/services/documents/ocr.js';

const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const flag = (name: string) => process.argv.includes(name);
const dir = path.resolve(arg('--dir') ?? 'evals/handwriting');

const CHAT_SYSTEM = 'You read handwriting. Transcribe exactly what is written on the page, in reading order, keeping the writer\'s own spelling and layout. Do not correct, summarise or comment. Mark a word you cannot read as [unclear]. Reply with the transcription only.';

async function main() {
  if (!userChatAvailable()) { console.error('No vision model configured. Set ANTHROPIC_API_KEY (or the provider your deployment uses).'); process.exit(2); }
  const target = readingTarget();
  const limit = Number(arg('--limit')) || Infinity;
  const names = (await fs.readdir(dir)).filter((f) => /\.(png|jpe?g|webp|tiff?)$/i.test(f)).sort().slice(0, limit);
  if (!names.length) { console.log(`No page images in ${dir}. See evals/handwriting/README.md.`); return; }

  const cases: EvalCase[] = [];
  for (const f of names) {
    const base = f.replace(/\.[^.]+$/, '');
    const truth = await fs.readFile(path.join(dir, `${base}.txt`), 'utf8').catch(() => null);
    if (truth === null) { console.warn(`skip ${f}: no ${base}.txt`); continue; }
    const meta = await fs.readFile(path.join(dir, `${base}.json`), 'utf8').then(JSON.parse).catch(() => ({}));
    cases.push({ name: f, image: await fs.readFile(path.join(dir, f)), truth, tags: Array.isArray(meta.tags) ? meta.tags.map(String) : [], language: typeof meta.language === 'string' ? meta.language : undefined });
  }

  const reader: Reader = flag('--chat')
    ? async (image, { cleanup }) => {
        // What a user's photo goes through in chat: the cleanup (when on), then a plain transcription request.
        const enh = cleanup ? await enhancePhoto(image) : null;
        const sent = enh?.jpeg ?? image;
        const mime = enh?.jpeg ? 'image/jpeg' : /^\x89PNG/.test(sent.subarray(0, 4).toString('latin1')) ? 'image/png' : 'image/jpeg';
        let text = '';
        for await (const c of target.adapter.stream({
          model: target.model, temperature: 0, maxTokens: 8000,
          messages: [{ role: 'system', content: CHAT_SYSTEM }, { role: 'user', content: [{ type: 'text', text: 'Transcribe this page.' }, { type: 'image_url', image_url: { url: `data:${mime};base64,${sent.toString('base64')}` } }] }] as any,
        })) if (c.type === 'text') text += c.text;
        return text;
      }
    : async (image, { cleanup }) => {
        const r = await processDocument(image, 'page.jpg', { adapter: target.adapter, model: target.model, fallbackModel: null }, { crossCheck: false, forceRecognition: true, cleanup });
        return documentText(r).replace(/^--- Page \d+ ---\n/gm, '').replace(/~~/g, '');
      };

  const wanted = (arg('--conditions') ?? '').split(',').map((s) => s.trim()).filter(Boolean) as Condition[];
  const conditions: Condition[] = flag('--degrade') ? ['clean', ...(wanted.length ? wanted : CONDITIONS.filter((c) => c !== 'clean'))] : ['clean'];
  for (const c of conditions) if (!CONDITIONS.includes(c)) { console.error(`Unknown condition "${c}". Use: ${CONDITIONS.join(', ')}`); process.exit(2); }
  const modes = flag('--degrade') ? [false, true] : [true];

  const calls = cases.length * conditions.reduce((n, c) => n + (c === 'clean' ? 1 : modes.length), 0);
  console.log(`${cases.length} page(s), ${conditions.length} condition(s), ${calls} model reading(s) via the ${flag('--chat') ? 'chat' : 'marking pipeline'} path with ${target.model}.`);
  const rows = await runCases(cases, reader, { conditions, modes });
  console.log(formatReport(rows));
  await fs.mkdir('evals/reports', { recursive: true });
  const out = `evals/reports/accuracy-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  await fs.writeFile(out, JSON.stringify({ path: flag('--chat') ? 'chat' : 'pipeline', model: target.model, rows }, null, 2));
  console.log(`\nReport: ${out}`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); }).finally(() => shutdownOcr());
