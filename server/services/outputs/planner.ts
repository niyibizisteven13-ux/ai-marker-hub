import type { OutputKind } from './spec.js';

/**
 * Output planner: decides how a request is best answered before anything is generated.
 * Deterministic and explainable (each decision lists its reasons), so it can be tested and audited.
 *
 * Principles: plain prose for simple questions; computation through the analysis engine whenever numbers
 * must be exact; a chart for comparisons and trends; a file only when one is asked for or clearly needed;
 * an interactive HTML report only when exploring the result materially helps. At most one primary artifact.
 */

export interface PlanInput {
  message: string;
  /** Attached or referenced files (name + MIME), e.g. chat uploads. */
  attachments?: Array<{ name: string; mime?: string }>;
  /** Sources the caller proposes to use; the planner keeps only those the resolver authorises. */
  sources?: Array<{ type: string; id: string }>;
  /** Whether a tabular dataset is available in context (upload, repository file, analytics dataset). */
  hasDataset?: boolean;
  imageGenerationAvailable?: boolean;
}

export interface OutputPlan {
  intent: 'question' | 'analysis' | 'visualisation' | 'document' | 'report' | 'diagram' | 'map' | 'image' | 'table' | 'model3d' | 'form';
  output: OutputKind | 'model3d' | 'form';
  format: 'prose' | 'table' | 'svg' | 'html' | 'xlsx' | 'pdf' | 'docx' | 'pptx' | 'json' | 'png' | 'scene';
  needsComputation: boolean;
  needsRetrieval: boolean;
  tools: string[];
  artifact: boolean;
  template?: 'statistical_report' | 'briefing_deck' | 'data_workbook';
  authorizedSources: Array<{ type: string; id: string }>;
  rejectedSources: Array<{ type: string; id: string; reason: string }>;
  /** Every deliverable the user explicitly asked for in this message (e.g. a chart AND an Excel file). */
  deliverables: Array<{ output: OutputKind | 'model3d'; format: OutputPlan['format'] }>;
  reasons: string[];
}

const has = (re: RegExp, s: string) => re.test(s);
const TABULAR = /\.(csv|tsv|xlsx|xls|json)$/i;

const R = {
  xlsx: /\b(excel|xlsx|spreadsheet|workbook)\b/i,
  pdf: /\bpdf\b/i,
  docx: /\b(word|docx|editable (?:report|document))\b/i,
  pptx: /\b(powerpoint|pptx|slides?|slide deck|deck|presentation)\b/i,
  dashboard: /\bdashboard\b/i,
  /** Forms, surveys and questionnaires: creating, changing, publishing them, or working with their responses. */
  form: /\b(forms?|surveys?|questionnaires?|quiz(?:zes)?|registration|sign-?up\s+sheet|application\s+form|feedback\s+form|poll)\b/i,
  /** A saved form the user owns ("my survey", "this form"), as opposed to figures that merely came from a survey. */
  ownForm: /\b(?:my|this|the|our)\s+(?:\w+\s+)?(?:forms?|surveys?|questionnaires?|quiz(?:zes)?|poll)\b/i,
  formWork: /\b(create|make|build|design|generate|draft|prepare|add|remove|change|edit|update|reword|publish|share|open|close|review|check|analy[sz]e|results?|responses?|submissions?|report|export|excel|statistics|stats|chart|summari[sz]e|my)\b/i,
  /** Something to look at from every side: a 3D model the student can rotate (anatomy, molecules, machines, buildings). */
  model3d: /(?:\b3[- ]?d\b|\b(?:3|three)[- ]?dimen\w*|\brotatable\b|\b(?:can|could|to) (?:rotate|spin) (?:it|them|the model)\b|\bball[- ]and[- ]stick\b|\bin vr\b|\bvirtual reality\b)/i,
  /** A shareable HTML page that demonstrates or explains something (data story, showcase, interactive page). */
  html: /\b(html|web ?page|demonstrat\w*|demo|showcase|data story|infographic|interactive (?:page|report|story))\b/i,
  report: /\b(report|write[- ]?up|brief(?:ing)?)\b/i,
  interactive: /\b(interactive|explore|explorer|filterable|sortable|drill[- ]?down|widget|calculator)\b/i,
  chart: /\b(chart|graph|plot|visuali[sz]e|visuali[sz]ation|histogram|scatter|bar chart|line chart|pie)\b/i,
  trend: /\b(trend|over time|per (?:year|month|term)|compare|comparison|growth)\b/i,
  diagram: /\b(diagram|flow ?chart|process map|org(?:anisation|anization)? chart|mermaid|decision tree|workflow)\b/i,
  map: /\b(map|choropleth|geograph\w*)\b/i,
  image: /\b(image|picture|photo|illustration|poster|drawing)\b/i,
  table: /\b(table|tabulate|list (?:the|all)|columns?)\b/i,
  compute: /\b(mean|average|median|mode|sum|total|percent(?:age)?|ratio|rate|standard deviation|variance|regression|correlat\w*|statistic\w*|calculate|compute|how many|count|distribution|outliers?|pivot|group(?:ed)? by|moving average|significan\w*|p-value|confidence interval)\b/i,
  causal: /\b(cause|causes|caused|effect of|impact of|because of)\b/i,
  retrieval: /\b(rwanda|nisr|ministry|policy|curriculum|law|official|according to|source|report says|document says)\b/i,
  /** The user asks for something to be produced (not merely mentions a format: "summarise this PDF"). */
  create: /\b(make|create|generate|give|export|produce|build|prepare|draw|plot|download|save|convert|turn|put|send|write|draft|design|render|visuali[sz]e)\b|\b(?:as|in|into|to)\s+(?:an?\s+)?(?:excel|xlsx|word|docx|pdf|powerpoint|pptx|slides?|chart|graph|spreadsheet|workbook|deck)\b/i,
};

