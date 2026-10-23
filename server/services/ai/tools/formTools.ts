import type { Tool, ToolServices } from '../types.js';
import type { ProviderAdapter } from '../providers/types.js';
import { err } from './helpers.js';
import { AnalysisError, coverage, runAnalysis, summarize, tabular, type AnalysisRequest, type Dataset } from '../../forms/analysis.js';
import { codebook, normalizeFields } from '../../forms/model.js';
import { editForm, generateForm } from '../../forms/generate.js';
import { reviewForm, type Review } from '../../forms/review.js';
import { createForm, formDataset, formLinks, FormError, listForms, ownForm, saveForm, setOpen } from '../../forms/service.js';
import { recordUsage } from '../../billing/usage.js';

/**
 * Forms through conversation: create from a description, change, review, publish, list, analyse the responses
 * with real statistics, and deliver an HTML report and an Excel workbook with the codebook. Every number in
 * replies comes from the statistics engine; generated forms are drafts until the owner publishes them.
 */

type AI = { adapter: ProviderAdapter; model: string; fallbackModel?: string | null };
const fmt = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? '–' : String(Number(n.toFixed(2))));

function reviewText(r: Review, max = 5): string {
  const top = r.findings.slice(0, max).map((f) => `- ${f.level === 'critical' ? '**Critical**' : f.level === 'error' ? '**Error**' : f.level === 'warning' ? 'Warning' : 'Suggestion'}${f.question ? ` ("${f.question}")` : ''}: ${f.finding} ${f.recommendation}`);
  return `Readiness ${r.score}/100 (completeness ${r.parts.completeness}, validation ${r.parts.validation}, logic ${r.parts.logic}, privacy ${r.parts.privacy}, wording ${r.parts.accessibility})${r.ready ? '' : ' – fix the critical issues and errors before publishing'}.${top.length ? `\n${top.join('\n')}${r.findings.length > max ? `\n- … and ${r.findings.length - max} more` : ''}` : '\nNo issues found.'}`;
}

function outline(schema: any): string {
  const fields = normalizeFields(schema);
  let sec: string | null = null;
  const lines: string[] = [];
  fields.forEach((f, i) => {
    if (f.section && f.section !== sec) { sec = f.section; lines.push(`**${sec}**`); }
    lines.push(`${i + 1}. ${f.label} – ${f.kind.replace('_', ' ')}${f.options.length ? ` (${f.options.slice(0, 6).join(' / ')}${f.options.length > 6 ? ' / …' : ''})` : ''}${f.kind === 'number' && (f.min !== undefined || f.max !== undefined) ? ` ${fmt(f.min ?? null)}–${fmt(f.max ?? null)}${f.unit ? ` ${f.unit}` : ''}` : ''}${f.required ? ', required' : ''}${f.showIf ? `, shown when ${fields.find((x) => x.id === f.showIf!.fieldId)?.variable ?? f.showIf.fieldId} = ${String(f.showIf.equals ?? '…')}` : ''}`);
  });
  return lines.join('\n');
}

