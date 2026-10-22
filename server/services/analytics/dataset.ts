import { createHash } from 'node:crypto';
import { parse as parseCsv } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { parseStatValue } from '../ai/nisr/nisrNormalize.js';

/**
 * Loads a tabular dataset (CSV, XLSX, JSON), infers column types, and reports data quality.
 * Raw cell text is kept; numeric views are derived on demand so no value is silently changed.
 */

export type ColumnType = 'numeric' | 'categorical' | 'boolean' | 'datetime' | 'text' | 'empty';

export interface ColumnInfo {
  name: string;
  type: ColumnType;
  /** Extra hints: identifier-like, binary 0/1, year-like, percent values. */
  hints: string[];
  nonMissing: number;
  missing: number;
  distinct: number;
  /** Numeric columns: non-missing cells that are not valid numbers. */
  invalid: number;
  invalidExamples: string[];
  examples: string[];
}

export interface Dataset {
  name: string;
  format: 'csv' | 'xlsx' | 'json';
  sha256: string;
  bytes: number;
  columns: ColumnInfo[];
  /** Raw cell text, trimmed. "" = empty cell. */
  rows: Array<Record<string, string>>;
  missingTokens: string[];
  warnings: string[];
}

export interface LoadOptions {
  maxBytes?: number;
  maxRows?: number;
  maxColumns?: number;
  sheet?: string;
  /** Extra tokens to treat as missing (case-insensitive). */
  missingValues?: string[];
}

/** Default missing-value markers for general datasets (narrower than the NISR set, which also treats "x" as suppressed). */
export const DEFAULT_MISSING = ['', 'na', 'n/a', 'nan', 'null', '#n/a', '..', '.'];

export class DatasetError extends Error {
  constructor(public code: 'UNSUPPORTED_FORMAT' | 'TOO_LARGE' | 'MALFORMED' | 'EMPTY', message: string) {
    super(message);
  }
}

const clean = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('result' in o) return clean(o.result);
    if ('text' in o) return clean(o.text);
    if ('richText' in o && Array.isArray(o.richText)) return (o.richText as Array<{ text?: string }>).map((r) => r.text ?? '').join('');
    return '';
  }
  return String(v).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').trim();
};

