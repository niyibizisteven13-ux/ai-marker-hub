import { describe, expect, it } from 'vitest';
import { sanitizeSvg, UnsafeSvgError } from '../src/ai/drawing/svgSanitizer.js';
import { svgToPng } from '../src/ai/drawing/rasterize.js';
import { renderVegaLite } from '../src/ai/drawing/chart.js';
import { renderDiagram } from '../src/ai/drawing/diagram.js';

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('svg sanitizer', () => {
  it('keeps a normal drawing intact', () => {
    const svg = sanitizeSvg(`<svg viewBox="0 0 100 100"><defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient></defs><rect x="10" y="10" width="80" height="80" rx="8" fill="url(#g)" stroke="#000" stroke-width="2"/><circle cx="50" cy="50" r="20" style="fill:#fff;stroke:#333"/><text x="50" y="55" text-anchor="middle" font-size="12">Hi</text><path d="M10 10 L90 90"/></svg>`);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('viewBox="0 0 100 100"');
    expect(svg).toContain('linearGradient');
    expect(svg).toContain('url(#g)');
    expect(svg).toContain('Hi');
    expect(svg).toContain('d="M10 10 L90 90"');
  });

  const attacks: Array<[string, string]> = [
    ['script tag', `<svg viewBox="0 0 1 1"><script>alert(1)</script><rect width="1" height="1"/></svg>`],
    ['onload handler', `<svg viewBox="0 0 1 1" onload="alert(1)"><rect width="1" height="1" onclick="alert(2)"/></svg>`],
    ['foreignObject', `<svg viewBox="0 0 1 1"><foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><iframe src="javascript:alert(1)"></iframe></body></foreignObject></svg>`],
    ['external image', `<svg viewBox="0 0 1 1"><image href="http://evil.test/x.png" width="1" height="1"/></svg>`],
    ['javascript href', `<svg viewBox="0 0 1 1"><a href="javascript:alert(1)"><rect width="1" height="1"/></a></svg>`],
    ['use external', `<svg viewBox="0 0 1 1"><use href="http://evil.test/a.svg#x"/><use xlink:href="data:image/svg+xml;base64,AAA"/></svg>`],
    ['style url external', `<svg viewBox="0 0 1 1"><rect width="1" height="1" style="fill:url(http://evil.test/x);background:url(javascript:1)"/></svg>`],
    ['fill external url', `<svg viewBox="0 0 1 1"><rect width="1" height="1" fill="url(http://evil.test/x)"/></svg>`],
    ['animate/set', `<svg viewBox="0 0 1 1"><rect width="1" height="1"><set attributeName="onmouseover" to="alert(1)"/><animate attributeName="href" values="javascript:alert(1)"/></rect></svg>`],
    ['entity bomb / doctype', `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;&a;">]><svg viewBox="0 0 1 1"><text>&b;</text></svg>`],
  ];
  for (const [name, input] of attacks) {
    it(`neutralises: ${name}`, () => {
      const out = sanitizeSvg(input);
      expect(out).not.toMatch(/<script|onload|onclick|onmouseover|foreignObject|<iframe|<image|<animate|<set|javascript:|evil\.test|data:image|ENTITY|DOCTYPE/i);
    });
  }

  it('rejects non-svg, oversize, and missing viewBox', () => {
    expect(() => sanitizeSvg('<html></html>')).toThrow(UnsafeSvgError);
    expect(() => sanitizeSvg('<svg viewBox="0 0 1 1">' + 'a'.repeat(600_000) + '</svg>')).toThrow(/larger/);
    expect(() => sanitizeSvg('<svg><rect width="1" height="1"/></svg>')).toThrow(/viewBox/);
  });
});

describe('rasterize', () => {
  it('renders a PNG with the right signature and size', () => {
    const svg = sanitizeSvg('<svg viewBox="0 0 200 100"><rect width="200" height="100" fill="#D2691E"/><text x="100" y="55" text-anchor="middle" font-size="24" fill="#fff">Bwenge</text></svg>');
    const png = svgToPng(svg, { width: 800 });
    expect(png.data.subarray(0, 8).equals(PNG_SIG)).toBe(true);
    expect(png.width).toBe(800);
    expect(png.height).toBe(400);
  });
});

describe('charts', () => {
  it('renders a bar chart to SVG that survives sanitising and rasterising', async () => {
    const svg = await renderVegaLite({
      title: 'Scores by class',
      data: { values: [{ cls: '6A', score: 72 }, { cls: '6B', score: 65 }, { cls: '6C', score: 80 }] },
      mark: 'bar',
      encoding: { x: { field: 'cls', type: 'nominal', title: 'Class' }, y: { field: 'score', type: 'quantitative', title: 'Average score' } },
    });
    expect(svg).toContain('<svg');
    expect(svg).toContain('Scores by class');
    const clean = sanitizeSvg(svg, { maxBytes: 2_000_000 });
    const png = svgToPng(clean, { width: 900 });
    expect(png.data.subarray(0, 8).equals(PNG_SIG)).toBe(true);
  });

  it('blocks remote data', async () => {
    await expect(renderVegaLite({ data: { url: 'http://evil.test/data.json' }, mark: 'bar', encoding: {} })).rejects.toThrow(/inline/);
  });
});

describe('diagrams', () => {
  it('lays out a flowchart and returns clean SVG', () => {
    const svg = renderDiagram({
      title: 'Marking flow',
      direction: 'TB',
      nodes: [
        { id: 'a', label: 'Upload scripts', color: 'orange' },
        { id: 'b', label: 'AI marks against rubric', color: 'teal' },
        { id: 'c', label: 'Teacher reviews?', shape: 'diamond' },
        { id: 'd', label: 'Publish results', shape: 'ellipse', color: 'navy' },
      ],
      edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'd', label: 'approved' }, { from: 'c', to: 'b', label: 'adjust', dashed: true }],
    });
    expect(svg).toContain('Upload scripts');
    expect(svg).toContain('marker-end');
    const clean = sanitizeSvg(svg);
    expect(clean).toContain('polygon');
    expect(svgToPng(clean).data.subarray(0, 8).equals(PNG_SIG)).toBe(true);
  });

  it('escapes labels and validates references', () => {
    const svg = renderDiagram({ nodes: [{ id: 'a', label: '<script>x</script>' }], edges: [] });
    expect(svg).not.toContain('<script>');
    expect(() => renderDiagram({ nodes: [{ id: 'a', label: 'A' }], edges: [{ from: 'a', to: 'zzz' }] })).toThrow(/unknown node/);
    expect(() => renderDiagram({ nodes: [{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }], edges: [] })).toThrow(/unique/);
  });
});
