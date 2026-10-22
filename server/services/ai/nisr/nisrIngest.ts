import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { rankKnowledgeChunks } from '../../KnowledgeRetrievalService.js';
import { normalizeCsv, normalizeJson, normalizeText, normalizeXlsx, type NisrPassage, type NisrRecord, type NisrTableMapping } from './nisrNormalize.js';

export type { NisrRecord, NisrPassage, NisrTableMapping } from './nisrNormalize.js';

export type NisrFormat = 'csv' | 'json' | 'xlsx' | 'text';

/** One entry in data/nisr/manifest.json. See data/nisr/README.md. */
export interface NisrManifestItem {
  id: string;
  title: string;
  organization: string;
  sourceUrl: string;
  publicationDate: string;
  referencePeriod: string;
  geographicCoverage: string;
  license: string;
  format: NisrFormat;
  /** Path relative to the data directory, inside raw/. */
  file: string;
  /** "sha256:<hex>" of the raw file. */
  checksum: string;
  /** Approval seam: only approved datasets are indexed. Defaults to approved unless NISR_REQUIRE_APPROVAL=true. */
  status?: 'approved' | 'pending' | 'rejected';
  methodology?: string;
  units?: string;
  notes?: string;
  table?: NisrTableMapping;
}

export interface NisrManifest {
  schemaVersion: number;
  datasets: NisrManifestItem[];
}

export type NisrDatasetMeta = Omit<NisrManifestItem, 'table' | 'checksum'> & {
  checksum: string;
  ingestion: { status: 'indexed' | 'failed' | 'skipped'; recordCount: number; passageCount: number; warnings: string[]; error?: string };
};

export interface NisrIndex {
  formatVersion: 1;
  indexVersion: string;
  builtAt: string;
  durationMs: number;
  datasets: NisrDatasetMeta[];
  records: NisrRecord[];
  passages: NisrPassage[];
}

export interface NisrCitation {
  datasetId: string;
  title: string;
  organization: string;
  referencePeriod: string;
  publicationDate: string;
  sourceUrl: string;
  /** Repository-relative source file, e.g. data/nisr/raw/x.csv. */
  source: string;
  row?: number;
  passage?: number;
}

export interface NisrSearchHit {
  kind: 'record' | 'passage';
  text: string;
  score: number;
  citation: NisrCitation;
  record?: NisrRecord;
}

export interface NisrQuery {
  datasetId?: string;
  indicator?: string;
  geography?: string;
  period?: string;
  limit?: number;
}

export interface NisrBuildOptions {
  force?: boolean;
  /** Fill in missing checksums in the manifest (explicit, operator-run action). Mismatches are never overwritten. */
  writeChecksums?: boolean;
  log?: (msg: string) => void;
}

const REQUIRED: Array<keyof NisrManifestItem> = ['id', 'title', 'organization', 'sourceUrl', 'publicationDate', 'referencePeriod', 'geographicCoverage', 'license', 'format', 'file'];
const FORMATS: NisrFormat[] = ['csv', 'json', 'xlsx', 'text'];
const ID = /^[a-z0-9][a-z0-9._-]{1,80}$/;

/** True when a question is likely about published statistics, so NISR retrieval is worth running. */
export function isStatisticsQuery(query: string): boolean {
  return /\b(nisr|statistic\w*|census|survey|eicv|dhs|labou?r force|lfs|population|household|gdp|inflation|cpi|consumer price|unemploy\w*|employment|poverty|literacy|enrol+ment|fertility|mortality|life expectancy|district|province|percentage|rate of|how many|number of|growth|indicator|ibarura|abaturage|imibare|ubukene)\b/i.test(query);
}

const fold = (s: string | null | undefined) => (s ?? '').normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().trim();

/**
 * NISR (National Institute of Statistics of Rwanda) dataset pipeline:
 * manifest validation -> checksum verification -> normalization -> versioned index on disk -> retrieval and filtered queries.
 * The index is rebuilt by an explicit command or admin endpoint, never ad hoc during an answer.
 */
export class NisrIngestionPipeline {
  readonly dataDir: string;
  readonly indexDir: string;
  private cache: { index: NisrIndex; mtimeMs: number } | null = null;

