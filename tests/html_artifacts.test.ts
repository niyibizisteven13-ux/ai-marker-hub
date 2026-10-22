import test from 'node:test';
import assert from 'node:assert/strict';
import { planOutput } from '../server/services/outputs/planner.js';
import { outputSpecSchema } from '../server/services/outputs/spec.js';
import { THEMES, reportHtml, tableWidget, validateSelfContainedHtml } from '../server/services/outputs/html.js';
import { renderChartSvg } from '../server/services/outputs/charts.js';

// HTML artifacts that demonstrate data: the planner recognises the request, the spec takes a topic theme,
// and the page stays self-contained (no network) with the theme's colours. SYNTHETIC data.

test('planner: "demonstrate / HTML page / showcase" requests produce a themed HTML report deliverable', () => {
  for (const message of [
    'Create an HTML page that demonstrates our exam results',
    'Make a web page showcasing these survey figures',
    'Build a data story for the board',
  ]) {
    const p = planOutput({ message });
    assert.equal(p.format, 'html', message);
    assert.equal(p.output, 'report', message);
    assert.ok(p.artifact);
    assert.deepEqual(p.deliverables, [{ output: 'report', format: 'html' }], message);
  }
  assert.equal(planOutput({ message: 'What is photosynthesis?' }).artifact, false, 'plain questions stay prose');
});

test('spec: reports and widgets accept a topic theme and subtitle; unknown themes are rejected', () => {
  const base = { kind: 'report', title: 'Results', sources: [{ type: 'user', label: 'User' }], sections: [{ heading: 'A', text: 'B' }] };
  assert.equal((outputSpecSchema.parse({ ...base, theme: 'violet', subtitle: 'Term results' }) as any).theme, 'violet');
  assert.throws(() => outputSpecSchema.parse({ ...base, theme: 'neon' }));
  const w = { kind: 'widget', title: 'T', sources: [], theme: 'forest', widget: { type: 'kpi_cards', kpis: [{ label: 'n', value: 3 }] } };
  assert.equal((outputSpecSchema.parse(w) as any).theme, 'forest');
});

test('render: themed hero, KPIs and sections in a self-contained page; charts use the theme palette', async () => {
  const rows = [{ Term: 'T1', Score: 62 }, { Term: 'T2', Score: 68 }];
  const chart: any = { type: 'bar', x: { field: 'Term', title: 'Term', type: 'nominal' }, y: { field: 'Score', title: 'Score', unit: '%' }, data: rows, sourceNote: 'Synthetic' };
  const svg = await renderChartSvg(chart, 'Scores', rows as any, THEMES.forest.pal);
  assert.match(svg, new RegExp(THEMES.forest.pal[0], 'i'), 'bars take the theme colour');

  const html = reportHtml({
    title: 'Class progress', theme: 'forest', subtitle: 'Terms 1 and 2', layout: 'dashboard', summary: 'Scores rose.',
    kpis: [{ label: 'Term 2', value: 68, unit: '%' }], sections: [{ heading: 'Scores', chartSvg: svg }], sources: [{ label: 'Synthetic', type: 'user' }],
    meta: { generatedAt: '2026-10-22T10:00:00Z', revision: 1, artifactId: '00000000-aaaa' },
  });
  assert.match(html, /<header class="hero"><div class="eyebrow">Interactive dashboard<\/div><h1>Class progress<\/h1><p class="sub">Terms 1 and 2<\/p>/);
  assert.match(html, new RegExp(`--acc:${THEMES.forest.acc};--acc2:${THEMES.forest.acc2}`));
  assert.match(html, /class="card kpi"/);
  assert.deepEqual(validateSelfContainedHtml(html), { valid: true, problems: [] });

  const table = tableWidget('Scores', { caption: 'Scores by term', columns: [{ key: 'Term', label: 'Term' }, { key: 'Score', label: 'Score' }], rows } as any, [], { theme: 'not-a-theme' });
  assert.match(table, new RegExp(`--acc:${THEMES.ocean.acc}`), 'unknown themes fall back to ocean');
  assert.match(table, /Data explorer/);
  assert.equal(validateSelfContainedHtml(table).valid, true);
});
