import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { authFetch } from '../utils/authFetch';
import type { Message } from '../types';

/**
 * A conversation as one self-contained HTML file: every message (Markdown, tables, maths), the files the user
 * attached (named, pictures shown), and everything Bwenge produced: charts and images shown in place, HTML
 * reports and dashboards embedded (sandboxed), other files (Excel, Word, PDF, PowerPoint) downloadable from
 * inside the page. Opens in any browser, offline, without an account.
 */

const MAX_EMBED_BYTES = 12 * 1024 * 1024; // per file
const MAX_TOTAL_BYTES = 40 * 1024 * 1024; // whole page

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const sizeText = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);

function markdown(text: string): string {
  return renderToStaticMarkup(
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}
      components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>
      {text}
    </ReactMarkdown>,
  );
}

async function dataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(bin)}`;
}

/** Strips the assistant's internal markers the chat hides (thinking blocks, form JSON). */
const visible = (text: string) => text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<(thinking|form)>[\s\S]*?<\/\1>/g, '').trim();

export async function conversationHtml(messages: Message[], title: string, get: (url: string) => Promise<Response> = (url) => (/^(blob:|data:)/.test(url) ? fetch(url) : authFetch(url))): Promise<{ html: string; skipped: string[] }> {
  let used = 0;
  const skipped: string[] = [];
  const fetchFile = async (url: string, size?: number): Promise<Blob | null> => {
    if (size && (size > MAX_EMBED_BYTES || used + size > MAX_TOTAL_BYTES)) return null;
    try {
      const res = await get(url);
      if (!res.ok) return null;
      const blob = await res.blob();
      if (blob.size > MAX_EMBED_BYTES || used + blob.size > MAX_TOTAL_BYTES) return null;
      used += blob.size;
      return blob;
    } catch { return null; }
  };

  const parts: string[] = [];
  for (const m of messages) {
    const who = m.sender === 'user' ? 'You' : 'Bwenge';
    const body: string[] = [];
    // Files the user attached: pictures in place, other files by name.
    for (const a of m.attachments ?? (m.attachment ? [m.attachment] : [])) {
      const src = a.previewUrl || a.url;
      const isImage = (a.mimeType || a.type || '').startsWith('image/') || a.fileType === 'image';
      const blob = isImage && src ? await fetchFile(src) : null;
      body.push(blob
        ? `<figure class="upload"><img alt="${esc(a.name)}" src="${await dataUrl(blob)}"><figcaption>${esc(a.name)}</figcaption></figure>`
        : `<div class="chip">📎 ${esc(a.name)}${a.size ? ` · ${esc(String(a.size))}` : ''}</div>`);
    }
    const text = visible(m.text || '');
    if (text) body.push(`<div class="md">${markdown(text)}</div>`);
    // What Bwenge produced in this reply.
    for (const a of m.generatedAttachments ?? []) {
      const blob = await fetchFile(a.url, a.size);
      if (!blob) {
        skipped.push(a.name);
        body.push(`<div class="file missing"><strong>${esc(a.name)}</strong><span>${sizeText(a.size)} · too large to include, or no longer available</span></div>`);
        continue;
      }
      const mime = a.mime || blob.type;
      if (/^image\//.test(mime)) {
        body.push(`<figure class="artifact"><img alt="${esc(a.name)}" src="${await dataUrl(blob)}"><figcaption>${esc(a.name)} · <a download="${esc(a.name)}" href="${await dataUrl(blob)}">Download</a></figcaption></figure>`);
      } else if (mime === 'text/html') {
        const html = await blob.text();
        body.push(`<figure class="artifact"><iframe title="${esc(a.name)}" sandbox="allow-scripts" loading="lazy" srcdoc="${esc(html)}"></iframe><figcaption>${esc(a.name)} · <a download="${esc(a.name)}" href="${await dataUrl(new Blob([html], { type: 'text/html' }))}">Download</a></figcaption></figure>`);
      } else {
        body.push(`<a class="file" download="${esc(a.name)}" href="${await dataUrl(blob)}"><strong>${esc(a.name)}</strong><span>${sizeText(blob.size)} · Download</span></a>`);
      }
    }
    if (m.examId) body.push('<div class="chip">Marking of this examination is in Bwenge (open the chat to see the live results).</div>');
    if (!body.length) continue;
    parts.push(`<section class="msg ${m.sender}"><div class="who">${who}${m.timestamp ? ` <time>${esc(new Date(m.timestamp).toLocaleString())}</time>` : ''}</div>${body.join('\n')}</section>`);
  }

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.19.0/dist/katex.min.css">
<style>
:root{--bg:#FAF9F5;--card:#fff;--text:#1F1E1D;--muted:#6B6A64;--line:#E6E3DA;--user:#F0EEE6;--accent:#C96442;--code:#F4F2EC}
@media (prefers-color-scheme:dark){:root{--bg:#262624;--card:#30302E;--text:#ECEBE6;--muted:#A3A29C;--line:#3D3C39;--user:#3A3936;--accent:#E08A6A;--code:#1F1E1D}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15.5px/1.65 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
header{max-width:780px;margin:0 auto;padding:28px 16px 8px}header h1{font-size:22px;margin:0 0 4px}header p{margin:0;color:var(--muted);font-size:13px}
main{max-width:780px;margin:0 auto;padding:8px 16px 48px}
.msg{margin:18px 0}.who{font-size:12px;font-weight:600;color:var(--muted);margin-bottom:6px}.who time{font-weight:400;margin-left:6px}
.msg.user .md{background:var(--user);border-radius:16px;padding:10px 14px;display:inline-block;max-width:100%}
.md p{margin:.5em 0}.md pre{background:var(--code);padding:12px;border-radius:10px;overflow:auto;font-size:13px}.md code{background:var(--code);padding:1px 5px;border-radius:5px;font-size:.9em}
.md table{border-collapse:collapse;margin:10px 0;display:block;overflow-x:auto}.md th,.md td{border:1px solid var(--line);padding:6px 10px;text-align:left}.md th{background:var(--user)}
.md a,.artifact a{color:var(--accent)}.md img{max-width:100%}
figure{margin:12px 0}figure img{max-width:100%;border-radius:12px;border:1px solid var(--line);background:#fff}figure iframe{width:100%;height:520px;border:1px solid var(--line);border-radius:12px;background:#fff}
figcaption{font-size:12px;color:var(--muted);margin-top:4px}.upload img{max-height:320px}
.chip{display:inline-block;margin:4px 6px 4px 0;padding:4px 10px;border:1px solid var(--line);border-radius:999px;font-size:12.5px;color:var(--muted)}
.file{display:flex;flex-direction:column;gap:2px;margin:10px 0;padding:10px 14px;border:1px solid var(--line);border-radius:12px;background:var(--card);color:var(--text);text-decoration:none;max-width:420px}
.file span{font-size:12px;color:var(--muted)}.file.missing{opacity:.7}
footer{max-width:780px;margin:0 auto;padding:0 16px 32px;color:var(--muted);font-size:12px}
</style></head>
<body><header><h1>${esc(title)}</h1><p>Conversation with Bwenge · shared ${esc(new Date().toLocaleString())}</p></header>
<main>${parts.join('\n')}</main>
<footer>Made with Bwenge. Files created in the conversation are included in this page.</footer></body></html>`;
  return { html, skipped };
}

/** Builds the page and shares it (phones: the share sheet with the file) or downloads it. */
export async function shareConversationHtml(messages: Message[], title: string): Promise<{ shared: boolean; skipped: string[] }> {
  const { html, skipped } = await conversationHtml(messages, title);
  const name = `${(title || 'Bwenge conversation').replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'Bwenge conversation'}.html`;
  const file = new File([html], name, { type: 'text/html' });
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file], title }); return { shared: true, skipped }; } catch (e) { if ((e as Error)?.name === 'AbortError') throw e; }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return { shared: false, skipped };
}
