/**
 * What kind of file something is (from its name and type), and how to read it in the browser for a thumbnail or a
 * full preview: page 1 of a PDF, the start of a Word document, the first rows of a spreadsheet, the slides of a
 * deck, a frame of a video, the sound wave of a recording, the list inside a ZIP. Nothing here leaves the device.
 */

export type FileKind = 'image' | 'pdf' | 'word' | 'sheet' | 'csv' | 'slides' | 'html' | 'code' | 'text' | 'audio' | 'video' | 'zip' | 'other';

export interface KindSource { name: string; type: string }

const ext = (name: string) => (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase();

const CODE = new Set(['js', 'jsx', 'ts', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'go', 'rs', 'rb', 'php', 'swift', 'kt', 'css', 'scss', 'json', 'xml', 'yaml', 'yml', 'sql', 'sh', 'bat', 'ps1', 'r', 'm', 'ipynb', 'toml', 'ini', 'tex']);
const TEXT = new Set(['txt', 'md', 'markdown', 'log', 'rtf', 'srt', 'vtt']);

export function kindOf(s: KindSource): FileKind {
  const e = ext(s.name);
  const t = (s.type || '').toLowerCase();
  if (t.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'heic', 'heif', 'tif', 'tiff', 'avif', 'ico'].includes(e)) return 'image';
  if (t === 'application/pdf' || e === 'pdf') return 'pdf';
  if (/wordprocessingml/.test(t) || e === 'docx') return 'word';
  if (/spreadsheetml/.test(t) || e === 'xlsx' || e === 'xlsm') return 'sheet';
  if (t === 'text/csv' || t === 'text/tab-separated-values' || e === 'csv' || e === 'tsv') return 'csv';
  if (/presentationml/.test(t) || e === 'pptx') return 'slides';
  if (t === 'text/html' || e === 'html' || e === 'htm') return 'html';
  if (t.startsWith('audio/') || ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac', 'weba'].includes(e) || (e === 'webm' && !t.startsWith('video/'))) return 'audio';
  if (t.startsWith('video/') || ['mp4', 'mov', 'm4v', 'mkv', 'avi'].includes(e)) return 'video';
  if (t === 'application/zip' || t === 'application/x-zip-compressed' || e === 'zip') return 'zip';
  if (CODE.has(e) || t === 'application/json' || t === 'application/xml') return 'code';
  if (TEXT.has(e) || t.startsWith('text/')) return 'text';
  return 'other';
}

/** Short label shown on the tile, like Claude's "PDF", "DOCX", "PY". */
export function badgeOf(s: KindSource): string {
  const e = ext(s.name);
  if (e) return e.slice(0, 5).toUpperCase();
  const k = kindOf(s);
  return k === 'other' ? 'FILE' : k.toUpperCase();
}

/** Formats the browser itself can draw (others, like HEIC or TIFF on most browsers, get an icon). */
export function browserCanShowImage(s: KindSource): boolean {
  const e = ext(s.name);
  if (['heic', 'heif', 'tif', 'tiff'].includes(e) || /heic|heif|tiff/.test(s.type)) return false;
  return true;
}

export function formatBytes(n?: number): string {
  if (!n) return '';
  return n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`;
}

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

/* ------------------------------------------------------------------ readers ------------------------------------------------------------------ */

/** Plain text of an RTF file, good enough to read. */
export function rtfToText(rtf: string): string {
  return rtf
    .replace(/\\par[d]?/g, '\n')
    .replace(/\{\\\*[^{}]*\}/g, '')
    .replace(/\\'([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\[a-z]+-?\d* ?/gi, '')
    .replace(/[{}]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function readText(blob: Blob, name: string): Promise<string> {
  const raw = await blob.slice(0, 2_000_000).text();
  if (ext(name) === 'rtf') return rtfToText(raw);
  if (ext(name) === 'ipynb') {
    try {
      const nb = JSON.parse(raw);
      return (nb.cells ?? []).map((c: any) => (Array.isArray(c.source) ? c.source.join('') : String(c.source ?? ''))).join('\n\n# ───\n\n');
    } catch { /* show as JSON */ }
  }
  return raw;
}

/** Rows of a CSV/TSV file. */
export async function readCsv(blob: Blob, name: string, maxRows = 1000): Promise<string[][]> {
  const Papa = (await import('papaparse')).default;
  const text = await blob.slice(0, 5_000_000).text();
  const out = Papa.parse<string[]>(text, { delimiter: ext(name) === 'tsv' ? '\t' : '', preview: maxRows, skipEmptyLines: true });
  return out.data.map((r) => r.map((c) => String(c ?? '')));
}

export interface Sheet { name: string; rows: string[][]; rowCount: number; colCount: number }

function cellText(v: any): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('result' in v) return cellText(v.result);
    if ('text' in v) return String(v.text);
    if (Array.isArray(v.richText)) return v.richText.map((r: any) => r.text).join('');
    if ('error' in v) return String(v.error);
    return '';
  }
  return String(v);
}

/** Sheets of an Excel workbook (first rows and columns of each). */
export async function readWorkbook(blob: Blob, maxRows = 500, maxCols = 40): Promise<Sheet[]> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await blob.arrayBuffer());
  return wb.worksheets.map((ws) => {
    const rows: string[][] = [];
    const cols = Math.min(maxCols, ws.columnCount || 0);
    for (let r = 1; r <= Math.min(maxRows, ws.rowCount); r++) {
      const row = ws.getRow(r);
      const cells: string[] = [];
      for (let c = 1; c <= cols; c++) cells.push(cellText(row.getCell(c).value));
      rows.push(cells);
    }
    // Drop empty rows at the end.
    while (rows.length && rows[rows.length - 1].every((c) => !c)) rows.pop();
    return { name: ws.name, rows, rowCount: ws.rowCount, colCount: ws.columnCount };
  });
}

export interface Slide { n: number; title: string; lines: string[] }

const decodeXml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** Slides of a PowerPoint deck: the text on each, and the deck's own thumbnail picture if it has one. */
export async function readDeck(blob: Blob): Promise<{ slides: Slide[]; thumbnail: string | null }> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const names = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]));
  const slides: Slide[] = [];
  for (const [i, n] of names.entries()) {
    const xml = await zip.file(n)!.async('string');
    const paras = xml.split(/<\/a:p>/).map((p) => decodeXml([...p.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join('')).trim()).filter(Boolean);
    slides.push({ n: i + 1, title: paras[0] ?? '', lines: paras.slice(1) });
  }
  return { slides, thumbnail: await zipThumbnail(zip) };
}

/** Office and OpenDocument files often carry a small picture of page 1. */
async function zipThumbnail(zip: any): Promise<string | null> {
  const name = Object.keys(zip.files).find((n) => /^(docProps\/thumbnail\.(jpe?g|png)|Thumbnails\/thumbnail\.png)$/i.test(n));
  if (!name) return null;
  const b64 = await zip.file(name).async('base64');
  return `data:image/${/png$/i.test(name) ? 'png' : 'jpeg'};base64,${b64}`;
}

export interface ZipEntry { path: string; size: number; dir: boolean }

export async function readZip(blob: Blob): Promise<{ entries: ZipEntry[]; open: (path: string) => Promise<File> }> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const entries: ZipEntry[] = [];
  zip.forEach((path: string, f: any) => {
    if (/(^|\/)(__MACOSX|\.DS_Store)/.test(path)) return;
    entries.push({ path, dir: f.dir, size: f._data?.uncompressedSize ?? 0 });
  });
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return {
    entries,
    open: async (path) => {
      const b = await zip.file(path)!.async('blob');
      const name = path.split('/').pop() || path;
      return new File([b], name, { type: guessType(name) });
    },
  };
}

const TYPES: Record<string, string> = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', csv: 'text/csv', txt: 'text/plain', md: 'text/markdown',
  json: 'application/json', html: 'text/html', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', mp4: 'video/mp4', webm: 'video/webm', zip: 'application/zip',
};
export const guessType = (name: string) => TYPES[ext(name)] ?? '';

/** Word document as safe HTML (headings, paragraphs, lists, tables, pictures). */
export async function readWordHtml(blob: Blob): Promise<string> {
  const mammoth = (await import('mammoth')).default;
  const out = await mammoth.convertToHtml({ arrayBuffer: await blob.arrayBuffer() });
  return cleanHtml(out.value);
}

const ALLOWED = new Set(['p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'img', 'a', 'blockquote', 'pre', 'code', 'span']);

/** Keeps only plain document markup: no scripts, styles, frames or event handlers; pictures only as embedded data. */
export function cleanHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const walk = (el: Element) => {
    for (const child of [...el.children]) {
      const tag = child.tagName.toLowerCase();
      if (!ALLOWED.has(tag)) {
        if (['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta'].includes(tag)) { child.remove(); continue; }
        walk(child);
        child.replaceWith(...child.childNodes);
        continue;
      }
      for (const attr of [...child.attributes]) {
        const keep = (attr.name === 'href' && /^https?:/i.test(attr.value)) || (attr.name === 'src' && /^data:image\//i.test(attr.value)) || ['colspan', 'rowspan', 'alt'].includes(attr.name);
        if (!keep) child.removeAttribute(attr.name);
      }
      if (tag === 'a') { child.setAttribute('target', '_blank'); child.setAttribute('rel', 'noopener noreferrer'); }
      walk(child);
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

/* ---------------------------------------------------------------- thumbnails ---------------------------------------------------------------- */

export interface Thumb {
  /** A picture: the photo, page 1, a video frame, the sound wave, the deck's own thumbnail. */ image?: string;
  /** The first lines, for text, code and Word files. */ text?: string;
  /** The first rows, for spreadsheets and CSV. */ table?: string[][];
  /** "12 pages", "48 lines", "3 sheets", "0:42". */ meta?: string;
}

async function pdfThumb(blob: Blob): Promise<Thumb> {
  const { loadPdfJs } = await import('../components/PdfViewer');
  const lib = await loadPdfJs();
  const doc = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise;
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: 300 / base.width });
    const c = document.createElement('canvas');
    c.width = Math.floor(vp.width);
    c.height = Math.floor(vp.height);
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    await page.render({ canvas: c, canvasContext: g, viewport: vp }).promise;
    return { image: c.toDataURL('image/jpeg', 0.82), meta: `${doc.numPages} page${doc.numPages === 1 ? '' : 's'}` };
  } finally { void doc.destroy(); }
}

function videoThumb(blob: Blob): Promise<Thumb> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'metadata'; v.src = url;
    const done = (t: Thumb | null, err?: unknown) => { URL.revokeObjectURL(url); v.removeAttribute('src'); if (t) resolve(t); else reject(err); };
    const timer = window.setTimeout(() => done(null, new Error('timeout')), 15000);
    v.onloadedmetadata = () => { v.currentTime = Math.min(1, (v.duration || 2) / 4); };
    v.onseeked = () => {
      window.clearTimeout(timer);
      const c = document.createElement('canvas');
      const w = 320;
      c.width = w; c.height = Math.max(1, Math.round((v.videoHeight / Math.max(1, v.videoWidth)) * w)) || 180;
      c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
      done({ image: c.toDataURL('image/jpeg', 0.8), meta: Number.isFinite(v.duration) ? mmss(v.duration) : undefined });
    };
    v.onerror = (e) => { window.clearTimeout(timer); done(null, e); };
  });
}

async function audioThumb(blob: Blob): Promise<Thumb> {
  const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
  const ctx = new Ctx();
  try {
    const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
    const data = audio.getChannelData(0);
    const bars = 48;
    const step = Math.floor(data.length / bars) || 1;
    const peaks: number[] = [];
    for (let i = 0; i < bars; i++) {
      let p = 0;
      for (let j = i * step; j < Math.min(data.length, (i + 1) * step); j += 16) p = Math.max(p, Math.abs(data[j]));
      peaks.push(p);
    }
    const top = Math.max(0.01, ...peaks);
    const c = document.createElement('canvas');
    c.width = 288; c.height = 160;
    const g = c.getContext('2d')!;
    g.fillStyle = '#D97757';
    const w = c.width / bars;
    peaks.forEach((p, i) => { const h = Math.max(4, (p / top) * c.height * 0.7); g.fillRect(i * w + w * 0.2, (c.height - h) / 2, w * 0.6, h); });
    return { image: c.toDataURL('image/png'), meta: mmss(audio.duration) };
  } finally { void ctx.close(); }
}

async function makeThumb(src: KindSource, blob: Blob): Promise<Thumb> {
  const kind = kindOf(src);
  switch (kind) {
    case 'pdf': return pdfThumb(blob);
    case 'video': return videoThumb(blob);
    case 'audio': return blob.size < 40e6 ? audioThumb(blob) : {};
    case 'word': {
      const mammoth = (await import('mammoth')).default;
      const ab = await blob.arrayBuffer();
      const { default: JSZip } = await import('jszip');
      const pic = await zipThumbnail(await JSZip.loadAsync(ab)).catch(() => null);
      const text = (await mammoth.extractRawText({ arrayBuffer: ab })).value.trim();
      const words = text ? text.split(/\s+/).length : 0;
      return { image: pic ?? undefined, text: text.slice(0, 700), meta: `${words.toLocaleString()} words` };
    }
    case 'sheet': {
      const sheets = await readWorkbook(blob, 8, 6);
      const first = sheets[0];
      return { table: first?.rows ?? [], meta: `${sheets.length} sheet${sheets.length === 1 ? '' : 's'}${first ? ` · ${first.rowCount} rows` : ''}` };
    }
    case 'csv': {
      const rows = await readCsv(blob, src.name, 8);
      return { table: rows.map((r) => r.slice(0, 6)) };
    }
    case 'slides': {
      const deck = await readDeck(blob);
      const first = deck.slides[0];
      return { image: deck.thumbnail ?? undefined, text: first ? [first.title, ...first.lines].join('\n') : '', meta: `${deck.slides.length} slide${deck.slides.length === 1 ? '' : 's'}` };
    }
    case 'zip': {
      const { entries } = await readZip(blob);
      const files = entries.filter((e) => !e.dir);
      return { text: files.slice(0, 12).map((e) => e.path).join('\n'), meta: `${files.length} file${files.length === 1 ? '' : 's'}` };
    }
    case 'html': case 'code': case 'text': {
      const text = await readText(blob.slice(0, 200_000), src.name);
      const lines = text.split('\n').length;
      return { text: text.slice(0, 700), meta: `${lines.toLocaleString()} line${lines === 1 ? '' : 's'}` };
    }
    default: return {};
  }
}

const cache = new Map<string, Promise<Thumb>>();
const fileIds = new WeakMap<Blob, string>();
let nextId = 0;

/** Same file → same key, so a thumbnail is worked out once, however often the page redraws. */
export function keyOf(src: { name: string; file?: Blob; url?: string; storedFileId?: string; fallbackUrl?: string }): string {
  if (src.file) {
    let id = fileIds.get(src.file);
    if (!id) { id = `f${nextId++}`; fileIds.set(src.file, id); }
    return id;
  }
  return `${src.name}|${src.storedFileId ?? ''}|${src.url ?? ''}|${src.storedFileId || src.url ? '' : src.fallbackUrl ?? ''}`;
}

/** Thumbnail for a file (images are handled by the caller, which can show them directly). Never throws. */
export function thumbnailFor(key: string, src: KindSource, load: () => Promise<Blob>): Promise<Thumb> {
  let p = cache.get(key);
  if (!p) {
    p = load().then((b) => (b.size > 120e6 ? {} : makeThumb(src, b))).catch(() => ({}));
    cache.set(key, p);
    if (cache.size > 300) cache.delete(cache.keys().next().value!);
  }
  return p;
}
