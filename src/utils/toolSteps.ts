import type { Step } from '../components/ActivityLine';

/** Turns agent tool calls streamed over SSE into short, human activity steps for the chat. */

const FORMAT_LABEL: Record<string, string> = { xlsx: 'Excel workbook', docx: 'Word document', pptx: 'PowerPoint deck', pdf: 'PDF' };
const KIND_LABEL: Record<string, string> = {
  chart: 'chart', widget: 'interactive view', report: 'report', diagram: 'diagram', map: 'map', answer: 'answer', image: 'image',
};
const clip = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function describeToolCall(name: string, input: any): string {
  const title = typeof input?.spec?.title === 'string' ? `: ${clip(input.spec.title)}` : typeof input?.title === 'string' ? `: ${clip(input.title)}` : '';
  switch (name) {
    case 'create_output': {
      const spec = input?.spec ?? {};
      if (spec.kind === 'document') return `Building ${FORMAT_LABEL[spec.format] ?? 'document'}${title}`;
      if (spec.kind === 'template') return `Filling ${spec.template === 'briefing_deck' ? 'briefing deck' : spec.template === 'data_workbook' ? 'data workbook' : 'statistical report'}${title}`;
      if (spec.kind === 'report' && spec.layout === 'dashboard') return `Building dashboard${title}`;
      return `Creating ${KIND_LABEL[spec.kind] ?? 'output'}${title}`;
    }
    case 'analyze_data': return 'Computing statistics with the analysis engine';
    case 'create_spreadsheet': return `Building Excel workbook${title}`;
    case 'create_document': return `Writing document${title}`;
    case 'create_presentation': return `Building slides${title}`;
    case 'create_chart': return `Drawing chart${title}`;
    case 'create_diagram': return `Drawing diagram${title}`;
    case 'create_drawing': return `Drawing illustration${title}`;
    case 'create_text_file': return 'Writing text file';
    case 'create_archive': return 'Packing ZIP archive';
    case 'generate_image': return 'Generating image';
    case 'search_knowledge': return typeof input?.query === 'string' ? `Searching the knowledge base for “${clip(input.query, 40)}”` : 'Searching the knowledge base';
    case 'web_search': return typeof input?.query === 'string' ? `Searching the web for “${clip(input.query, 40)}”` : 'Searching the web';
    case 'fetch_url':
    case 'web_fetch': return typeof input?.url === 'string' ? `Reading ${clip(input.url.replace(/^https?:\/\/(www\.)?/, ''), 40)}` : 'Reading a web page';
    case 'read_attachment': return 'Reading your file';
    case 'run_python': return 'Running Python';
    case 'create_form': return 'Designing the form';
    case 'edit_form': return 'Updating the form';
    case 'review_form': return 'Reviewing the form';
    case 'publish_form': return input?.open === false ? 'Closing the form' : 'Publishing the form';
    case 'list_forms': return 'Looking up your forms';
    case 'analyze_form': return 'Analysing the responses';
    case 'form_report': return input?.format === 'xlsx' ? 'Building the Excel file' : input?.format === 'html' ? 'Building the report' : 'Building the report and Excel file';
    case 'create_3d_model': return `Building the 3D model${typeof input?.scene?.title === 'string' ? `: ${clip(input.scene.title)}` : ''}`;
    default: return name.replace(/_/g, ' ');
  }
}

/**
 * User-facing one-liner for a tool result. Tool results are written for the model ("do not paste its
 * contents…"), so known shapes are rewritten and anything else is cut to its first sentence.
 */
export function summarizeToolResult(text: string | undefined, isError: boolean): string | undefined {
  const t = (text ?? '').trim();
  const made = /^(?:Created|Reused the identical) [\w ]+? "([^"]+)" \((\w+), (\d+) bytes/.exec(t);
  if (made && !isError) {
    const bytes = Number(made[3]);
    const size = bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
    return `Ready: ${made[1]} (${made[2].toUpperCase()}, ${size})`;
  }
  const analysis = /^analysisId: [0-9a-f-]+\nSource: ([^;]+); rows (\d+)/.exec(t);
  if (analysis && !isError) return `Computed from ${analysis[1]} (${analysis[2]} rows)`;
  const line = t.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('<<<'));
  if (!line) return isError ? 'Failed' : undefined;
  const first = line.replace(/^ERROR:\s*/, '').split(/(?<=\.)\s/)[0];
  return clip(first.replace(/\s*\((?:[^)]*artifact [0-9a-f-]{36}[^)]*)\)/, ''), 140);
}

/** Applies one SSE event to the step list (returns a new array). */
export function applyToolEvent(steps: Step[], event: { type: string; id?: string; name?: string; input?: unknown; text?: string; isError?: boolean }): Step[] {
  if (event.type === 'tool_call' && event.name) {
    const id = event.id || `${event.name}-${steps.length}`;
    if (steps.some((s) => s.id === id)) return steps;
    return [...steps, { id, name: event.name, label: describeToolCall(event.name, event.input), status: 'running' }];
  }
  if (event.type === 'tool_result' && event.name) {
    const isError = Boolean(event.isError) || /^ERROR\b/.test(event.text ?? '');
    let idx = event.id ? steps.findIndex((s) => s.id === event.id) : -1;
    if (idx < 0) idx = steps.findIndex((s) => s.name === event.name && s.status === 'running');
    if (idx < 0) return steps;
    const next = [...steps];
    next[idx] = { ...next[idx], status: isError ? 'error' : 'done', summary: summarizeToolResult(event.text, isError) };
    return next;
  }
  return steps;
}

/** Server progress steps ({type:"status", id, label, state, detail}): reading files, marking stages, writing. */
export function applyStatusEvent(steps: Step[], event: { id?: string; label?: string; state?: string; detail?: string }): Step[] {
  if (!event.id || !event.label) return steps;
  const id = `status-${event.id}`;
  const status = event.state === 'done' ? 'done' : event.state === 'error' ? 'error' : 'running';
  const step: Step = { id, name: 'status', label: event.label, status, ...(event.detail ? { summary: event.detail } : {}) };
  const i = steps.findIndex((s) => s.id === id);
  if (i < 0) return [...steps, step];
  const next = [...steps];
  next[i] = { ...next[i], ...step };
  return next;
}