  constructor(dataDir?: string, indexDir?: string) {
    this.dataDir = path.resolve(dataDir ?? process.env.NISR_DATA_DIR ?? path.join(process.cwd(), 'data', 'nisr'));
    this.indexDir = path.resolve(indexDir ?? process.env.NISR_INDEX_DIR ?? path.join(this.dataDir, 'index'));
  }

  private get indexPath() { return path.join(this.indexDir, 'nisr-index.json'); }
  private get manifestPath() { return path.join(this.dataDir, 'manifest.json'); }

  async loadManifest(): Promise<NisrManifest> {
    let raw: string;
    try {
      raw = await fs.readFile(this.manifestPath, 'utf-8');
    } catch {
      return { schemaVersion: 1, datasets: [] };
    }
    const parsed = JSON.parse(raw);
    return { schemaVersion: Number(parsed.schemaVersion ?? 1), datasets: Array.isArray(parsed.datasets) ? parsed.datasets : [] };
  }

  /** Structural validation of the manifest. Returns human-readable problems (empty = valid). */
  validateManifest(manifest: NisrManifest): string[] {
    const problems: string[] = [];
    const seen = new Set<string>();
    manifest.datasets.forEach((d, i) => {
      const where = `datasets[${i}]${d?.id ? ` (${d.id})` : ''}`;
      for (const k of REQUIRED) if (!d?.[k] || typeof d[k] !== 'string') problems.push(`${where}: missing ${k}`);
      if (d?.id && !ID.test(d.id)) problems.push(`${where}: id must be lowercase letters, digits, ".", "_" or "-"`);
      if (d?.id && seen.has(d.id)) problems.push(`${where}: duplicate id`);
      seen.add(d?.id);
      if (d?.format && !FORMATS.includes(d.format)) problems.push(`${where}: format must be one of ${FORMATS.join(', ')}`);
      if (d?.format && d.format !== 'text' && !d.table) problems.push(`${where}: tabular formats need a "table" mapping`);
      if (d?.sourceUrl && !/^https?:\/\//.test(d.sourceUrl)) problems.push(`${where}: sourceUrl must be http(s)`);
      if (d?.checksum && !/^sha256:[a-f0-9]{64}$/.test(d.checksum)) problems.push(`${where}: checksum must be "sha256:<64 hex>"`);
      if (d?.file) {
        try { this.resolveRawFile(d.file); } catch (e) { problems.push(`${where}: ${(e as Error).message}`); }
      }
    });
    return problems;
  }

  /** Resolves a manifest file path, refusing anything outside data/nisr/raw (path traversal, absolute paths). */
  resolveRawFile(file: string): string {
    const rawDir = path.join(this.dataDir, 'raw');
    const resolved = path.resolve(this.dataDir, file);
    if (path.isAbsolute(file) || !resolved.startsWith(rawDir + path.sep)) throw new Error('file must be a relative path inside raw/');
    return resolved;
  }

  private async sha256(file: string): Promise<string> {
    return `sha256:${createHash('sha256').update(await fs.readFile(file)).digest('hex')}`;
  }

  /** Builds the index. Idempotent: if the manifest and every file checksum are unchanged, the existing index is kept. */
  async buildIndex(opts: NisrBuildOptions = {}): Promise<{ index: NisrIndex; rebuilt: boolean; problems: string[] }> {
    const log = opts.log ?? (() => {});
    const started = Date.now();
    const manifest = await this.loadManifest();
    const problems = this.validateManifest(manifest);
    const requireApproval = process.env.NISR_REQUIRE_APPROVAL === 'true';
    const maxBytes = Number(process.env.NISR_MAX_FILE_MB ?? 50) * 1024 * 1024;
    const maxRows = Number(process.env.NISR_MAX_ROWS ?? 200_000);

    // Checksums first, so the version reflects file contents.
    const actual = new Map<string, string>();
    let manifestChanged = false;
    for (const d of manifest.datasets) {
      try {
        const file = this.resolveRawFile(d.file);
        const real = await fs.realpath(file);
        if (!real.startsWith(path.join(await fs.realpath(this.dataDir), 'raw') + path.sep)) throw new Error('file resolves outside raw/ (symlink)');
        const stat = await fs.stat(real);
        if (stat.size > maxBytes) throw new Error(`file is ${stat.size} bytes; limit is ${maxBytes}`);
        const sum = await this.sha256(real);
        actual.set(d.id, sum);
        if (!d.checksum && opts.writeChecksums) { d.checksum = sum; manifestChanged = true; log(`checksum recorded for ${d.id}`); }
      } catch (e) {
        actual.set(d.id, `error:${(e as Error).message}`);
      }
    }
    if (manifestChanged) await this.writeAtomic(this.manifestPath, JSON.stringify(manifest, null, 2) + '\n');

    const indexVersion = createHash('sha256')
      .update(JSON.stringify({ formatVersion: 1, manifest, checksums: [...actual.entries()].sort(), requireApproval }))
      .digest('hex').slice(0, 16);

    const existing = await this.loadIndex();
    if (!opts.force && existing?.indexVersion === indexVersion) {
      log(`index ${indexVersion} is up to date (${existing.records.length} records, ${existing.passages.length} passages)`);
      return { index: existing, rebuilt: false, problems };
    }

    const datasets: NisrDatasetMeta[] = [];
    const records: NisrRecord[] = [];
    const passages: NisrPassage[] = [];
    for (const d of manifest.datasets) {
      const { table: _table, ...meta } = d;
      const ingestion: NisrDatasetMeta['ingestion'] = { status: 'skipped', recordCount: 0, passageCount: 0, warnings: [] };
      datasets.push({ ...meta, checksum: d.checksum ?? '', ingestion });
      const status = d.status ?? (requireApproval ? 'pending' : 'approved');
      const ownProblems = problems.filter((p) => p.includes(`(${d.id})`));
      if (status !== 'approved') { ingestion.error = `status is ${status}`; continue; }
      if (ownProblems.length) { ingestion.status = 'failed'; ingestion.error = ownProblems.join('; '); continue; }
      const sum = actual.get(d.id) ?? '';
      if (sum.startsWith('error:')) { ingestion.status = 'failed'; ingestion.error = sum.slice(6); continue; }
      if (!d.checksum) { ingestion.status = 'failed'; ingestion.error = 'no checksum in manifest (run the index command with --write-checksums)'; continue; }
      if (d.checksum !== sum) { ingestion.status = 'failed'; ingestion.error = 'checksum mismatch: the file changed since it was recorded'; continue; }
      try {
        const file = this.resolveRawFile(d.file);
        if (d.format === 'text') {
          const r = normalizeText(d.id, await fs.readFile(file, 'utf-8'));
          passages.push(...r.items);
          ingestion.passageCount = r.items.length;
          ingestion.warnings.push(...r.warnings);
        } else {
          const r = d.format === 'csv' ? normalizeCsv(d.id, await fs.readFile(file, 'utf-8'), d.table!, maxRows)
            : d.format === 'json' ? normalizeJson(d.id, await fs.readFile(file, 'utf-8'), d.table!, maxRows)
              : await normalizeXlsx(d.id, await fs.readFile(file), d.table!, maxRows);
          records.push(...r.items);
          ingestion.recordCount = r.items.length;
          ingestion.warnings.push(...r.warnings);
        }
        ingestion.status = 'indexed';
        log(`indexed ${d.id}: ${ingestion.recordCount} records, ${ingestion.passageCount} passages`);
      } catch (e) {
        ingestion.status = 'failed';
        ingestion.error = (e as Error).message.slice(0, 300);
        log(`FAILED ${d.id}: ${ingestion.error}`);
      }
    }

    const index: NisrIndex = { formatVersion: 1, indexVersion, builtAt: new Date().toISOString(), durationMs: Date.now() - started, datasets, records, passages };
    await fs.mkdir(this.indexDir, { recursive: true });
    await this.writeAtomic(this.indexPath, JSON.stringify(index));
    this.cache = null;
    log(`index ${indexVersion} written: ${records.length} records, ${passages.length} passages`);
    return { index, rebuilt: true, problems };
  }

  private async writeAtomic(file: string, content: string) {
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, content, 'utf-8');
    await fs.rename(tmp, file);
  }

