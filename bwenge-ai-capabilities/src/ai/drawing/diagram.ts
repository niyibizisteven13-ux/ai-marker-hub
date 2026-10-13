import dagre from '@dagrejs/dagre';
import { escapeHtml } from '../util/text.js';

export interface DiagramNode {
  id: string;
  label: string;
  shape?: 'box' | 'rounded' | 'diamond' | 'ellipse';
  /** One of: neutral, orange, teal, navy, gold, red, green, purple */
  color?: string;
}
export interface DiagramEdge { from: string; to: string; label?: string; dashed?: boolean }
export interface DiagramSpec {
  title?: string;
  direction?: 'TB' | 'LR';
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

const PALETTE: Record<string, { fill: string; stroke: string; text: string }> = {
  neutral: { fill: '#F3F4F6', stroke: '#9CA3AF', text: '#111827' },
  orange: { fill: '#FDE9DC', stroke: '#D2691E', text: '#5A2A08' },
  teal: { fill: '#D7F5F1', stroke: '#1FB3A6', text: '#0B4A44' },
  navy: { fill: '#DCE6F5', stroke: '#12305A', text: '#0B1F3A' },
  gold: { fill: '#FAF0D2', stroke: '#C9A24B', text: '#5B4410' },
  red: { fill: '#FBE0E0', stroke: '#C0392B', text: '#5C1A14' },
  green: { fill: '#DDF3E1', stroke: '#2E8B57', text: '#14401F' },
  purple: { fill: '#ECE3F7', stroke: '#7A5195', text: '#3A2150' },
};

const MAX_NODES = 80;
const FONT = 14;
const CHAR_W = 7.6;

function wrapLabel(label: string, max = 22): string[] {
  const out: string[] = [];
  for (const para of String(label).split('\n')) {
    let line = '';
    for (const w of para.split(/\s+/)) {
      if ((line + ' ' + w).trim().length > max && line) { out.push(line); line = w; } else line = (line + ' ' + w).trim();
    }
    out.push(line);
  }
  return out.slice(0, 6);
}

export function renderDiagram(spec: DiagramSpec): string {
  if (!spec || !Array.isArray(spec.nodes) || !spec.nodes.length) throw new Error('Diagram needs nodes.');
  if (spec.nodes.length > MAX_NODES) throw new Error(`Too many nodes (max ${MAX_NODES}).`);
  const ids = new Set(spec.nodes.map((n) => n.id));
  if (ids.size !== spec.nodes.length) throw new Error('Node ids must be unique.');
  for (const e of spec.edges ?? []) if (!ids.has(e.from) || !ids.has(e.to)) throw new Error(`Edge references unknown node: ${e.from} -> ${e.to}`);

  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: spec.direction === 'LR' ? 'LR' : 'TB', nodesep: 40, ranksep: 56, marginx: 24, marginy: spec.title ? 56 : 24 });
  g.setDefaultEdgeLabel(() => ({}));

  const lines = new Map<string, string[]>();
  for (const n of spec.nodes) {
    const ls = wrapLabel(n.label);
    lines.set(n.id, ls);
    const textW = Math.max(...ls.map((l) => l.length)) * CHAR_W;
    const shape = n.shape ?? 'rounded';
    const w = Math.max(88, textW + (shape === 'diamond' ? 80 : 36));
    const h = Math.max(44, ls.length * (FONT + 4) + (shape === 'diamond' ? 44 : 22));
    g.setNode(n.id, { width: w, height: h });
  }
  (spec.edges ?? []).forEach((e, i) => g.setEdge({ v: e.from, w: e.to, name: String(i) }, { width: e.label ? e.label.length * 6.5 + 12 : 0, height: e.label ? 18 : 0, labelpos: 'c' }));
  dagre.layout(g);

  const graph = g.graph();
  const W = Math.ceil(graph.width ?? 400);
  const H = Math.ceil(graph.height ?? 300);
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${escapeHtml(spec.title ?? 'Diagram')}">`);
  out.push('<defs><marker id="arr" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0 0 L10 4 L0 8 Z" fill="#6B7280"/></marker></defs>');
  out.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  if (spec.title) out.push(`<text x="${W / 2}" y="30" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="700" fill="#111827">${escapeHtml(spec.title)}</text>`);

  (spec.edges ?? []).forEach((e, i) => {
    const edge = g.edge({ v: e.from, w: e.to, name: String(i) });
    const pts = edge.points as Array<{ x: number; y: number }>;
    const d = pts.map((p, k) => `${k ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    out.push(`<path d="${d}" fill="none" stroke="#6B7280" stroke-width="1.6" ${e.dashed ? 'stroke-dasharray="6 4"' : ''} marker-end="url(#arr)"/>`);
    if (e.label) {
      const mid = pts[Math.floor(pts.length / 2)];
      const lw = e.label.length * 6.5 + 10;
      out.push(`<rect x="${(mid.x - lw / 2).toFixed(1)}" y="${(mid.y - 10).toFixed(1)}" width="${lw.toFixed(1)}" height="18" rx="4" fill="#ffffff" fill-opacity="0.92"/>`);
      out.push(`<text x="${mid.x.toFixed(1)}" y="${(mid.y + 3).toFixed(1)}" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="12" fill="#374151">${escapeHtml(e.label)}</text>`);
    }
  });

  for (const n of spec.nodes) {
    const p = g.node(n.id);
    const c = PALETTE[n.color ?? 'neutral'] ?? PALETTE.neutral;
    const x = p.x - p.width / 2, y = p.y - p.height / 2;
    const shape = n.shape ?? 'rounded';
    if (shape === 'ellipse') out.push(`<ellipse cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" rx="${(p.width / 2).toFixed(1)}" ry="${(p.height / 2).toFixed(1)}" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.6"/>`);
    else if (shape === 'diamond') out.push(`<polygon points="${p.x},${y} ${x + p.width},${p.y} ${p.x},${y + p.height} ${x},${p.y}" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.6"/>`);
    else out.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${p.width.toFixed(1)}" height="${p.height.toFixed(1)}" rx="${shape === 'box' ? 3 : 10}" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.6"/>`);
    const ls = lines.get(n.id)!;
    const startY = p.y - ((ls.length - 1) * (FONT + 4)) / 2 + 5;
    ls.forEach((l, i) => out.push(`<text x="${p.x.toFixed(1)}" y="${(startY + i * (FONT + 4)).toFixed(1)}" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="${FONT}" fill="${c.text}">${escapeHtml(l)}</text>`));
  }
  out.push('</svg>');
  return out.join('\n');
}
