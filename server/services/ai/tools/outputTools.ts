import type { AnalysisReport } from '../../outputs/analysis.js';
import { analysisTables, tableMarkdown } from '../../outputs/tables.js';
import type { Tool, ToolServices } from '../types.js';
import { err, untrusted } from './helpers.js';

/**
 * Agent front end of the universal output engine. analyze_data computes statistics in the isolated
 * Python engine (never the model); create_output turns a validated spec into a stored, revisioned artifact.
 */

const WAIT_MS = 90_000;

function problemText(e: any): string {
  const details = Array.isArray(e?.details) ? ` ${e.details.slice(0, 8).join(' ')}` : '';
  return `${String(e?.message ?? 'failed').slice(0, 600)}${details}`;
}

export function outputTools(services: ToolServices): Tool[] {
  const outputs = services.outputs;
  if (!outputs) return [];

  const analyzeData: Tool = {
    definition: {
      name: 'analyze_data',
      description: [
        'Compute statistics on a tabular file (CSV, XLSX, JSON) with the deterministic analysis engine: describe, missing, distribution, groupby, pivot, correlation, regression, outliers, moving_average, with optional row filters.',
        'Use it for EVERY number you report about a dataset; never calculate or estimate figures yourself.',
        'source: { type: "file", id: <fileId from the conversation> } for chat attachments, or "dataset" / "repository_file" ids.',
        'Returns result tables and an analysisId you can pass to create_output (fromAnalysis, templates, reports).',
      ].join(' '),
      parameters: {
        type: 'object', required: ['source', 'operations'],
        properties: {
          title: { type: 'string', maxLength: 200 },
          source: { type: 'object', required: ['type', 'id'], properties: { type: { type: 'string', enum: ['file', 'dataset', 'repository_file', 'upload'] }, id: { type: 'string' } } },
          operations: {
            type: 'array', minItems: 1, maxItems: 20,
            description: 'Examples: {"op":"describe","columns":["age"]}; {"op":"groupby","by":["district"],"metrics":[{"column":"yield","agg":"mean"}]}; {"op":"pivot","index":"district","columns":"year","values":"yield","agg":"sum"}; {"op":"correlation","columns":["a","b"],"method":"spearman"}; {"op":"regression","y":"yield","x":["rainfall"]}; {"op":"outliers","column":"income","method":"iqr"}; {"op":"distribution","column":"age","bins":10}; {"op":"moving_average","value":"price","orderBy":"date","window":7}; {"op":"missing"}',
            items: { type: 'object', required: ['op'], properties: { op: { type: 'string', enum: ['describe', 'missing', 'distribution', 'groupby', 'pivot', 'correlation', 'regression', 'outliers', 'moving_average'] } } },
          },
          filters: { type: 'array', items: { type: 'object', required: ['column', 'op'], properties: { column: { type: 'string' }, op: { type: 'string', enum: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'notin', 'isnull', 'notnull'] }, value: {} } } },
          units: { type: 'object', description: 'Unit per column, e.g. {"income":"RWF","yield":"t/ha"}.', additionalProperties: { type: 'string' } },
        },
      },
    },
    async execute(input, ctx) {
      try {
        const spec = { kind: 'analysis', title: input.title || 'Data analysis', sources: [], dataset: input.source, analysis: { operations: input.operations, ...(input.filters ? { filters: input.filters } : {}), ...(input.units ? { units: input.units } : {}) } };
        const { artifact } = await outputs.create(ctx.userId, spec);
        const a = await outputs.waitReady(ctx.userId, artifact.id, WAIT_MS);
        if (a.status === 'failed') return err(`The analysis failed: ${a.error}`);
        if (a.status !== 'ready') return { text: `The analysis is still running (analysisId ${a.id}). Tell the user it is in progress; do not invent results.` };
        const rep: AnalysisReport = await outputs.readAnalysis(ctx.userId, a.id);
        const tables = analysisTables(rep).map((t) => `### ${t.caption}\n${tableMarkdown(t)}${t.note ? `\n_${t.note}_` : ''}`).join('\n\n');
        const header = `analysisId: ${a.id}\nSource: ${rep.source.label}; rows ${rep.rowsIn}${rep.rowsAnalysed !== rep.rowsIn ? ` (${rep.rowsAnalysed} after filters)` : ''}; engine ${rep.engine.name}.`;
        const notes = [...rep.limitations.slice(0, 8), ...rep.assumptions.slice(0, 4)].map((x) => `- ${x}`).join('\n');
        return {
          text: `${header}\nReport ONLY numbers that appear in these tables, with units and the sample size. Correlation and regression show association, not causation.\n\n${untrusted('ANALYSIS RESULTS', tables)}${notes ? `\n\nAssumptions and limitations to mention when relevant:\n${notes}` : ''}`,
        };
      } catch (e: any) {
        return err(`The analysis could not run: ${problemText(e)}`);
      }
    },
  };

  const createOutput: Tool = {
    definition: {
      name: 'create_output',
      description: [
        'Create a stored, shareable, revisioned artifact from a validated output spec. Use it only when the output materially helps; prefer plain prose and Markdown tables for simple answers.',
        'kinds: chart (Vega-Lite-like config; quantitative axes need a unit; sourceNote required), widget (table_explorer | chart_explorer | kpi_cards: interactive self-contained HTML), report (layout "report" or "dashboard": persistent HTML with sections, KPIs, charts, tables), document (format xlsx | pdf | docx | pptx with blocks / sheets / slides), template (statistical_report DOCX | briefing_deck PPTX | data_workbook XLSX filled from analysisArtifactId), diagram (mermaid flowchart text or graph nodes/edges), map (geojson polygons or points).',
        'Numbers in charts and tables must come from analyze_data results via fromAnalysis {artifactId, result} or from sources the user supplied; never type computed numbers.',
        'Every spec needs title and sources [{type, id?, label}] (values typed by the user: {"type":"user","label":"Values given by the user"}).',
        'Example chart: {"kind":"chart","title":"Values by category","sources":[{"type":"user","label":"User input"}],"chart":{"type":"bar","x":{"field":"Category","title":"Category","type":"nominal"},"y":{"field":"Value","title":"Value","unit":"none"},"data":[{"Category":"A","Value":10}],"sourceNote":"Values given by the user"}}.',
        'Example Excel file: {"kind":"document","format":"xlsx","title":"Values","sources":[{"type":"user","label":"User input"}],"sheets":[{"name":"Data","table":{"columns":[{"key":"Category","label":"Category"},{"key":"Value","label":"Value"}],"rows":[{"Category":"A","Value":10}]}}]}.',
        'HTML outputs (widget, report) take theme and subtitle: pick the theme that fits the topic: violet education/learning, forest agriculture/environment, crimson health, slate finance/business/government, amber energy/economy, teal science/water, sunset community/culture, ocean anything else. For an HTML page that demonstrates data or a topic, use kind report (layout "dashboard" for many figures) with a summary, 3-6 KPIs, and sections that each pair a chart or table with a short explanation of what it shows.',
        'Call the tool once per requested deliverable.',
      ].join(' '),
      parameters: {
        type: 'object', required: ['spec'],
        properties: { spec: { type: 'object', required: ['kind', 'title', 'sources'], properties: { kind: { type: 'string', enum: ['chart', 'widget', 'report', 'document', 'template', 'diagram', 'map'] }, title: { type: 'string' }, sources: { type: 'array' } } } },
      },
    },
    async execute(input, ctx) {
      try {
        if (input.spec?.kind === 'analysis') return err('Use analyze_data for calculations.');
        const { artifact, reused } = await outputs.create(ctx.userId, input.spec);
        const a = await outputs.waitReady(ctx.userId, artifact.id, WAIT_MS);
        if (a.status === 'failed') return err(`The output could not be generated: ${a.error}`);
        if (a.status !== 'ready') return { text: `"${a.title}" is still being generated (artifact ${a.id}). Tell the user it will appear in their outputs when ready.` };
        const ref = await outputs.attachmentRef(a);
        // Never report success unless the stored file was re-read and validated.
        if (!ref) return err(`"${a.title}" was generated but the stored file failed validation, so it cannot be delivered. Tell the user it failed; do not claim a download exists.`);
        const warnings = (a.warnings ?? []).length ? `\nWarnings to tell the user: ${(a.warnings as string[]).join(' ')}` : '';
        return { text: `${reused ? 'Reused the identical' : 'Created'} ${a.kind} "${a.title}" (${a.format}, ${ref.size} bytes, artifact ${a.id}, revision ${a.revision}). It is attached to your reply as a download; do not paste its contents or write a link.${warnings}`, attachments: [ref] };
      } catch (e: any) {
        return err(`The output spec was rejected: ${problemText(e)} Fix the spec and try again.`);
      }
    },
  };

  return [analyzeData, createOutput];
}
