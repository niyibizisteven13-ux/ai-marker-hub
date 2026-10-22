import { parse as parseCsv } from 'csv-parse/sync';
import ExcelJS from 'exceljs';

/** How a tabular file maps onto tidy statistical records. Column names are matched exactly as they appear in the header. */
export interface NisrTableMapping {
  /** Column holding the indicator name, or `indicator` for a single-indicator table. */
  indicatorColumn?: string;
  indicator?: string;
  geographyColumn?: string;
  /** Constant geography when the file has no geography column (e.g. "Rwanda"). */
  geography?: string;
  periodColumn?: string;
  /** Long format: the column holding values. */
  valueColumn?: string;
  /** Wide format: each listed column is a period (e.g. ["2019","2020"]) holding that period's value. */
  periodColumns?: string[];
  unitColumn?: string;
  unit?: string;
  /** Extra columns kept as dimensions (e.g. "Sex", "Area"). */
  dimensionColumns?: string[];
  /** XLSX only: sheet name (default: first sheet) and 1-based header row (default 1). */
  sheet?: string;
  headerRow?: number;
}

export interface NisrRecord {
  id: string;
  datasetId: string;
  /** 1-based data row number in the source file (header excluded), for citation. */
  row: number;
  indicator: string;
  geography: string | null;
  period: string | null;
  /** null when the source marks the value as missing; never coerced to 0. */
  value: number | null;
  valueText: string;
  unit: string | null;
  missing: boolean;
  dimensions: Record<string, string>;
}

export interface NisrPassage {
  id: string;
  datasetId: string;
  index: number;
  text: string;
}

export interface NormalizeResult<T> {
  items: T[];
  warnings: string[];
}

/** Tokens NISR and similar publications use for "not available" / suppressed values. */
export const MISSING = new Set(['', '-', '–', '—', '..', '...', 'n/a', 'na', 'n.a.', 'nan', 'null', 'x', '*', ':', 'not available']);

export function parseStatValue(raw: unknown): { value: number | null; missing: boolean; percent: boolean; text: string } {
  const text = raw === null || raw === undefined ? '' : String(typeof raw === 'object' && raw && 'result' in (raw as any) ? (raw as any).result : raw).trim();
  if (MISSING.has(text.toLowerCase())) return { value: null, missing: true, percent: false, text };
  const percent = /%$/.test(text);
  // Accept "1,234.5", "1 234", "12.5%", "(3.2)" as negative. Reject anything else rather than guessing.
  let cleaned = text.replace(/%$/, '').replace(/[\s ]/g, '').replace(/,(?=\d{3}(\D|$))/g, '');
  let negative = false;
  if (/^\(.*\)$/.test(cleaned)) { negative = true; cleaned = cleaned.slice(1, -1); }
  if (!/^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(cleaned)) return { value: null, missing: true, percent, text };
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return { value: null, missing: true, percent, text };
  return { value: negative ? -n : n, missing: false, percent, text };
}

const clean = (v: unknown) => (v === null || v === undefined ? '' : String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim());

