import type { AttachmentKind } from '../types.js';

export const MIME = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pdf: 'application/pdf',
  csv: 'text/csv; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  html: 'text/html; charset=utf-8',
  json: 'application/json',
  scene: 'application/vnd.bwenge.scene+json',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  zip: 'application/zip',
} as const;

/** Text/code extensions the AI may create (always served as downloads, never rendered inline). */
export const TEXT_EXTENSIONS: Record<string, { mime: string; kind: AttachmentKind }> = {
  txt: { mime: MIME.txt, kind: 'text' },
  md: { mime: MIME.md, kind: 'text' },
  csv: { mime: MIME.csv, kind: 'text' },
  json: { mime: MIME.json, kind: 'code' },
  html: { mime: MIME.html, kind: 'code' },
  css: { mime: 'text/css; charset=utf-8', kind: 'code' },
  js: { mime: 'text/javascript; charset=utf-8', kind: 'code' },
  ts: { mime: 'text/plain; charset=utf-8', kind: 'code' },
  tsx: { mime: 'text/plain; charset=utf-8', kind: 'code' },
  py: { mime: 'text/x-python; charset=utf-8', kind: 'code' },
  sql: { mime: 'text/plain; charset=utf-8', kind: 'code' },
  xml: { mime: 'application/xml; charset=utf-8', kind: 'code' },
  yaml: { mime: 'text/yaml; charset=utf-8', kind: 'code' },
  yml: { mime: 'text/yaml; charset=utf-8', kind: 'code' },
  ini: { mime: MIME.txt, kind: 'text' },
  tex: { mime: MIME.txt, kind: 'text' },
  r: { mime: MIME.txt, kind: 'code' },
  sh: { mime: MIME.txt, kind: 'code' },
};

/** Read PNG/JPEG dimensions from the header so images can be placed at the right aspect ratio. */
export function imageSize(buf: Buffer): { width: number; height: number; type: 'png' | 'jpg' } | null {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), type: 'png' };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7), type: 'jpg' };
      }
      i += 2 + len;
    }
  }
  return null;
}
