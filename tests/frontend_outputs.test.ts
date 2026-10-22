import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { applyToolEvent, describeToolCall, summarizeToolResult } from '../src/utils/toolSteps.js';
import { AttachmentCards } from '../src/components/AttachmentCards.js';
import { formatBytes, filesFromDrop } from '../src/api/knowledge.js';
import { isInlineCode } from '../src/utils/markdownCode.js';

// Frontend logic for chat tool activity, generated-file cards, markdown and the knowledge explorer. SYNTHETIC data.

test('tool steps: readable labels for each tool and spec kind', () => {
  assert.equal(describeToolCall('create_output', { spec: { kind: 'chart', title: 'Values by category' } }), 'Creating chart: Values by category');
  assert.equal(describeToolCall('create_output', { spec: { kind: 'document', format: 'xlsx', title: 'Marks' } }), 'Building Excel workbook: Marks');
  assert.equal(describeToolCall('create_output', { spec: { kind: 'report', layout: 'dashboard', title: 'Enrolment' } }), 'Building dashboard: Enrolment');
  assert.equal(describeToolCall('create_output', { spec: { kind: 'template', template: 'briefing_deck' } }), 'Filling briefing deck');
  assert.equal(describeToolCall('analyze_data', {}), 'Computing statistics with the analysis engine');
  assert.equal(describeToolCall('search_knowledge', { query: 'maize yields' }), 'Searching the knowledge base for “maize yields”');
  assert.equal(describeToolCall('some_new_tool', {}), 'some new tool');
});

test('tool steps: results become user-facing summaries, never model instructions', () => {
  assert.equal(summarizeToolResult('Created chart "Values by category" (svg, 7473 bytes, artifact 0f8c1a2e-1111-4222-8333-444455556666, revision 1). It is attached to your reply as a download; do not paste its contents or write a link.', false),
    'Ready: Values by category (SVG, 7.3 KB)');
  assert.equal(summarizeToolResult('Reused the identical document "Category values" (xlsx, 7578 bytes, artifact x, revision 1).', false), 'Ready: Category values (XLSX, 7.4 KB)');
  assert.equal(summarizeToolResult('analysisId: 0f8c1a2e-1111-4222-8333-444455556666\nSource: study.csv; rows 8; engine bwenge-stats.', false), 'Computed from study.csv (8 rows)');
  const err = summarizeToolResult('ERROR: The output spec was rejected: chart: axis "Value" is quantitative; give its unit. Fix the spec and try again.', true)!;
  assert.match(err, /^The output spec was rejected/);
  assert.doesNotMatch(err, /Fix the spec/, 'only the first sentence');
  assert.equal(summarizeToolResult('', true), 'Failed');
});

test('tool steps: call → result lifecycle by id, with errors and unknown ids ignored', () => {
  let steps = applyToolEvent([], { type: 'tool_call', id: 't1', name: 'create_output', input: { spec: { kind: 'chart', title: 'A' } } });
  steps = applyToolEvent(steps, { type: 'tool_call', id: 't2', name: 'create_output', input: { spec: { kind: 'document', format: 'xlsx', title: 'B' } } });
  steps = applyToolEvent(steps, { type: 'tool_call', id: 't1', name: 'create_output', input: {} });
  assert.equal(steps.length, 2, 'duplicate call ignored');
  assert.deepEqual(steps.map((s) => s.status), ['running', 'running']);
  steps = applyToolEvent(steps, { type: 'tool_result', id: 't2', name: 'create_output', text: 'ERROR: The output could not be generated: disk full', isError: true });
  steps = applyToolEvent(steps, { type: 'tool_result', id: 't1', name: 'create_output', text: 'Created chart "A" (svg, 100 bytes, artifact x, revision 1).' });
  assert.deepEqual(steps.map((s) => s.status), ['done', 'error']);
  assert.equal(steps[1].summary, 'The output could not be generated: disk full');
  assert.deepEqual(applyToolEvent(steps, { type: 'tool_result', id: 'nope', name: 'other', text: 'x' }), steps);
  // Old servers send no id: the oldest running step with that tool name is completed.
  const legacy = applyToolEvent(applyToolEvent([], { type: 'tool_call', name: 'search_knowledge', input: {} }), { type: 'tool_result', name: 'search_knowledge', text: 'Found 3 passages.' });
  assert.equal(legacy[0].status, 'done');
});