function rowsToRecords(datasetId: string, rows: Record<string, unknown>[], header: string[], m: NisrTableMapping, maxRows: number): NormalizeResult<NisrRecord> {
  const warnings: string[] = [];
  const required = [m.indicatorColumn, m.geographyColumn, m.periodColumn, m.valueColumn, m.unitColumn, ...(m.periodColumns ?? []), ...(m.dimensionColumns ?? [])].filter(Boolean) as string[];
  const missingCols = required.filter((c) => !header.includes(c));
  if (missingCols.length) throw new Error(`Columns not found in header: ${missingCols.join(', ')}`);
  if (!m.indicatorColumn && !m.indicator) throw new Error('Mapping needs indicatorColumn or indicator.');
  if (!m.valueColumn && !m.periodColumns?.length) throw new Error('Mapping needs valueColumn (long format) or periodColumns (wide format).');
  if (rows.length > maxRows) throw new Error(`Table has ${rows.length} rows; limit is ${maxRows}.`);

  const items: NisrRecord[] = [];
  let missingCount = 0;
  let unparsed = 0;
  rows.forEach((row, i) => {
    const indicator = m.indicatorColumn ? clean(row[m.indicatorColumn]) : m.indicator!;
    if (!indicator) return;
    const geography = m.geographyColumn ? clean(row[m.geographyColumn]) || null : m.geography ?? null;
    const dimensions: Record<string, string> = {};
    for (const d of m.dimensionColumns ?? []) dimensions[d] = clean(row[d]);
    const cells: Array<{ period: string | null; raw: unknown }> = m.periodColumns?.length
      ? m.periodColumns.map((p) => ({ period: p, raw: row[p] }))
      : [{ period: m.periodColumn ? clean(row[m.periodColumn]) || null : null, raw: row[m.valueColumn!] }];
    cells.forEach((cell, j) => {
      const parsed = parseStatValue(cell.raw);
      if (parsed.missing) {
        missingCount++;
        if (parsed.text && !MISSING.has(parsed.text.toLowerCase())) unparsed++;
      }
      const unit = (m.unitColumn ? clean(row[m.unitColumn]) : '') || m.unit || (parsed.percent ? '%' : '') || null;
      items.push({
        id: `${datasetId}:${i + 1}${cells.length > 1 ? `:${j + 1}` : ''}`,
        datasetId,
        row: i + 1,
        indicator,
        geography,
        period: cell.period,
        value: parsed.value,
        valueText: parsed.text,
        unit,
        missing: parsed.missing,
        dimensions,
      });
    });
  });
  if (missingCount) warnings.push(`${missingCount} value(s) are missing in the source and are stored as null.`);
  if (unparsed) warnings.push(`${unparsed} value(s) were not recognisable numbers and are stored as null.`);
  return { items, warnings };
}

export function normalizeCsv(datasetId: string, content: string, m: NisrTableMapping, maxRows: number): NormalizeResult<NisrRecord> {
  const rows: Record<string, unknown>[] = parseCsv(content.replace(/^﻿/, ''), { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true });
  const header = rows.length ? Object.keys(rows[0]) : [];
  return rowsToRecords(datasetId, rows, header, m, maxRows);
}

export function normalizeJson(datasetId: string, content: string, m: NisrTableMapping, maxRows: number): NormalizeResult<NisrRecord> {
  const data = JSON.parse(content);
  const rows: Record<string, unknown>[] = Array.isArray(data) ? data : Array.isArray(data?.rows) ? data.rows : Array.isArray(data?.data) ? data.data : [];
  if (!rows.length) throw new Error('JSON must be an array of row objects (or { rows: [...] }).');
  const header = [...new Set(rows.flatMap((r) => Object.keys(r ?? {})))];
  return rowsToRecords(datasetId, rows, header, m, maxRows);
}

export async function normalizeXlsx(datasetId: string, buffer: Buffer, m: NisrTableMapping, maxRows: number): Promise<NormalizeResult<NisrRecord>> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);
  const ws = m.sheet ? wb.getWorksheet(m.sheet) : wb.worksheets[0];
  if (!ws) throw new Error(`Sheet ${m.sheet ?? '(first)'} not found.`);
  const headerRow = m.headerRow ?? 1;
  const header: string[] = [];
  ws.getRow(headerRow).eachCell({ includeEmpty: true }, (cell, col) => { header[col] = clean(cell.text); });
  const rows: Record<string, unknown>[] = [];
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    if (n <= headerRow) return;
    const obj: Record<string, unknown> = {};
    row.eachCell({ includeEmpty: true }, (cell, col) => { if (header[col]) obj[header[col]] = cell.value ?? ''; });
    rows.push(obj);
  });
  return rowsToRecords(datasetId, rows, header.filter(Boolean), m, maxRows);
}

/** Splits report text into passages on paragraph boundaries (~maxChars each). */
export function normalizeText(datasetId: string, content: string, maxChars = 1200): NormalizeResult<NisrPassage> {
  const paragraphs = content.replace(/\r\n/g, '\n').split(/\n\s*\n/).map((p) => p.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').trim()).filter(Boolean);
  const items: NisrPassage[] = [];
  let buf = '';
  const flush = () => { if (buf.trim()) items.push({ id: `${datasetId}:p${items.length + 1}`, datasetId, index: items.length + 1, text: buf.trim() }); buf = ''; };
  for (const p of paragraphs) {
    if (buf && buf.length + p.length + 2 > maxChars) flush();
    if (p.length > maxChars) {
      for (let i = 0; i < p.length; i += maxChars) { buf = p.slice(i, i + maxChars); flush(); }
    } else {
      buf = buf ? `${buf}\n\n${p}` : p;
    }
  }
  flush();
  return { items, warnings: items.length ? [] : ['No text content found.'] };
}
