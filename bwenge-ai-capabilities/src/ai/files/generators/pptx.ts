import * as PptxNs from 'pptxgenjs';
import { parseInline } from '../../util/text.js';
import type { ImageResolver } from './spec.js';

type PptxCtor = typeof import('pptxgenjs').default;
// pptxgenjs ships a default-exported class; under NodeNext typings the namespace import wraps it.
const PptxGenJS: PptxCtor = ((PptxNs as any).default?.default ?? (PptxNs as any).default ?? PptxNs) as PptxCtor;
type Slide = ReturnType<InstanceType<PptxCtor>['addSlide']>;

export interface SlideSpec {
  layout?: 'title' | 'section' | 'bullets' | 'two-column' | 'image' | 'table' | 'quote';
  title?: string;
  subtitle?: string;
  bullets?: string[];
  leftBullets?: string[];
  rightBullets?: string[];
  image?: { fileId?: string; dataUrl?: string; caption?: string };
  table?: { header?: string[]; rows: string[][] };
  quote?: string;
  attribution?: string;
  notes?: string;
}
export interface PresentationSpec {
  title: string;
  subtitle?: string;
  author?: string;
  theme?: { accent?: string; background?: string; text?: string };
  slides: SlideSpec[];
}

const MAX_SLIDES = 100;
const hex = (v: string | undefined, d: string) => (v && /^#?[0-9a-fA-F]{6}$/.test(v) ? v.replace('#', '').toUpperCase() : d);
const plain = (t: string) => parseInline(t).map((r) => r.text).join('');

export async function generatePptx(spec: PresentationSpec, resolveImage: ImageResolver): Promise<Buffer> {
  if (!spec?.title || !Array.isArray(spec.slides)) throw new Error('Presentation needs a title and slides.');
  if (spec.slides.length > MAX_SLIDES) throw new Error(`Too many slides (max ${MAX_SLIDES}).`);

  const accent = hex(spec.theme?.accent, 'D2691E');
  const bg = hex(spec.theme?.background, 'FFFFFF');
  const text = hex(spec.theme?.text, '1B1B1F');
  const font = 'Calibri';

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 in
  pptx.title = spec.title;
  pptx.author = spec.author ?? 'Bwenge';
  pptx.company = 'Bwenge';
  const W = 13.33;

  const addTitle = (slide: Slide, title?: string) => {
    if (!title) return;
    slide.addText(plain(title), { x: 0.6, y: 0.35, w: W - 1.2, h: 0.9, fontFace: font, fontSize: 30, bold: true, color: text, valign: 'middle', fit: 'shrink' });
    slide.addShape('rect', { x: 0.6, y: 1.25, w: 1.1, h: 0.06, fill: { color: accent }, line: { color: accent, width: 0 } });
  };
  const bullets = (items: string[] = []) =>
    items.map((t) => ({ text: plain(t), options: { bullet: true, breakLine: true } }));

  // Title slide
  const first = pptx.addSlide();
  first.background = { color: bg };
  first.addShape('rect', { x: 0, y: 0, w: 0.35, h: 7.5, fill: { color: accent }, line: { color: accent, width: 0 } });
  first.addText(plain(spec.title), { x: 0.9, y: 2.3, w: W - 1.8, h: 1.6, fontFace: font, fontSize: 44, bold: true, color: text, valign: 'bottom', fit: 'shrink' });
  if (spec.subtitle) first.addText(plain(spec.subtitle), { x: 0.9, y: 4.0, w: W - 1.8, h: 0.9, fontFace: font, fontSize: 22, color: '666666', valign: 'top', fit: 'shrink' });

  for (const s of spec.slides) {
    const slide = pptx.addSlide();
    slide.background = { color: bg };
    const layout = s.layout ?? (s.table ? 'table' : s.image ? 'image' : s.leftBullets || s.rightBullets ? 'two-column' : s.quote ? 'quote' : 'bullets');
    if (layout === 'section') {
      slide.addShape('rect', { x: 0, y: 0, w: W, h: 7.5, fill: { color: accent }, line: { color: accent, width: 0 } });
      slide.addText(plain(s.title ?? ''), { x: 0.9, y: 2.6, w: W - 1.8, h: 1.6, fontFace: font, fontSize: 40, bold: true, color: 'FFFFFF', valign: 'middle', fit: 'shrink' });
      if (s.subtitle) slide.addText(plain(s.subtitle), { x: 0.9, y: 4.2, w: W - 1.8, h: 0.8, fontFace: font, fontSize: 20, color: 'FFFFFF', fit: 'shrink' });
    } else {
      addTitle(slide, s.title);
      if (layout === 'bullets') {
        slide.addText(bullets(s.bullets), { x: 0.8, y: 1.6, w: W - 1.6, h: 5.2, fontFace: font, fontSize: 28, color: text, valign: 'top', paraSpaceAfter: 14, fit: 'shrink' });
      } else if (layout === 'two-column') {
        slide.addText(bullets(s.leftBullets), { x: 0.8, y: 1.6, w: (W - 2) / 2, h: 5.2, fontFace: font, fontSize: 24, color: text, valign: 'top', paraSpaceAfter: 10, fit: 'shrink' });
        slide.addText(bullets(s.rightBullets), { x: 0.8 + (W - 2) / 2 + 0.4, y: 1.6, w: (W - 2) / 2, h: 5.2, fontFace: font, fontSize: 24, color: text, valign: 'top', paraSpaceAfter: 10, fit: 'shrink' });
      } else if (layout === 'image' && s.image) {
        const img = await resolveImage(s.image);
        if (img) {
          const maxW = W - 1.6, maxH = 4.9;
          let w = maxW, h = (w * img.height) / img.width;
          if (h > maxH) { h = maxH; w = (h * img.width) / img.height; }
          slide.addImage({ data: `image/${img.type === 'png' ? 'png' : 'jpeg'};base64,${img.data.toString('base64')}`, x: (W - w) / 2, y: 1.6, w, h });
          if (s.image.caption) slide.addText(plain(s.image.caption), { x: 0.8, y: 6.7, w: W - 1.6, h: 0.5, fontFace: font, fontSize: 14, italic: true, color: '666666', align: 'center' });
        }
        if (s.bullets?.length) slide.addText(bullets(s.bullets), { x: 0.8, y: 6.5, w: W - 1.6, h: 0.8, fontFace: font, fontSize: 14, color: text });
      } else if (layout === 'table' && s.table) {
        const rows: any[] = [];
        if (s.table.header?.length) rows.push(s.table.header.map((h) => ({ text: plain(h), options: { bold: true, fill: { color: 'EAEAEA' }, color: text } })));
        for (const r of s.table.rows) rows.push(r.map((c) => ({ text: plain(String(c ?? '')), options: { color: text } })));
        slide.addTable(rows, { x: 0.8, y: 1.6, w: W - 1.6, fontFace: font, fontSize: 14, border: { type: 'solid', color: 'CCCCCC', pt: 0.75 }, valign: 'middle', autoPage: true });
      } else if (layout === 'quote') {
        slide.addText(`\u201C${plain(s.quote ?? '')}\u201D`, { x: 1.2, y: 2.0, w: W - 2.4, h: 3, fontFace: 'Georgia', fontSize: 32, italic: true, color: text, valign: 'middle', fit: 'shrink' });
        if (s.attribution) slide.addText(`\u2014 ${plain(s.attribution)}`, { x: 1.2, y: 5.2, w: W - 2.4, h: 0.6, fontFace: font, fontSize: 18, color: '666666', align: 'right' });
      }
    }
    if (s.notes) slide.addNotes(s.notes);
  }
  const out = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer | Uint8Array | ArrayBuffer;
  return Buffer.from(out as Uint8Array);
}
