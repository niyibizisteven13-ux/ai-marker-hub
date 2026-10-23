import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { ProviderAdapter } from '../server/services/ai/providers/types.js';

// Bwenge Forms: the canonical model, server-side validation with branching, form versions, the pre-publication
// review, the statistics engine on responses, and the chat tools (create, edit, review, publish, analyse, report)
// against a scripted model. Local test database; no network.

const { normalizeFields, codebook } = await import('../server/services/forms/model.js');
const { validateSubmission, checkDefinition } = await import('../server/services/forms/validation.js');
const { reviewForm } = await import('../server/services/forms/review.js');
const { buildDataset, runAnalysis, AnalysisError, tabular } = await import('../server/services/forms/analysis.js');
const { ensureVersion, listVersions } = await import('../server/services/forms/versions.js');
const { formTools, reportSpec } = await import('../server/services/ai/tools/formTools.js');
const { validateSpec } = await import('../server/services/outputs/spec.js');
const { planOutput } = await import('../server/services/outputs/planner.js');
const { prisma } = await import('../server/db.js');
const db = prisma as any;

const SURVEY = {
  title: 'Student expenditure survey',
  description: 'Participation is voluntary and answers are confidential.',
  fields: [
    { id: 'q1', type: 'number', label: 'What is your age?', required: true, min: 16, max: 100, sectionTitle: 'About you', analytics: { variableName: 'age', measurementLevel: 'ratio' } },
    { id: 'q2', type: 'radio', label: 'Which faculty are you in?', required: true, options: ['Economics', 'Engineering', 'Medicine'], allowOther: true },
    { id: 'q3', type: 'radio', label: 'Do you have a job?', required: true, options: ['Yes', 'No'] },
    { id: 'q4', type: 'number', label: 'Monthly income', required: true, min: 0, max: 5_000_000, unit: 'RWF', showIf: { fieldId: 'q3', equals: 'Yes' } },
    { id: 'q5', type: 'linear_scale', label: 'How satisfied are you with campus services?', scaleMin: 1, scaleMax: 5, scaleMinLabel: 'Very dissatisfied', scaleMaxLabel: 'Very satisfied' },
    { id: 'q6', type: 'checkbox', label: 'Which services do you use?', options: ['Library', 'Cafeteria', 'Clinic'] },
    { id: 'q7', type: 'MULTIPLE_CHOICE_GRID', label: 'Rate these', rows: ['Wifi', 'Rooms'], columns: ['Poor', 'Good'] },
  ],
};

test('model: one typed field list from any stored shape, with variables, sections and measurement levels', () => {
  const f = normalizeFields(JSON.stringify({ schema: JSON.stringify(SURVEY) }));
  assert.deepEqual(f.map((x) => x.kind), ['number', 'radio', 'radio', 'number', 'linear_scale', 'checkbox', 'radio_grid']);
  assert.equal(f[0].variable, 'age');
  assert.equal(f[1].variable, 'faculty');
  assert.equal(f[3].measurement, 'ratio');
  assert.equal(f[4].measurement, 'ordinal');
  assert.equal(f[0].section, 'About you');
  assert.equal(f[6].section, 'About you');
  const old = normalizeFields({ questions: [{ id: 'a', type: 'SHORT_TEXT', title: 'Name' }, { id: 'b', type: 'SHORT_TEXT', title: 'Name' }] });
  assert.notEqual(old[0].variable, old[1].variable, 'variable names are unique');
  const cb = codebook(f);
  assert.equal(cb.find((c) => c.variable === 'monthly_income')!.shownWhen, 'q3 = Yes');
  assert.match(cb.find((c) => c.variable === 'faculty')!.values, /Economics \| Engineering \| Medicine \| \(other: free text\)/);
});

test('validation: typed answers, "Other", ranges and branching are enforced on the server', () => {
  const ok = validateSubmission(SURVEY, { q1: '21', q2: '__other__', 'q2::other': 'Law', q3: 'No', q4: 999, q5: 4, q6: ['Library', 'Clinic'], q7: { Wifi: 'Poor' } });
  assert.ok(ok.ok);
  assert.deepEqual((ok as any).values, { q1: 21, q2: 'Law', q3: 'No', q5: 4, q6: ['Library', 'Clinic'], q7: { Wifi: 'Poor' } }, 'the hidden income answer is dropped, "Other" becomes its text');
  const err = (a: Record<string, unknown>) => (validateSubmission(SURVEY, a) as any).error as string;
  assert.match(err({ q1: 500, q2: 'Economics', q3: 'No' }), /100 or less/);
  assert.match(err({ q1: 20, q2: 'Economics', q3: 'Maybe' }), /Choose one of the options/);
  assert.match(err({ q1: 20, q2: 'Economics', q3: 'Yes' }), /Please answer "Monthly income"/, 'required when shown');
  assert.match(err({ q1: 20, q2: 'Economics', q3: 'No', q6: ['Gym'] }), /Choose from the options/);
  assert.match(err({ q1: 20, q2: 'Economics', q3: 'No', q5: 9 }), /from 1 to 5/);
  assert.match(err({ q1: 20, q2: 'Economics', q3: 'No', q7: { Lab: 'Good' } }), /Invalid row/);
});

