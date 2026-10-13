import ExcelJS from 'exceljs';

export interface ColumnSpec {
  header: string;
  width?: number;
  type?: 'text' | 'number' | 'currency' | 'percent' | 'date';
}
export interface SheetSpec {
  name: string;
  columns?: ColumnSpec[];
  /** Rows of values. A string starting with "=" becomes a live formula (for example "=SUM(B2:B10)"). */
  rows: Array<Array<string | number | boolean | null>>;
  freezeHeader?: boolean;
  autoFilter?: boolean;
}
export interface WorkbookSpec {
  title?: string;
  author?: string;
  sheets: SheetSpec[];
}

const MAX_ROWS = 100_000;
const MAX_CELLS = 1_000_000;

function sheetName(raw: string, used: Set<string>): string {
  let name = (raw || 'Sheet').replace(/[\[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Sheet';
  let n = 2;
  while (used.has(name.toLowerCase())) name = `${name.slice(0, 28)} ${n++}`;
  used.add(name.toLowerCase());
  return name;
}

const FORMATS: Record<string, string> = {
  number: '#,##0.00',
  currency: '#,##0.00',
  percent: '0.0%',
  date: 'yyyy-mm-dd',
};

export async function generateXlsx(spec: WorkbookSpec): Promise<Buffer> {
  if (!spec || !Array.isArray(spec.sheets) || !spec.sheets.length) throw new Error('Workbook needs at least one sheet.');
  const wb = new ExcelJS.Workbook();
  wb.creator = spec.author ?? 'Bwenge';
  wb.title = spec.title ?? '';
  wb.created = new Date();
  const used = new Set<string>();
  let cells = 0;

  for (const sheet of spec.sheets) {
    if (sheet.rows.length > MAX_ROWS) throw new Error(`A sheet has more than ${MAX_ROWS} rows.`);
    const ws = wb.addWorksheet(sheetName(sheet.name, used));
    const cols = sheet.columns ?? [];
    const width = Math.max(cols.length, ...sheet.rows.map((r) => r.length), 1);
    cells += width * (sheet.rows.length + 1);
    if (cells > MAX_CELLS) throw new Error('Workbook is too large.');

    if (cols.length) {
      const header = ws.addRow(cols.map((c) => c.header));
      header.font = { bold: true, name: 'Calibri', size: 11 };
      header.alignment = { vertical: 'middle' };
      header.eachCell((c) => {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAEAEA' } };
        c.border = { bottom: { style: 'thin', color: { argb: 'FF999999' } } };
      });
    }
    for (const r of sheet.rows) {
      const values = r.map((v, i) => {
        if (typeof v === 'string' && v.startsWith('=') && v.length > 1) return { formula: v.slice(1) } as ExcelJS.CellFormulaValue;
        if (cols[i]?.type === 'date' && typeof v === 'string') { const d = new Date(v); return Number.isNaN(d.getTime()) ? v : d; }
        return v;
      });
      ws.addRow(values);
    }
    cols.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      if (c.type && FORMATS[c.type]) col.numFmt = FORMATS[c.type];
      let maxLen = c.header.length;
      for (const r of sheet.rows) maxLen = Math.max(maxLen, String(r[i] ?? '').length);
      col.width = c.width ?? Math.min(Math.max(10, maxLen + 2), 60);
      if (c.type && c.type !== 'text') col.alignment = { horizontal: 'right' };
    });
    if (!cols.length) {
      for (let i = 1; i <= width; i++) {
        let maxLen = 8;
        for (const r of sheet.rows) maxLen = Math.max(maxLen, String(r[i - 1] ?? '').length);
        ws.getColumn(i).width = Math.min(maxLen + 2, 60);
      }
    }
    if (cols.length && sheet.freezeHeader !== false) ws.views = [{ state: 'frozen', ySplit: 1 }];
    if (cols.length && sheet.autoFilter) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
