import sanitizeHtml from 'sanitize-html';

/**
 * Strict allow-list SVG sanitizer. The AI writes SVG as text, so it is treated as untrusted:
 * no scripts, no event handlers, no external resources, no foreignObject, no animation.
 */

const TAGS = [
  'svg', 'g', 'defs', 'title', 'desc', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'pattern', 'marker', 'symbol', 'use',
];

const COMMON = [
  'id', 'transform', 'opacity', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity',
  'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset',
  'clip-path', 'mask', 'marker-start', 'marker-mid', 'marker-end', 'filter', 'role', 'aria-label', 'aria-hidden', 'style',
];

const ATTRS: Record<string, string[]> = {
  svg: ['xmlns', 'viewBox', 'width', 'height', 'preserveAspectRatio', 'version', ...COMMON],
  g: COMMON,
  defs: [], title: [], desc: [],
  path: ['d', 'pathLength', ...COMMON],
  rect: ['x', 'y', 'width', 'height', 'rx', 'ry', ...COMMON],
  circle: ['cx', 'cy', 'r', ...COMMON],
  ellipse: ['cx', 'cy', 'rx', 'ry', ...COMMON],
  line: ['x1', 'y1', 'x2', 'y2', ...COMMON],
  polyline: ['points', ...COMMON],
  polygon: ['points', ...COMMON],
  text: ['x', 'y', 'dx', 'dy', 'text-anchor', 'dominant-baseline', 'font-family', 'font-size', 'font-weight', 'font-style', 'letter-spacing', 'text-decoration', 'textLength', 'lengthAdjust', ...COMMON],
  tspan: ['x', 'y', 'dx', 'dy', 'text-anchor', 'font-family', 'font-size', 'font-weight', 'font-style', 'fill', 'letter-spacing'],
  linearGradient: ['id', 'x1', 'y1', 'x2', 'y2', 'gradientUnits', 'gradientTransform', 'spreadMethod', 'href'],
  radialGradient: ['id', 'cx', 'cy', 'r', 'fx', 'fy', 'gradientUnits', 'gradientTransform', 'spreadMethod', 'href'],
  stop: ['offset', 'stop-color', 'stop-opacity'],
  clipPath: ['id', 'clipPathUnits', 'transform'],
  mask: ['id', 'x', 'y', 'width', 'height', 'maskUnits', 'maskContentUnits'],
  pattern: ['id', 'x', 'y', 'width', 'height', 'patternUnits', 'patternContentUnits', 'patternTransform', 'viewBox'],
  marker: ['id', 'markerWidth', 'markerHeight', 'refX', 'refY', 'orient', 'markerUnits', 'viewBox', 'preserveAspectRatio'],
  symbol: ['id', 'viewBox', 'preserveAspectRatio'],
  use: ['x', 'y', 'width', 'height', 'href', ...COMMON],
};

const STYLE_PROPS = [
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin',
  'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'font-family', 'font-size', 'font-weight', 'font-style',
  'text-anchor', 'letter-spacing', 'stop-color', 'stop-opacity', 'dominant-baseline', 'text-decoration',
];
// A style value is allowed only if it has no url() other than local #refs and no scripting tricks.
const SAFE_STYLE_VALUE = /^(?!.*(?:url\((?!\s*#)|expression|javascript|@import|behavior|-moz-binding|<|>)).{0,200}$/i;

export class UnsafeSvgError extends Error {}

export interface SvgOptions {
  maxBytes?: number;
}

export function sanitizeSvg(input: string, opts: SvgOptions = {}): string {
  const maxBytes = opts.maxBytes ?? 500_000;
  if (typeof input !== 'string' || !input.trim()) throw new UnsafeSvgError('SVG is empty.');
  if (Buffer.byteLength(input) > maxBytes) throw new UnsafeSvgError(`SVG is larger than ${Math.round(maxBytes / 1000)} KB.`);
  if (!/<svg[\s>]/i.test(input)) throw new UnsafeSvgError('Content is not an SVG (missing <svg> root).');

  // Remove XML prolog, DOCTYPE/ENTITY declarations (XXE / billion laughs) and comments before parsing.
  let src = input.replace(/<\?xml[\s\S]*?\?>/gi, '').replace(/<!DOCTYPE[^>[]*(\[[\s\S]*?\])?\s*>/gi, '').replace(/<!ENTITY[\s\S]*?>/gi, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_m, t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));

  const allowedStyles: Record<string, Record<string, RegExp[]>> = { '*': Object.fromEntries(STYLE_PROPS.map((p) => [p, [SAFE_STYLE_VALUE]])) };
  const out = sanitizeHtml(src, {
    allowedTags: TAGS,
    allowedAttributes: Object.fromEntries(Object.entries(ATTRS).map(([k, v]) => [k, v])) as sanitizeHtml.IOptions['allowedAttributes'],
    allowedStyles,
    parser: { xmlMode: true, lowerCaseTags: false, lowerCaseAttributeNames: false, decodeEntities: true },
    disallowedTagsMode: 'discard',
    selfClosing: ['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'stop', 'use'],
    transformTags: {
      '*': (tagName, attribs) => {
        const next: Record<string, string> = {};
        for (const [k, v] of Object.entries(attribs)) {
          const key = k === 'xlink:href' ? 'href' : k;
          if (key === 'href') {
            // Only local fragment references (#id) are allowed. No external URLs, no data:, no javascript:.
            if (!/^#[\w.-]+$/.test(String(v).trim())) continue;
            next[key] = String(v).trim();
            continue;
          }
          const val = String(v);
          // Empty values would be serialised as bare attributes (invalid XML), so drop them.
          if (val === '') continue;
          if (/^on/i.test(key)) continue;
          // Any url() must point to a local #id.
          if (/url\(/i.test(val) && /url\(\s*(?!['"]?#)/i.test(val)) continue;
          if (/javascript:|data:|vbscript:/i.test(val)) continue;
          next[key] = val;
        }
        return { tagName, attribs: next };
      },
    },
  });

  if (!/^\s*<svg[\s>]/.test(out)) throw new UnsafeSvgError('SVG root element was removed during sanitising.');
  let svg = out.trim();
  if (!/<svg[^>]*\sxmlns=/.test(svg)) svg = svg.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
  if (!/<svg[^>]*\s(viewBox|width)=/.test(svg)) throw new UnsafeSvgError('SVG needs a viewBox (or width and height).');
  return svg;
}