test('definition check: broken branching, impossible ranges and duplicates block publishing', () => {
  assert.deepEqual(checkDefinition(SURVEY).errors, []);
  const bad = { fields: [
    { id: 'a', type: 'radio', label: 'Employed?', options: ['Yes', 'No'] },
    { id: 'b', type: 'number', label: 'Income', min: 10, max: 1 , showIf: { fieldId: 'a', equals: 'yes' } },
    { id: 'c', type: 'text', label: 'Later', showIf: { fieldId: 'd', equals: 'x' } },
    { id: 'd', type: 'select', label: 'One option', options: ['Only'] },
  ] };
  const e = checkDefinition(bad).errors.join('\n');
  assert.match(e, /minimum is above the maximum/);
  assert.match(e, /"yes", which is not an option/);
  assert.match(e, /depends on a later question/);
  assert.match(e, /needs at least two options/);
});

test('review: readiness score, consent for personal data, numbers typed as text, wording', () => {
  const good = reviewForm(SURVEY);
  assert.ok(good.score >= 80, `score ${good.score}`);
  assert.equal(good.ready, true);
  const r = reviewForm({ title: 'Untitled form', fields: [
    { id: 'n', type: 'text', label: 'Your full name', required: true },
    { id: 'p', type: 'text', label: 'Phone number' },
    { id: 'h', type: 'text', label: 'How many hours do you study each week?' },
    { id: 'l', type: 'radio', label: "Don't you agree the canteen is great?", options: ['Yes', 'No'] },
  ] });
  assert.equal(r.ready, false);
  assert.equal(r.findings[0].level, 'critical', 'critical issues first');
  assert.match(r.findings[0].finding, /personal information/);
  const t = r.findings.map((f) => f.finding).join('\n');
  assert.match(t, /Looks like a number/);
  assert.match(t, /phone number in a plain text/);
  assert.match(t, /Leading wording/);
  assert.match(t, /no title/);
  assert.ok(r.score < good.score);
});

const RESPONSES = [
  { q1: 20, q2: 'Economics', q3: 'Yes', q4: 50000, q5: 4, q6: ['Library'] },
  { q1: 22, q2: 'Economics', q3: 'No', q5: 3, q6: ['Library', 'Clinic'] },
  { q1: 24, q2: 'Engineering', q3: 'Yes', q4: 90000, q5: 2, q6: ['Cafeteria'] },
  { q1: 19, q2: 'Engineering', q3: 'Yes', q4: 80000, q5: 1, q6: [] },
  { q1: 25, q2: 'Medicine', q3: 'No', q5: 5, q6: ['Clinic'] },
  { q1: 23, q2: 'Medicine', q3: 'Yes', q4: 120000, q5: 4, q6: ['Library'] },
].map((data, i) => ({ id: `r${i}`, data: JSON.stringify(data), createdAt: new Date(2026, 9, 1 + i), formVersion: 1 }));

