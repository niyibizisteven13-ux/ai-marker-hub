import { escapeHtml } from '../analytics/htmlReport.js';
import { scriptJson } from '../exams/report.js';
import type { ChartConfig } from './spec.js';
import { fmt, type DisplayTable, type Row } from './tables.js';

/**
 * Self-contained HTML outputs: inline interactive widgets and persistent reports/dashboards.
 * - Inline CSS and JS only; a Content-Security-Policy with default-src 'none' blocks every network call.
 * - Theme-aware (CSS variables, prefers-color-scheme, data-theme override), responsive, and wide tables or
 *   charts scroll inside their own container instead of widening the page.
 * - Data reaches scripts only as escaped JSON and is inserted with textContent.
 */

export const CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'";

const CSS = `
:root{--bg:#f7f8fa;--card:#fff;--ink:#17202b;--mute:#5d6875;--line:#e3e7ec;--acc:#1f5fa6;--warn:#9a5b00;--warnbg:#fff6e6}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#0f141a;--card:#171e26;--ink:#e6ebf0;--mute:#9aa6b2;--line:#2a3440;--acc:#7db3ef;--warn:#f0c27a;--warnbg:#2c2414}}
:root[data-theme=dark]{--bg:#0f141a;--card:#171e26;--ink:#e6ebf0;--mute:#9aa6b2;--line:#2a3440;--acc:#7db3ef;--warn:#f0c27a;--warnbg:#2c2414}
*{box-sizing:border-box}html,body{margin:0}body{background:var(--bg);color:var(--ink);font:15px/1.5 Inter,"Segoe UI",system-ui,sans-serif;overflow-x:hidden}
main{max-width:1100px;margin:0 auto;padding:20px 16px 40px}h1{font-size:24px;margin:0 0 4px;line-height:1.25}h2{font-size:17px;margin:26px 0 10px}
.meta,.small{color:var(--mute);font-size:12.5px}.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px;margin:10px 0}
.scroll{overflow-x:auto;max-width:100%;-webkit-overflow-scrolling:touch}.scroll svg{max-width:100%;height:auto}
.chart{background:#fff;border-radius:8px;padding:6px}
table{border-collapse:collapse;width:100%;font-size:13.5px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--mute);font-weight:600;white-space:nowrap}td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px}.kpi b{display:block;font-size:22px}.kpi span{color:var(--mute);font-size:12.5px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,460px),1fr));gap:12px}
.notice{background:var(--warnbg);color:var(--warn);border-radius:8px;padding:10px 12px;font-size:13.5px}
.controls{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 10px}.controls input,.controls select,.controls button{font:inherit;padding:5px 8px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--ink)}
th[data-k]{cursor:pointer}ul{padding-left:20px}a{color:var(--acc)}
`;

