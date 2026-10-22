import { renderVegaLite } from '../ai/drawing/chart.js';
import { sanitizeSvg } from '../ai/drawing/svgSanitizer.js';
import type { ChartSpec } from './charts.js';
import { validateChartSpec } from './charts.js';

/**
 * Self-contained HTML report renderer. Output contains no scripts, no event handlers and no external
 * resources: all text is HTML-escaped, charts are server-rendered SVG passed through the SVG allow-list
 * sanitizer, and a CSP meta tag blocks script execution even if the file is opened locally.
 */

export type ContentKind = 'source' | 'calculated' | 'interpretation';

export interface ReportTable { caption: string; columns: string[]; rows: Array<Array<string | number | null>>; note?: string }
export interface ReportParagraph { text: string; kind?: ContentKind }
/** An inline image (e.g. a scan crop). Only base64 PNG/JPEG data URLs are accepted. */
export interface ReportImage { dataUrl: string; alt: string; caption?: string }
export interface ReportSection { heading: string; paragraphs?: ReportParagraph[]; bullets?: ReportParagraph[]; tables?: ReportTable[]; charts?: ChartSpec[]; images?: ReportImage[] }

const SAFE_IMAGE = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;
export interface ReportCitation { title: string; publisher?: string; year?: string | number; url?: string; locator?: string; accessed?: string }

export interface ReportInput {
  title: string;
  subtitle?: string;
  summary: ReportParagraph[];
  researchQuestion?: string;
  datasetDescription?: ReportParagraph[];
  methodology?: string[];
  sections: ReportSection[];
  limitations?: string[];
  conclusion?: ReportParagraph[];
  recommendations?: string[];
  citations?: ReportCitation[];
  reproducibility?: { engineVersion: string; datasetSha256?: string; generatedAt: string; transformations: string[]; methods: string[] };
  /** Banner text, e.g. "Proposed AI assessment — not an instructor-confirmed grade". */
  notice?: string;
}

