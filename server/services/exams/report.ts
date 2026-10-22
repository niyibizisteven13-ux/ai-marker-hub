import type { ClassStatistics, CandidateSummary } from './results.js';
import type { MarkingScheme } from './scheme.js';
import type { ExamRecord } from './types.js';

/**
 * Self-contained interactive results report (index.html inside the bundle). Inline CSS and JS only, a
 * Content-Security-Policy that blocks all network access, and candidate data inserted with textContent
 * (never innerHTML), so names and transcribed answers cannot inject markup. PDFs are linked relatively.
 */

export interface ReportCandidate extends CandidateSummary {
  pdfPath: string | null;
  details: Array<{ questionId: string; feedback: string; lostMarks: string; override: string | null; corrected: boolean; evidencePages: number[] }>;
}

export interface ReportData {
  exam: { id: string; title: string; schemeVersion: number; runId: string; resultRevision: number; generatedAt: string; passPercent: number; totalMarks: number };
  stats: ClassStatistics;
  questions: Array<{ id: string; number: string; maxMarks: number }>;
  candidates: ReportCandidate[];
  failed: Array<{ candidateId: string; fileName: string; error: string }>;
}

/** JSON safe to place inside a <script type="application/json"> element. */
export function scriptJson(v: unknown): string {
  return JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function buildReportData(exam: ExamRecord, scheme: MarkingScheme, summaries: CandidateSummary[], stats: ClassStatistics, pdfPaths: Record<string, string>, meta: { runId: string; schemeVersion: number; generatedAt: string }): ReportData {
  return {
    exam: { id: exam.id, title: exam.title, schemeVersion: meta.schemeVersion, runId: meta.runId, resultRevision: exam.resultRevision, generatedAt: meta.generatedAt, passPercent: exam.passPercent, totalMarks: scheme.totalMarks },
    stats,
    questions: scheme.questions.map((q) => ({ id: q.id, number: q.number, maxMarks: q.maxMarks })),
    candidates: summaries.map((s) => {
      const res = exam.results[s.submissionId];
      return {
        ...s, pdfPath: pdfPaths[s.submissionId] ?? null,
        details: (res?.questions ?? []).map((q) => ({
          questionId: q.questionId, feedback: q.ai?.feedback ?? '', lostMarks: q.ai?.lostMarks ?? '',
          override: q.override ? `${q.override.marks}/${q.maxMarks} by examiner: ${q.override.reason}${q.override.rubricConflict ? ` (note: ${q.override.rubricConflict})` : ''}` : null,
          corrected: !!q.ai?.basedOnCorrection,
          evidencePages: [...new Set((q.ai?.evidenceElementIds ?? []).map((id) => Number(/^p(\d+)/.exec(id)?.[1])).filter((n) => n > 0))],
        })),
      };
    }),
    failed: exam.submissions.filter((s) => s.state === 'failed').map((s) => ({ candidateId: s.candidateId, fileName: s.fileName, error: s.error?.message ?? 'Processing failed.' })),
  };
}

const CSS = `
:root{--bg:#f6f7f9;--card:#fff;--ink:#16202c;--mute:#5b6675;--line:#e2e6eb;--ok:#167a3e;--part:#b26a00;--bad:#b3261e;--flag:#d35400;--acc:#1f3a5f}
@media (prefers-color-scheme:dark){:root{--bg:#11161c;--card:#1a2129;--ink:#e8edf2;--mute:#9aa6b2;--line:#2b3440;--acc:#7fb0e6}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:1180px;margin:0 auto;padding:20px 16px 48px}h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:24px 0 10px}
.meta{color:var(--mute);font-size:12px}.banner{margin:14px 0;padding:10px 12px;border-radius:8px;background:#fff4e5;color:#7a4300;border:1px solid #f3c78b}
@media (prefers-color-scheme:dark){.banner{background:#3a2a12;color:#f6c88a;border-color:#6b4a17}}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}.tile{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px}
.tile b{display:block;font-size:20px}.tile span{color:var(--mute);font-size:12px}.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px;overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--mute);font-weight:600;white-space:nowrap}
tbody tr.row{cursor:pointer}tbody tr.row:hover{background:rgba(127,127,127,.08)}tr.sel{outline:2px solid var(--acc)}
.filters{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px;align-items:end}.filters label{display:flex;flex-direction:column;font-size:12px;color:var(--mute);gap:3px}
.filters input,.filters select{font:inherit;padding:5px 6px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--ink)}.chk{flex-direction:row!important;align-items:center;gap:6px!important}
.pill{display:inline-block;padding:1px 7px;border-radius:999px;font-size:11px;border:1px solid var(--line);white-space:nowrap}.provisional{color:var(--mute)}.needs_review{color:var(--flag);border-color:var(--flag)}.user_corrected{color:var(--acc);border-color:var(--acc)}.user_confirmed{color:var(--ok);border-color:var(--ok)}
.full{color:var(--ok);font-weight:600}.partial{color:var(--part);font-weight:600}.zero{color:var(--bad);font-weight:600}.unmarked{color:var(--flag)}
.detail{margin-top:12px}.flag{color:var(--flag);font-size:12px}.small{font-size:12px;color:var(--mute)}a{color:var(--acc)}svg text{fill:var(--mute);font-size:10px}
`;

const JS = `
(function(){
var D=JSON.parse(document.getElementById('report-data').textContent);
function el(t,a,txt){var e=document.createElement(t);if(a)for(var k in a){if(k==='class')e.className=a[k];else e.setAttribute(k,a[k]);}if(txt!==undefined&&txt!==null)e.textContent=String(txt);return e;}
function fmt(n){return n===null||n===undefined?'–':String(n);}
function pill(s){return el('span',{class:'pill '+s},s.replace('_',' '));}
var tiles=document.getElementById('tiles'),S=D.stats;
[['Candidates',S.candidates],['Fully marked',S.complete],['With open flags',S.flaggedCandidates],['Failed processing',S.failedProcessing],['Mean total',fmt(S.mean)+' / '+D.exam.totalMarks],['Median total',fmt(S.median)],['Pass rate (≥'+D.exam.passPercent+'%)',S.passRate===null?'–':S.passRate+'%']].forEach(function(t){var d=el('div',{class:'tile'});d.appendChild(el('b',null,t[1]));d.appendChild(el('span',null,t[0]));tiles.appendChild(d);});
function bars(container,items,max,label){var NS='http://www.w3.org/2000/svg',w=Math.max(320,items.length*44),h=150,svg=document.createElementNS(NS,'svg');svg.setAttribute('viewBox','0 0 '+w+' '+h);svg.setAttribute('width','100%');svg.setAttribute('role','img');svg.setAttribute('aria-label',label);
var bw=(w-20)/Math.max(1,items.length);items.forEach(function(it,i){var v=it.value||0,bh=max?Math.round((v/max)*(h-40)):0,r=document.createElementNS(NS,'rect');r.setAttribute('x',10+i*bw+4);r.setAttribute('y',h-22-bh);r.setAttribute('width',Math.max(4,bw-8));r.setAttribute('height',bh);r.setAttribute('rx',3);r.setAttribute('fill','#3b74b8');var tt=document.createElementNS(NS,'title');tt.textContent=it.label+': '+v;r.appendChild(tt);svg.appendChild(r);
var t=document.createElementNS(NS,'text');t.setAttribute('x',10+i*bw+bw/2);t.setAttribute('y',h-8);t.setAttribute('text-anchor','middle');t.textContent=it.label;svg.appendChild(t);var t2=document.createElementNS(NS,'text');t2.setAttribute('x',10+i*bw+bw/2);t2.setAttribute('y',h-26-bh);t2.setAttribute('text-anchor','middle');t2.textContent=it.value===null?'':String(v);svg.appendChild(t2);});container.appendChild(svg);}
bars(document.getElementById('dist'),S.distribution.map(function(d){return{label:d.from+'%',value:d.count};}),Math.max.apply(null,S.distribution.map(function(d){return d.count;}).concat([1])),'Score distribution');
bars(document.getElementById('qbars'),S.questions.map(function(q){return{label:q.number,value:q.meanPercent};}),100,'Mean percentage per question');
var qt=document.getElementById('qtable');S.questions.forEach(function(q){var tr=el('tr');[q.number,q.maxMarks,q.marked,fmt(q.mean),fmt(q.meanPercent)+'%',fmt(q.fullRate)+'%',fmt(q.partialRate)+'%',fmt(q.zeroRate)+'%',q.flagged].forEach(function(v){tr.appendChild(el('td',null,v));});qt.appendChild(tr);});
var qsel=document.getElementById('f-q');D.questions.forEach(function(q){qsel.appendChild(el('option',{value:q.id},'Question '+q.number));});
var head=document.getElementById('chead');['Candidate','Name','Total','%','Result','Status','Flags'].concat(D.questions.map(function(q){return 'Q'+q.number;})).forEach(function(h){head.appendChild(el('th',null,h));});
function num(id){var v=document.getElementById(id).value;return v===''?null:Number(v);}
function pass(c){
 var s=document.getElementById('f-search').value.trim().toLowerCase();if(s&&(c.candidateId+' '+(c.candidateName||'')+' '+c.fileName).toLowerCase().indexOf(s)<0)return false;
 var a=num('f-tmin'),b=num('f-tmax'),p=num('f-pmin'),q=num('f-pmax');if(a!==null&&c.total<a)return false;if(b!==null&&c.total>b)return false;if(p!==null&&c.percent<p)return false;if(q!==null&&c.percent>q)return false;
 var st=document.getElementById('f-status').value;if(st==='corrected'&&!(c.status==='user_corrected'||c.status==='user_confirmed'))return false;if(st&&st!=='corrected'&&c.status!==st)return false;
 if(document.getElementById('f-flag').checked&&!c.openFlags)return false;if(document.getElementById('f-fail').checked&&c.passed!==false)return false;if(document.getElementById('f-changed').checked&&!c.changedByUser)return false;
 var qid=qsel.value,oc=document.getElementById('f-qo').value;if(qid&&oc){var r=c.questions.filter(function(x){return x.questionId===qid;})[0];if(!r)return false;if(oc==='correct'&&r.outcome!=='full')return false;if(oc==='incorrect'&&r.outcome!=='zero')return false;if(oc==='partial'&&r.outcome!=='partial')return false;if(oc==='notfull'&&r.outcome==='full')return false;}
 return true;}
var body=document.getElementById('cbody'),count=document.getElementById('count'),detail=document.getElementById('detail'),selected=null;
function render(){body.textContent='';var shown=D.candidates.filter(pass);count.textContent=shown.length+' of '+D.candidates.length+' candidates';
 shown.forEach(function(c){var tr=el('tr',{class:'row'+(selected===c.submissionId?' sel':''),tabindex:'0'});tr.appendChild(el('td',null,c.candidateId));tr.appendChild(el('td',null,c.candidateName||''));tr.appendChild(el('td',null,c.total+' / '+c.maxTotal+(c.complete?'':' *')));tr.appendChild(el('td',null,c.percent+'%'));
  tr.appendChild(el('td',null,c.passed===null?'Incomplete':c.passed?'Pass':'Below pass mark'));var td=el('td');td.appendChild(pill(c.status));tr.appendChild(td);tr.appendChild(el('td',{class:c.openFlags?'flag':''},c.openFlags||''));
  D.questions.forEach(function(q){var r=c.questions.filter(function(x){return x.questionId===q.id;})[0];tr.appendChild(el('td',{class:r?r.outcome:''},r?(r.marks===null?'?':r.marks):''));});
  tr.addEventListener('click',function(){show(c);});tr.addEventListener('keydown',function(e){if(e.key==='Enter')show(c);});body.appendChild(tr);});}
function show(c){selected=c.submissionId;render();detail.textContent='';var h=el('h2',null,'Candidate '+c.candidateId+(c.candidateName?' – '+c.candidateName:''));detail.appendChild(h);
 var p=el('p');p.appendChild(document.createTextNode('Total '+c.total+' / '+c.maxTotal+' ('+c.percent+'%) '));p.appendChild(pill(c.status));detail.appendChild(p);
 if(c.pdfPath){var a=el('a',{href:c.pdfPath,target:'_blank',rel:'noopener'},'Open the marked script (PDF)');detail.appendChild(a);}else detail.appendChild(el('p',{class:'small'},'No marked PDF is available for this candidate.'));
 var t=el('table');var hr=el('tr');['Question','Marks','Status','Feedback','Checks'].forEach(function(x){hr.appendChild(el('th',null,x));});var th=el('thead');th.appendChild(hr);t.appendChild(th);var tb=el('tbody');
 c.questions.forEach(function(q){var d=c.details.filter(function(x){return x.questionId===q.questionId;})[0]||{};var tr=el('tr');tr.appendChild(el('td',null,q.number));tr.appendChild(el('td',{class:q.outcome},(q.marks===null?'–':q.marks)+' / '+q.maxMarks));var s=el('td');s.appendChild(pill(q.status));tr.appendChild(s);
  var f=el('td');if(d.override)f.appendChild(el('div',null,'Examiner override: '+d.override));if(d.feedback)f.appendChild(el('div',null,d.feedback));if(d.lostMarks)f.appendChild(el('div',{class:'small'},'Lost marks: '+d.lostMarks));if(d.corrected)f.appendChild(el('div',{class:'small'},'Marked from a corrected reading.'));if(d.evidencePages&&d.evidencePages.length)f.appendChild(el('div',{class:'small'},'Evidence on page(s) '+d.evidencePages.join(', ')));tr.appendChild(f);
  var k=el('td');q.flags.forEach(function(fl){k.appendChild(el('div',{class:'flag'},fl.detail));});tr.appendChild(k);tb.appendChild(tr);});t.appendChild(tb);var wrap=el('div',{class:'card detail'});wrap.appendChild(t);detail.appendChild(wrap);if(detail.scrollIntoView)detail.scrollIntoView({behavior:'smooth',block:'start'});}
['f-search','f-tmin','f-tmax','f-pmin','f-pmax','f-status','f-flag','f-fail','f-changed','f-q','f-qo'].forEach(function(id){var e=document.getElementById(id);e.addEventListener('input',render);e.addEventListener('change',render);});
document.getElementById('f-reset').addEventListener('click',function(e){e.preventDefault();['f-search','f-tmin','f-tmax','f-pmin','f-pmax','f-status','f-q','f-qo'].forEach(function(id){document.getElementById(id).value='';});['f-flag','f-fail','f-changed'].forEach(function(id){document.getElementById(id).checked=false;});render();});
var issues=document.getElementById('issues');D.candidates.forEach(function(c){c.questions.forEach(function(q){q.flags.forEach(function(f){var li=el('li');li.appendChild(el('b',null,c.candidateId+' · Q'+q.number+': '));li.appendChild(document.createTextNode(f.detail));issues.appendChild(li);});});});
if(!issues.children.length)issues.appendChild(el('li',null,'No open review flags.'));
var fl=document.getElementById('failed');D.failed.forEach(function(f){fl.appendChild(el('li',null,f.candidateId+' ('+f.fileName+'): '+f.error));});if(!D.failed.length)fl.appendChild(el('li',null,'None.'));
render();
})();
`;

export function renderExamReport(data: ReportData): string {
  const e = data.exam;
  const csp = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>${escapeHtml(e.title)} – marking results</title><style>${CSS}</style></head>
<body><main>
<h1>${escapeHtml(e.title)}</h1>
<div class="meta">Exam ${escapeHtml(e.id.slice(0, 8))} · marking scheme v${e.schemeVersion} · run ${escapeHtml(e.runId.slice(0, 8))} · result revision ${e.resultRevision} · generated ${escapeHtml(e.generatedAt.replace('T', ' ').slice(0, 16))} UTC</div>
<div class="banner">AI-assisted marking against the official marking scheme. Marks are <b>provisional</b> unless marked “user confirmed”; items flagged for review need a teacher's check. Totals are computed by Bwenge.AI, not by the AI model.</div>
<section><div class="tiles" id="tiles"></div></section>
<h2>Score distribution</h2><div class="card" id="dist"></div>
<h2>Question performance</h2><div class="card" id="qbars"></div>
<div class="card" style="margin-top:10px"><table><thead><tr><th>Question</th><th>Max</th><th>Marked</th><th>Mean</th><th>Mean %</th><th>Full</th><th>Partial</th><th>Zero</th><th>Flagged</th></tr></thead><tbody id="qtable"></tbody></table></div>
<h2>Candidates</h2>
<div class="card"><div class="filters">
<label>Search ID, name or file<input id="f-search" type="search" autocomplete="off"></label>
<label>Total from<input id="f-tmin" type="number" step="any"></label><label>Total to<input id="f-tmax" type="number" step="any"></label>
<label>Percentage from<input id="f-pmin" type="number" step="any"></label><label>Percentage to<input id="f-pmax" type="number" step="any"></label>
<label>Status<select id="f-status"><option value="">All</option><option value="provisional">Provisional</option><option value="needs_review">Needs review</option><option value="corrected">Corrected or confirmed</option><option value="user_corrected">User corrected</option><option value="user_confirmed">User confirmed</option></select></label>
<label>Question<select id="f-q"><option value="">Any question</option></select></label>
<label>Answer was<select id="f-qo"><option value="">Any outcome</option><option value="correct">Fully correct</option><option value="partial">Partly correct</option><option value="incorrect">Incorrect (0 marks)</option><option value="notfull">Not full marks</option></select></label>
<label class="chk"><input id="f-flag" type="checkbox">With review flags</label><label class="chk"><input id="f-fail" type="checkbox">Below pass mark (${e.passPercent}%)</label><label class="chk"><input id="f-changed" type="checkbox">Changed by a user</label>
<a href="#" id="f-reset">Reset filters</a></div>
<p class="small" id="count"></p>
<table><thead><tr id="chead"></tr></thead><tbody id="cbody"></tbody></table>
<p class="small">* incomplete: at least one question has no mark yet. Click a candidate for question-level feedback and the marked script.</p></div>
<div id="detail"></div>
<h2>Open review items</h2><div class="card"><ul id="issues"></ul></div>
<h2>Scripts that could not be processed</h2><div class="card"><ul id="failed"></ul></div>
</main>
<script type="application/json" id="report-data">${scriptJson(data)}</script>
<script>${JS}</script>
</body></html>`;
}

/** Checks for the exam report: CSP present, no network access, no secrets or server paths. */
export function validateExamReport(html: string, forbiddenStrings: string[] = []): { valid: boolean; problems: string[] } {
  const problems: string[] = [];
  if (!/^<!doctype html>/i.test(html)) problems.push('missing doctype');
  if (!/<meta http-equiv="Content-Security-Policy" content="default-src 'none';/i.test(html)) problems.push('missing restrictive CSP');
  if (/<script\b[^>]*\bsrc\s*=/i.test(html)) problems.push('external script');
  if (/\b(?:src|href|action)\s*=\s*["']?\s*(?:https?:|\/\/|javascript:|data:text)/i.test(html)) problems.push('external or active link');
  if (/@import|url\(\s*['"]?(?:https?:)?\/\//i.test(html)) problems.push('CSS loads an external resource');
  if (/<(iframe|object|embed|form|base)\b/i.test(html)) problems.push('disallowed element');
  if (/(sk-ant-[\w-]{10,}|sk-[\w-]{20,}|Bearer\s+[\w.-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY)/.test(html)) problems.push('looks like a credential');
  if (/(\/home\/[\w.-]+\/|\/root\/|\/var\/www\/|\/opt\/[\w.-]+\/)/.test(html)) problems.push('contains a server file path');
  for (const s of forbiddenStrings) if (s && s.length >= 6 && html.includes(s)) problems.push('contains a forbidden internal string');
  return { valid: problems.length === 0, problems };
}
