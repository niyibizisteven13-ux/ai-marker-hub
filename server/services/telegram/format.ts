/**
 * Markdown (as the AI writes it) → Telegram HTML. Telegram supports only a small tag set
 * (b, i, u, s, code, pre, a, blockquote), so headings become bold lines, lists get bullets, tables become
 * aligned monospace blocks, and everything else is escaped. Long answers are split at block boundaries
 * so every message is valid HTML on its own. LaTeX maths becomes readable symbols (Telegram renders none).
 */
import { displayMath, inlineMath } from './math.js';

export const MESSAGE_LIMIT = 4096;
export const CAPTION_LIMIT = 1024;

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const escAttr = (s: string) => esc(s).replace(/"/g, '&quot;');

/** Inline Markdown (one line or paragraph) → HTML. Code spans are protected first. */
function inline(src: string): string {
  const codes: string[] = [];
  let s = src.replace(/`([^`\n]+)`/g, (_, c) => `\u0000${codes.push(`<code>${esc(c)}</code>`) - 1}\u0000`);
  // Maths is converted and protected like code, so its ^, _ and * are not read as formatting.
  s = inlineMath(s, (m) => `\u0000${codes.push(esc(m)) - 1}\u0000`);
  const links: string[] = [];
  // App links ("/upgrade", "/exams/…") become absolute: Telegram only opens full URLs.
  const appBase = (process.env.APP_BASE_URL || 'https://www.bwenge.space').replace(/\/$/, '');
  s = s.replace(/\[([^\]\n]+)\]\(((?:https?:\/\/|\/(?!\/))[^)\s]*)\)/g, (_, t, u) => `\u0001${links.push(`<a href="${escAttr(u.startsWith('/') ? appBase + u : u)}">${esc(t)}</a>`) - 1}\u0001`);
  s = esc(s);
  s = s.replace(/\*\*([^*\n]+?)\*\*|__([^_\n]+?)__/g, (_, a, b) => `<b>${a ?? b}</b>`);
  s = s.replace(/(^|[\s(])\*([^*\n]+?)\*(?=[\s).,;:!?]|$)/g, '$1<i>$2</i>');
  s = s.replace(/(^|[\s(])_([^_\n]+?)_(?=[\s).,;:!?]|$)/g, '$1<i>$2</i>');
  s = s.replace(/~~([^~\n]+?)~~/g, '<s>$1</s>');
  s = s.replace(/\u0001(\d+)\u0001/g, (_, i) => links[Number(i)]);
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
}

function table(lines: string[]): string {
  const rows = lines.filter((l) => !/^\s*\|?\s*:?-{2,}/.test(l)).map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim().replace(/\*\*|`/g, '')));
  const widths = rows[0].map((_, i) => Math.min(24, Math.max(...rows.map((r) => (r[i] ?? '').length))));
  const fmt = (r: string[]) => r.map((c, i) => (c.length > widths[i] ? `${c.slice(0, widths[i] - 1)}…` : c.padEnd(widths[i]))).join('  ').trimEnd();
  const out = [fmt(rows[0]), widths.map((w) => '─'.repeat(w)).join('  '), ...rows.slice(1).map(fmt)];
  return `<pre>${esc(out.join('\n'))}</pre>`;
}