  /** Loads the built index (cached until the file changes). Returns null if it has not been built. */
  async loadIndex(): Promise<NisrIndex | null> {
    try {
      const stat = await fs.stat(this.indexPath);
      if (this.cache && this.cache.mtimeMs === stat.mtimeMs) return this.cache.index;
      const index = JSON.parse(await fs.readFile(this.indexPath, 'utf-8')) as NisrIndex;
      if (index.formatVersion !== 1) return null;
      this.cache = { index, mtimeMs: stat.mtimeMs };
      return index;
    } catch {
      return null;
    }
  }

  async status() {
    const [manifest, index] = await Promise.all([this.loadManifest(), this.loadIndex()]);
    return {
      manifestDatasets: manifest.datasets.length,
      manifestProblems: this.validateManifest(manifest),
      index: index
        ? { indexVersion: index.indexVersion, builtAt: index.builtAt, durationMs: index.durationMs, records: index.records.length, passages: index.passages.length, datasets: index.datasets.map((d) => ({ id: d.id, title: d.title, referencePeriod: d.referencePeriod, ...d.ingestion })) }
        : null,
    };
  }

  private citation(meta: NisrDatasetMeta, extra: Partial<NisrCitation> = {}): NisrCitation {
    return {
      datasetId: meta.id, title: meta.title, organization: meta.organization, referencePeriod: meta.referencePeriod,
      publicationDate: meta.publicationDate, sourceUrl: meta.sourceUrl, source: path.posix.join('data/nisr', meta.file), ...extra,
    };
  }