test('analysis: summaries are branching-aware; methods follow measurement levels; numbers are computed', () => {
  const ds = buildDataset(SURVEY, RESPONSES);
  const s = runAnalysis(ds, { type: 'summary', variables: ['monthly_income', 'job', 'services_use'] }) as any;
  const income = s.summaries[0];
  assert.equal(income.kind, 'numeric');
  assert.equal(income.n, 4);
  assert.equal(income.mean, 85000);
  assert.deepEqual(income.coverage, { answered: 4, notShown: 2, skipped: 0, responseRate: 100 }, 'people without a job were not shown the question');
  assert.deepEqual(s.summaries[1].table.map((t: any) => [t.value, t.count]), [['Yes', 4], ['No', 2]]);
  assert.equal(s.summaries[2].multiple, true);
  const ct = runAnalysis(ds, { type: 'crosstab', row: 'faculty', column: 'job' }) as any;
  assert.deepEqual(ct.counts, [[1, 1], [2, 0], [1, 1]]);
  assert.equal(ct.df, 2);
  assert.ok(ct.warnings.length, 'small expected counts are flagged');
  const cmp = runAnalysis(ds, { type: 'compare', outcome: 'monthly_income', group: 'faculty' }) as any;
  assert.deepEqual(cmp.groups.map((g: any) => [g.group, g.n, g.mean]), [['Economics', 1, 50000], ['Engineering', 2, 85000], ['Medicine', 1, 120000]]);
  const cor = runAnalysis(ds, { type: 'correlate', x: 'age', y: 'satisfied_with_campus_services' }) as any;
  assert.equal(cor.n, 6);
  assert.ok(cor.warnings.some((w: string) => /Spearman/.test(w)), 'ordinal scale noted');
  assert.throws(() => runAnalysis(ds, { type: 'correlate', x: 'faculty', y: 'age' }), AnalysisError);
  assert.throws(() => runAnalysis(ds, { type: 'summary', variables: ['nope'] }), /no variable "nope"/);
  const t = tabular(ds);
  assert.equal(t.rows[1].monthly_income, 'not shown');
  assert.equal(t.rows[1].services_use, 'Library; Clinic');
});

test('report spec: built only from computed results and valid for the output engine', () => {
  const ds = buildDataset(SURVEY, RESPONSES);
  const spec = reportSpec('Student expenditure survey', ds, [runAnalysis(ds, { type: 'compare', outcome: 'monthly_income', group: 'faculty' }), runAnalysis(ds, { type: 'crosstab', row: 'faculty', column: 'job' }), runAnalysis(ds, { type: 'correlate', x: 'age', y: 'monthly_income' })], randomUUID());
  const v = validateSpec(spec) as any;
  assert.equal(v.kind, 'report');
  assert.ok(v.sections.some((s: any) => s.heading === 'Method and limitations'));
  assert.ok(v.sections.some((s: any) => s.chart?.type === 'histogram'));
});

test('versions: a new version only when the questions change', async () => {
  const id = randomUUID();
  assert.equal(await ensureVersion(id, SURVEY), 1);
  assert.equal(await ensureVersion(id, { ...SURVEY, title: 'Renamed', themeColor: '#000000' }), 1, 'cosmetic changes keep the version');
  assert.equal(await ensureVersion(id, { ...SURVEY, fields: [...SURVEY.fields, { id: 'q8', type: 'text', label: 'Comments' }] }), 2);
  assert.deepEqual((await listVersions(id)).map((v) => [v.version, v.questions]), [[1, 7], [2, 8]]);
});

test('planner: form work goes to the form tools', () => {
  for (const m of ['Create a university economics survey about student expenditure', 'Analyse the responses to my survey', 'Publish my registration form', 'Give me the survey results in Excel']) {
    const p = planOutput({ message: m });
    assert.equal(p.output, 'form', m);
    assert.ok(p.tools.includes('create_form'));
  }
  assert.notEqual(planOutput({ message: 'What is a normal form in databases?' }).output, 'form');
});

// ── Chat tools with a scripted model ─────────────────────────────────────────
const queue: string[] = [];
const adapter: ProviderAdapter = { name: 'scripted', async *stream() { yield { type: 'text', text: queue.shift() ?? '{}' } as any; yield { type: 'usage', input: 300, output: 900 } as any; } };
const q = (id: string, type: string, label: string, extra: Record<string, unknown> = {}) => ({ id, type, label, description: null, required: true, options: [], allowOther: false, min: null, max: null, unit: null, scaleMin: null, scaleMax: null, scaleMinLabel: null, scaleMaxLabel: null, rows: [], columns: [], showIf: null, variable: label.toLowerCase().replace(/[^a-z]+/g, '_').slice(0, 20), measurement: 'nominal', ...extra });
const generated = (extra: unknown[] = []) => JSON.stringify({
  title: 'Course evaluation', description: 'Your answers are anonymous and voluntary.', confirmationMessage: 'Thank you!',
  sections: [{ title: 'Course', questions: [q('q1', 'radio', 'Which course did you take', { options: ['Micro', 'Macro'] }), q('q2', 'linear_scale', 'Overall satisfaction', { scaleMin: 1, scaleMax: 5, scaleMinLabel: 'Low', scaleMaxLabel: 'High', measurement: 'ordinal' }), ...extra]}],
  notes: ['Satisfaction is an ordinal scale.'],
});

