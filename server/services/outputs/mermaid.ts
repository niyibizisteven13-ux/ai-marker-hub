import type { DiagramSpec } from '../ai/drawing/diagram.js';

/**
 * Mermaid flowchart subset → the existing diagram renderer (server-side SVG, no browser, no Mermaid JS).
 * Supported: graph/flowchart TB|TD|BT|LR|RL; nodes A[box] A(rounded) A([stadium]) A{decision} A((circle))
 * A[[subroutine]]; edges -->, ---, -.->, ==>, with |label|, -- label --> or -. label .->; chains (A --> B --> C).
 * Interactions (click, href, callbacks), styling and other diagram types are refused, not guessed.
 */

export class MermaidError extends Error {}

const SHAPES: Array<[RegExp, NonNullable<DiagramSpec['nodes'][number]['shape']>]> = [
  [/^\(\((.*)\)\)$/s, 'ellipse'], [/^\(\[(.*)\]\)$/s, 'rounded'], [/^\[\[(.*)\]\]$/s, 'box'], [/^\{(.*)\}$/s, 'diamond'],
  [/^\((.*)\)$/s, 'rounded'], [/^\[(.*)\]$/s, 'box'], [/^>(.*)\]$/s, 'box'],
];

const NODE = /^([A-Za-z0-9_\-]+)\s*((?:\(\(|\(\[|\[\[|\[|\(|\{|>).*?(?:\)\)|\]\)|\]\]|\]|\)|\}))?$/s;
const EDGE = /\s*(?:(-->|---|-\.->|-\.-|==>|===|--x|--o)(?:\|([^|]*)\|)?|--\s+([^-][^>]*?)\s+-->|-\.\s+([^.][^>]*?)\s+\.->)\s*/;

function clean(t: string) {
  return t.replace(/^["']|["']$/g, '').replace(/<br\s*\/?>/gi, ' ').replace(/[<>]/g, '').trim().slice(0, 200);
}

export function parseMermaid(src: string, title?: string): DiagramSpec {
  const lines = src.replace(/\r\n/g, '\n').split(/\n|;/).map((l) => l.replace(/%%.*$/, '').trim()).filter(Boolean);
  if (!lines.length) throw new MermaidError('The Mermaid text is empty.');
  const head = /^(graph|flowchart)\s*(TB|TD|BT|LR|RL)?\s*$/i.exec(lines[0]);
  if (!head) {
    const kind = lines[0].split(/\s/)[0];
    throw new MermaidError(`Only Mermaid flowcharts ("graph TD" / "flowchart LR") are supported; "${kind}" diagrams are not.`);
  }
  const dir = (head[2] ?? 'TD').toUpperCase();
  const nodes = new Map<string, { id: string; label: string; shape: NonNullable<DiagramSpec['nodes'][number]['shape']> }>();
  const edges: DiagramSpec['edges'] = [];
  const warnings: string[] = [];
  const node = (raw: string) => {
    const m = NODE.exec(raw.trim());
    if (!m) throw new MermaidError(`Cannot read the node "${raw.trim().slice(0, 60)}".`);
    const id = m[1];
    let label = nodes.get(id)?.label ?? id;
    let shape = nodes.get(id)?.shape ?? 'box';
    if (m[2]) {
      const sh = SHAPES.find(([re]) => re.test(m[2]));
      if (!sh) throw new MermaidError(`Unsupported node shape in "${raw.trim().slice(0, 60)}".`);
      label = clean(sh[0].exec(m[2])![1]);
      shape = sh[1];
    }
    nodes.set(id, { id, label, shape });
    if (nodes.size > 80) throw new MermaidError('At most 80 nodes are supported.');
    return id;
  };
  for (const line of lines.slice(1)) {
    if (/^(click|href|callback)\b/i.test(line)) throw new MermaidError('Interactive Mermaid commands (click, href, callbacks) are not allowed.');
    if (/^(style|classDef|class|linkStyle)\b/i.test(line)) { warnings.push('Styling lines were ignored.'); continue; }
    if (/^subgraph\b|^end$/i.test(line)) { warnings.push('Subgraphs were flattened.'); continue; }
    const parts = line.split(EDGE);
    // split with capture groups: [node, op, |label|, -- label -->, -. label .->, node, op, ...]
    if (parts.length === 1) { node(parts[0]); continue; }
    let prev = node(parts[0]);
    for (let i = 1; i + 4 < parts.length + 1; i += 5) {
      const op = parts[i] ?? (parts[i + 3] !== undefined ? '-.->' : '-->');
      const lbl = parts[i + 1] ?? parts[i + 2] ?? parts[i + 3];
      const nextRaw = parts[i + 4];
      if (nextRaw === undefined) break;
      const next = node(nextRaw);
      edges.push({ from: prev, to: next, ...(lbl ? { label: clean(lbl) } : {}), ...(/-\./.test(op) ? { dashed: true } : {}) });
      prev = next;
    }
  }
  if (edges.length > 200) throw new MermaidError('At most 200 connections are supported.');
  return { title, direction: dir === 'LR' || dir === 'RL' ? 'LR' : 'TB', nodes: [...nodes.values()], edges, ...(warnings.length ? { warnings: [...new Set(warnings)] } as any : {}) };
}
