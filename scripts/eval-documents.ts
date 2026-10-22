/**
 * Runs the document pipeline on evals/handwriting/* and scores it against ground-truth .txt files.
 * Reports CER/WER per file and overall, review-flag rates, time and tokens. See evals/handwriting/README.md.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { agentTarget } from '../server/services/AiService.js';
import { processDocument, documentText } from '../server/services/documents/pipeline.js';
import { characterErrorRate, wordErrorRate } from '../server/services/documents/metrics.js';
import { tesseractOcr, shutdownOcr } from '../server/services/documents/ocr.js';

const dir = path.resolve('evals/handwriting');
const useOcr = !process.argv.includes('--no-ocr');

async function main() {
  const target = agentTarget();
  if (target.provider !== 'anthropic' && process.env.DOC_VISION_GONKA !== 'true') {
    console.error('No vision model configured. Set AI_AGENT_PROVIDER=anthropic and ANTHROPIC_API_KEY (or DOC_VISION_GONKA=true).');
    process.exit(2);
  }
  const files = (await fs.readdir(dir)).filter((f) => /\.(png|jpe?g|webp|tiff?|pdf)$/i.test(f)).sort();
  if (!files.length) { console.log(`No pages in ${dir}. See README.md there.`); return; }
  const rows = [];
  let cerNum = 0, cerDen = 0, werNum = 0, werDen = 0;
  for (const f of files) {
    const truthPath = path.join(dir, f.replace(/\.[^.]+$/, '.txt'));
    const truth = await fs.readFile(truthPath, 'utf8').catch(() => null);
    if (truth === null) { console.warn(`skip ${f}: no ${path.basename(truthPath)}`); continue; }
    const started = Date.now();
    const result = await processDocument(await fs.readFile(path.join(dir, f)), f, { adapter: target.adapter, model: process.env.DOC_VISION_MODEL || target.model, fallbackModel: null, ocr: useOcr ? tesseractOcr : undefined }, { crossCheck: useOcr, forceRecognition: true });
    const hyp = documentText(result).replace(/^--- Page \d+ ---\n/gm, '').replace(/~~/g, '');
    const cer = characterErrorRate(truth, hyp);
    const wer = wordErrorRate(truth, hyp);
    cerNum += cer.substitutions + cer.deletions + cer.insertions; cerDen += cer.reference;
    werNum += wer.substitutions + wer.deletions + wer.insertions; werDen += wer.reference;
    const els = result.pages.flatMap((p) => p.elements);
    const row = {
      file: f, pages: result.pages.length, cer: cer.rate, wer: wer.rate, cerDetail: cer, werDetail: wer,
      elements: els.length, flagged: els.filter((e) => e.needsReview).length,
      ocrCorroborated: els.filter((e) => e.checks.ocr?.status === 'corroborated').length, ocrConflict: els.filter((e) => e.checks.ocr?.status === 'conflict').length,
      seconds: Math.round((Date.now() - started) / 100) / 10, usage: result.usage,
    };
    rows.push(row);
    console.log(`${f}: CER ${(cer.rate! * 100).toFixed(2)}%  WER ${(wer.rate! * 100).toFixed(2)}%  flagged ${row.flagged}/${row.elements}  ${row.seconds}s`);
  }
  const summary = { files: rows.length, cer: cerDen ? cerNum / cerDen : null, wer: werDen ? werNum / werDen : null, model: process.env.DOC_VISION_MODEL || target.model, ocrCrossCheck: useOcr };
  console.log(`Overall: CER ${summary.cer === null ? 'n/a' : (summary.cer * 100).toFixed(2) + '%'}  WER ${summary.wer === null ? 'n/a' : (summary.wer * 100).toFixed(2) + '%'} over ${rows.length} file(s)`);
  await fs.mkdir('evals/reports', { recursive: true });
  const out = `evals/reports/handwriting-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  await fs.writeFile(out, JSON.stringify({ summary, rows }, null, 2));
  console.log(`Report: ${out}`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); }).finally(() => shutdownOcr());