export function detectFormat(filename: string, mime?: string): Dataset['format'] | null {
  // The extension decides; the client-supplied MIME type is only a fallback when there is no known extension.
  const ext = filename.includes('.') ? filename.toLowerCase().split('.').pop() : '';
  if (ext === 'csv' || ext === 'tsv' || ext === 'txt') return 'csv';
  if (ext === 'xlsx') return 'xlsx';
  if (ext === 'json') return 'json';
  if (ext) return null;
  if (mime === 'text/csv') return 'csv';
  if (mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return 'xlsx';
  if (mime === 'application/json') return 'json';
  return null;
}

function uniqueHeaders(raw: string[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((h, i) => {
    const base = clean(h) || `column_${i + 1}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n ? `${base}_${n + 1}` : base;
  });
}

export async function loadDataset(data: Buffer, filename: string, mime?: string, opts: LoadOptions = {}): Promise<Dataset> {
  const maxBytes = opts.maxBytes ?? 20 * 1024 * 1024;
  const maxRows = opts.maxRows ?? 200_000;
  const maxColumns = opts.maxColumns ?? 200;
  if (data.length > maxBytes) throw new DatasetError('TOO_LARGE', `File is ${data.length} bytes; the limit is ${maxBytes}.`);
  const format = detectFormat(filename, mime);
  if (!format) throw new DatasetError('UNSUPPORTED_FORMAT', 'Supported formats: CSV, TSV, XLSX, JSON.');
  const warnings: string[] = [];
  let header: string[] = [];
  let records: string[][] = [];

  try {
    if (format === 'csv') {
      const text = data.toString('utf8').replace(/^﻿/, '');
      if (text.includes('�')) warnings.push('The file is not valid UTF-8; some characters could not be decoded.');
      const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
      const delimiter = [',', ';', '\t', '|'].reduce((best, d) => (firstLine.split(d).length > firstLine.split(best).length ? d : best), ',');
      const parsed: string[][] = parseCsv(text, { delimiter, skip_empty_lines: true, relax_column_count: true, relax_quotes: true, to: maxRows + 2 }); // header + limit + 1, so overflow is detected rather than silently truncated
      header = parsed[0] ?? [];
      records = parsed.slice(1);
      const ragged = records.filter((r) => r.length !== header.length).length;
      if (ragged) warnings.push(`${ragged} row(s) have a different number of fields from the header; missing fields are treated as empty and extra fields are ignored.`);
    } else if (format === 'xlsx') {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(data as any);
      const ws = opts.sheet ? wb.getWorksheet(opts.sheet) : wb.worksheets[0];
      if (!ws) throw new DatasetError('MALFORMED', `Sheet ${opts.sheet ?? '(first)'} not found.`);
      if (wb.worksheets.length > 1 && !opts.sheet) warnings.push(`Workbook has ${wb.worksheets.length} sheets; only "${ws.name}" was read.`);
      const rows: string[][] = [];
      ws.eachRow({ includeEmpty: false }, (row) => {
        if (rows.length > maxRows + 1) return; // header + limit + 1 rows are enough to detect overflow
        const cells: string[] = [];
        row.eachCell({ includeEmpty: true }, (cell, col) => { cells[col - 1] = clean(cell.value); });
        rows.push(Array.from(cells, (c) => c ?? ''));
      });
      header = rows[0] ?? [];
      records = rows.slice(1);
    } else {
      const parsed = JSON.parse(data.toString('utf8'));
      const arr: unknown[] = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.rows) ? parsed.rows : Array.isArray(parsed?.data) ? parsed.data : [];
      if (!arr.length || !arr.every((r) => r && typeof r === 'object' && !Array.isArray(r))) throw new DatasetError('MALFORMED', 'JSON must be an array of row objects (or {"rows": [...]}).');
      header = [...new Set(arr.flatMap((r) => Object.keys(r as object)))];
      records = arr.slice(0, maxRows + 1).map((r) => header.map((h) => clean((r as Record<string, unknown>)[h])));
    }
  } catch (e) {
    if (e instanceof DatasetError) throw e;
    throw new DatasetError('MALFORMED', `Could not parse the ${format.toUpperCase()} file: ${(e as Error).message.slice(0, 200)}`);
  }

  if (!header.length) throw new DatasetError('EMPTY', 'The file has no header row.');
  if (header.length > maxColumns) throw new DatasetError('TOO_LARGE', `File has ${header.length} columns; the limit is ${maxColumns}.`);
  if (records.length > maxRows) throw new DatasetError('TOO_LARGE', `File has more than ${maxRows} rows.`);
  if (!records.length) throw new DatasetError('EMPTY', 'The file has a header but no data rows.');
  const names = uniqueHeaders(header.map(clean));
  if (names.some((n, i) => n !== clean(header[i]))) warnings.push('Some column names were empty or duplicated and were renamed (e.g. column_3, name_2).');

  const rows = records.map((r) => Object.fromEntries(names.map((n, i) => [n, clean(r[i])])));
  const missingTokens = [...new Set([...DEFAULT_MISSING, ...(opts.missingValues ?? []).map((m) => m.trim().toLowerCase())])];
  const ds: Dataset = {
    name: filename.replace(/[^\w.\- ]/g, '_').slice(0, 120), format,
    sha256: createHash('sha256').update(data).digest('hex'), bytes: data.length,
    columns: [], rows, missingTokens, warnings,
  };
  ds.columns = names.map((n) => inferColumn(ds, n));
  return ds;
}

export function isMissing(ds: Pick<Dataset, 'missingTokens'>, v: string): boolean {
  return ds.missingTokens.includes(v.trim().toLowerCase());
}

/** Numeric view of a column: null for missing or invalid cells. */
export function numericColumn(ds: Dataset, name: string): Array<number | null> {
  return ds.rows.map((r) => {
    const v = r[name] ?? '';
    if (isMissing(ds, v)) return null;
    const p = parseStatValue(v);
    return p.missing ? null : p.value;
  });
}

/** Text view of a column: null for missing cells. */
export function textColumn(ds: Dataset, name: string): Array<string | null> {
  return ds.rows.map((r) => {
    const v = r[name] ?? '';
    return isMissing(ds, v) ? null : v;
  });
}

const BOOL = new Set(['true', 'false', 'yes', 'no', 'y', 'n', 'oui', 'non', 'yego', 'oya']);
const DATE = /^(\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?|\d{4}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})$/;

function inferColumn(ds: Dataset, name: string): ColumnInfo {
  const values = ds.rows.map((r) => r[name] ?? '');
  const present = values.filter((v) => !isMissing(ds, v));
  const distinct = new Set(present).size;
  const info: ColumnInfo = {
    name, type: 'empty', hints: [], nonMissing: present.length, missing: values.length - present.length, distinct,
    invalid: 0, invalidExamples: [], examples: [...new Set(present)].slice(0, 5),
  };
  if (!present.length) return info;
  const parsed = present.map((v) => ({ v, p: parseStatValue(v) }));
  const numeric = parsed.filter((x) => !x.p.missing);
  const lower = present.map((v) => v.toLowerCase());

  if (numeric.length / present.length >= 0.8) {
    info.type = 'numeric';
    const bad = parsed.filter((x) => x.p.missing);
    info.invalid = bad.length;
    info.invalidExamples = [...new Set(bad.map((x) => x.v))].slice(0, 5);
    const nums = numeric.map((x) => x.p.value!);
    if (nums.every((n) => n === 0 || n === 1)) info.hints.push('binary 0/1');
    if (nums.every((n) => Number.isInteger(n) && n >= 1800 && n <= 2100) && /year|annee|umwaka|period/i.test(name)) info.hints.push('year');
    if (numeric.some((x) => x.p.percent)) info.hints.push('percent values');
    if (/(^|_)(id|code|number)$/i.test(name) && distinct === present.length) info.hints.push('identifier-like: summary statistics are not meaningful');
  } else if (lower.every((v) => BOOL.has(v))) {
    info.type = 'boolean';
  } else if (present.filter((v) => DATE.test(v) && !Number.isNaN(Date.parse(v.replace(' ', 'T')))).length / present.length >= 0.9) {
    info.type = 'datetime';
  } else if (distinct <= Math.max(20, Math.ceil(present.length * 0.05)) && present.every((v) => v.length <= 80)) {
    info.type = 'categorical';
  } else {
    info.type = 'text';
    if (distinct === present.length) info.hints.push('all values unique');
  }
  return info;
}

export interface QualityIssue { severity: 'info' | 'warning' | 'error'; column?: string; message: string }

export interface QualityReport {
  rows: number;
  columns: number;
  completeRows: number;
  duplicateRows: number;
  duplicateExamples: number[];
  missingByColumn: Array<{ column: string; missing: number; percent: number }>;
  issues: QualityIssue[];
}

/** Data-quality summary: missingness, duplicates, invalid values, constant and mostly-empty columns. */
export function qualityReport(ds: Dataset): QualityReport {
  const issues: QualityIssue[] = ds.warnings.map((w) => ({ severity: 'warning' as const, message: w }));
  const n = ds.rows.length;
  const seen = new Map<string, number>();
  const dupes: number[] = [];
  let complete = 0;
  ds.rows.forEach((r, i) => {
    const key = JSON.stringify(ds.columns.map((c) => r[c.name]));
    if (seen.has(key)) dupes.push(i + 1);
    else seen.set(key, i);
    if (ds.columns.every((c) => !isMissing(ds, r[c.name] ?? ''))) complete++;
  });
  if (dupes.length) issues.push({ severity: 'warning', message: `${dupes.length} row(s) exactly duplicate an earlier row. They were kept; check whether they are genuine repeated observations.` });
  for (const c of ds.columns) {
    const pct = (100 * c.missing) / n;
    if (c.type === 'empty') issues.push({ severity: 'warning', column: c.name, message: 'Column is entirely empty.' });
    else if (pct >= 50) issues.push({ severity: 'warning', column: c.name, message: `${pct.toFixed(1)}% of values are missing.` });
    else if (pct > 0) issues.push({ severity: 'info', column: c.name, message: `${c.missing} missing value(s) (${pct.toFixed(1)}%).` });
    if (c.invalid) issues.push({ severity: 'warning', column: c.name, message: `${c.invalid} value(s) are not valid numbers in a numeric column (e.g. ${c.invalidExamples.map((e) => JSON.stringify(e)).join(', ')}); they are treated as missing in calculations.` });
    if (c.type !== 'empty' && c.distinct === 1 && n > 1) issues.push({ severity: 'info', column: c.name, message: 'Column has a single distinct value (constant).' });
    for (const h of c.hints) if (h.startsWith('identifier')) issues.push({ severity: 'info', column: c.name, message: `Looks like an ${h}.` });
  }
  return {
    rows: n, columns: ds.columns.length, completeRows: complete, duplicateRows: dupes.length, duplicateExamples: dupes.slice(0, 10),
    missingByColumn: ds.columns.map((c) => ({ column: c.name, missing: c.missing, percent: Number(((100 * c.missing) / n).toFixed(2)) })),
    issues,
  };
}

export function preview(ds: Dataset, rows = 10) {
  return { columns: ds.columns.map((c) => c.name), rows: ds.rows.slice(0, rows) };
}