export function planOutput(input: PlanInput, authorize: (s: { type: string; id: string }) => { ok: boolean; reason?: string } = () => ({ ok: true })): OutputPlan {
  const m = input.message.normalize('NFKC');
  const reasons: string[] = [];
  const tabularAttachment = (input.attachments ?? []).some((a) => TABULAR.test(a.name) || /csv|spreadsheet|excel/.test(a.mime ?? ''));
  const hasData = !!input.hasDataset || tabularAttachment || (input.sources ?? []).length > 0;

  const authorizedSources: OutputPlan['authorizedSources'] = [];
  const rejectedSources: OutputPlan['rejectedSources'] = [];
  for (const s of input.sources ?? []) {
    const a = authorize(s);
    if (a.ok) authorizedSources.push(s); else rejectedSources.push({ ...s, reason: a.reason ?? 'not accessible' });
  }
  if (rejectedSources.length) reasons.push(`${rejectedSources.length} source(s) are not accessible to this user and will not be used.`);

  const needsComputation = hasData && has(R.compute, m) || (hasData && (has(R.chart, m) || has(R.trend, m) || has(R.dashboard, m)));
  if (needsComputation) reasons.push('Numbers must come from the dataset, so they are computed by the analysis engine, not estimated by the model.');
  const needsRetrieval = !hasData && has(R.retrieval, m);
  if (needsRetrieval) reasons.push('The question refers to documents or official facts, so knowledge-base retrieval is needed for citations.');
  if (has(R.causal, m) && needsComputation) reasons.push('The request asks about causes; results will be reported as associations unless the data come from a controlled design.');

  // Explicitly requested deliverables; a request can name several ("a bar chart and an Excel file").
  const deliverables: OutputPlan['deliverables'] = [];
  if (has(R.create, m)) {
    if (has(R.chart, m)) deliverables.push({ output: 'chart', format: 'svg' });
    if (has(R.diagram, m)) deliverables.push({ output: 'diagram', format: 'svg' });
    for (const fmt of ['xlsx', 'pptx', 'docx', 'pdf'] as const) if (has(R[fmt], m)) deliverables.push({ output: needsComputation && fmt !== 'pdf' ? 'template' : 'document', format: fmt });
    if (has(R.dashboard, m) || has(R.html, m)) deliverables.push({ output: 'report', format: 'html' });
  }

  const plan = (p: Omit<OutputPlan, 'needsComputation' | 'needsRetrieval' | 'authorizedSources' | 'rejectedSources' | 'reasons' | 'deliverables'>): OutputPlan => ({
    ...p, needsComputation, needsRetrieval, authorizedSources, rejectedSources,
    tools: [...new Set([...(needsRetrieval ? ['search_knowledge'] : []), ...(needsComputation ? ['analyze_data'] : []), ...p.tools])],
    // Only explicitly requested deliverables are enforced by the chat delivery check.
    deliverables: p.artifact ? deliverables : [],
    reasons,
  });

  // 0. Forms: the form tools create, change, review and publish real forms and analyse their stored responses.
  if (has(R.form, m) && has(R.formWork, m) && !hasData && (!has(R.html, m) || has(R.ownForm, m))) {
    reasons.push('A form, survey or questionnaire request: handled by the form tools (real saved forms and their stored responses).');
    return { ...plan({ intent: 'form', output: 'form', format: 'json', tools: ['create_form', 'edit_form', 'review_form', 'publish_form', 'list_forms', 'analyze_form', 'form_report'], artifact: true }), deliverables: [] };
  }
  // 1. An explicit file format wins: the user said what they want to receive.
  for (const fmt of ['xlsx', 'pptx', 'docx', 'pdf'] as const) {
    if (has(R[fmt], m) && has(R.create, m)) {
      const template = needsComputation ? ({ xlsx: 'data_workbook', pptx: 'briefing_deck', docx: 'statistical_report', pdf: undefined } as const)[fmt] : undefined;
      reasons.push(`The request names a ${fmt.toUpperCase()} file${template ? `; the editable ${template.replace('_', ' ')} template keeps computed results, methods and limitations together` : ''}.`);
      return plan({ intent: 'document', output: template ? 'template' : 'document', format: fmt, tools: ['create_output'], artifact: true, template });
    }
  }
  // 2. A 3D model the student can rotate: rendered by the interactive viewer, never drawn as a flat image.
  if (has(R.model3d, m) && (has(R.create, m) || /\b(show|see|view|explore|model|structure)\b/i.test(m))) {
    reasons.push('A 3D structure was requested: an interactive model the student can rotate, take apart and cut open.');
    const p = plan({ intent: 'model3d', output: 'model3d', format: 'scene', tools: ['create_3d_model'], artifact: true });
    return { ...p, deliverables: [{ output: 'model3d', format: 'scene' }] };
  }
  // 3. Dashboards, HTML pages that demonstrate something, and interactive reports: only when exploring helps.
  if (has(R.dashboard, m) || has(R.html, m) || (has(R.interactive, m) && (has(R.report, m) || hasData))) {
    reasons.push(has(R.dashboard, m) ? 'A dashboard was requested: a persistent, shareable HTML report.'
      : has(R.html, m) ? 'An HTML page that demonstrates the topic was requested: a themed report with KPIs, charts, tables and explanation.'
        : 'Interactive exploration was requested and there is data to explore.');
    return plan({ intent: 'report', output: has(R.dashboard, m) || has(R.report, m) || has(R.html, m) ? 'report' : 'widget', format: 'html', tools: ['create_output'], artifact: true });
  }
  if (has(R.diagram, m)) {
    reasons.push('A process or structure is best shown as a diagram.');
    return plan({ intent: 'diagram', output: 'diagram', format: 'svg', tools: ['create_output'], artifact: true });
  }
  if (has(R.map, m) && (hasData || /\bmap\b/i.test(m))) {
    reasons.push('Geographic data is best shown on a map (needs coordinates or boundary data).');
    return plan({ intent: 'map', output: 'map', format: 'svg', tools: ['create_output'], artifact: true });
  }
  if (has(R.chart, m) || (hasData && has(R.trend, m))) {
    reasons.push(has(R.chart, m) ? 'A chart was requested.' : 'Comparisons and trends are clearer as a chart.');
    return plan({ intent: 'visualisation', output: 'chart', format: 'svg', tools: ['create_output'], artifact: true });
  }
  if (has(R.report, m) && hasData) {
    reasons.push('A report on data: a persistent HTML report with methods and limitations.');
    return plan({ intent: 'report', output: 'report', format: 'html', tools: ['create_output'], artifact: true });
  }
  if (has(R.image, m) && !hasData) {
    if (input.imageGenerationAvailable) {
      reasons.push('An image was requested and image generation is configured.');
      return plan({ intent: 'image', output: 'image', format: 'png', tools: ['generate_image'], artifact: true });
    }
    reasons.push('An image was requested but image generation is not configured; an SVG drawing is offered instead.');
    return plan({ intent: 'image', output: 'answer', format: 'svg', tools: ['create_drawing'], artifact: true });
  }
  if (needsComputation) {
    reasons.push('A computed answer with a compact results table; no file needed.');
    return plan({ intent: 'analysis', output: 'analysis', format: 'table', tools: [], artifact: false });
  }
  if (has(R.table, m)) {
    reasons.push('A structured table answers this best.');
    return plan({ intent: 'table', output: 'answer', format: 'table', tools: [], artifact: false });
  }
  reasons.push('A direct answer in prose is enough; no artifact.');
  return plan({ intent: 'question', output: 'answer', format: 'prose', tools: [], artifact: false });
}

