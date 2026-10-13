import { Resvg } from '@resvg/resvg-js';
import { interFontPath } from '../util/fonts.js';

export interface RasterOptions {
  width?: number;
  background?: string;
  fontFiles?: string[];
}

/** SVG -> PNG (also used to place drawings inside DOCX, PDF, and PPTX files). */
export function svgToPng(svg: string, opts: RasterOptions = {}): { data: Buffer; width: number; height: number } {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: Math.min(Math.max(opts.width ?? 1600, 200), 4000) },
    background: opts.background ?? '#ffffff',
    font: {
      loadSystemFonts: true,
      fontFiles: opts.fontFiles ?? [interFontPath('regular'), interFontPath('bold')],
      defaultFontFamily: 'Inter',
    },
  });
  const img = resvg.render();
  return { data: Buffer.from(img.asPng()), width: img.width, height: img.height };
}