  static formatRecord(r: NisrRecord): string {
    const dims = Object.entries(r.dimensions).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(', ');
    const value = r.missing ? `not available in source (${r.valueText || 'blank'})` : `${r.value}${r.unit ? ` ${r.unit}` : ''}`;
    return [`Indicator: ${r.indicator}`, r.geography && `Geography: ${r.geography}`, r.period && `Period: ${r.period}`, dims, `Value: ${value}`].filter(Boolean).join(' | ');
  }

  /** Keyword retrieval over indexed records and report passages. Returns [] when the index is missing or nothing matches. */
  async search(query: string, limit = 6): Promise<NisrSearchHit[]> {
    const index = await this.loadIndex();
    if (!index) return [];
    const meta = new Map(index.datasets.map((d) => [d.id, d]));
    type Doc = { text: string; hit: Omit<NisrSearchHit, 'score'> };
    const docs: Doc[] = [];
    for (const r of index.records) {
      const m = meta.get(r.datasetId);
      if (!m) continue;
      const text = NisrIngestionPipeline.formatRecord(r);
      docs.push({ text: `${text} ${m.title} ${m.referencePeriod}`, hit: { kind: 'record', text, citation: this.citation(m, { row: r.row }), record: r } });
    }
    for (const p of index.passages) {
      const m = meta.get(p.datasetId);
      if (!m) continue;
      docs.push({ text: `${m.title}\n${p.text}`, hit: { kind: 'passage', text: p.text, citation: this.citation(m, { passage: p.index }) } });
    }
    return rankKnowledgeChunks(docs, query, { limit, threshold: 0.3 }).map((r) => ({ ...r.chunk.hit, score: r.score }));
  }

  /** Deterministic filter over structured records (case- and accent-insensitive exact match on each given field). */
  async query(q: NisrQuery): Promise<{ records: NisrRecord[]; datasets: NisrCitation[]; truncated: boolean }> {
    const index = await this.loadIndex();
    if (!index) return { records: [], datasets: [], truncated: false };
    const limit = Math.min(Math.max(q.limit ?? 500, 1), 5000);
    const matches = index.records.filter((r) =>
      (!q.datasetId || r.datasetId === q.datasetId) &&
      (!q.indicator || fold(r.indicator) === fold(q.indicator)) &&
      (!q.geography || fold(r.geography) === fold(q.geography)) &&
      (!q.period || fold(r.period) === fold(q.period)));
    const ids = new Set(matches.map((r) => r.datasetId));
    const datasets = index.datasets.filter((d) => ids.has(d.id)).map((d) => this.citation(d));
    return { records: matches.slice(0, limit), datasets, truncated: matches.length > limit };
  }
}