/** One-paragraph guidance for the chat model, appended to the system prompt for this turn. */
export function planHint(p: OutputPlan): string {
  const list = p.deliverables.map((d) => `a ${d.output === 'template' ? `${d.format.toUpperCase()} template` : d.output === 'document' ? `${d.format.toUpperCase()} file` : `${d.output} (${d.format.toUpperCase()})`}`);
  const what = p.artifact
    ? list.length > 1
      ? `The user asked for ${list.length} deliverables: ${list.join(' and ')}. Create each one with a tool call; do not skip any.`
      : p.output === 'form' ? 'Use the form tools: create_form for a new form, list_forms then edit_form / review_form / publish_form for an existing one, analyze_form for statistics on its responses, form_report for the HTML report and Excel data. Do not write a <form_schema> block or JSON.'
      : p.output === 'model3d' ? 'Call create_3d_model to build an interactive 3D model (named parts with realistic proportions and colours, a short description each, guided views). Never draw it as an SVG or describe JSON in the reply.'
      : `Produce one ${p.output}${p.template ? ` (${p.template} template)` : ''} in ${p.format.toUpperCase()} format with a tool call.`
    : `Answer in ${p.format === 'table' ? 'prose with a compact table' : 'plain prose'}; do not create a file.`;
  return `[Output plan for this turn: ${what}${p.needsComputation ? ' Compute every number with analyze_data; never estimate numbers.' : ''}${p.needsRetrieval ? ' Retrieve and cite sources with search_knowledge.' : ''} Reasons: ${p.reasons.join(' ')}]`;
}
