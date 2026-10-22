/**
 * Validate data/nisr/manifest.json and (re)build the NISR retrieval index.
 *
 *   npm run nisr:index                         build if anything changed (idempotent)
 *   npm run nisr:index -- --force              rebuild even if unchanged
 *   npm run nisr:index -- --write-checksums    record sha256 for datasets that have none yet
 *   npm run nisr:validate                      validate the manifest only; exit 1 on problems
 *
 * NISR_DATA_DIR / NISR_INDEX_DIR override the default data/nisr and data/nisr/index locations.
 */
import { NisrIngestionPipeline } from '../server/services/ai/nisr/nisrIngest.js';

const args = new Set(process.argv.slice(2));
const pipeline = new NisrIngestionPipeline();

async function main() {
  const manifest = await pipeline.loadManifest();
  const problems = pipeline.validateManifest(manifest);
  console.log(`[nisr] ${manifest.datasets.length} dataset(s) in ${pipeline.dataDir}/manifest.json`);
  for (const p of problems) console.log(`[nisr] problem: ${p}`);

  if (args.has('--validate')) {
    process.exit(problems.length ? 1 : 0);
  }

  const { index, rebuilt } = await pipeline.buildIndex({
    force: args.has('--force'),
    writeChecksums: args.has('--write-checksums'),
    log: (m) => console.log(`[nisr] ${m}`),
  });
  const failed = index.datasets.filter((d) => d.ingestion.status === 'failed');
  for (const d of index.datasets) {
    console.log(`[nisr] ${d.id}: ${d.ingestion.status}${d.ingestion.error ? ` (${d.ingestion.error})` : ''}${d.ingestion.warnings.length ? ` warnings: ${d.ingestion.warnings.join(' ')}` : ''}`);
  }
  console.log(`[nisr] index ${index.indexVersion} ${rebuilt ? 'built' : 'unchanged'} at ${index.builtAt}: ${index.records.length} records, ${index.passages.length} passages`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(`[nisr] failed: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
