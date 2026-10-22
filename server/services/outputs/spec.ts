import { z } from 'zod';
import { analysisInputSchema } from './analysis.js';

/**
 * The internal output specification. Every artifact is described by one validated OutputSpec before
 * anything is rendered: explicit kind, title, sources, chart configuration, calculation references and
 * content. Numbers shown in charts and tables either come inline from the caller (labelled as such) or are
 * pulled from a stored, engine-computed analysis (`fromAnalysis`), never re-typed by the model.
 */

const text = (max: number) => z.string().max(max);
const title = z.string().trim().min(1).max(200);
const cell = z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]);

export const sourceRefSchema = z.object({
  type: z.enum(['dataset', 'repository_file', 'upload', 'file', 'knowledge', 'artifact', 'inline', 'user']),
  id: z.string().max(100).optional(),
  label: z.string().trim().min(1).max(300),
  url: z.string().max(500).optional(),
}).strict();
export type SourceRef = z.infer<typeof sourceRefSchema>;

/** Pull rows from a stored analysis result instead of typing numbers. */
export const fromAnalysisSchema = z.object({ artifactId: z.string().uuid(), result: z.number().int().min(0).max(19) }).strict();

const axis = z.object({
  field: z.string().min(1).max(200),
  title: z.string().trim().min(1).max(120),
  /** Unit of measure ("RWF", "%", "students"); use "none" for unitless values. */
  unit: z.string().trim().min(1).max(40).optional(),
  type: z.enum(['quantitative', 'nominal', 'ordinal', 'temporal']).optional(),
}).strict();

export const chartConfigSchema = z.object({
  type: z.enum(['bar', 'grouped-bar', 'stacked-bar', 'line', 'area', 'scatter', 'histogram', 'boxplot', 'heatmap', 'pie']),
  subtitle: text(200).optional(),
  x: axis,
  y: axis.optional(),
  color: axis.optional(),
  data: z.array(z.record(cell)).max(5000).optional(),
  fromAnalysis: fromAnalysisSchema.optional(),
  /** Where the data comes from, shown under the chart. */
  sourceNote: z.string().trim().min(3).max(300),
}).strict();
export type ChartConfig = z.infer<typeof chartConfigSchema>;

export const tableSchema = z.object({
  caption: text(300).optional(),
  columns: z.array(z.object({ key: z.string().min(1).max(200), label: z.string().min(1).max(200), unit: z.string().max(40).optional() }).strict()).min(1).max(50),
  rows: z.array(z.record(cell)).max(2000).optional(),
  fromAnalysis: fromAnalysisSchema.optional(),
}).strict();
export type TableSpec = z.infer<typeof tableSchema>;

const kpi = z.object({ label: z.string().min(1).max(120), value: z.union([z.number(), z.string().max(60)]), unit: z.string().max(40).optional(), note: text(200).optional() }).strict();

const section = z.object({
  heading: z.string().trim().min(1).max(200),
  text: text(20_000).optional(),
  table: tableSchema.optional(),
  chart: chartConfigSchema.optional(),
}).strict();

const docBlock = z.union([
  z.object({ type: z.literal('heading'), level: z.union([z.literal(1), z.literal(2), z.literal(3)]), text: text(500) }).strict(),
  z.object({ type: z.literal('paragraph'), text: text(20_000) }).strict(),
  z.object({ type: z.literal('list'), ordered: z.boolean().optional(), items: z.array(text(2000)).max(200) }).strict(),
  z.object({ type: z.literal('table'), table: tableSchema }).strict(),
  z.object({ type: z.literal('chart'), chart: chartConfigSchema }).strict(),
  z.object({ type: z.literal('pageBreak') }).strict(),
]);

const common = { title, sources: z.array(sourceRefSchema).max(30).default([]) };
/** Look of HTML outputs, chosen to fit the topic (see THEMES in html.ts). */
const look = {
  theme: z.enum(['ocean', 'forest', 'violet', 'crimson', 'slate', 'amber', 'teal', 'sunset']).optional(),
  subtitle: z.string().trim().max(300).optional(),
};