test('chat tools: create, edit, review, publish, analyse and report a form', async () => {
  const user = `u-${randomUUID()}`;
  await db.user.create({ data: { id: user, email: `${user}@test.local`, name: 'Teacher', passwordHash: 'x', role: 'INSTRUCTOR' } });
  const created: any[] = [];
  const outputs = {
    create: async (_u: string, spec: unknown) => { const s = validateSpec(spec) as any; created.push(s); return { artifact: { id: randomUUID(), title: s.title }, reused: false }; },
    waitReady: async (_u: string, id: string) => ({ id, status: 'ready', title: created.at(-1).title }),
    readAnalysis: async () => null,
    attachmentRef: async (a: any) => ({ id: a.id, name: `${a.title}`, mime: created.at(-1).kind === 'report' ? 'text/html' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 10, kind: 'document', url: '/x', expiresAt: '' }),
  };
  const tools = Object.fromEntries(formTools({ formAi: () => ({ adapter, model: 'test-model' }), outputs } as any).map((t) => [t.definition.name, t]));
  const ctx = { userId: user, files: {} as any, services: {} as any };

  queue.push(generated());
  const c = await tools.create_form.execute({ description: 'A course evaluation for economics students' }, ctx);
  const formId = /formId ([0-9a-f-]{36})/.exec(c.text)?.[1] as string;
  assert.ok(formId, c.text);
  assert.match(c.text, /draft form "Course evaluation"/);
  assert.match(c.text, /NOT published/);
  assert.match(c.text, /\*\*Course\*\*\n1\. Which course did you take – radio \(Micro \/ Macro\), required/);
  assert.match(c.text, /Readiness \d+\/100/);
  assert.match(c.text, /\[Open and edit the form\]\([^)]*\/forms\/[^)]+\/edit\)/);
  const stored = JSON.parse((await db.applicationForm.findUnique({ where: { id: formId } })).schema);
  assert.equal(stored.acceptingResponses, false, 'a draft until published');
  assert.equal(stored.fields[1].analytics.measurementLevel, 'ordinal');

  queue.push(generated([q('q3', 'long_text', 'What should change', { required: false, measurement: 'text' })]));
  const e = await tools.edit_form.execute({ formId, change: 'add an open question about improvements' }, ctx);
  assert.match(e.text, /3\. What should change – long text/);
  assert.equal((await tools.edit_form.execute({ formId, change: 'x' }, { ...ctx, userId: 'someone-else' })).isError, true, 'only the owner');

  assert.match((await tools.review_form.execute({ formId }, ctx)).text, /Readiness/);
  const p = await tools.publish_form.execute({ formId, open: true }, ctx);
  assert.match(p.text, /Published "Course evaluation" \(version 1\)/);
  assert.match(p.text, /\/forms\/[0-9a-f-]{36}$/m);

  assert.match((await tools.analyze_form.execute({ formId }, ctx)).text, /no responses yet/);
  for (const [course, sat] of [['Micro', 4], ['Micro', 5], ['Macro', 2], ['Macro', 3], ['Micro', 4]] as const) {
    await db.formSubmission.create({ data: { id: randomUUID(), formId, data: JSON.stringify({ q1: course, q2: sat }), formVersion: 1, createdAt: new Date() } });
  }
  const a = await tools.analyze_form.execute({ formId, analyses: [{ type: 'summary' }, { type: 'compare', outcome: 'overall_satisfaction', group: 'which_course_did_you' }, { type: 'correlate', x: 'which_course_did_you', y: 'overall_satisfaction' }] }, ctx);
  assert.match(a.text, /5 responses/);
  assert.match(a.text, /Micro 3 \(60%\), Macro 2 \(40%\)/);
  assert.match(a.text, /\| Micro \| 3 \| 4\.33 \| 4 \|/);
  assert.match(a.text, /Could not run correlate: A correlation needs two numeric questions/);
  const rep = await tools.form_report.execute({ formId, format: 'both', analyses: [{ type: 'crosstab', row: 'which_course_did_you', column: 'overall_satisfaction' }] }, ctx);
  assert.equal(rep.attachments?.length, 2);
  assert.deepEqual(created.map((x) => x.kind), ['report', 'document']);
  assert.deepEqual(created[1].sheets.map((s: any) => s.name), ['Responses', 'Codebook', 'Response rates']);
  const close = await tools.publish_form.execute({ formId, open: false }, ctx);
  assert.match(close.text, /Closed/);
  assert.match((await tools.list_forms.execute({}, ctx)).text, /"Course evaluation" \(formId [^)]+\): 3 questions, 5 responses, closed/);
});