export interface RenderedReport { html: string; bytes: number; charts: Array<{ id: string; ok: boolean; problem?: string }> }

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escapeHtml(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

function fmtCell(v: string | number | null): string {
  if (v === null || v === undefined) return '<span class="na">—</span>';
  if (typeof v === 'number') return Number.isFinite(v) ? escapeHtml(Number(v.toFixed(4)).toLocaleString("en-US", { maximumFractionDigits: 4 })) : 'n/a';
  return escapeHtml(v);
}

const KIND_LABEL: Record<ContentKind, string> = { source: 'Source value', calculated: 'Calculated', interpretation: 'Interpretation' };
function para(p: ReportParagraph, tag = 'p'): string {
  const badge = p.kind ? `<span class="badge ${p.kind}">${KIND_LABEL[p.kind]}</span> ` : '';
  return `<${tag}>${badge}${escapeHtml(p.text)}</${tag}>`;
}

function table(t: ReportTable, maxRows = 500): string {
  const rows = t.rows.slice(0, maxRows);
  return `<div class="tablewrap"><table><caption>${escapeHtml(t.caption)}</caption><thead><tr>${t.columns.map((c) => `<th scope="col">${escapeHtml(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${fmtCell(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>${t.rows.length > maxRows ? `<p class="note">Showing ${maxRows} of ${t.rows.length} rows.</p>` : ''}${t.note ? `<p class="note">${escapeHtml(t.note)}</p>` : ''}</div>`;
}

async function figure(c: ChartSpec): Promise<{ html: string; ok: boolean; problem?: string }> {
  const problems = validateChartSpec(c);
  if (problems.length) return { html: '', ok: false, problem: problems.join('; ') };
  let svg: string;
  try {
    svg = sanitizeSvg(await renderVegaLite(c.vegaLite), { maxBytes: 3_000_000 });
  } catch (e) {
    return { html: '', ok: false, problem: `render failed: ${(e as Error).message.slice(0, 160)}` };
  }
  svg = svg.replace(/^<svg/, `<svg role="img" aria-label="${escapeHtml(c.altText)}"`);
  const dataTable = table({ caption: `Values plotted in “${c.title}”`, columns: c.table.columns, rows: c.table.rows }, 200);
  return {
    ok: true,
    html: `<figure id="${escapeHtml(c.id)}"><div class="chart">${svg}</div><figcaption><strong>${escapeHtml(c.title)}.</strong> ${escapeHtml(c.caption)}<br><span class="prov">${escapeHtml(c.provenance)}</span></figcaption><details><summary>Data table for this chart</summary>${dataTable}</details></figure>`,
  };
}

const CSS = `
:root{--ink:#1d2433;--muted:#5b6475;--line:#d9dee7;--accent:#12305A;--teal:#1FB3A6;--warm:#D2691E;--bg:#ffffff;--soft:#f5f7fa}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 "Segoe UI",Inter,system-ui,-apple-system,sans-serif}
main{max-width:920px;margin:0 auto;padding:40px 24px 64px}h1{font-size:30px;line-height:1.2;margin:0 0 6px;color:var(--accent)}
h2{font-size:21px;margin:40px 0 12px;padding-bottom:6px;border-bottom:2px solid var(--line);color:var(--accent)}h3{font-size:17px;margin:24px 0 8px}
.subtitle{color:var(--muted);margin:0 0 24px}.notice{background:#fff7e6;border:1px solid #f0c36d;border-radius:8px;padding:12px 16px;margin:16px 0}
.summary{background:var(--soft);border-left:4px solid var(--teal);padding:14px 18px;border-radius:6px}
.badge{display:inline-block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;border-radius:4px;padding:1px 6px;vertical-align:1px}
.badge.source{background:#e6f0ff;color:#12305A}.badge.calculated{background:#e3f7f4;color:#0b6b62}.badge.interpretation{background:#fdeee3;color:#8a3f0a}
.tablewrap{overflow-x:auto;margin:12px 0}table{border-collapse:collapse;width:100%;font-size:14px}caption{text-align:left;font-weight:600;padding:6px 0;color:var(--muted)}
th,td{border-bottom:1px solid var(--line);padding:6px 10px;text-align:left;vertical-align:top}th{background:var(--soft)}td{font-variant-numeric:tabular-nums}
.na{color:#9aa3b2}.note,.prov{color:var(--muted);font-size:13px}figure{margin:24px 0;padding:16px;border:1px solid var(--line);border-radius:10px}
.chart{overflow-x:auto}.chart svg{max-width:100%;height:auto}figcaption{font-size:14px;margin-top:8px}details{margin-top:8px}summary{cursor:pointer;color:var(--accent);font-size:14px}
ol.refs li{margin-bottom:6px}code{background:var(--soft);padding:1px 4px;border-radius:4px;font-size:13px}footer{margin-top:48px;color:var(--muted);font-size:13px;border-top:1px solid var(--line);padding-top:12px}
figure.crop{padding:8px}figure.crop img{max-width:100%;height:auto;border:1px solid var(--line);background:#fff}
@media print{figure{break-inside:avoid}details{display:block}}`;

function safeUrl(u?: string): string | null {
  if (!u) return null;
  try {
    const url = new URL(u);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function renderReportHtml(r: ReportInput): Promise<RenderedReport> {
  const chartStatus: RenderedReport['charts'] = [];
  const parts: string[] = [];
  parts.push(`<header><h1>${escapeHtml(r.title)}</h1>${r.subtitle ? `<p class="subtitle">${escapeHtml(r.subtitle)}</p>` : ''}</header>`);
  if (r.notice) parts.push(`<div class="notice" role="note">${escapeHtml(r.notice)}</div>`);
  parts.push(`<section class="summary" aria-label="Summary"><h2 style="margin-top:0;border:0">Summary</h2>${r.summary.map((p) => para(p)).join('')}</section>`);
  if (r.researchQuestion) parts.push(`<section><h2>Research question</h2><p>${escapeHtml(r.researchQuestion)}</p></section>`);
  if (r.datasetDescription?.length) parts.push(`<section><h2>Data</h2>${r.datasetDescription.map((p) => para(p)).join('')}</section>`);
  if (r.methodology?.length) parts.push(`<section><h2>Methods and data preparation</h2><ol>${r.methodology.map((m) => `<li>${escapeHtml(m)}</li>`).join('')}</ol></section>`);
  for (const s of r.sections) {
    const body: string[] = [`<h2>${escapeHtml(s.heading)}</h2>`];
    for (const p of s.paragraphs ?? []) body.push(para(p));
    if (s.bullets?.length) body.push(`<ul>${s.bullets.map((b) => para(b, 'li')).join('')}</ul>`);
    for (const img of s.images ?? []) {
      if (!SAFE_IMAGE.test(img.dataUrl)) continue;
      body.push(`<figure class="crop"><img src="${img.dataUrl}" alt="${escapeHtml(img.alt)}">${img.caption ? `<figcaption>${escapeHtml(img.caption)}</figcaption>` : ''}</figure>`);
    }
    for (const t of s.tables ?? []) body.push(table(t));
    for (const c of s.charts ?? []) {
      const f = await figure(c);
      chartStatus.push({ id: c.id, ok: f.ok, problem: f.problem });
      if (f.ok) body.push(f.html);
    }
    parts.push(`<section>${body.join('')}</section>`);
  }
  if (r.limitations?.length) parts.push(`<section><h2>Limitations</h2><ul>${r.limitations.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul></section>`);
  if (r.conclusion?.length) parts.push(`<section><h2>Conclusion</h2>${r.conclusion.map((p) => para(p)).join('')}</section>`);
  if (r.recommendations?.length) parts.push(`<section><h2>Recommendations</h2><p class="note">Recommendations follow from the results above and their limitations; check them against local context before acting.</p><ul>${r.recommendations.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul></section>`);
  if (r.citations?.length) {
    parts.push(`<section><h2>Sources</h2><ol class="refs">${r.citations.map((c) => {
      const url = safeUrl(c.url);
      const bits = [c.publisher, c.year, c.locator, c.accessed ? `accessed ${c.accessed}` : ''].filter(Boolean).map(escapeHtml).join('. ');
      return `<li><cite>${escapeHtml(c.title)}</cite>${bits ? `. ${bits}` : ''}${url ? `. <a href="${escapeHtml(url)}" rel="noopener noreferrer nofollow">${escapeHtml(url)}</a>` : ''}</li>`;
    }).join('')}</ol></section>`);
  }
  if (r.reproducibility) {
    const rep = r.reproducibility;
    parts.push(`<section><h2>Reproducibility</h2><p>Generated ${escapeHtml(rep.generatedAt)} by <code>${escapeHtml(rep.engineVersion)}</code>${rep.datasetSha256 ? ` from input file sha256 <code>${escapeHtml(rep.datasetSha256)}</code>` : ''}. All numbers in this report were computed by deterministic code; text marked “Interpretation” explains them and adds no new figures.</p><h3>Transformations</h3><ol>${rep.transformations.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ol><h3>Methods and formulas</h3><ul>${[...new Set(rep.methods)].map((m) => `<li>${escapeHtml(m)}</li>`).join('')}</ul></section>`);
  }
  parts.push(`<footer>Generated by Bwenge.AI. Check important figures against the original source before use.</footer>`);

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer"><title>${escapeHtml(r.title)}</title><style>${CSS}</style></head><body><main>${parts.join('\n')}</main></body></html>`;
  return { html, bytes: Buffer.byteLength(html), charts: chartStatus };
}

export interface ArtifactValidation { valid: boolean; problems: string[] }

const decodeAttr = (v: string) => v.replace(/&#x([0-9a-f]+);?/gi, (_m, h) => String.fromCharCode(parseInt(h, 16))).replace(/&#(\d+);?/g, (_m, d) => String.fromCharCode(Number(d))).replace(/&colon;/gi, ':').replace(/&tab;|&newline;|[\s\u0000]/gi, '');

/**
 * Attribute-level checks on real tags. Quoted attribute values are inspected as values, so escaped
 * text such as aria-label="&lt;img onerror=…&gt;" is not mistaken for markup.
 */
function scanTags(html: string): string[] {
  const out = new Set<string>();
  for (const tag of html.match(/<[a-zA-Z][^>]*>/g) ?? []) {
    for (const m of tag.matchAll(/\s([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g)) {
      const name = m[1].toLowerCase();
      const value = decodeAttr((m[2] ?? '').replace(/^["']|["']$/g, '')).toLowerCase();
      if (/^on/.test(name)) out.add('contains an inline event handler');
      const inlineImage = name === 'src' && /^<img\s/i.test(tag) && SAFE_IMAGE.test((m[2] ?? '').replace(/^["']|["']$/g, ''));
      if ((name === 'href' || name === 'src' || name === 'xlink:href' || name === 'action') && /^(javascript|vbscript|data):/.test(value) && !inlineImage) out.add('contains a script URL');
      if ((name === 'src' || name === 'xlink:href' || name === 'srcset' || name === 'poster') && /^(https?:)?\/\//.test(value)) out.add('loads an external resource');
    }
  }
  return [...out];
}

/**
 * Final gate before an HTML artifact is stored: size, no active content, no external resources,
 * and no leaked server paths or credentials.
 */
export function validateHtmlArtifact(html: string, opts: { maxBytes?: number; forbiddenStrings?: string[] } = {}): ArtifactValidation {
  const problems: string[] = [];
  const maxBytes = opts.maxBytes ?? 8 * 1024 * 1024;
  const bytes = Buffer.byteLength(html);
  if (bytes > maxBytes) problems.push(`artifact is ${bytes} bytes; limit ${maxBytes}`);
  if (!/^<!doctype html>/i.test(html)) problems.push('missing doctype');
  if (!/<meta http-equiv="Content-Security-Policy"/i.test(html)) problems.push('missing CSP meta tag');
  const checks: Array<[RegExp, string]> = [
    [/<script\b/i, 'contains a <script> element'],
    [/<(iframe|object|embed|form|input|button|link|base|meta\s+http-equiv="refresh")\b/i, 'contains a disallowed element'],
    [/@import|url\(\s*['"]?(https?:)?\/\//i, 'CSS loads an external resource'],
    [/(sk-ant-[\w-]{10,}|sk-[\w-]{20,}|Bearer\s+[\w.-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY)/, 'contains something that looks like a credential'],
    [/(\/home\/[\w.-]+\/|\/root\/|\/var\/www\/|[A-Z]:\\\\Users\\\\)/, 'contains a server file path'],
  ];
  for (const [re, msg] of checks) if (re.test(html)) problems.push(msg);
  problems.push(...scanTags(html));
  for (const s of opts.forbiddenStrings ?? []) if (s && s.length >= 6 && html.includes(s)) problems.push('contains a forbidden internal string');
  return { valid: problems.length === 0, problems };
}
