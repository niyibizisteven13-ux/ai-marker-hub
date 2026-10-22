import type { AgentEvent, AttachmentRef } from '../ai/types.js';
import type { OutputPlan } from './planner.js';

/**
 * Chat-turn glue between the output planner and the agent loop:
 * - which /api/ai/chat path a message takes (the tool-enabled agent or the legacy text stream),
 * - prompt rules for tool turns,
 * - a delivery check: when the user asked for files, the turn is only successful if the files exist.
 *   Missing deliverables get one corrective agent turn; anything still missing is reported, never faked.
 */

/** Appended to the system prompt on tool turns; overrides older "emit artifact-json" persona rules. */
export const TOOL_TURN_RULES = `[Deliverables for this turn]
- Real files, charts and spreadsheets are created ONLY by calling tools (create_output, create_spreadsheet, create_chart, create_document, create_presentation). A file exists only when a tool result confirms it.
- Do NOT emit \`\`\`artifact-json blocks, CSV text, or JSON for the user to copy into a file, and never tell the user to save or rename text as .xlsx, .docx or .pptx.
- Do not write download links yourself; created files are attached automatically.
- If a tool returns an error, fix the input and call it again; if it still fails, tell the user exactly what failed and offer a working alternative (for example a table in the chat).`;

/** Decides whether a web-chat message must run through the tool-enabled agent. */
export function useToolAgent(o: {
  intent: string;
  service: string;
  isSmallTalk: boolean;
  /** Provider explicitly chosen in the UI, if any. */
  requestedProvider: string | null;
  hasClaudeKey: boolean;
  aiProvider: string | undefined;
  /** Some agent model is configured (Claude agent or a Gonka key). */
  agentAvailable: boolean;
  plan: Pick<OutputPlan, 'artifact' | 'needsComputation'>;
  /** Photos or PDFs attached: only the agent path can look at them. */
  hasVisualFiles?: boolean;
}): boolean {
  if (o.intent !== 'general_assist' || o.service !== 'general' || o.isSmallTalk) return false;
  // Original rule: Claude key present and no explicit or Gonka-default provider.
  if (!o.requestedProvider && o.hasClaudeKey && o.aiProvider !== 'gonkarouter') return true;
  // Files, charts and computed numbers need tools; the legacy text stream has none. Honour an explicit local
  // provider choice (e.g. Ollama), which cannot run the agent tools.
  const toolProvider = !o.requestedProvider || ['gonkarouter', 'anthropic', 'claude'].includes(o.requestedProvider);
  return toolProvider && o.agentAvailable && (o.plan.artifact || o.plan.needsComputation || Boolean(o.hasVisualFiles));
}

const FORMAT_MIME: Record<string, RegExp> = {
  svg: /^image\/(svg\+xml|png)/,
  html: /^text\/html/,
  png: /^image\//,
  xlsx: /spreadsheetml|ms-excel/,
  docx: /wordprocessingml|msword/,
  pptx: /presentationml|ms-powerpoint/,
  pdf: /^application\/pdf/,
};

/** Deliverables with no matching attachment (by file type). Each attachment satisfies one deliverable. */
export function missingDeliverables(plan: Pick<OutputPlan, 'deliverables'>, attachments: AttachmentRef[]): OutputPlan['deliverables'] {
  const left = [...attachments];
  const missing: OutputPlan['deliverables'] = [];
  for (const d of plan.deliverables) {
    const re = FORMAT_MIME[d.format];
    const i = re ? left.findIndex((a) => re.test(a.mime)) : -1;
    if (i >= 0) left.splice(i, 1);
    else if (re) missing.push(d);
  }
  return missing;
}

const describe = (d: OutputPlan['deliverables'][number]) => (d.output === 'document' || d.output === 'template' ? `${d.format.toUpperCase()} file` : `${d.output} (${d.format.toUpperCase()})`);

/** File links in the answer that do not point at a file created in this turn. */
export function fabricatedLinks(text: string, attachments: AttachmentRef[]): string[] {
  const real = new Set(attachments.flatMap((a) => [a.url, a.previewUrl].filter(Boolean) as string[]));
  const links = [...text.matchAll(/\]\(([^)\s]+)\)|(?:https?:\/\/|\/api\/files\/)[^\s)"'<>]+/g)].map((m) => m[1] ?? m[0]);
  return links.filter((l) => /\.(xlsx|xls|csv|docx|pptx|pdf|svg|png|html)(\?|$)|\/api\/(files|outputs)\//i.test(l) && !real.has(l));
}

export interface TurnResult { text: string; attachments?: AttachmentRef[] }

/**
 * Runs an agent turn and checks that every requested deliverable was really created. One corrective turn
 * (with the failed attempt's text cleared on the client via a reset) asks the model to call the tools; a
 * still-missing deliverable or an invented file link is reported in plain words.
 */
export async function runDeliverableTurn<R extends TurnResult>(o: {
  plan: Pick<OutputPlan, 'artifact' | 'deliverables'>;
  run: (correction?: { previousText: string; note: string }) => Promise<R>;
  onEvent?: (e: AgentEvent) => void;
}): Promise<R & { missing: OutputPlan['deliverables'] }> {
  let r = await o.run();
  let attachments = [...(r.attachments ?? [])];
  let missing = o.plan.artifact ? missingDeliverables(o.plan, attachments) : [];
  if (missing.length) {
    o.onEvent?.({ type: 'turn_reset', data: { reason: 'missing deliverables' } });
    const note = `[Delivery check] The user asked for: ${missing.map(describe).join(' and ')}. No such file was created in your previous reply. Call the tools now to create ${missing.length > 1 ? 'them' : 'it'}. Do not paste CSV or JSON for the user to save, and never tell them to rename a file. If a tool fails, tell the user the real error and offer a working alternative.`;
    const second = await o.run({ previousText: r.text, note });
    attachments = [...attachments, ...(second.attachments ?? [])];
    r = { ...second, attachments } as R;
    missing = missingDeliverables(o.plan, attachments);
  }
  const notes: string[] = [];
  if (missing.length) notes.push(`Not created: ${missing.map(describe).join(', ')}. No download is available for ${missing.length > 1 ? 'them' : 'it'}, so please ask again or use the table above.`);
  const fake = fabricatedLinks(r.text, attachments);
  if (fake.length) notes.push(`Note: ${fake.length > 1 ? 'these links were' : 'this link was'} not created by Bwenge and may not work: ${fake.slice(0, 3).join(', ')}. Use the attached files instead.`);
  if (notes.length) {
    const extra = `\n\n${notes.join('\n')}`;
    o.onEvent?.({ type: 'text', data: { text: extra } });
    r = { ...r, text: `${r.text}${extra}` };
  }
  return { ...r, attachments, missing };
}
