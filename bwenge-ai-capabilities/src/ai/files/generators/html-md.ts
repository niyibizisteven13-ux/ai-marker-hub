import { escapeHtml, parseInline } from '../../util/text.js';
import type { Block, DocumentSpec, ImageResolver } from './spec.js';
import { validateDocumentSpec } from './spec.js';

const inlineHtml = (t: string) =>
  parseInline(t).map((r) => (r.code ? `<code>${escapeHtml(r.text)}</code>` : r.bold ? `<strong>${escapeHtml(r.text)}</strong>` : r.italic ? `<em>${escapeHtml(r.text)}</em>` : escapeHtml(r.text))).join('');

export async function generateHtml(spec: DocumentSpec, resolveImage: ImageResolver): Promise<Buffer> {
  validateDocumentSpec(spec);
  const out: string[] = [];
  for (const b of spec.blocks as Block[]) {
    switch (b.type) {
      case 'heading': out.push(`<h${b.level}>${inlineHtml(b.text)}</h${b.level}>`); break;
      case 'paragraph': out.push(`<p${b.align ? ` style="text-align:${b.align}"` : ''}>${inlineHtml(b.text)}</p>`); break;
      case 'list': out.push(`<${b.ordered ? 'ol' : 'ul'}>${b.items.map((i) => `<li>${inlineHtml(i)}</li>`).join('')}</${b.ordered ? 'ol' : 'ul'}>`); break;
      case 'quote': out.push(`<blockquote>${inlineHtml(b.text)}</blockquote>`); break;
      case 'code': out.push(`<pre><code>${escapeHtml(b.text)}</code></pre>`); break;
      case 'table':
        out.push(`<div class="t"><table>${b.header?.length ? `<thead><tr>${b.header.map((h) => `<th>${inlineHtml(h)}</th>`).join('')}</tr></thead>` : ''}<tbody>${b.rows.map((r) => `<tr>${r.map((c) => `<td>${inlineHtml(String(c ?? ''))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
        break;
      case 'image': {
        const img = await resolveImage({ fileId: b.fileId, dataUrl: b.dataUrl });
        if (img) out.push(`<figure><img alt="${escapeHtml(b.alt ?? b.caption ?? '')}" src="data:image/${img.type === 'png' ? 'png' : 'jpeg'};base64,${img.data.toString('base64')}">${b.caption ? `<figcaption>${escapeHtml(b.caption)}</figcaption>` : ''}</figure>`);
        break;
      }
      case 'pageBreak': out.push('<hr>'); break;
    }
  }
  const html = `<!doctype html>
<html lang="${escapeHtml(spec.language ?? 'en')}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(spec.title)}</title>
<style>body{font:16px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;color:#1b1b1f}h1,h2,h3,h4{line-height:1.25}.sub{color:#666}blockquote{margin:1em 0;padding-left:1em;border-left:3px solid #ccc;color:#555}pre{background:#f4f4f6;padding:12px;overflow:auto;border-radius:8px}code{background:#f0f0f3;padding:1px 4px;border-radius:4px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d7d7dc;padding:6px 10px;text-align:left}th{background:#efeff3}.t{overflow-x:auto}figure{margin:1em 0;text-align:center}img{max-width:100%}footer{margin-top:3em;color:#777;font-size:13px}</style></head>
<body><h1>${escapeHtml(spec.title)}</h1>${spec.subtitle ? `<p class="sub">${escapeHtml(spec.subtitle)}</p>` : ''}${out.join('\n')}${spec.footer ? `<footer>${escapeHtml(spec.footer)}</footer>` : ''}</body></html>`;
  return Buffer.from(html, 'utf8');
}

export async function generateMarkdown(spec: DocumentSpec): Promise<Buffer> {
  validateDocumentSpec(spec);
  const out: string[] = [`# ${spec.title}`];
  if (spec.subtitle) out.push(`_${spec.subtitle}_`);
  for (const b of spec.blocks as Block[]) {
    switch (b.type) {
      case 'heading': out.push(`${'#'.repeat(Math.min(b.level + 1, 6))} ${b.text}`); break;
      case 'paragraph': out.push(b.text); break;
      case 'list': out.push(b.items.map((i, n) => (b.ordered ? `${n + 1}. ${i}` : `- ${i}`)).join('\n')); break;
      case 'quote': out.push(b.text.split('\n').map((l) => `> ${l}`).join('\n')); break;
      case 'code': out.push('```' + (b.language ?? '') + '\n' + b.text + '\n```'); break;
      case 'table': {
        const cols = Math.max(b.header?.length ?? 0, ...b.rows.map((r) => r.length), 1);
        const row = (r: string[]) => `| ${Array.from({ length: cols }, (_, i) => String(r[i] ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ')} |`;
        out.push([row(b.header ?? Array(cols).fill('')), `| ${Array(cols).fill('---').join(' | ')} |`, ...b.rows.map(row)].join('\n'));
        break;
      }
      case 'image': out.push(`*[Image${b.caption ? `: ${b.caption}` : ''}]*`); break;
      case 'pageBreak': out.push('---'); break;
    }
  }
  if (spec.footer) out.push(`---\n${spec.footer}`);
  return Buffer.from(out.join('\n\n') + '\n', 'utf8');
}
