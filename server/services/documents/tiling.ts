import type { RecognizedElement, Region } from './recognize.js';
import { textSimilarity } from './metrics.js';
import type { UncertaintySignal } from './verify.js';

/**
 * Overlapping tiles for dense pages. The full-page pass gives layout and reading order (context);
 * tile passes read small handwriting at native resolution (detail). Tile readings are mapped back to
 * page space, merged with the full-page elements, and de-duplicated across overlaps.
 */

export interface Tile { index: number; row: number; col: number; x: number; y: number; width: number; height: number; core: Region }

export type TilingMode = 'auto' | 'always' | 'off';

/** Tile when the page would be downscaled by at least this factor for the full-page pass. */
export const AUTO_TILE_FACTOR = 1.35;

export function shouldTile(width: number, height: number, mode: TilingMode, modelMaxSide: number): boolean {
  if (mode === 'off') return false;
  if (mode === 'always') return true;
  return Math.max(width, height) / modelMaxSide >= AUTO_TILE_FACTOR;
}

/** Plans a grid of overlapping tiles (pixel coordinates) with each tile's non-overlapping "core" in page space (0–1000). */
export function planTiles(width: number, height: number, opts: { tileSize?: number; overlap?: number; maxTiles?: number } = {}): Tile[] {
  let size = opts.tileSize ?? 1800;
  const maxTiles = opts.maxTiles ?? 4;
  let cols = Math.max(1, Math.ceil(width / size));
  let rows = Math.max(1, Math.ceil(height / size));
  while (cols * rows > maxTiles) {
    size *= 1.15;
    cols = Math.max(1, Math.ceil(width / size));
    rows = Math.max(1, Math.ceil(height / size));
  }
  const cw = Math.ceil(width / cols);
  const ch = Math.ceil(height / rows);
  const ovx = Math.round(cw * (opts.overlap ?? 0.12));
  const ovy = Math.round(ch * (opts.overlap ?? 0.12));
  const tiles: Tile[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = Math.max(0, c * cw - ovx);
      const y = Math.max(0, r * ch - ovy);
      const x1 = Math.min(width, (c + 1) * cw + ovx);
      const y1 = Math.min(height, (r + 1) * ch + ovy);
      tiles.push({
        index: tiles.length, row: r, col: c, x, y, width: x1 - x, height: y1 - y,
        core: { x0: (c * cw / width) * 1000, y0: (r * ch / height) * 1000, x1: (Math.min(width, (c + 1) * cw) / width) * 1000, y1: (Math.min(height, (r + 1) * ch) / height) * 1000 },
      });
    }
  }
  return tiles;
}

/** Maps a region given in a tile's own 0–1000 space to page 0–1000 space. */
export function tileToPage(r: Region, t: Tile, width: number, height: number): Region {
  const fx = (v: number) => ((t.x + (v / 1000) * t.width) / width) * 1000;
  const fy = (v: number) => ((t.y + (v / 1000) * t.height) / height) * 1000;
  return { x0: fx(r.x0), y0: fy(r.y0), x1: fx(r.x1), y1: fy(r.y1) };
}

const area = (r: Region) => Math.max(0, r.x1 - r.x0) * Math.max(0, r.y1 - r.y0);
const inter = (a: Region, b: Region) => area({ x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) });
const center = (r: Region) => ({ x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 });
const inside = (p: { x: number; y: number }, r: Region, pad = 0) => p.x >= r.x0 - pad && p.x <= r.x1 + pad && p.y >= r.y0 - pad && p.y <= r.y1 + pad;
const contained = (inner: Region, outer: Region) => area(inner) > 0 && inter(inner, outer) / area(inner);

export interface TileElement { tile: Tile; element: RecognizedElement }

export interface MergeResult {
  elements: RecognizedElement[];
  readingOrder: string[];
  signals: Record<string, UncertaintySignal[]>;
  alternates: Record<string, Array<{ source: 'full_page' | 'tile'; text: string }>>;
  stats: { tiles: number; replaced: number; agreed: number; added: number; duplicatesRemoved: number };
}

const REPLACEABLE = new Set(['heading', 'paragraph', 'list_item', 'marginal_note', 'page_number', 'header_footer', 'other']);
export const TILE_AGREE = 0.9;

