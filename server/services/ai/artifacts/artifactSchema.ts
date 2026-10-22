import * as AjvNs from 'ajv';

type AjvCtor = typeof import('ajv').default;
// Ajv is CommonJS with a default export; unwrap it for NodeNext ESM.
const Ajv: AjvCtor = ((AjvNs as any).default?.default ?? (AjvNs as any).default ?? AjvNs) as AjvCtor;

export const ARTIFACT_SCHEMA_VERSION = '1';

export type ChartType = 'bar' | 'line' | 'pie' | 'scatter' | 'histogram';

export interface ArtifactSource {
  organization: string;
  dataset: string;
  period?: string;
  reference: string;
}

export interface ChartArtifact {
  type: 'chart';
  schemaVersion: string;
  chartType: ChartType;
  title: string;
  xKey: string;
  series: Array<{ dataKey: string; label: string }>;
  data: Array<Record<string, string | number | null>>;
  unit?: string;
  source?: ArtifactSource;
  notes?: string[];
}

export interface TableArtifact {
  type: 'table';
  schemaVersion: string;
  title: string;
  columns: Array<{ key: string; label: string; unit?: string }>;
  rows: Array<Record<string, string | number | null>>;
  source?: ArtifactSource;
  notes?: string[];
}

export type Artifact = ChartArtifact | TableArtifact;

const MAX_ROWS = 1000;
const KEY = { type: 'string', pattern: '^[A-Za-z0-9_.-]{1,64}$' };
const TEXT = (max: number) => ({ type: 'string', minLength: 1, maxLength: max });
const CELL = { type: ['string', 'number', 'null'], maxLength: 500 };
const SOURCE = {
  type: 'object', additionalProperties: false, required: ['organization', 'dataset', 'reference'],
  properties: { organization: TEXT(200), dataset: TEXT(300), period: TEXT(100), reference: TEXT(500) },
};

const chartSchema = {
  type: 'object', additionalProperties: false,
  required: ['type', 'schemaVersion', 'chartType', 'title', 'xKey', 'series', 'data'],
  properties: {
    type: { const: 'chart' },
    schemaVersion: { const: ARTIFACT_SCHEMA_VERSION },
    chartType: { enum: ['bar', 'line', 'pie', 'scatter', 'histogram'] },
    title: TEXT(200),
    xKey: KEY,
    series: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'object', additionalProperties: false, required: ['dataKey', 'label'], properties: { dataKey: KEY, label: TEXT(120) } } },
    data: { type: 'array', minItems: 1, maxItems: MAX_ROWS, items: { type: 'object', propertyNames: KEY, additionalProperties: CELL } },
    unit: TEXT(60),
    source: SOURCE,
    notes: { type: 'array', maxItems: 20, items: TEXT(500) },
  },
};

const tableSchema = {
  type: 'object', additionalProperties: false,
  required: ['type', 'schemaVersion', 'title', 'columns', 'rows'],
  properties: {
    type: { const: 'table' },
    schemaVersion: { const: ARTIFACT_SCHEMA_VERSION },
    title: TEXT(200),
    columns: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'object', additionalProperties: false, required: ['key', 'label'], properties: { key: KEY, label: TEXT(120), unit: TEXT(60) } } },
    rows: { type: 'array', maxItems: MAX_ROWS, items: { type: 'object', propertyNames: KEY, additionalProperties: CELL } },
    source: SOURCE,
    notes: { type: 'array', maxItems: 20, items: TEXT(500) },
  },
};

const ajv = new Ajv({ allErrors: true, strict: false });
const validateChartSchema = ajv.compile(chartSchema);
const validateTableSchema = ajv.compile(tableSchema);

export class ArtifactValidationError extends Error {
  constructor(public problems: string[]) {
    super(`Invalid artifact: ${problems.join('; ')}`);
  }
}

/**
 * Validates an artifact (from code or from model output) before it is returned to a client.
 * Beyond the JSON schema: chart keys must exist in the data, numeric series must be finite numbers or null,
 * and pie/histogram values must be non-negative. Throws ArtifactValidationError with all problems found.
 */
export function validateArtifact(value: unknown): Artifact {
  const a = value as Artifact;
  const problems: string[] = [];
  if (a?.type === 'chart') {
    if (!validateChartSchema(a)) problems.push(...(validateChartSchema.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}`));
    else {
      for (const [i, row] of a.data.entries()) {
        if (!(a.xKey in row)) problems.push(`/data/${i} is missing xKey "${a.xKey}"`);
        for (const s of a.series) {
          const v = row[s.dataKey];
          if (v === undefined) problems.push(`/data/${i} is missing series "${s.dataKey}"`);
          else if (v !== null && (typeof v !== 'number' || !Number.isFinite(v))) problems.push(`/data/${i}/${s.dataKey} must be a finite number or null`);
          else if ((a.chartType === 'pie' || a.chartType === 'histogram') && typeof v === 'number' && v < 0) problems.push(`/data/${i}/${s.dataKey} must be >= 0 for ${a.chartType}`);
        }
      }
      if (a.chartType === 'pie' && a.series.length !== 1) problems.push('pie charts take exactly one series');
    }
  } else if (a?.type === 'table') {
    if (!validateTableSchema(a)) problems.push(...(validateTableSchema.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}`));
    else {
      const keys = new Set(a.columns.map((c) => c.key));
      a.rows.forEach((row, i) => Object.keys(row).forEach((k) => { if (!keys.has(k)) problems.push(`/rows/${i} has unknown column "${k}"`); }));
    }
  } else {
    problems.push('type must be "chart" or "table"');
  }
  if (problems.length) throw new ArtifactValidationError(problems.slice(0, 20));
  return a;
}