const ref = (over: Record<string, unknown>) => ({ id: 'f1', name: 'x', mime: 'application/octet-stream', size: 2048, kind: 'document', url: '/api/files/f1?exp=1&sig=a', expiresAt: new Date(Date.now() + 3600_000).toISOString(), ...over });

test('generated file cards: right label per type, sandboxed HTML open, expired links not offered', () => {
  const html = renderToStaticMarkup(createElement(AttachmentCards, { attachments: [
    ref({ id: 'c', name: 'Values.svg', mime: 'image/svg+xml', kind: 'chart', previewUrl: '/api/files/p?exp=1&sig=b' }),
    ref({ id: 'x', name: 'Values.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', kind: 'spreadsheet' }),
    ref({ id: 'h', name: 'Report.html', mime: 'text/html; charset=utf-8', kind: 'document' }),
    ref({ id: 'old', name: 'Old.pdf', mime: 'application/pdf', kind: 'pdf', expiresAt: new Date(Date.now() - 1000).toISOString() }),
  ] as any }));
  assert.match(html, /Created for you · 4 files/);
  assert.match(html, /<img[^>]+src="\/api\/files\/p\?exp=1&amp;sig=b"/, 'charts render as <img>, never inline SVG');
  assert.match(html, /Excel workbook · 2\.0 KB/);
  assert.match(html, /Interactive report · 2\.0 KB/);
  assert.match(html, /aria-expanded="false"[^>]*>[\s\S]*?Open/, 'HTML reports can be opened');
  assert.match(html, /PDF · 2\.0 KB[\s\S]*Link expired/);
  assert.doesNotMatch(html, /href="\/api\/files\/f1\?exp=1&amp;sig=a" download="Old\.pdf"/, 'no download link for an expired file');
  assert.equal(renderToStaticMarkup(createElement(AttachmentCards, { attachments: [] })), '');
});

test('markdown: inline code is told apart from fenced blocks (react-markdown v10 has no inline prop)', async () => {
  const { unified } = await import('unified');
  const { default: remarkParse } = await import('remark-parse');
  const tree: any = unified().use(remarkParse).parse('Columns `Category` and `Value`.\n\n```\nplain block\n```\n\n```python\nprint(1)\n```');
  const codes: any[] = [];
  const walk = (n: any) => { if (n.type === 'inlineCode' || n.type === 'code') codes.push(n); n.children?.forEach(walk); };
  walk(tree);
  const verdicts = codes.map((n) => isInlineCode({}, n.lang ? `language-${n.lang}` : undefined, n, n.value));
  assert.deepEqual(verdicts, [true, true, false, false]);
  assert.equal(isInlineCode({ inline: true }, 'language-js', undefined, 'x'), true, 'older renderers that pass `inline` are respected');
});

test('explorer: byte formatting and drag-and-drop folders keep relative paths and empty folders', async () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(7_340), '7.2 KB');
  assert.equal(formatBytes(5 * 1024 ** 3), '5.00 GB');
  const file = (name: string) => ({ isFile: true, isDirectory: false, name, file: (ok: (f: File) => void) => ok(new File(['x'], name)) });
  const dir = (name: string, children: any[]) => ({ isFile: false, isDirectory: true, name, createReader: () => { let done = false; return { readEntries: (ok: (b: any[]) => void) => { const batch = done ? [] : children; done = true; setTimeout(() => ok(batch)); } }; } });
  const dropped = { items: [{ webkitGetAsEntry: () => dir('Library', [file('a.txt'), dir('Reports', [file('b.csv')]), dir('Empty', [])]) }, { webkitGetAsEntry: () => file('loose.md') }], files: [] } as unknown as DataTransfer;
  const r = await filesFromDrop(dropped);
  assert.deepEqual(r.files.map((f) => f.relativePath), ['Library/a.txt', 'Library/Reports/b.csv', 'loose.md']);
  assert.deepEqual(r.emptyFolders, ['Library/Empty']);
  assert.equal(r.hasFolders, true);
});
