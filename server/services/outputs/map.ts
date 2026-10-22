import { escapeHtml } from '../analytics/htmlReport.js';

/**
 * Offline SVG maps: choropleths from GeoJSON polygons (values in feature properties) and proportional
 * point maps from coordinates. No tiles, CDNs or network calls; boundaries must be supplied (e.g. a
 * district GeoJSON in a knowledge repository). Equirectangular projection scaled by cos(latitude), which
 * is adequate for country-scale maps such as Rwanda; the projection is stated on the map.
 */

export class MapError extends Error {}

type Pos = [number, number];
interface Feature { geometry: { type: string; coordinates: any } | null; properties?: Record<string, unknown> }

const PALETTE = ['#e8f1fa', '#b9d4ee', '#7fb0dc', '#3f86c4', '#145a9c'];
const W = 800, H = 560, PAD = 24, TOP = 70, BOTTOM = 90;

function rings(g: Feature['geometry']): Pos[][] {
  if (!g) return [];
  if (g.type === 'Polygon') return g.coordinates as Pos[][];
  if (g.type === 'MultiPolygon') return (g.coordinates as Pos[][][]).flat();
  return [];
}

export function renderMap(opts: { title: string; sourceNote: string; geojson?: { features: Feature[] }; points?: Array<{ lat: number; lon: number; label?: string; value?: number }>; valueField?: string; labelField?: string; unit?: string }): { svg: string; warnings: string[] } {
  const warnings: string[] = [];
  const feats = (opts.geojson?.features ?? []).filter((f) => f && f.geometry);
  const polys = feats.filter((f) => ['Polygon', 'MultiPolygon'].includes(f.geometry!.type));
  const geoPoints = feats.filter((f) => f.geometry!.type === 'Point').map((f) => ({ lon: (f.geometry!.coordinates as Pos)[0], lat: (f.geometry!.coordinates as Pos)[1], label: opts.labelField ? String(f.properties?.[opts.labelField] ?? '') : undefined, value: opts.valueField ? Number(f.properties?.[opts.valueField]) : undefined }));
  const points = [...(opts.points ?? []), ...geoPoints].filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  const coords: Pos[] = [...polys.flatMap((f) => rings(f.geometry).flat()), ...points.map((p) => [p.lon, p.lat] as Pos)];
  if (!coords.length) throw new MapError('The map has no coordinates.');
  if (coords.length > 200_000) throw new MapError('The boundary data is too detailed (more than 200,000 points); simplify it first.');
  if (coords.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 180 || Math.abs(y) > 90)) throw new MapError('Coordinates must be longitude/latitude in degrees (WGS84).');

  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of coords) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const k = Math.cos((((minY + maxY) / 2) * Math.PI) / 180);
  const spanX = Math.max((maxX - minX) * k, 1e-6), spanY = Math.max(maxY - minY, 1e-6);
  const scale = Math.min((W - 2 * PAD) / spanX, (H - TOP - BOTTOM) / spanY);
  const ox = PAD + (W - 2 * PAD - spanX * scale) / 2, oy = TOP + (H - TOP - BOTTOM - spanY * scale) / 2;
  const proj = ([x, y]: Pos) => [ox + (x - minX) * k * scale, oy + (maxY - y) * scale] as const;
  const path = (rs: Pos[][]) => rs.map((r) => `M${r.map((p) => proj(p).map((v) => v.toFixed(1)).join(',')).join('L')}Z`).join('');

  // Choropleth classes: equal-count (quantile) breaks over the supplied values.
  const values = polys.map((f) => Number(f.properties?.[opts.valueField ?? '']));
  const valid = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const classes = Math.min(5, new Set(valid).size);
  const breaks = classes ? Array.from({ length: classes + 1 }, (_, i) => valid[Math.min(valid.length - 1, Math.round((i * (valid.length - 1)) / classes))]) : [];
  const classOf = (v: number) => { for (let i = 1; i < breaks.length; i++) if (v <= breaks[i]) return i - 1; return breaks.length - 2; };
  if (opts.valueField && polys.length && valid.length < polys.length) warnings.push(`${polys.length - valid.length} area(s) have no value for "${opts.valueField}" and are shown as "No data".`);
  const unit = opts.unit && opts.unit !== 'none' ? ` (${opts.unit})` : '';
  const fmt = (v: number) => (Math.abs(v) >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : String(Number(v.toPrecision(3))));

  const shapes = polys.map((f, i) => {
    const v = values[i];
    const has = opts.valueField && Number.isFinite(v);
    const name = opts.labelField ? String(f.properties?.[opts.labelField] ?? '') : '';
    const fill = has ? PALETTE[Math.round((classOf(v) * (PALETTE.length - 1)) / Math.max(1, classes - 1))] : opts.valueField ? 'url(#nodata)' : '#dfe6ee';
    return `<path d="${path(rings(f.geometry))}" fill="${fill}" stroke="#ffffff" stroke-width="0.8"><title>${escapeHtml(name)}${has ? `: ${escapeHtml(fmt(v))}${escapeHtml(unit)}` : ''}</title></path>`;
  }).join('');
  const maxV = Math.max(...points.map((p) => Math.abs(p.value ?? 0)), 0);
  const dots = points.slice(0, 5000).map((p) => {
    const [x, y] = proj([p.lon, p.lat]);
    const r = p.value !== undefined && maxV > 0 ? 3 + 14 * Math.sqrt(Math.abs(p.value) / maxV) : 4;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="#d9480f" fill-opacity="0.7" stroke="#fff" stroke-width="0.8"><title>${escapeHtml(p.label ?? '')}${p.value !== undefined ? `: ${escapeHtml(fmt(p.value))}${escapeHtml(unit)}` : ''}</title></circle>`;
  }).join('');
  const legend = classes ? Array.from({ length: classes }, (_, i) => `<rect x="${PAD + i * 120}" y="${H - 62}" width="18" height="14" fill="${PALETTE[Math.round((i * (PALETTE.length - 1)) / Math.max(1, classes - 1))]}" stroke="#999" stroke-width="0.5"/><text x="${PAD + i * 120 + 24}" y="${H - 51}" font-size="11" fill="#333">${escapeHtml(fmt(breaks[i]))}–${escapeHtml(fmt(breaks[i + 1]))}</text>`).join('')
    + (valid.length < polys.length && opts.valueField ? `<rect x="${PAD + classes * 120}" y="${H - 62}" width="18" height="14" fill="url(#nodata)" stroke="#999" stroke-width="0.5"/><text x="${PAD + classes * 120 + 24}" y="${H - 51}" font-size="11" fill="#333">No data</text>` : '') : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" style="max-width:100%;height:auto;display:block" font-family="Inter, Segoe UI, Arial, sans-serif">
<defs><pattern id="nodata" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#f2f2f2"/><line x1="0" y1="0" x2="0" y2="6" stroke="#bbb" stroke-width="2"/></pattern></defs>
<rect width="${W}" height="${H}" fill="#ffffff"/>
<text x="${PAD}" y="30" font-size="18" font-weight="600" fill="#111">${escapeHtml(opts.title)}</text>
${opts.valueField ? `<text x="${PAD}" y="50" font-size="12" fill="#555">${escapeHtml(opts.valueField)}${escapeHtml(unit)}${classes ? ', quantile classes' : ''}</text>` : ''}
<g>${shapes}</g><g>${dots}</g>
${legend}
<text x="${PAD}" y="${H - 22}" font-size="10.5" fill="#555">Source: ${escapeHtml(opts.sourceNote)} · Projection: equirectangular (approximate) · Boundaries as supplied</text>
</svg>`;
  return { svg, warnings };
}
