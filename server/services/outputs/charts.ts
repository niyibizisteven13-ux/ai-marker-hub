import { renderVegaLite } from '../ai/drawing/chart.js';
import { sanitizeSvg } from '../ai/drawing/svgSanitizer.js';
import type { ChartConfig } from './spec.js';
import type { Row } from './tables.js';

/**
 * Compiles a validated ChartConfig into Vega-Lite and renders it with the existing renderer. The compiler,
 * not the model, adds the title, axis titles with units, legend, tooltips and the source line, so every
 * chart carries them. Data is always inline; Vega-Lite URL loading is never emitted.
 */

const label = (a: { title?: string; unit?: string }) => (a.unit && a.unit !== 'none' ? `${a.title} (${a.unit})` : a.title);

function guessType(rows: Row[], field: string): 'quantitative' | 'nominal' | 'temporal' {
  const vals = rows.map((r) => r[field]).filter((v) => v !== null && v !== undefined);
  if (vals.length && vals.every((v) => typeof v === 'number')) return 'quantitative';
  if (vals.length && vals.every((v) => typeof v === 'string' && /^\d{4}-\d{2}(-\d{2})?/.test(v))) return 'temporal';
  return 'nominal';
}

export function compileChart(c: ChartConfig, title: string, rows: Row[]): Record<string, unknown> {
  const xType = c.x.type ?? (c.type === 'histogram' ? 'quantitative' : guessType(rows, c.x.field));
  const yType = c.y ? c.y.type ?? guessType(rows, c.y.field) : 'quantitative';
  const longLabels = xType === 'nominal' && rows.some((r) => String(r[c.x.field] ?? '').length > 10);
  const enc: Record<string, any> = {};
  const tooltip = [c.x, c.y, c.color].filter(Boolean).map((a) => ({ field: a!.field, title: label(a!), type: a === c.x ? xType : a === c.y ? yType : 'nominal' }));
  let mark: any;
  switch (c.type) {
    case 'histogram':
      mark = { type: 'bar', tooltip: true };
      enc.x = { field: c.x.field, type: 'quantitative', bin: { maxbins: 30 }, title: label(c.x) };
      enc.y = { aggregate: 'count', type: 'quantitative', title: c.y ? label(c.y) : 'Count' };
      break;
    case 'pie':
      mark = { type: 'arc', tooltip: true };
      enc.theta = { field: c.x.field, type: 'quantitative', title: label(c.x) };
      enc.color = { field: c.color!.field, type: 'nominal', title: label(c.color!), legend: { orient: 'bottom', columns: 3 } };
      break;
    case 'heatmap':
      mark = { type: 'rect', tooltip: true };
      enc.x = { field: c.x.field, type: c.x.type ?? 'nominal', title: label(c.x) };
      enc.y = { field: c.y!.field, type: c.y!.type ?? 'nominal', title: label(c.y!) };
      enc.color = { field: c.color?.field ?? 'value', type: 'quantitative', title: c.color ? label(c.color) : 'Value', legend: { orient: 'bottom' } };
      break;
    case 'boxplot':
      mark = { type: 'boxplot', extent: 1.5 };
      enc.x = { field: c.x.field, type: xType === 'quantitative' ? 'nominal' : xType, title: label(c.x) };
      enc.y = { field: c.y!.field, type: 'quantitative', title: label(c.y!) };
      break;
    default: {
      const t = c.type === 'scatter' ? 'point' : c.type === 'line' ? 'line' : c.type === 'area' ? 'area' : 'bar';
      mark = { type: t, tooltip: true, ...(t === 'line' ? { point: true } : {}) };
      enc.x = { field: c.x.field, type: xType, title: label(c.x), axis: longLabels ? { labelAngle: -35, labelLimit: 140 } : { labelLimit: 160 } };
      enc.y = { field: c.y!.field, type: yType, title: label(c.y!) };
      if (c.color) {
        enc.color = { field: c.color.field, type: 'nominal', title: label(c.color), legend: { orient: 'bottom' } };
        if (c.type === 'grouped-bar') enc.xOffset = { field: c.color.field };
      }
    }
  }
  if (!enc.tooltip && c.type !== 'boxplot') enc.tooltip = tooltip;
  return {
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
    title: { text: title, subtitle: [...(c.subtitle ? [c.subtitle] : []), `Source: ${c.sourceNote}`], anchor: 'start', subtitleFontSize: 11 },
    width: 640, height: 360, autosize: { type: 'fit', contains: 'padding' },
    background: 'white',
    config: { font: 'Inter, Segoe UI, Arial, sans-serif', axis: { labelFontSize: 11, titleFontSize: 12 }, legend: { labelLimit: 200 } },
    data: { values: rows },
    mark, encoding: enc,
  };
}

/** Renders to sanitised SVG that scales to its container (no fixed pixel width, no external references). */
export async function renderChartSvg(c: ChartConfig, title: string, rows: Row[]): Promise<string> {
  if (!rows.length) throw new Error('The chart has no data rows.');
  const svg = sanitizeSvg(await renderVegaLite(compileChart(c, title, rows)), { maxBytes: 3_000_000 });
  return makeResponsive(svg);
}

/** Root <svg>: keep a viewBox, drop fixed width/height so it scales down instead of overflowing. */
export function makeResponsive(svg: string): string {
  return svg.replace(/<svg\b[^>]*>/, (tag) => {
    const w = /\swidth="([\d.]+)/.exec(tag)?.[1], h = /\sheight="([\d.]+)/.exec(tag)?.[1];
    let t = tag.replace(/\s(width|height)="[^"]*"/g, '');
    if (!/viewBox=/.test(t) && w && h) t = t.replace('<svg', `<svg viewBox="0 0 ${w} ${h}"`);
    t = t.replace(/\sstyle="[^"]*"/, '');
    return t.replace('<svg', `<svg${/\srole=/.test(t) ? '' : ' role="img"'} style="max-width:100%;height:auto;display:block"`);
  });
}
