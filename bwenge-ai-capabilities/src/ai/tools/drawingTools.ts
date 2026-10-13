import { renderDiagram, type DiagramSpec } from '../drawing/diagram.js';
import { renderVegaLite } from '../drawing/chart.js';
import { svgToPng } from '../drawing/rasterize.js';
import { sanitizeSvg, UnsafeSvgError } from '../drawing/svgSanitizer.js';
import { MIME } from '../files/mime.js';
import type { Tool } from '../types.js';
import { err, formatSize, saveFile } from './helpers.js';

const msg = (name: string, ref: { id: string; size: number }) =>
  `Created ${name} (${formatSize(ref.size)}, fileId ${ref.id}). It is shown to the user with a download button. To place it inside a document or presentation, use this fileId in an image block. Describe it in one or two sentences; do not paste the SVG code.`;

export const createDrawing: Tool = {
  definition: {
    name: 'create_drawing',
    description: 'Draw an illustration, icon, logo, floor plan, map sketch, infographic, poster or any vector picture by writing SVG. Use a viewBox (for example "0 0 800 600"), simple shapes, readable text (font-size 14 or more), and a white or coloured background rect. No scripts, no external images or fonts, no animation. Prefer this for drawings; use create_chart for data and create_diagram for flowcharts.',
    parameters: {
      type: 'object', required: ['svg'],
      properties: { svg: { type: 'string', description: 'Complete <svg> markup' }, title: { type: 'string' }, fileName: { type: 'string' } },
    },
  },
  async execute(input, ctx) {
    try {
      const svg = sanitizeSvg(input.svg);
      const png = svgToPng(svg, { width: 1600 });
      const ref = await saveFile(ctx, { name: input.fileName || input.title || 'drawing', ext: 'svg', mime: MIME.svg, kind: 'drawing', data: Buffer.from(svg, 'utf8'), previewPng: png.data });
      return { text: msg(ref.name, ref), attachments: [ref] };
    } catch (e: any) {
      if (e instanceof UnsafeSvgError) return err(`The SVG was rejected: ${e.message} Fix it and call create_drawing again.`);
      return err(`Could not render the drawing: ${String(e.message).slice(0, 250)}. Check that the SVG is valid XML.`);
    }
  },
};

export const createChart: Tool = {
  definition: {
    name: 'create_chart',
    description: 'Create a chart (bar, line, area, scatter, pie via arc, histogram, heatmap, box plot, stacked or grouped) from a Vega-Lite v5 specification. Data MUST be inline in data.values; URLs are blocked. Always include axis titles and a chart title.',
    parameters: {
      type: 'object', required: ['spec'],
      properties: { spec: { type: 'object', description: 'Vega-Lite v5 spec' }, fileName: { type: 'string' } },
    },
  },
  async execute(input, ctx) {
    try {
      const svg = sanitizeSvg(await renderVegaLite(input.spec), { maxBytes: 3_000_000 });
      const png = svgToPng(svg, { width: 1600 });
      const title = typeof input.spec?.title === 'string' ? input.spec.title : input.spec?.title?.text;
      const ref = await saveFile(ctx, { name: input.fileName || title || 'chart', ext: 'svg', mime: MIME.svg, kind: 'chart', data: Buffer.from(svg, 'utf8'), previewPng: png.data });
      return { text: msg(ref.name, ref), attachments: [ref] };
    } catch (e: any) {
      return err(`Could not create the chart: ${String(e.message).slice(0, 300)}`);
    }
  },
};

export const createDiagram: Tool = {
  definition: {
    name: 'create_diagram',
    description: 'Create a flowchart, process map, org chart, architecture diagram, mind-map-like tree, or decision tree. Give nodes and edges; layout is automatic. Shapes: box, rounded, diamond (decisions), ellipse (start/end). Colors: neutral, orange, teal, navy, gold, red, green, purple.',
    parameters: {
      type: 'object', required: ['spec'],
      properties: {
        fileName: { type: 'string' },
        spec: {
          type: 'object', required: ['nodes', 'edges'],
          properties: {
            title: { type: 'string' },
            direction: { type: 'string', enum: ['TB', 'LR'] },
            nodes: { type: 'array', maxItems: 80, items: { type: 'object', required: ['id', 'label'], properties: { id: { type: 'string' }, label: { type: 'string' }, shape: { type: 'string', enum: ['box', 'rounded', 'diamond', 'ellipse'] }, color: { type: 'string' } } } },
            edges: { type: 'array', items: { type: 'object', required: ['from', 'to'], properties: { from: { type: 'string' }, to: { type: 'string' }, label: { type: 'string' }, dashed: { type: 'boolean' } } } },
          },
        },
      },
    },
  },
  async execute(input, ctx) {
    try {
      const svg = sanitizeSvg(renderDiagram(input.spec as DiagramSpec));
      const png = svgToPng(svg, { width: 1600 });
      const ref = await saveFile(ctx, { name: input.fileName || input.spec.title || 'diagram', ext: 'svg', mime: MIME.svg, kind: 'diagram', data: Buffer.from(svg, 'utf8'), previewPng: png.data });
      return { text: msg(ref.name, ref), attachments: [ref] };
    } catch (e: any) {
      return err(`Could not create the diagram: ${String(e.message).slice(0, 300)}`);
    }
  },
};

export const generateImage: Tool = {
  definition: {
    name: 'generate_image',
    description: 'Generate a realistic or artistic raster picture (photo-style, painting, illustration with complex shading) from a text description. Slower and costlier than create_drawing; use it only when vector drawing is not suitable.',
    parameters: {
      type: 'object', required: ['prompt'],
      properties: { prompt: { type: 'string', maxLength: 2000 }, size: { type: 'string', enum: ['1024x1024', '1024x1536', '1536x1024'], default: '1024x1024' }, fileName: { type: 'string' } },
    },
  },
  async execute(input, ctx) {
    const provider = ctx.services.image;
    if (!provider) return err('Image generation is not configured.');
    try {
      const out = await provider.generate(input.prompt, { size: input.size, signal: ctx.signal });
      const ext = out.mime.includes('png') ? 'png' : out.mime.includes('webp') ? 'webp' : 'jpg';
      if (!/^image\/(png|jpeg|webp)/.test(out.mime)) return err('The image provider returned an unsupported format.');
      const ref = await saveFile(ctx, { name: input.fileName || 'image', ext, mime: out.mime, kind: 'image', data: out.data });
      return { text: msg(ref.name, ref), attachments: [ref] };
    } catch (e: any) {
      return err(`Image generation failed: ${String(e.message).slice(0, 250)}`);
    }
  },
};