export const outputSpecSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('answer'), ...common, text: text(20_000), table: tableSchema.optional() }).strict(),
  z.object({ kind: z.literal('chart'), ...common, chart: chartConfigSchema }).strict(),
  z.object({
    kind: z.literal('widget'), ...common, ...look,
    widget: z.discriminatedUnion('type', [
      z.object({ type: z.literal('table_explorer'), table: tableSchema }).strict(),
      z.object({ type: z.literal('chart_explorer'), chart: chartConfigSchema }).strict(),
      z.object({ type: z.literal('kpi_cards'), kpis: z.array(kpi).min(1).max(12) }).strict(),
    ]),
  }).strict(),
  z.object({
    kind: z.literal('report'), ...common, ...look, layout: z.enum(['report', 'dashboard']).default('report'), summary: text(5000).optional(),
    kpis: z.array(kpi).max(12).optional(), sections: z.array(section).min(1).max(40), analysisArtifactIds: z.array(z.string().uuid()).max(5).optional(),
  }).strict(),
  z.object({
    kind: z.literal('document'), ...common, format: z.enum(['xlsx', 'pdf', 'docx', 'pptx']),
    blocks: z.array(docBlock).max(2000).optional(),
    sheets: z.array(z.object({ name: z.string().min(1).max(31), table: tableSchema }).strict()).max(20).optional(),
    slides: z.array(z.object({ title: z.string().max(200), bullets: z.array(text(300)).max(8).optional(), table: tableSchema.optional(), chart: chartConfigSchema.optional(), notes: text(3000).optional() }).strict()).max(60).optional(),
  }).strict(),
  z.object({
    kind: z.literal('template'), ...common, template: z.enum(['statistical_report', 'briefing_deck', 'data_workbook']),
    analysisArtifactId: z.string().uuid(),
    /** Narrative written for the reader; numbers in it are checked against the analysis. */
    summary: text(5000).optional(), interpretation: text(10_000).optional(), author: text(120).optional(), audience: text(200).optional(),
  }).strict(),
  z.object({
    kind: z.literal('diagram'), ...common,
    mermaid: text(20_000).optional(),
    graph: z.object({ direction: z.enum(['TB', 'LR']).optional(), nodes: z.array(z.object({ id: z.string().max(60), label: z.string().max(200), shape: z.enum(['box', 'rounded', 'diamond', 'ellipse']).optional() }).strict()).max(80), edges: z.array(z.object({ from: z.string().max(60), to: z.string().max(60), label: z.string().max(100).optional(), dashed: z.boolean().optional() }).strict()).max(200) }).strict().optional(),
  }).strict(),
  z.object({
    kind: z.literal('map'), ...common, sourceNote: z.string().trim().min(3).max(300),
    geojson: z.object({ type: z.literal('FeatureCollection'), features: z.array(z.any()).max(2000) }).passthrough().optional(),
    points: z.array(z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180), label: z.string().max(120).optional(), value: z.number().optional() }).strict()).max(5000).optional(),
    valueField: z.string().max(100).optional(), labelField: z.string().max(100).optional(), unit: z.string().max(40).optional(),
  }).strict(),
  z.object({ kind: z.literal('image'), ...common, prompt: text(2000) }).strict(),
  z.object({
    kind: z.literal('analysis'), ...common,
    dataset: z.object({ type: z.enum(['dataset', 'repository_file', 'upload', 'file']), id: z.string().min(1).max(100) }).strict(),
    analysis: analysisInputSchema,
  }).strict(),
]);

export type OutputSpec = z.infer<typeof outputSpecSchema>;
export type OutputKind = NonNullable<OutputSpec['kind']>;
/** One spec variant (written with an optional kind because the project compiles without strictNullChecks). */
export type SpecOf<K extends OutputKind> = Extract<OutputSpec, { kind?: K }>;