/** Splits Markdown into blocks: fenced code, tables, lists, quotes, headings and paragraphs. */
function blocks(md: string): string[] {
  const lines = md.replace(/\r\n/g, '\n').replace(/<\/?think(ing)?>[\s\S]*?<\/think(ing)?>/gi, '')
    // A plain-text copy written after a formula ("Unicode: y = …") repeats what the conversion already shows.
    .replace(/(\$\$[^\n]*\$\$|\\\][^\n]*)\n(?:[ \t]*\n)?[ \t]*Unicode:[^\n]*/g, '$1')
    .split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      const start = i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) i++;
      out.push(lines.slice(start, Math.min(i + 1, lines.length)).join('\n'));
      i++;
      continue;
    }
    if (!line.trim()) { i++; continue; }
    const open = /^\s*(\$\$|\\\[)/.exec(line);
    if (open) {
      // Display maths: from the opening $$ (or \[) to the closing one, possibly on the same line.
      const close = open[1] === '$$' ? '$$' : '\\]';
      const start = i;
      const rest = line.trim().slice(open[1].length);
      if (!rest.includes(close)) { i++; while (i < lines.length && !lines[i].includes(close)) i++; }
      out.push(lines.slice(start, Math.min(i + 1, lines.length)).join('\n'));
      i++;
      continue;
    }
    const start = i;
    const isTable = /^\s*\|.*\|\s*$/.test(line);
    while (i < lines.length && lines[i].trim() && !/^\s*```/.test(lines[i]) && (i === start || !/^\s*(\$\$|\\\[)/.test(lines[i])) && (/^\s*\|.*\|\s*$/.test(lines[i]) === isTable)) i++;
    out.push(lines.slice(start, i).join('\n'));
  }
  return out;
}

export function blockToHtml(block: string): string {
  const fence = /^\s*```([\w+-]*)\n([\s\S]*?)(?:\n\s*```)?\s*$/.exec(block);
  if (fence) return `<pre>${fence[1] ? `<code class="language-${escAttr(fence[1])}">` : ''}${esc(fence[2])}${fence[1] ? '</code>' : ''}</pre>`;
  const math = displayMath(block);
  if (math !== null) return `<pre>${esc(math)}</pre>`;
  const lines = block.split('\n');
  if (lines.every((l) => /^\s*\|.*\|\s*$/.test(l)) && lines.length >= 2) return table(lines);
  if (lines.every((l) => /^\s*>/.test(l))) return `<blockquote>${lines.map((l) => inline(l.replace(/^\s*>\s?/, ''))).join('\n')}</blockquote>`;
  return lines.map((l) => {
    const h = /^\s*#{1,6}\s+(.*)$/.exec(l);
    if (h) return `<b>${inline(h[1].replace(/\*\*/g, ''))}</b>`;
    const ul = /^(\s*)[-*+]\s+(.*)$/.exec(l);
    if (ul) return `${ul[1].length >= 2 ? '   ◦ ' : '• '}${inline(ul[2])}`;
    const ol = /^(\s*)(\d+)[.)]\s+(.*)$/.exec(l);
    if (ol) return `${ol[1].length >= 2 ? '   ' : ''}${ol[2]}. ${inline(ol[3])}`;
    if (/^\s*([-*_])\1{2,}\s*$/.test(l)) return '──────────';
    return inline(l);
  }).join('\n');
}

export function markdownToHtml(md: string): string {
  return blocks(md).map(blockToHtml).join('\n\n');
}

/** Markdown → one or more Telegram messages, each valid HTML under the limit. */
export function markdownToMessages(md: string, limit = MESSAGE_LIMIT - 96): string[] {
  const out: string[] = [];
  let cur = '';
  const push = () => { if (cur.trim()) out.push(cur); cur = ''; };
  for (const b of blocks(md)) {
    let html = blockToHtml(b);
    if (html.length > limit) {
      // A single huge block: split its source lines into smaller blocks of the same kind.
      const fence = /^\s*```([\w+-]*)\n/.exec(b);
      const body = fence ? b.replace(/^\s*```[\w+-]*\n/, '').replace(/\n\s*```\s*$/, '') : b;
      let piece: string[] = [];
      const flush = () => { if (piece.length) { push(); out.push(blockToHtml(fence ? `\`\`\`${fence[1]}\n${piece.join('\n')}\n\`\`\`` : piece.join('\n'))); piece = []; } };
      for (const line of body.split('\n')) {
        const chunks = line.match(new RegExp(`[\\s\\S]{1,${Math.floor(limit / 2)}}`, 'g')) ?? [''];
        for (const c of chunks) {
          if (esc([...piece, c].join('\n')).length > limit - 40) flush();
          piece.push(c);
        }
      }
      flush();
      continue;
    }
    if (cur && cur.length + html.length + 2 > limit) push();
    cur = cur ? `${cur}\n\n${html}` : html;
  }
  push();
  return out.length ? out : [''];
}

/** Plain caption (≤ 1024) for photos and documents. */
export function caption(html: string): string {
  if (html.length <= CAPTION_LIMIT) return html;
  // Too long for a caption: drop formatting and cut on the plain text so the escaped result still fits.
  const plain = html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  let cut = plain.slice(0, CAPTION_LIMIT - 2);
  while (esc(cut).length > CAPTION_LIMIT - 2) cut = cut.slice(0, -20);
  return `${esc(cut)}…`;
}
