import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationHtml } from '../src/lib/conversationHtml.tsx';

// Sharing a chat as one HTML page: messages rendered (Markdown, tables, maths), pictures and charts inline,
// HTML reports embedded in a sandbox, other files downloadable from the page, nothing executable leaking into
// the page itself. SYNTHETIC conversation.

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>';
const report = '<html><body><h1>Class report</h1><script>document.title="x"</script></body></html>';
const files: Record<string, { body: string; type: string }> = {
  '/f/chart.svg': { body: svg, type: 'image/svg+xml' },
  '/f/report.html': { body: report, type: 'text/html' },
  '/f/results.xlsx': { body: 'PK-fake-xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
};
const get = async (url: string) => files[url] ? new Response(files[url].body, { headers: { 'content-type': files[url].type } }) : new Response('gone', { status: 404 });
const ref = (name: string, url: string, mime: string, size = 100) => ({ id: name, name, mime, size, kind: 'file' as any, url, expiresAt: '' });

test('a conversation becomes one self-contained HTML page with its artifacts', async () => {
  const { html, skipped } = await conversationHtml([
    { id: '1', sender: 'user', text: 'Compare <b>A</b> and B, and solve $x^2=4$', timestamp: '2026-10-29T08:00:00Z', attachments: [{ id: 'a', name: 'scores.csv', size: '2 KB' }] },
    { id: '2', sender: 'assistant', text: '<think>internal</think>| Group | Mean |\n|---|---|\n| A | 3.2 |\n\nSo $x = \\pm 2$.', timestamp: '2026-10-29T08:00:05Z',
      generatedAttachments: [ref('chart.svg', '/f/chart.svg', 'image/svg+xml'), ref('Class report.html', '/f/report.html', 'text/html'), ref('results.xlsx', '/f/results.xlsx', files['/f/results.xlsx'].type), ref('old.pdf', '/f/expired.pdf', 'application/pdf')] },
  ] as any, 'Maths <class>', get);

  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<title>Maths &lt;class&gt;<\/title>/, 'the title is escaped');
  assert.match(html, /Compare &lt;b&gt;A&lt;\/b&gt; and B/, 'raw HTML typed in a message is shown, not run');
  assert.match(html, /<table>[\s\S]*<td>A<\/td>[\s\S]*<td>3.2<\/td>/, 'Markdown tables are rendered');
  assert.match(html, /class="katex"/, 'maths is typeset');
  assert.doesNotMatch(html, /internal/, 'hidden reasoning is left out');
  assert.match(html, /📎 scores\.csv · 2 KB/, 'the user\'s attached file is named');
  assert.match(html, /<img alt="chart\.svg" src="data:image\/svg\+xml;base64,/, 'charts are inside the page');
  assert.match(html, /<iframe title="Class report.html" sandbox="allow-scripts"[^>]*srcdoc="&lt;html&gt;/, 'HTML reports are embedded in a sandbox');
  assert.doesNotMatch(html, /<script>document\.title/, 'the report\'s script never runs in the page itself');
  assert.match(html, /download="results\.xlsx" href="data:application\/vnd\.openxmlformats/, 'Excel is downloadable from the page');
  assert.deepEqual(skipped, ['old.pdf']);
  assert.match(html, /old\.pdf<\/strong><span>100 B · too large to include, or no longer available/);
});