export class SpecError extends Error {
  constructor(message: string, public problems: string[]) {
    super(message);
  }
}

/** Structural (zod) and semantic checks that do not need storage. */
export function validateSpec(input: unknown): OutputSpec {
  const r = outputSpecSchema.safeParse(input);
  if (!r.success) throw new SpecError('The output specification is invalid.', r.error.issues.slice(0, 20).map((i) => `${i.path.join('.') || 'spec'}: ${i.message}`));
  const s = r.data;
  const problems: string[] = [];
  const checkChart = (c: ChartConfig, where: string) => {
    if (!c.data && !c.fromAnalysis) problems.push(`${where}: give data or fromAnalysis.`);
    if (c.data && c.fromAnalysis) problems.push(`${where}: use either data or fromAnalysis, not both.`);
    const needsY = !['histogram', 'pie'].includes(c.type);
    if (needsY && !c.y) problems.push(`${where}: a ${c.type} chart needs a y axis.`);
    if (c.type === 'pie' && !c.color) problems.push(`${where}: a pie chart needs a color field for its categories.`);
    for (const ax of [c.x, c.y].filter(Boolean) as Array<z.infer<typeof axis>>) {
      if ((ax.type ?? 'quantitative') === 'quantitative' && !ax.unit) problems.push(`${where}: axis "${ax.title}" is quantitative; give its unit (or "none").`);
    }
    if (c.data) {
      const keys = new Set(c.data.flatMap((d) => Object.keys(d)));
      for (const f of [c.x.field, c.y?.field, c.color?.field].filter(Boolean) as string[]) if (c.data.length && !keys.has(f)) problems.push(`${where}: field "${f}" is not in the data.`);
    }
  };
  const checkTable = (t: TableSpec, where: string) => {
    if (!t.rows && !t.fromAnalysis) problems.push(`${where}: give rows or fromAnalysis.`);
  };
  switch (s.kind) {
    case 'answer': if (s.table) checkTable(s.table, 'table'); break;
    case 'chart': checkChart(s.chart, 'chart'); break;
    case 'widget': if (s.widget.type === 'chart_explorer') checkChart(s.widget.chart, 'widget.chart'); if (s.widget.type === 'table_explorer') checkTable(s.widget.table, 'widget.table'); break;
    case 'report': s.sections.forEach((sec, i) => { if (sec.chart) checkChart(sec.chart, `sections[${i}].chart`); if (sec.table) checkTable(sec.table, `sections[${i}].table`); if (!sec.text && !sec.chart && !sec.table) problems.push(`sections[${i}]: empty section.`); }); break;
    case 'document':
      if (s.format === 'xlsx' && !s.sheets?.length) problems.push('An xlsx document needs sheets.');
      if (s.format === 'pptx' && !s.slides?.length) problems.push('A pptx document needs slides.');
      if ((s.format === 'docx' || s.format === 'pdf') && !s.blocks?.length) problems.push(`A ${s.format} document needs blocks.`);
      s.blocks?.forEach((b, i) => { if (b.type === 'chart') checkChart(b.chart, `blocks[${i}].chart`); if (b.type === 'table') checkTable(b.table, `blocks[${i}].table`); });
      s.sheets?.forEach((sh, i) => checkTable(sh.table, `sheets[${i}].table`));
      s.slides?.forEach((sl, i) => { if (sl.chart) checkChart(sl.chart, `slides[${i}].chart`); if (sl.table) checkTable(sl.table, `slides[${i}].table`); });
      break;
    case 'diagram': if (!s.mermaid === !s.graph) problems.push('Give exactly one of mermaid or graph.'); break;
    case 'map': if (!s.geojson === !s.points) problems.push('Give exactly one of geojson or points.'); break;
    default: break;
  }
  if (problems.length) throw new SpecError('The output specification is invalid.', problems);
  return s;
}