export function page(title: string, body: string, opts: { script?: string; data?: unknown } = {}): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<title>${escapeHtml(title)}</title><style>${CSS}</style></head>
<body><main>${body}</main>${opts.data !== undefined ? `<script type="application/json" id="data">${scriptJson(opts.data)}</script>` : ''}${opts.script ? `<script>${opts.script}</script>` : ''}</body></html>`;
}

/** Minimal, safe Markdown: paragraphs, "- " bullet lists and **bold**; everything else is escaped text. */
export function textHtml(t: string): string {
  const blocks = t.replace(/\r\n/g, '\n').split(/\n\s*\n/);
  return blocks.map((b) => {
    const lines = b.split('\n').filter((l) => l.trim());
    const inline = (s: string) => escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    if (lines.length && lines.every((l) => /^\s*[-*•]\s+/.test(l))) return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*•]\s+/, ''))}</li>`).join('')}</ul>`;
    return lines.length ? `<p>${lines.map(inline).join('<br>')}</p>` : '';
  }).join('');
}

export function tableHtml(t: DisplayTable): string {
  const numeric = new Set(t.columns.filter((c) => t.rows.some((r) => typeof r[c.key] === 'number')).map((c) => c.key));
  return `<div class="scroll"><table><caption class="small" style="text-align:left;caption-side:top;padding-bottom:4px">${escapeHtml(t.caption)}</caption><thead><tr>${t.columns.map((c) => `<th class="${numeric.has(c.key) ? 'num' : ''}">${escapeHtml(c.label)}${c.unit ? ` (${escapeHtml(c.unit)})` : ''}</th>`).join('')}</tr></thead><tbody>${t.rows.slice(0, 1000).map((r) => `<tr>${t.columns.map((c) => `<td class="${numeric.has(c.key) ? 'num' : ''}">${escapeHtml(fmt(r[c.key], c.key))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${t.rows.length > 1000 ? `<p class="small">Showing 1,000 of ${t.rows.length} rows.</p>` : ''}${t.note ? `<p class="small">${escapeHtml(t.note)}</p>` : ''}`;
}

export function kpisHtml(kpis: Array<{ label: string; value: number | string; unit?: string; note?: string }>): string {
  return `<div class="kpis">${kpis.map((k) => `<div class="card kpi"><b>${escapeHtml(typeof k.value === 'number' ? fmt(k.value) : k.value)}${k.unit ? ` <span>${escapeHtml(k.unit)}</span>` : ''}</b><span>${escapeHtml(k.label)}</span>${k.note ? `<div class="small">${escapeHtml(k.note)}</div>` : ''}</div>`).join('')}</div>`;
}

const sourcesHtml = (sources: Array<{ label: string; type: string }>) => (sources.length ? `<h2>Sources</h2><ul>${sources.map((s) => `<li>${escapeHtml(s.label)} <span class="small">(${escapeHtml(s.type)})</span></li>`).join('')}</ul>` : '');

export interface ReportSectionRendered { heading: string; text?: string; table?: DisplayTable; chartSvg?: string }
export interface AnalysisAppendix { methodology: string[]; assumptions: string[]; limitations: string[]; engine: string; isolation?: string; rows?: string; filters?: string[] }

export function reportHtml(r: { title: string; layout: 'report' | 'dashboard'; summary?: string; kpis?: Array<{ label: string; value: number | string; unit?: string; note?: string }>; sections: ReportSectionRendered[]; sources: Array<{ label: string; type: string }>; appendix?: AnalysisAppendix[]; meta: { generatedAt: string; revision: number; artifactId: string } }): string {
  const sec = (s: ReportSectionRendered) => `<section class="card"><h2 style="margin-top:0">${escapeHtml(s.heading)}</h2>${s.text ? textHtml(s.text) : ''}${s.chartSvg ? `<div class="scroll chart">${s.chartSvg}</div>` : ''}${s.table ? tableHtml(s.table) : ''}</section>`;
  const body = [
    `<h1>${escapeHtml(r.title)}</h1><div class="meta">Generated ${escapeHtml(r.meta.generatedAt.replace('T', ' ').slice(0, 16))} UTC · revision ${r.meta.revision} · ${escapeHtml(r.meta.artifactId.slice(0, 8))}</div>`,
    r.summary ? `<div class="card">${textHtml(r.summary)}</div>` : '',
    r.kpis?.length ? kpisHtml(r.kpis) : '',
    r.layout === 'dashboard' ? `<div class="grid">${r.sections.map(sec).join('')}</div>` : r.sections.map(sec).join(''),
    ...(r.appendix ?? []).map((a) => `<h2>Method, assumptions and limitations</h2><div class="card small">${a.rows ? `<p>${escapeHtml(a.rows)}</p>` : ''}${a.filters?.length ? `<p>Filters: ${a.filters.map(escapeHtml).join('; ')}</p>` : ''}<p><b>Method</b></p><ul>${a.methodology.map((m) => `<li>${escapeHtml(m)}</li>`).join('')}</ul>${a.assumptions.length ? `<p><b>Assumptions</b></p><ul>${a.assumptions.map((m) => `<li>${escapeHtml(m)}</li>`).join('')}</ul>` : ''}${a.limitations.length ? `<p><b>Limitations</b></p><ul>${a.limitations.map((m) => `<li>${escapeHtml(m)}</li>`).join('')}</ul>` : ''}<p>Computed by ${escapeHtml(a.engine)}${a.isolation ? ` (${escapeHtml(a.isolation)})` : ''}. Narrative text may be AI-written; numbers in tables and charts come from the computation.</p></div>`),
    sourcesHtml(r.sources),
  ].join('');
  return page(r.title, body);
}

// ── Widgets ───────────────────────────────────────────────────────────────────

const TABLE_JS = `(function(){var D=JSON.parse(document.getElementById('data').textContent),cols=D.columns,rows=D.rows,q='',key=null,dir=1,pg=0,PS=50;
function el(t,a,x){var e=document.createElement(t);if(a)for(var k in a)e.setAttribute(k,a[k]);if(x!=null)e.textContent=String(x);return e}
function f(v){if(v===null||v===undefined)return'–';if(typeof v==='number'){if(!isFinite(v))return'–';return Math.abs(v)>=1000?v.toLocaleString('en-US',{maximumFractionDigits:1}):Number.isInteger(v)?String(v):(Math.abs(v)>=1?v.toFixed(3).replace(/\\.?0+$/,''):v.toPrecision(3))}return String(v)}
var head=document.getElementById('th'),body=document.getElementById('tb'),info=document.getElementById('info');
cols.forEach(function(c){var th=el('th',{'data-k':c.key},c.label+(c.unit?' ('+c.unit+')':''));th.addEventListener('click',function(){dir=key===c.key?-dir:1;key=c.key;pg=0;render()});head.appendChild(th)});
function view(){var r=rows.filter(function(x){if(!q)return true;return cols.some(function(c){return String(x[c.key]==null?'':x[c.key]).toLowerCase().indexOf(q)>=0})});if(key)r=r.slice().sort(function(a,b){var u=a[key],v=b[key];if(u==null)return 1;if(v==null)return-1;return(u<v?-1:u>v?1:0)*dir});return r}
function render(){var r=view();body.textContent='';r.slice(pg*PS,pg*PS+PS).forEach(function(x){var tr=el('tr');cols.forEach(function(c){tr.appendChild(el('td',typeof x[c.key]==='number'?{'class':'num'}:null,f(x[c.key])))});body.appendChild(tr)});info.textContent=r.length+' of '+rows.length+' rows'+(r.length>PS?' · page '+(pg+1)+' of '+Math.ceil(r.length/PS):'')}
document.getElementById('q').addEventListener('input',function(e){q=e.target.value.toLowerCase();pg=0;render()});
document.getElementById('prev').addEventListener('click',function(){if(pg>0){pg--;render()}});document.getElementById('next').addEventListener('click',function(){if((pg+1)*PS<view().length){pg++;render()}});
document.getElementById('csv').addEventListener('click',function(){var esc=function(v){v=v==null?'':String(v);return /[",\\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v};var t=[cols.map(function(c){return esc(c.label)}).join(',')].concat(view().map(function(x){return cols.map(function(c){return esc(x[c.key])}).join(',')})).join('\\n');var a=el('a',{download:'table.csv',href:URL.createObjectURL(new Blob([t],{type:'text/csv'}))});document.body.appendChild(a);a.click();a.remove()});
render()})();`;

export function tableWidget(title: string, t: DisplayTable, sources: Array<{ label: string; type: string }>): string {
  return page(title, `<h1>${escapeHtml(title)}</h1><p class="small">${escapeHtml(t.caption)}</p><div class="controls"><input id="q" type="search" placeholder="Search…" aria-label="Search rows"><button id="prev" type="button">Previous</button><button id="next" type="button">Next</button><button id="csv" type="button">Download CSV</button></div><div class="card scroll"><table><thead><tr id="th"></tr></thead><tbody id="tb"></tbody></table></div><p class="small" id="info"></p>${t.note ? `<p class="small">${escapeHtml(t.note)}</p>` : ''}${sourcesHtml(sources)}`,
    { data: { columns: t.columns, rows: t.rows }, script: TABLE_JS });
}

const CHART_JS = `(function(){var D=JSON.parse(document.getElementById('data').textContent),NS='http://www.w3.org/2000/svg',hidden={},kind=D.kind;
function n(t,a,x){var e=document.createElementNS(NS,t);for(var k in a)e.setAttribute(k,a[k]);if(x!=null)e.textContent=String(x);return e}
var series=D.color?Array.from(new Set(D.rows.map(function(r){return String(r[D.color])}))):['all'];var pal=['#1f5fa6','#d9480f','#2b8a3e','#7048e8','#c2255c','#e67700','#0b7285','#5c940d'];
var leg=document.getElementById('legend');series.forEach(function(s,i){var l=document.createElement('label');var c=document.createElement('input');c.type='checkbox';c.checked=true;c.addEventListener('change',function(){hidden[s]=!c.checked;draw()});l.appendChild(c);var sw=document.createElement('span');sw.textContent=' '+s+' ';sw.style.color=pal[i%pal.length];l.appendChild(sw);if(D.color)leg.appendChild(l)});
document.getElementById('kind').addEventListener('change',function(e){kind=e.target.value;draw()});
function draw(){var box=document.getElementById('plot');box.textContent='';var W=720,H=380,L=70,R=20,T=20,B=80;var xs=Array.from(new Set(D.rows.map(function(r){return String(r[D.x])})));var vis=D.rows.filter(function(r){return!hidden[D.color?String(r[D.color]):'all']});
var ys=vis.map(function(r){return Number(r[D.y])}).filter(isFinite);var max=Math.max.apply(null,ys.concat([0])),min=Math.min.apply(null,ys.concat([0]));if(max===min)max=min+1;
var svg=n('svg',{viewBox:'0 0 '+W+' '+H,role:'img','aria-label':D.title,style:'max-width:100%;height:auto;display:block'});svg.appendChild(n('rect',{width:W,height:H,fill:'#fff'}));
var sy=function(v){return T+(H-T-B)*(1-(v-min)/(max-min))},bw=(W-L-R)/Math.max(1,xs.length),sx=function(x){return L+bw*xs.indexOf(String(x))+bw/2};
for(var i=0;i<=4;i++){var v=min+(max-min)*i/4,y=sy(v);svg.appendChild(n('line',{x1:L,x2:W-R,y1:y,y2:y,stroke:'#e5e8eb'}));svg.appendChild(n('text',{x:L-6,y:y+4,'text-anchor':'end','font-size':11,fill:'#555'},Math.abs(v)>=1000?Math.round(v).toLocaleString('en-US'):Number(v.toPrecision(3))))}
xs.forEach(function(x){var t=n('text',{x:sx(x),y:H-B+16,'text-anchor':xs.length>8?'end':'middle','font-size':11,fill:'#555',transform:xs.length>8?'rotate(-35 '+sx(x)+' '+(H-B+16)+')':''},x.length>16?x.slice(0,15)+'…':x);svg.appendChild(t)});
svg.appendChild(n('text',{x:(L+W-R)/2,y:H-8,'text-anchor':'middle','font-size':12,fill:'#333'},D.xTitle));svg.appendChild(n('text',{x:14,y:(T+H-B)/2,'text-anchor':'middle','font-size':12,fill:'#333',transform:'rotate(-90 14 '+((T+H-B)/2)+')'},D.yTitle));
var on=series.filter(function(s){return!hidden[s]});on.forEach(function(s,si){var pts=vis.filter(function(r){return(D.color?String(r[D.color]):'all')===s&&isFinite(Number(r[D.y]))});var col=pal[series.indexOf(s)%pal.length];
if(kind==='bar'){var w=bw*0.8/on.length;pts.forEach(function(r){var x=sx(r[D.x])-bw*0.4+w*si,y=sy(Number(r[D.y])),y0=sy(0);var b=n('rect',{x:x,y:Math.min(y,y0),width:Math.max(1,w-2),height:Math.abs(y0-y),fill:col});b.appendChild(n('title',{},s+' · '+r[D.x]+': '+r[D.y]));svg.appendChild(b)})}
else{var d=pts.map(function(r,i){return(i?'L':'M')+sx(r[D.x])+','+sy(Number(r[D.y]))}).join('');svg.appendChild(n('path',{d:d,fill:'none',stroke:col,'stroke-width':2}));pts.forEach(function(r){var c=n('circle',{cx:sx(r[D.x]),cy:sy(Number(r[D.y])),r:3.5,fill:col});c.appendChild(n('title',{},s+' · '+r[D.x]+': '+r[D.y]));svg.appendChild(c)})}});
box.appendChild(svg)}draw()})();`;

export function chartWidget(title: string, c: ChartConfig, rows: Row[], staticSvg: string, sources: Array<{ label: string; type: string }>): string {
  const label = (a: { title?: string; unit?: string }) => (a.unit && a.unit !== 'none' ? `${a.title} (${a.unit})` : a.title);
  return page(title, `<h1>${escapeHtml(title)}</h1>${c.subtitle ? `<p class="small">${escapeHtml(c.subtitle)}</p>` : ''}<div class="controls"><label class="small">Chart type <select id="kind"><option value="bar"${c.type.includes('bar') ? ' selected' : ''}>Bars</option><option value="line"${c.type === 'line' || c.type === 'area' ? ' selected' : ''}>Lines</option></select></label><span id="legend" class="small"></span></div><div class="card scroll chart" id="plot"></div><noscript><div class="scroll chart">${staticSvg}</div></noscript><p class="small">Source: ${escapeHtml(c.sourceNote)}</p>${sourcesHtml(sources)}`,
    { data: { title, kind: c.type === 'line' || c.type === 'area' ? 'line' : 'bar', x: c.x.field, y: c.y?.field, color: c.color?.field ?? null, xTitle: label(c.x), yTitle: c.y ? label(c.y) : '', rows: rows.slice(0, 2000) }, script: CHART_JS });
}

// ── Validation ────────────────────────────────────────────────────────────────

export function validateSelfContainedHtml(html: string, forbidden: string[] = [], maxBytes = 10 * 1024 * 1024): { valid: boolean; problems: string[] } {
  const p: string[] = [];
  if (Buffer.byteLength(html) > maxBytes) p.push('too large');
  if (!/^<!doctype html>/i.test(html)) p.push('missing doctype');
  if (!html.includes(`content="${CSP}"`)) p.push('missing or weakened Content-Security-Policy');
  if (/<script\b[^>]*\bsrc\s*=/i.test(html)) p.push('external script');
  // Embedded JSON data is escaped (no "<"), so markup checks run on the page without it and without inline scripts.
  const data = /<script type="application\/json" id="data">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
  if (data.includes('<')) p.push('unescaped "<" in embedded data');
  const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
  if (/\b(?:src|href|action|xlink:href)\s*=\s*["']?\s*(?:https?:|\/\/|javascript:|data:text\/html)/i.test(markup)) p.push('external or active link');
  if (/@import|url\(\s*['"]?(?:https?:)?\/\//i.test(markup)) p.push('CSS loads an external resource');
  if (/<(iframe|object|embed|form|base|link)\b/i.test(markup)) p.push('disallowed element');
  if (/\son[a-z]+\s*=\s*["']/i.test(markup)) p.push('inline event handler attribute');
  if (/(sk-ant-[\w-]{10,}|sk-[\w-]{20,}|Bearer\s+[\w.-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY)/.test(html)) p.push('looks like a credential');
  if (/(\/home\/[\w.-]+\/|\/root\/|\/var\/www\/|\/opt\/[\w.-]+\/)/.test(html)) p.push('server file path');
  for (const s of forbidden) if (s && s.length >= 6 && html.includes(s)) p.push('forbidden internal string');
  return { valid: !p.length, problems: p };
}
