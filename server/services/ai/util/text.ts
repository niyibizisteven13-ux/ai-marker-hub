/** Small text helpers shared by generators. */

export interface InlineRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

/** Minimal inline markdown: **bold**, *italic*, `code`. Everything else is literal text. */
export function parseInline(input: string): InlineRun[] {
  const runs: InlineRun[] = [];
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    if (m.index > last) runs.push({ text: input.slice(last, m.index) });
    if (m[2] !== undefined) runs.push({ text: m[2], bold: true });
    else if (m[3] !== undefined) runs.push({ text: m[3], italic: true });
    else if (m[4] !== undefined) runs.push({ text: m[4], code: true });
    last = m.index + m[0].length;
  }
  if (last < input.length) runs.push({ text: input.slice(last) });
  return runs.length ? runs : [{ text: input }];
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Make a safe download file name: no paths, no control chars, bounded length, keeps/sets extension. */
export function safeFileName(name: string, ext: string): string {
  const base = (name || 'file')
    .replace(/[\\/\0-\x1f<>:"|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.+$/, '')
    .slice(0, 80) || 'file';
  const dotExt = ext.startsWith('.') ? ext : `.${ext}`;
  return base.toLowerCase().endsWith(dotExt.toLowerCase()) ? base : base + dotExt;
}

/** Guard against spreadsheet formula injection in CSV (OWASP): prefix risky leading characters. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function truncate(s: string, max: number, note = '\n[truncated]'): string {
  return s.length <= max ? s : s.slice(0, max) + note;
}
