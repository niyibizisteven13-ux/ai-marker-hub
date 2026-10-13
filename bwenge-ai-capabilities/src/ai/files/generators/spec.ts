/** JSON "document model" the AI fills in. One spec renders to DOCX, PDF, HTML or Markdown. */

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3 | 4; text: string }
  | { type: 'paragraph'; text: string; align?: 'left' | 'center' | 'right' | 'justify' }
  | { type: 'list'; ordered?: boolean; items: string[] }
  | { type: 'table'; header?: string[]; rows: string[][]; columnWidths?: number[] }
  | { type: 'image'; fileId?: string; dataUrl?: string; widthPx?: number; caption?: string; alt?: string }
  | { type: 'quote'; text: string }
  | { type: 'code'; text: string; language?: string }
  | { type: 'pageBreak' };

export interface DocumentSpec {
  title: string;
  subtitle?: string;
  author?: string;
  /** BCP-47 language tag, e.g. "en", "fr", "rw". */
  language?: string;
  header?: string;
  footer?: string;
  pageNumbers?: boolean;
  blocks: Block[];
}

export interface ResolvedImage {
  data: Buffer;
  type: 'png' | 'jpg';
  width: number;
  height: number;
}

/** Looks up an image by generated-file id or data URL. Returns null if it cannot be used. */
export type ImageResolver = (ref: { fileId?: string; dataUrl?: string }) => Promise<ResolvedImage | null>;

export const MAX_BLOCKS = 2000;
export const MAX_TABLE_CELLS = 20000;

export function validateDocumentSpec(spec: DocumentSpec): void {
  if (!spec || typeof spec.title !== 'string' || !spec.title.trim()) throw new Error('Document needs a title.');
  if (!Array.isArray(spec.blocks)) throw new Error('Document needs a blocks array.');
  if (spec.blocks.length > MAX_BLOCKS) throw new Error(`Too many blocks (max ${MAX_BLOCKS}).`);
  let cells = 0;
  for (const b of spec.blocks) {
    if (b.type === 'table') {
      if (!Array.isArray(b.rows)) throw new Error('Table needs rows.');
      cells += (b.rows.length + 1) * Math.max(b.header?.length ?? 0, ...b.rows.map((r) => r.length), 1);
    }
  }
  if (cells > MAX_TABLE_CELLS) throw new Error('Tables are too large.');
}
