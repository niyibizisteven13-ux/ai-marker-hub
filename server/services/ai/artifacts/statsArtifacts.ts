import { NisrIngestionPipeline, type NisrCitation, type NisrQuery, type NisrRecord } from '../nisr/nisrIngest.js';
import { DeterministicTools, type DescriptiveStats } from '../tools/deterministicTools.js';
import { ARTIFACT_SCHEMA_VERSION, validateArtifact, type Artifact, type ChartType } from './artifactSchema.js';

export interface StatsQueryResult {
  query: NisrQuery;
  records: NisrRecord[];
  truncated: boolean;
  /** Computed in code over non-missing values only; missing values are counted, never treated as 0. */
  stats: DescriptiveStats | null;
  units: string[];
  change?: { from: string; to: string; fromValue: number; toValue: number; absolute: number; percent: number | null; formula: string };
  artifacts: Artifact[];
  sources: NisrCitation[];
  warnings: string[];
}

const tools = new DeterministicTools();

function periodSort(a: string | null, b: string | null) {
  return String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true });
}

/**
 * Runs a deterministic NISR query and returns numbers computed in code plus validated chart/table artifacts.
 * No model is involved; an LLM may explain these results but must not change them.
 */
export async function buildStatsQuery(pipeline: NisrIngestionPipeline, q: NisrQuery & { chartType?: ChartType }): Promise<StatsQueryResult> {
  const { records, datasets, truncated } = await pipeline.query(q);
  const warnings: string[] = [];
  if (!records.length) {
    return { query: q, records, truncated, stats: null, units: [], artifacts: [], sources: [], warnings: ['No indexed NISR records match this query. The index may not contain this indicator, geography or period.'] };
  }
  if (truncated) warnings.push('Result was truncated; narrow the query for complete statistics.');

  const units = [...new Set(records.map((r) => r.unit ?? ''))].filter(Boolean);
  const mixedUnits = units.length > 1;
  const indicators = new Set(records.map((r) => r.indicator));
  if (mixedUnits) warnings.push(`Records use different units (${units.join(', ')}); summary statistics were not computed across them.`);
  if (indicators.size > 1) warnings.push(`Records cover ${indicators.size} different indicators; summary statistics were not computed across them.`);

  const comparable = !mixedUnits && indicators.size === 1 && datasets.length === 1;
  const stats = comparable ? tools.calculateStats(records.map((r) => r.value), units[0]).stats : null;
  const missing = records.filter((r) => r.missing).length;
  if (missing) warnings.push(`${missing} record(s) have no value in the source and were excluded from calculations.`);

  // Change between first and last period for a single series (one indicator, one geography, one unit).
  let change: StatsQueryResult['change'];
  const geos = new Set(records.map((r) => r.geography));
  const series = records.filter((r) => !r.missing && r.period).sort((a, b) => periodSort(a.period, b.period));
  if (comparable && geos.size === 1 && series.length >= 2 && new Set(series.map((r) => r.period)).size === series.length) {
    const first = series[0];
    const last = series[series.length - 1];
    const pc = first.value === 0 ? null : Number((((last.value! - first.value!) / Math.abs(first.value!)) * 100).toFixed(4));
    change = {
      from: first.period!, to: last.period!, fromValue: first.value!, toValue: last.value!,
      absolute: Number((last.value! - first.value!).toFixed(10)), percent: pc,
      formula: pc === null ? 'percent change undefined: starting value is 0' : `(${last.value} - ${first.value}) / |${first.value}| × 100`,
    };
  }

  const source = datasets.length === 1
    ? { organization: datasets[0].organization, dataset: datasets[0].title, period: datasets[0].referencePeriod, reference: datasets[0].sourceUrl }
    : undefined;
  if (datasets.length > 1) warnings.push('Records come from more than one dataset; check each source before comparing values.');

  const artifacts: Artifact[] = [];
  const dimKeys = [...new Set(records.flatMap((r) => Object.keys(r.dimensions)))];
  artifacts.push(validateArtifact({
    type: 'table', schemaVersion: ARTIFACT_SCHEMA_VERSION,
    title: indicators.size === 1 ? [...indicators][0] : 'NISR records',
    columns: [
      { key: 'indicator', label: 'Indicator' }, { key: 'geography', label: 'Geography' }, { key: 'period', label: 'Period' },
      ...dimKeys.map((k, i) => ({ key: `dim${i}`, label: k })),
      { key: 'value', label: 'Value', ...(units.length === 1 ? { unit: units[0] } : {}) }, { key: 'unit', label: 'Unit' }, { key: 'sourceRow', label: 'Source row' },
    ],
    rows: records.slice(0, 1000).map((r) => ({
      indicator: r.indicator, geography: r.geography, period: r.period,
      ...Object.fromEntries(dimKeys.map((k, i) => [`dim${i}`, r.dimensions[k] ?? null])),
      value: r.value, unit: r.unit, sourceRow: `${r.datasetId}#${r.row}`,
    })),
    ...(source ? { source } : {}),
    ...(missing ? { notes: ['Empty values are missing in the source, not zero.'] } : {}),
  }));

  // A chart only when it is meaningful: one indicator and unit, one value per x position.
  if (comparable && records.length <= 200) {
    const byGeo = geos.size > 1;
    const xKey = byGeo ? 'geography' : 'period';
    const xs = records.map((r) => (byGeo ? r.geography : r.period));
    const singlePeriod = new Set(records.map((r) => r.period)).size === 1;
    if (xs.every(Boolean) && new Set(xs).size === xs.length && (!byGeo || singlePeriod)) {
      const chartType: ChartType = q.chartType ?? (byGeo ? 'bar' : 'line');
      const rows = [...records].sort((a, b) => (byGeo ? 0 : periodSort(a.period, b.period)));
      try {
        artifacts.push(validateArtifact({
          type: 'chart', schemaVersion: ARTIFACT_SCHEMA_VERSION, chartType,
          title: `${[...indicators][0]}${byGeo ? ` by geography, ${records[0].period ?? ''}` : ` over time${records[0].geography ? `, ${records[0].geography}` : ''}`}`.trim(),
          xKey, series: [{ dataKey: 'value', label: [...indicators][0].slice(0, 120) }],
          data: rows.map((r) => ({ [xKey]: (byGeo ? r.geography : r.period) as string, value: r.value })),
          ...(units[0] ? { unit: units[0] } : {}),
          ...(source ? { source } : {}),
          ...(missing ? { notes: ['Null points are missing in the source, not zero.'] } : {}),
        }));
      } catch (e) {
        warnings.push(`Chart not produced: ${(e as Error).message.slice(0, 200)}`);
      }
    }
  }

  return { query: q, records, truncated, stats, units, change, artifacts, sources: datasets, warnings };
}