export function analysisText(res: ReturnType<typeof runAnalysis>): string {
  switch (res.type) {
    case 'summary': return `${res.responses} responses.\n${res.summaries.map((s) => {
      const cov = `${s.coverage.answered} answered${s.coverage.skipped ? `, ${s.coverage.skipped} skipped` : ''}${s.coverage.notShown ? `, ${s.coverage.notShown} not shown (branching)` : ''}`;
      if (s.kind === 'categorical') return `- ${s.variable} ("${s.question}"): ${s.table.map((t) => `${t.value} ${t.count} (${t.percent}%)`).join(', ')}${s.median !== undefined ? `; median ${s.median}, mean ${s.mean}` : ''}${s.multiple ? ' (several answers allowed: % of respondents)' : ''} [${cov}]`;
      if (s.kind === 'numeric') return `- ${s.variable} ("${s.question}"): n ${s.n}, mean ${fmt(s.mean)}, median ${fmt(s.median)}, SD ${fmt(s.sd)}, range ${fmt(s.min)}–${fmt(s.max)}${s.unit ? ` ${s.unit}` : ''}, IQR ${fmt(s.q1)}–${fmt(s.q3)}${s.outliers ? `, ${s.outliers} outlier(s)` : ''} [${cov}]`;
      if (s.kind === 'date') return `- ${s.variable}: from ${s.first ?? '–'} to ${s.last ?? '–'} [${cov}]`;
      if (s.kind === 'grid') return `- ${s.variable} ("${s.question}"): ${s.rows.map((r) => `${r.row}: ${r.table.map((t) => `${t.value} ${t.count}`).join(', ')}`).join('; ')} [${cov}]`;
      return `- ${s.variable} ("${s.question}"): text, average ${s.averageLength} characters; examples: ${s.examples.map((e) => `"${e.slice(0, 120)}"`).join('; ') || '–'} [${cov}]`;
    }).join('\n')}`;
    case 'crosstab': return `Cross-tabulation ${res.row} × ${res.column} (n ${res.n}):\n| ${res.row} \\ ${res.column} | ${res.cols.join(' | ')} |\n|---|${res.cols.map(() => '---').join('|')}|\n${res.rows.map((r, i) => `| ${r} | ${res.counts[i].join(' | ')} |`).join('\n')}\n${res.chi2 !== null ? `Chi-square ${res.chi2} (df ${res.df}), p = ${res.p}, Cramér's V ${res.cramersV}.` : 'No test.'}${res.warnings.length ? `\nNotes: ${res.warnings.join(' ')}` : ''}`;
    case 'compare': return `${res.outcome} by ${res.group}:\n| Group | n | Mean | Median | SD |\n|---|---|---|---|---|\n${res.groups.map((g) => `| ${g.group} | ${g.n} | ${fmt(g.mean)} | ${fmt(g.median)} | ${fmt(g.sd)} |`).join('\n')}\n${res.f !== null ? `One-way ANOVA F(${res.df1}, ${res.df2}) = ${res.f}, p = ${res.p}, eta² = ${res.etaSquared}.` : 'No test.'}${res.warnings.length ? `\nNotes: ${res.warnings.join(' ')}` : ''}\nDifferences between groups describe this sample; they do not show cause.`;
    case 'correlate': return `${res.x} and ${res.y} (n ${res.n}): Pearson r = ${res.pearson ?? '–'}${res.p !== null ? ` (p = ${res.p})` : ''}, Spearman rho = ${res.spearman ?? '–'}.${res.warnings.length ? `\nNotes: ${res.warnings.join(' ')}` : ''}`;
  }
}

const ANALYSIS_ITEM = {
  type: 'object', required: ['type'],
  properties: {
    type: { type: 'string', enum: ['summary', 'crosstab', 'compare', 'correlate'] },
    variables: { type: 'array', items: { type: 'string' }, description: 'summary: variable names (empty = all)' },
    row: { type: 'string' }, column: { type: 'string' }, outcome: { type: 'string', description: 'numeric variable' }, group: { type: 'string', description: 'categorical variable' }, x: { type: 'string' }, y: { type: 'string' },
  },
};

const toRequest = (a: any): AnalysisRequest => (a.type === 'crosstab' ? { type: 'crosstab', row: String(a.row ?? ''), column: String(a.column ?? '') }
  : a.type === 'compare' ? { type: 'compare', outcome: String(a.outcome ?? ''), group: String(a.group ?? '') }
    : a.type === 'correlate' ? { type: 'correlate', x: String(a.x ?? ''), y: String(a.y ?? '') }
      : { type: 'summary', variables: Array.isArray(a.variables) ? a.variables.map(String) : [] });