/**
 * Merges tile readings (already in page coordinates) into the full-page elements:
 * - a full-page element that lies in one tile's core is compared with the tile elements inside it;
 *   agreement keeps the full-page reading, disagreement uses the close-up reading, keeps the other as an
 *   alternate, and adds a high-severity signal;
 * - tile elements not covered by any full-page element are de-duplicated across overlaps and added
 *   (flagged as found only at tile resolution), inserted into reading order by position.
 */
export function mergeTileReadings(page: { elements: RecognizedElement[]; readingOrder: string[] }, tileEls: TileElement[], tiles: Tile[]): MergeResult {
  const signals: MergeResult['signals'] = {};
  const alternates: MergeResult['alternates'] = {};
  const used = new Set<TileElement>();
  const stats = { tiles: tiles.length, replaced: 0, agreed: 0, added: 0, duplicatesRemoved: 0 };
  const elements = page.elements.map((f) => {
    const c = center(f.region);
    const tile = tiles.find((t) => inside(c, t.core));
    if (!tile) return f;
    const fullyInCore = (contained(f.region, tile.core) || 0) >= 0.98;
    const parts = tileEls.filter((te) => te.tile === tile && inside(center(te.element.region), f.region, 10));
    if (!parts.length) return f;
    parts.forEach((p) => used.add(p));
    // Elements of other tiles inside this region are duplicates of the same text.
    tileEls.filter((te) => te.tile !== tile && inside(center(te.element.region), f.region, 10)).forEach((p) => used.add(p));
    const tileText = parts.sort((a, b) => a.element.region.y0 - b.element.region.y0 || a.element.region.x0 - b.element.region.x0).map((p) => p.element.text).join(' ');
    const sim = textSimilarity(f.text, tileText);
    if (sim >= TILE_AGREE) { stats.agreed++; return f; }
    (signals[f.id] ??= []).push({ source: 'tile_disagreement', severity: 'high', detail: `The full-page and close-up readings differ (similarity ${sim.toFixed(2)}): "${f.text.slice(0, 80)}" vs "${tileText.slice(0, 80)}".` });
    if (!fullyInCore || !REPLACEABLE.has(f.type)) {
      (alternates[f.id] ??= []).push({ source: 'tile', text: tileText });
      return f;
    }
    stats.replaced++;
    (alternates[f.id] ??= []).push({ source: 'full_page', text: f.text });
    const spans = parts.flatMap((p) => p.element.uncertainSpans);
    const worst = parts.some((p) => p.element.legibility === 'unclear') ? 'unclear' : parts.some((p) => p.element.legibility === 'partly_unclear') ? 'partly_unclear' : f.legibility;
    return { ...f, text: tileText, uncertainSpans: [...f.uncertainSpans, ...spans], legibility: worst };
  });

  // Unmatched tile elements: drop those covered by a full-page element, de-duplicate across tiles, add the rest.
  const leftovers = tileEls.filter((te) => !used.has(te) && !page.elements.some((f) => (contained(te.element.region, f.region) || 0) >= 0.5));
  const kept: TileElement[] = [];
  for (const te of leftovers.sort((a, b) => depth(b) - depth(a))) {
    const dup = kept.find((k) => (contained(te.element.region, k.element.region) || 0) >= 0.5 && textSimilarity(te.element.text, k.element.text) >= 0.6);
    if (dup) { stats.duplicatesRemoved++; continue; }
    kept.push(te);
  }
  const order = [...page.readingOrder];
  for (const te of kept.sort((a, b) => a.element.region.y0 - b.element.region.y0)) {
    const id = `t${te.tile.index}-${te.element.id}`;
    elements.push({ ...te.element, id });
    signals[id] = [{ source: 'tile_only', severity: 'medium', detail: 'Found only in the close-up (tile) pass, not in the full-page reading.' }];
    const byId = new Map(elements.map((e) => [e.id, e]));
    const pos = order.findIndex((oid) => (byId.get(oid)?.region.y0 ?? 0) > te.element.region.y0);
    order.splice(pos === -1 ? order.length : pos, 0, id);
    stats.added++;
  }
  return { elements, readingOrder: order, signals, alternates, stats };
}

/** How far an element's centre is from its tile's core edges (larger = safer from cut-off text). */
function depth(te: TileElement): number {
  const c = center(te.element.region);
  const k = te.tile.core;
  return Math.min(c.x - k.x0, k.x1 - c.x, c.y - k.y0, k.y1 - c.y);
}
