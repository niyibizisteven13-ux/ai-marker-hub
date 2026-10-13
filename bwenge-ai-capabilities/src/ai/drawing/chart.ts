import * as vega from 'vega';
import * as vl from 'vega-lite';

/**
 * Vega-Lite chart -> SVG, rendered on the server with no browser.
 * Only inline data is allowed: remote data URLs and files are blocked.
 */

const blockedLoader = {
  load: async () => { throw new Error('External data is disabled. Put values in data.values.'); },
  sanitize: async () => { throw new Error('External data is disabled. Put values in data.values.'); },
  http: async () => { throw new Error('External data is disabled.'); },
  file: async () => { throw new Error('External data is disabled.'); },
} as unknown as ReturnType<typeof vega.loader>;

function hasExternalData(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some(hasExternalData);
  const o = node as Record<string, unknown>;
  if (typeof o.url === 'string' && ('data' in o || 'name' in o || 'format' in o || Object.keys(o).length <= 2)) return true;
  return Object.values(o).some(hasExternalData);
}

const THEME = {
  font: 'Inter',
  background: '#ffffff',
  axis: { labelFont: 'Inter', titleFont: 'Inter', labelColor: '#444', titleColor: '#222' },
  legend: { labelFont: 'Inter', titleFont: 'Inter' },
  title: { font: 'Inter', fontSize: 16, color: '#111' },
  range: { category: ['#D2691E', '#1FB3A6', '#12305A', '#C9A24B', '#7A5195', '#EF5675', '#5A8F29', '#888888'] },
};

export async function renderVegaLite(spec: Record<string, unknown>): Promise<string> {
  if (!spec || typeof spec !== 'object') throw new Error('Chart spec must be a Vega-Lite object.');
  if (hasExternalData(spec)) throw new Error('Chart data must be inline (data.values); URLs are not allowed.');
  const raw = JSON.stringify(spec);
  if (raw.length > 400_000) throw new Error('Chart spec is too large.');
  const s: Record<string, any> = { ...spec };
  if (!s.$schema) s.$schema = 'https://vega.github.io/schema/vega-lite/v5.json';
  if (s.width === undefined && !s.hconcat && !s.vconcat && !s.concat && !s.facet && !s.repeat) s.width = 560;
  if (s.height === undefined && !s.hconcat && !s.vconcat && !s.concat && !s.facet && !s.repeat) s.height = 340;
  s.config = { ...THEME, ...(s.config ?? {}) };
  const compiled = vl.compile(s as any).spec;
  const view = new vega.View(vega.parse(compiled), { renderer: 'none', loader: blockedLoader, logLevel: vega.Error });
  const svg = await view.toSVG();
  view.finalize();
  return svg;
}