/** The HTML report spec (output engine) built from computed results only. */
export function reportSpec(title: string, ds: Dataset, analyses: Array<ReturnType<typeof runAnalysis>>, formId: string) {
  const src = [{ type: 'user' as const, id: formId, label: `Responses to "${title}" (${ds.rows.length}), computed by the Bwenge statistics engine` }];
  const note = `Form responses, n = ${ds.rows.length}`;
  const dates = ds.rows.map((r) => r.submittedAt).filter(Boolean).sort() as string[];
  const sections: any[] = [];
  for (const f of ds.fields.filter((x) => x.kind !== 'file').slice(0, 30)) {
    const s = summarize(ds, f, { examples: 3 });
    const cov = `${s.coverage.answered} answered${s.coverage.skipped ? `, ${s.coverage.skipped} skipped` : ''}${s.coverage.notShown ? `, ${s.coverage.notShown} not shown by branching` : ''}.`;
    if (s.kind === 'categorical') sections.push({ heading: f.label.slice(0, 200), text: `Variable ${f.variable} (${f.measurement}). ${cov}${s.multiple ? ' Several answers were allowed, so percentages are of respondents and can add up to more than 100%.' : ''}${s.median !== undefined ? ` Median ${s.median}, mean ${s.mean}.` : ''}`, chart: { type: 'bar', x: { field: 'Answer', title: 'Answer', type: f.measurement === 'ordinal' ? 'ordinal' : 'nominal' }, y: { field: 'Responses', title: 'Responses', unit: 'responses' }, data: s.table.map((t) => ({ Answer: t.value, Responses: t.count })), sourceNote: note }, table: { columns: [{ key: 'value', label: 'Answer' }, { key: 'count', label: 'Responses' }, { key: 'percent', label: '%', unit: '%' }], rows: s.table } });
    else if (s.kind === 'numeric') sections.push({ heading: f.label.slice(0, 200), text: `Variable ${f.variable} (${f.measurement}${f.unit ? `, ${f.unit}` : ''}). ${cov}${s.outliers ? ` ${s.outliers} value(s) lie far outside the middle half of the answers; check them before drawing conclusions.` : ''}`, table: { columns: [{ key: 'k', label: 'Statistic' }, { key: 'v', label: 'Value', ...(f.unit ? { unit: f.unit } : {}) }], rows: [['Responses', s.n], ['Mean', s.mean], ['Median', s.median], ['Standard deviation', s.sd], ['Lower quartile', s.q1], ['Upper quartile', s.q3], ['Minimum', s.min], ['Maximum', s.max]].map(([k, v]) => ({ k, v: Number.isFinite(v as number) ? v : null })) }, ...(s.n >= 5 ? { chart: { type: 'histogram', x: { field: 'Value', title: f.label.slice(0, 120), unit: f.unit || 'none', type: 'quantitative' }, data: ds.rows.map((r) => Number(r.answers[f.id])).filter(Number.isFinite).map((v) => ({ Value: v })), sourceNote: note } } : {}) });
    else if (s.kind === 'text') sections.push({ heading: f.label.slice(0, 200), text: `Open answers (${cov}). Examples:\n${s.examples.map((e) => `- "${e}"`).join('\n') || '- none'}` });
    else if (s.kind === 'grid') sections.push({ heading: f.label.slice(0, 200), text: cov, table: { columns: [{ key: 'row', label: 'Row' }, ...f.columns.map((c, i) => ({ key: `c${i}`, label: c.slice(0, 200) }))], rows: s.rows.map((r) => ({ row: r.row, ...Object.fromEntries(r.table.map((t, i) => [`c${i}`, t.count])) })) } });
  }
  for (const a of analyses) {
    if (a.type === 'crosstab') sections.push({ heading: `${a.row} by ${a.column}`, text: `${a.chi2 !== null ? `Chi-square ${a.chi2} (df ${a.df}), p = ${a.p}, Cramér's V ${a.cramersV}. ` : ''}${a.warnings.join(' ')} An association in this sample does not show cause.`, table: { columns: [{ key: 'r', label: `${a.row} \\ ${a.column}` }, ...a.cols.map((c, i) => ({ key: `c${i}`, label: c.slice(0, 200) }))], rows: a.rows.map((r, i) => ({ r, ...Object.fromEntries(a.counts[i].map((n, j) => [`c${j}`, n])) })) } });
    if (a.type === 'compare') sections.push({ heading: `${a.outcome} by ${a.group}`, text: `${a.f !== null ? `One-way ANOVA F(${a.df1}, ${a.df2}) = ${a.f}, p = ${a.p}, eta² = ${a.etaSquared}. ` : ''}${a.warnings.join(' ')} Differences describe this sample; they do not show cause.`, chart: { type: 'bar', x: { field: 'Group', title: a.group, type: 'nominal' }, y: { field: 'Median', title: `Median ${a.outcome}`, unit: a.unit || 'none' }, data: a.groups.map((g) => ({ Group: g.group, Median: Number.isFinite(g.median) ? g.median : null })), sourceNote: note }, table: { columns: [{ key: 'group', label: 'Group' }, { key: 'n', label: 'n' }, { key: 'mean', label: 'Mean' }, { key: 'median', label: 'Median' }, { key: 'sd', label: 'SD' }], rows: a.groups.map((g) => ({ group: g.group, n: g.n, mean: Number.isFinite(g.mean) ? g.mean : null, median: Number.isFinite(g.median) ? g.median : null, sd: Number.isFinite(g.sd) ? g.sd : null })) } });
    if (a.type === 'correlate') sections.push({ heading: `${a.x} and ${a.y}`, text: `Pearson r = ${a.pearson ?? '–'}${a.p !== null ? ` (p = ${a.p})` : ''}, Spearman rho = ${a.spearman ?? '–'}, n = ${a.n}. ${a.warnings.join(' ')}`, chart: (() => { const fx = ds.fields.find((f) => f.variable === a.x)!, fy = ds.fields.find((f) => f.variable === a.y)!; return { type: 'scatter', x: { field: 'X', title: a.x, unit: fx.unit || 'none', type: 'quantitative' }, y: { field: 'Y', title: a.y, unit: fy.unit || 'none' }, data: ds.rows.map((r) => ({ X: Number(r.answers[fx.id]), Y: Number(r.answers[fy.id]) })).filter((p) => Number.isFinite(p.X) && Number.isFinite(p.Y)), sourceNote: note }; })() });
  }
  sections.push({ heading: 'Method and limitations', text: `All figures are computed from the ${ds.rows.length} stored responses by the Bwenge statistics engine (frequencies, descriptive statistics, chi-square, one-way ANOVA, Pearson and Spearman correlation). Questions hidden by branching count as "not shown", not as missing. Results describe the people who answered; without a random sample they may not represent a wider population, and associations do not establish causes.` });
  return {
    kind: 'report', title: `${title}: results`.slice(0, 200), sources: src, layout: 'report',
    summary: `${ds.rows.length} responses${dates.length ? ` collected between ${dates[0].slice(0, 10)} and ${dates[dates.length - 1].slice(0, 10)}` : ''}.`,
    kpis: [{ label: 'Responses', value: ds.rows.length }, { label: 'Questions', value: ds.fields.length }, ...(dates.length ? [{ label: 'Last response', value: dates[dates.length - 1].slice(0, 10) }] : [])],
    sections: sections.slice(0, 40),
  };
}

export function formTools(services: ToolServices & { formAi?: () => AI } = {}): Tool[] {
  const ai = async (): Promise<AI> => {
    if (services.formAi) return services.formAi();
    const { agentTarget } = await import('../../AiService.js');
    const a = agentTarget();
    return { adapter: a.adapter, model: a.model, fallbackModel: a.fallbackModel };
  };
  const fail = (e: any) => (e instanceof FormError || e instanceof AnalysisError ? err(e.message) : err(`The form request failed: ${e?.message ?? 'unknown error'}.`));
  const meter = (userId: string, model: string, usage?: { input: number; output: number }) => { void recordUsage(userId, { kind: 'artifact', model, inputTokens: usage?.input, outputTokens: usage?.output }); };

  const createFormTool: Tool = {
    definition: {
      name: 'create_form',
      description: 'Create a form, survey, questionnaire, registration, application, feedback form or quiz from a plain-language description. Bwenge designs sections, typed questions with validation, branching and a data dictionary, saves it as a DRAFT and reviews it. Pass everything the user said about purpose, audience, question types and analysis.',
      parameters: { type: 'object', required: ['description'], properties: { description: { type: 'string' } } },
    },
    async execute(input, ctx) {
      try {
        const a = await ai();
        const g = await generateForm(a, String(input.description ?? ''), ctx.signal);
        meter(ctx.userId, a.model, g.usage);
        const id = await createForm(ctx.userId, g.schema);
        const r = reviewForm(g.schema);
        const l = formLinks(id);
        return { text: `Created the draft form "${g.schema.title}" (formId ${id}, ${r.questions} questions${r.sections ? ` in ${r.sections} sections` : ''}). It is NOT published yet.\n\n${outline(g.schema)}\n\nDesign notes: ${g.notes.join(' ')}\n\n${reviewText(r)}\n\nLinks for the user: [Open and edit the form](${l.edit}) · [Preview it as a respondent](${l.fill}). Tell the user they can ask for changes in plain words, and say "publish it" when ready. Show the outline briefly; do not paste JSON.` };
      } catch (e) { return fail(e); }
    },
  };

  const editFormTool: Tool = {
    definition: {
      name: 'edit_form',
      description: 'Change one of the user\'s forms in plain words: add, remove, reword or reorder questions, change types, options, validation, required, branching, sections, title or description. Unchanged questions keep their ids. Use list_forms first if you do not know the formId.',
      parameters: { type: 'object', required: ['formId', 'change'], properties: { formId: { type: 'string' }, change: { type: 'string' } } },
    },
    async execute(input, ctx) {
      try {
        const { schema } = await ownForm(ctx.userId, String(input.formId));
        const a = await ai();
        const g = await editForm(a, schema, String(input.change ?? ''), ctx.signal);
        meter(ctx.userId, a.model, g.usage);
        await saveForm(ctx.userId, String(input.formId), g.schema);
        const r = reviewForm(g.schema);
        return { text: `Updated the form "${g.schema.title}" (formId ${input.formId}). New outline:\n${outline(g.schema)}\n\n${reviewText(r, 3)}\n\nResponses already collected keep the version they answered; new responses use the new version. [Open the form](${formLinks(String(input.formId)).edit}).` };
      } catch (e) { return fail(e); }
    },
  };

  const reviewTool: Tool = {
    definition: { name: 'review_form', description: 'Review one of the user\'s forms before publishing: completeness, validation, logic and branching, privacy and consent, wording; returns a readiness score and fixes.', parameters: { type: 'object', required: ['formId'], properties: { formId: { type: 'string' } } } },
    async execute(input, ctx) {
      try { const { row, schema } = await ownForm(ctx.userId, String(input.formId)); return { text: `Review of "${row.title}":\n${reviewText(reviewForm(schema), 10)}\n\nOffer to apply the fixes with edit_form.` }; } catch (e) { return fail(e); }
    },
  };

  const publishTool: Tool = {
    definition: { name: 'publish_form', description: 'Publish (open for responses) or close one of the user\'s forms. Publishing checks the form first. Only do this when the user asks.', parameters: { type: 'object', required: ['formId', 'open'], properties: { formId: { type: 'string' }, open: { type: 'boolean' } } } },
    async execute(input, ctx) {
      try {
        const id = String(input.formId);
        const { schema } = await ownForm(ctx.userId, id);
        const r = reviewForm(schema);
        const v = await setOpen(ctx.userId, id, !!input.open);
        const l = formLinks(id);
        return { text: input.open ? `Published "${schema.title}" (version ${v}). Share this link with respondents: ${l.fill}${r.findings.some((f) => f.level === 'critical') ? `\nStill open issues: ${r.findings.filter((f) => f.level === 'critical').map((f) => f.finding).join(' ')}` : ''}` : `Closed "${schema.title}": it no longer accepts responses. Existing responses are kept.` };
      } catch (e) { return fail(e); }
    },
  };

  const listTool: Tool = {
    definition: { name: 'list_forms', description: 'List the user\'s forms with their ids, number of questions, responses and whether they are open.', parameters: { type: 'object', properties: {} } },
    async execute(_input, ctx) {
      const forms = await listForms(ctx.userId);
      return { text: forms.length ? forms.map((f) => `- "${f.title}" (formId ${f.id}): ${f.questions} questions, ${f.responses} responses, ${f.open ? 'open' : 'closed/draft'}`).join('\n') : 'The user has no forms yet. Offer to create one.' };
    },
  };

  const analyzeTool: Tool = {
    definition: {
      name: 'analyze_form',
      description: 'Analyse the responses to one of the user\'s forms with real statistics: summary (frequencies, %, mean, median, SD…), crosstab (two categorical variables, chi-square, Cramér\'s V), compare (numeric outcome by group, ANOVA), correlate (two numeric variables, Pearson and Spearman). Use variable names from the codebook (call with a summary first if unsure). Report only the numbers returned.',
      parameters: { type: 'object', required: ['formId'], properties: { formId: { type: 'string' }, analyses: { type: 'array', items: ANALYSIS_ITEM, maxItems: 6 } } },
    },
    async execute(input, ctx) {
      try {
        const { title, ds } = await formDataset(ctx.userId, String(input.formId));
        if (!ds.rows.length) return { text: `"${title}" has no responses yet. Share the link: ${formLinks(String(input.formId)).fill}` };
        const reqs: AnalysisRequest[] = (Array.isArray(input.analyses) && input.analyses.length ? input.analyses : [{ type: 'summary' }]).slice(0, 6).map(toRequest);
        const parts: string[] = [];
        for (const q of reqs) { try { parts.push(analysisText(runAnalysis(ds, q))); } catch (e) { parts.push(`Could not run ${q.type}: ${(e as Error).message}`); } }
        const vars = `Variables: ${ds.fields.filter((f) => f.kind !== 'file').map((f) => `${f.variable} (${f.measurement})`).join(', ')}.`;
        return { text: `"${title}" – ${ds.rows.length} responses.\n${vars}\n\n${parts.join('\n\n')}\n\nExplain these results plainly; distinguish what the data shows from interpretation; never add numbers that are not here. Offer an HTML report and the Excel data (form_report).` };
      } catch (e) { return fail(e); }
    },
  };

  const reportTool: Tool = {
    definition: {
      name: 'form_report',
      description: 'Deliver the results of one of the user\'s forms as files: an interactive HTML report (charts and tables for every question, plus any requested analyses) and/or an Excel workbook (responses with variable names, codebook, summary).',
      parameters: { type: 'object', required: ['formId'], properties: { formId: { type: 'string' }, format: { type: 'string', enum: ['html', 'xlsx', 'both'] }, analyses: { type: 'array', items: ANALYSIS_ITEM, maxItems: 6 } } },
    },
    async execute(input, ctx) {
      const outputs = services.outputs ?? ctx.services.outputs;
      if (!outputs) return err('The report engine is not available here.');
      try {
        const id = String(input.formId);
        const { title, ds } = await formDataset(ctx.userId, id);
        if (!ds.rows.length) return { text: `"${title}" has no responses yet, so there is nothing to report. Share the link: ${formLinks(id).fill}` };
        const fmtWanted = input.format === 'html' || input.format === 'xlsx' ? input.format : 'both';
        const analyses = (Array.isArray(input.analyses) ? input.analyses : []).slice(0, 6).map(toRequest).flatMap((q: AnalysisRequest) => { try { return q.type === 'summary' ? [] : [runAnalysis(ds, q)]; } catch { return []; } });
        const refs = [];
        const notes: string[] = [];
        const make = async (spec: unknown) => {
          const { artifact } = await outputs.create(ctx.userId, spec);
          const a = await outputs.waitReady(ctx.userId, artifact.id, 120_000);
          if (a.status !== 'ready') { notes.push(`"${a.title}" ${a.status === 'failed' ? `failed: ${a.error}` : 'is still being generated'}.`); return; }
          const ref = await outputs.attachmentRef(a);
          if (ref) refs.push(ref);
        };
        if (fmtWanted !== 'xlsx') await make(reportSpec(title, ds, analyses, id));
        if (fmtWanted !== 'html') {
          const t = tabular(ds);
          const cb = codebook(ds.fields);
          const summaryRows = ds.fields.filter((f) => f.kind !== 'file').map((f) => { const c = coverage(ds, f); return { variable: f.variable, answered: c.answered, skipped: c.skipped, not_shown: c.notShown, response_rate: c.responseRate }; });
          await make({
            kind: 'document', format: 'xlsx', title: `${title} – responses`.slice(0, 200), sources: [{ type: 'user', id, label: `Responses to "${title}"` }],
            sheets: [
              { name: 'Responses', table: { columns: t.columns.slice(0, 50), rows: t.rows.slice(0, 2000) } },
              { name: 'Codebook', table: { columns: [{ key: 'variable', label: 'Variable' }, { key: 'question', label: 'Question' }, { key: 'type', label: 'Type' }, { key: 'measurement', label: 'Measurement' }, { key: 'required', label: 'Required' }, { key: 'values', label: 'Allowed values' }, { key: 'shownWhen', label: 'Shown when' }, { key: 'section', label: 'Section' }], rows: cb } },
              { name: 'Response rates', table: { columns: [{ key: 'variable', label: 'Variable' }, { key: 'answered', label: 'Answered' }, { key: 'skipped', label: 'Skipped' }, { key: 'not_shown', label: 'Not shown (branching)' }, { key: 'response_rate', label: 'Response rate', unit: '%' }], rows: summaryRows } },
            ],
          });
          if (t.columns.length > 50 || t.rows.length > 2000) notes.push('The workbook holds the first 50 columns and 2,000 responses; the full data is available as CSV from the form\'s results page.');
        }
        return refs.length
          ? { text: `Created ${refs.length === 2 ? 'the HTML report and the Excel workbook' : fmtWanted === 'xlsx' ? 'the Excel workbook (responses, codebook, response rates)' : 'the HTML report'} for "${title}" (${ds.rows.length} responses). They are attached; do not paste their contents.${notes.length ? `\nNotes: ${notes.join(' ')}` : ''}`, attachments: refs }
          : err(`The report could not be created. ${notes.join(' ')}`);
      } catch (e) { return fail(e); }
    },
  };

  return [createFormTool, editFormTool, reviewTool, publishTool, listTool, analyzeTool, reportTool];
}
