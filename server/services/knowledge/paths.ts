/**
 * Repository paths and file types. Every client-supplied path (folder upload, archive entry, rename)
 * passes through normalizeRelativePath; storage never uses these names, only opaque file-store ids.
 */

export class PathError extends Error {
  constructor(message: string) {
    super(message);
  }
}

const MAX_DEPTH = 32;
const MAX_SEGMENT = 200;
const MAX_PATH = 1024;

/** Validates one file or folder name (no separators). */
export function validateName(raw: string): string {
  const name = String(raw ?? '').normalize('NFC').trim();
  if (!name) throw new PathError('Names cannot be empty.');
  if (name.length > MAX_SEGMENT) throw new PathError(`Names can be at most ${MAX_SEGMENT} characters.`);
  if (/[\u0000-\u001f\u007f]/.test(name)) throw new PathError('Names cannot contain control characters.');
  if (/[/\\]/.test(name)) throw new PathError('Names cannot contain "/" or "\\".');
  if (name === '.' || name === '..') throw new PathError('"." and ".." are not valid names.');
  if (/[<>:"|?*]/.test(name)) throw new PathError('Names cannot contain < > : " | ? *.');
  return name;
}

/**
 * Normalises a relative path ("a\\b/c.pdf" → ["a","b","c.pdf"]). Rejects absolute paths, drive letters,
 * "..", "." segments, null bytes and over-long or over-deep paths, so nothing can escape the repository.
 */
export function normalizeRelativePath(raw: string): string[] {
  const input = String(raw ?? '');
  if (input.includes('\u0000')) throw new PathError('Paths cannot contain null bytes.');
  const unified = input.replace(/\\/g, '/');
  if (unified.startsWith('/') || /^[a-zA-Z]:/.test(unified) || unified.startsWith('//')) throw new PathError(`"${input.slice(0, 120)}" is an absolute path; send paths relative to the upload folder.`);
  const parts = unified.split('/').filter((p) => p !== '');
  if (!parts.length) throw new PathError('The path is empty.');
  if (parts.some((p) => p === '..')) throw new PathError(`"${input.slice(0, 120)}" tries to leave the repository ("..").`);
  if (parts.some((p) => p === '.')) throw new PathError(`"${input.slice(0, 120)}" contains "." segments.`);
  if (parts.length > MAX_DEPTH) throw new PathError(`Folders can be nested at most ${MAX_DEPTH} levels deep.`);
  const segs = parts.map(validateName);
  if (segs.join('/').length > MAX_PATH) throw new PathError(`Paths can be at most ${MAX_PATH} characters.`);
  return segs;
}

export const joinPath = (...parts: Array<string | null | undefined>) => parts.filter((p) => p && p.length).join('/');
export const parentPath = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
export const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1);
export const extensionOf = (name: string) => { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(i + 1).toLowerCase() : ''; };

/** "report.pdf" → "report (1).pdf", "(2)", … until `taken` says it is free. */
export function nextFreeName(name: string, taken: (candidate: string) => boolean): string {
  const ext = extensionOf(name);
  const stem = ext ? name.slice(0, -(ext.length + 1)) : name;
  for (let i = 1; i < 10_000; i++) {
    const candidate = `${stem} (${i})${ext ? `.${ext}` : ''}`;
    if (!taken(candidate)) return candidate;
  }
  throw new PathError('Too many files with the same name.');
}

// ── File types ──────────────────────────────────────────────────────────────

const BLOCKED = new Set(['exe', 'dll', 'so', 'dylib', 'bat', 'cmd', 'com', 'msi', 'scr', 'vbs', 'ps1', 'jar', 'apk', 'app', 'sh', 'cpl']);

export const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain', md: 'text/markdown', markdown: 'text/markdown', csv: 'text/csv', tsv: 'text/tab-separated-values', json: 'application/json',
  html: 'text/html', htm: 'text/html', rtf: 'application/rtf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  gif: 'image/gif', tif: 'image/tiff', tiff: 'image/tiff', zip: 'application/zip', xml: 'application/xml', yaml: 'text/yaml', yml: 'text/yaml',
  doc: 'application/msword', xls: 'application/vnd.ms-excel', ppt: 'application/vnd.ms-powerpoint',
};

const TEXT_EXT = new Set(['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'html', 'htm', 'rtf', 'xml', 'yaml', 'yml']);

/** Detects the real type from the first bytes. */
export function sniff(head: Buffer): 'pdf' | 'png' | 'jpeg' | 'webp' | 'gif' | 'tiff' | 'zip' | 'ole' | 'text' | 'binary' {
  if (head.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpeg';
  if (head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (head.subarray(0, 4).toString('latin1') === 'GIF8') return 'gif';
  if (['II*\u0000', 'MM\u0000*'].includes(head.subarray(0, 4).toString('latin1'))) return 'tiff';
  if (head[0] === 0x50 && head[1] === 0x4b && (head[2] === 3 || head[2] === 5 || head[2] === 7)) return 'zip';
  if (head.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) return 'ole';
  if (head.subarray(0, 2).toString('latin1') === 'MZ' || head.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) return 'binary';
  return head.subarray(0, 8192).includes(0) ? 'binary' : 'text';
}

/**
 * Checks that the content matches the extension. Returns the MIME type to store, or throws.
 * Unknown extensions are stored as opaque downloads; executables are refused.
 */
export function validateFileType(name: string, head: Buffer): string {
  const ext = extensionOf(name);
  if (BLOCKED.has(ext)) throw new PathError(`"${name}": executable files are not allowed.`);
  const kind = sniff(head);
  if (kind === 'binary' && (head.subarray(0, 2).toString('latin1') === 'MZ' || head[0] === 0x7f)) throw new PathError(`"${name}": executable content is not allowed.`);
  const expect: Record<string, Array<ReturnType<typeof sniff>>> = {
    pdf: ['pdf'], png: ['png'], jpg: ['jpeg'], jpeg: ['jpeg'], webp: ['webp'], gif: ['gif'], tif: ['tiff'], tiff: ['tiff'],
    docx: ['zip'], xlsx: ['zip'], pptx: ['zip'], zip: ['zip'], doc: ['ole'], xls: ['ole'], ppt: ['ole'],
  };
  if (expect[ext] && !expect[ext].includes(kind)) throw new PathError(`"${name}" does not contain what its extension says (.${ext}).`);
  if (TEXT_EXT.has(ext) && kind !== 'text') throw new PathError(`"${name}" is not a text file.`);
  return MIME_BY_EXT[ext] ?? (kind === 'text' ? 'text/plain' : 'application/octet-stream');
}
