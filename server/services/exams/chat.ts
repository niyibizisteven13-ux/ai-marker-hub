import { createHash } from 'node:crypto';
import type { FileStore } from '../ai/files/FileStore.js';
import { FileJobQueue, JobError } from '../ai/jobs/fileJobQueue.js';
import { generateStructured } from '../ai/llm/structuredJson.js';
import type { ProviderAdapter } from '../ai/providers/types.js';
import type { AttachmentRef } from '../ai/types.js';
import { OwnedRecordStore, type OwnedRecord } from '../storage/ownedRecordStore.js';
import { questionKey, schemeSummary } from './scheme.js';
import { ExamInputError, parseManifest, type ExamService, type UploadFile } from './service.js';
import { isImage, isPdf, isTyped, isZip } from './inputs.js';
import type { CandidateState, ExamRecord } from './types.js';

/**
 * Examination marking through the existing chat. Recognises marking requests, assigns roles to the
 * attached files, keeps the active examination per user so follow-ups need no re-upload, and answers
 * status, lookup, edit, correction and export requests from persisted state. Progress messages are
 * derived from stored job and candidate states, never assumed.
 */

export interface ExamChatContext extends OwnedRecord {
  examId: string | null;
  lastCandidateId: string | null;
  pending: { files: Array<{ fileId: string; name: string; mime: string }>; question: 'which_scheme'; autoMark: boolean } | null;
}

export interface ChatReply { text: string; attachments: AttachmentRef[] }

export interface ExamChatDeps {
  service: ExamService;
  fileStore: FileStore;
  queue: FileJobQueue;
  contexts: OwnedRecordStore<ExamChatContext>;
  /** Optional model for understanding requests the patterns below do not cover. */
  agent?: () => { adapter: ProviderAdapter; model: string; fallbackModel?: string | null } | null;
  /** How long a chat turn waits for a quick job (export, re-mark) before replying. */
  waitMs?: number;
}

const START_VERB = /\b(mark|grade|correct|assess|score|kosora|corrige[rz]?|noter)\b/i;
/** A batch: plural scripts/papers/candidates. A single "grade this essay" stays with the normal chat. */
const START_BATCH = /\b(papers|scripts|exams|examinations|candidates|students|answer\s*sheets|copies|ibizamini|impapuro)\b/i;
const START_SCHEME = /\b(mark(?:ing)?\s+scheme|marking\s+guide|bar[eè]me|official\s+rubric)\b/i;
/** A marking request: a marking verb with at least one script (one paper or a whole class, any format), or a scheme. */
const isStart = (msg: string, visualFiles: number) => START_VERB.test(msg) && (START_SCHEME.test(msg) || START_BATCH.test(msg) || visualFiles >= 1);
const SCHEME_NAME = /(mark(?:ing)?[\s_-]*(scheme|guide|key)|rubric|memo(?:randum)?|answer[\s_-]*key|solutions?|bar[eè]me|corrig[eé]|marking)/i;
const PAPER_NAME = /(question[\s_-]*paper|questions|exam[\s_-]*paper|examen|[eé]preuve|test[\s_-]*paper)/i;
const MANIFEST_NAME = /(manifest|candidates?|mapping|class[\s_-]*list|roster|students?)/i;
/** Words that tie a follow-up message to the active examination (general words like "download" alone do not). */
const EXAM_WORDS = /\b(candidates?|scripts?|papers?|marks?|marking|scheme|rubric|question\s*\d+|results|workbook|excel|spreadsheet|class|exam|examination|package|re-?mark|pass\s*mark)\b/i;
const SHORT_STATUS = /^\s*(status|progress|how\s+far|is\s+it\s+(?:ready|done)|done\s+yet|ready\s+yet|any\s+update)\??\s*[.!?]?\s*$/i;
const RECENT_MS = 7 * 24 * 60 * 60 * 1000;

const STATE_TEXT: Record<CandidateState, string> = {
  queued: 'waiting to start', validating: 'checking the files', recognizing: 'recognising handwritten answers', matching_questions: 'matching answers to questions',
  marking: 'marking question by question', verifying: 'checking uncertain readings and verifying the calculations', generating_artifacts: 'generating the marked papers, report and workbook',
  completed: 'done', completed_with_warnings: 'done with items to check', failed: 'could not be processed',
};

const ctxId = (userId: string) => { const h = createHash('sha256').update(`exam-chat:${userId}`).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`; };

/** Anything that can be a candidate script: PDFs, photos, typed answers, or a ZIP folder of them. */
const isVisual = (f: UploadFile) => isPdf(f) || isImage(f) || isZip(f);
const isScriptLike = (f: UploadFile) => isVisual(f) || isTyped(f);
const isText = (f: UploadFile) => /\.(csv|tsv|json|txt|md|docx|odt|rtf)$/i.test(f.name);
/** "I don't have a scheme, mark it yourself" and similar. */
const DRAFT_REQUEST = /\b(draft|write|create|make|generate|prepare)\b[^.]*\b(scheme|rubric|marking\s+guide|answers?)\b|\b(mark|grade)\s+(it|them)\s+(your\s*self|yourself|alone)\b|\b(don'?t|do\s+not|no)\s+(have\s+)?(an?\s+)?(official\s+)?(scheme|rubric|marking\s+(scheme|guide)|answer\s+key)\b|\buse\s+your\s+own\b|\bnta\s+(rubric|bar[eè]me)\b|\bpas\s+de\s+bar[eè]me\b/i;
const app = () => (process.env.APP_BASE_URL || '').replace(/\/$/, '');
const link = (label: string, path: string) => `[${label}](${app()}${path})`;

type Command =
  | { action: 'status' } | { action: 'confirm_scheme' } | { action: 'scheme_marks'; question: string; marks: number }
  | { action: 'show_candidate'; candidate: string | null } | { action: 'explain'; candidate: string | null; question: string | null }
  | { action: 'override'; candidate: string | null; question: string; marks: number; reason: string }
  | { action: 'correct_reading'; candidate: string | null; question: string | null; page: number | null; from: string; to: string; remark: boolean }
  | { action: 'remark'; candidate: string | null; question: string | null }
  | { action: 'failed_question'; question: string; mode: 'zero' | 'not_full' } | { action: 'failed' }
  | { action: 'top'; n: number; order: 'top' | 'bottom' } | { action: 'stats' } | { action: 'flags' }
  | { action: 'export'; what: 'all' | 'workbook' | 'report' } | { action: 'confirm_candidate'; candidate: string | null; question: string | null }
  | { action: 'pass_mark'; percent: number } | { action: 'start' };

const Q = String.raw`(?:question|qn|q)\.?\s*([0-9]{1,3}(?:\s*\(?[a-h]\)?(?![a-z]))?(?:\s*\(?(?:iv|v?i{1,3}|v)\)?(?![a-z]))?)`;

/** Pattern-based command parsing. Exported for tests. */
export function parseCommand(msg: string): Command | null {
  const m = msg.trim();
  let r: RegExpExecArray | null;
  if ((r = new RegExp(String.raw`\b(?:change|set|give|make|update|award)\b[^.]*?${Q}[^.]*?\b(?:to|=|as)\s*(\d+(?:\.\d+)?)(?:\s*(?:marks?|points?))?(?:[^.]*?\bbecause\b\s*(.+))?`, 'i').exec(m))) {
    return { action: 'override', candidate: null, question: r[1], marks: Number(r[2]), reason: (r[3] ?? '').trim().replace(/[.]$/, '') };
  }
  if ((r = /\bfrom\s+["“']?(.+?)["”']?\s+to\s+["“']?(.+?)["”']?(?:[.!]|$)/i.exec(m)) && /\b(read|reading|transcri|correct|written|wrote|says?)\w*/i.test(m)) {
    const page = /\bpage\s+(\d{1,3})\b/i.exec(m);
    const q = new RegExp(Q, 'i').exec(m);
    return { action: 'correct_reading', candidate: null, question: q?.[1] ?? null, page: page ? Number(page[1]) : null, from: r[1].trim(), to: r[2].trim(), remark: true };
  }
  if ((r = new RegExp(String.raw`answer\s+to\s+${Q}\s+is\s+["“']?(.+?)["”']?,?\s+not\s+["“']?(.+?)["”']?(?:[.!]|$)`, 'i').exec(m))) {
    return { action: 'correct_reading', candidate: null, question: r[1], page: null, from: r[3].trim(), to: r[2].trim(), remark: true };
  }
  if ((r = new RegExp(String.raw`${Q}\s+(?:is\s+worth|is\s+out\s+of|carries|has)\s+(\d+(?:\.\d+)?)\s*marks?`, 'i').exec(m)) && /\b(scheme|rubric|worth|out of|carries)\b/i.test(m)) {
    return { action: 'scheme_marks', question: r[1], marks: Number(r[2]) };
  }
  if (/\bpass\s*(?:mark|percent(?:age)?|threshold)\b/i.test(m) && (r = /(\d{1,3}(?:\.\d+)?)\s*%?/.exec(m.replace(/^[^\d]*pass/i, '')))) return { action: 'pass_mark', percent: Number(r[1]) };
  if (/\bconfirm\b/i.test(m) && /\b(scheme|rubric|marking guide)\b/i.test(m)) return { action: 'confirm_scheme' };
  if (/\b(scheme|rubric)\b.*\b(is|looks)\s+(correct|right|fine|ok|good)\b/i.test(m) || /^\s*(yes|yes,? confirm|confirmed?|correct|that'?s right)\s*[.!]?\s*$/i.test(m)) return { action: 'confirm_scheme' };
  if (/\bconfirm\b/i.test(m)) { const q = new RegExp(Q, 'i').exec(m); return { action: 'confirm_candidate', candidate: null, question: q?.[1] ?? null }; }
  if (/\bwhy\b/i.test(m) && /\b(lose|lost|get|got|only|deduct|marks?)\b/i.test(m)) { const q = new RegExp(Q, 'i').exec(m); return { action: 'explain', candidate: null, question: q?.[1] ?? null }; }
  if (/\bre-?\s?(?:evaluate|mark|grade|assess)\b/i.test(m)) { const q = new RegExp(Q, 'i').exec(m); return { action: 'remark', candidate: null, question: q?.[1] ?? null }; }
  if ((r = new RegExp(String.raw`\b(failed|got\s+(?:it\s+)?wrong|wrong|zero|incorrect|did\s*n[o']?t\s+get|lost\s+marks\s+on|scored\s+0)\b[^.]*?${Q}`, 'i').exec(m)) || (r = new RegExp(String.raw`${Q}[^.]*?\b(failed|wrong|zero|incorrect)\b`, 'i').exec(m))) {
    const q = /question|qn|q/i.test(r[1]) ? r[2] : (r[1].match(/^\d/) ? r[1] : r[2]);
    return { action: 'failed_question', question: q, mode: /lost\s+marks|did\s*n[o']?t\s+get/i.test(m) ? 'not_full' : 'zero' };
  }
  if ((r = /\b(top|best|highest|bottom|lowest|worst)\s+(\d{1,3})\b/i.exec(m))) return { action: 'top', n: Number(r[2]), order: /top|best|highest/i.test(r[1]) ? 'top' : 'bottom' };
  if (/\b(failed|below\s+(?:the\s+)?pass)\b/i.test(m)) return { action: 'failed' };
  if (/\b(statistics|stats|compare|comparison|performance|average|mean|median|recalculate)\b/i.test(m)) return { action: 'stats' };
  if (/\b(flag|flagged|flags|attention|issues?|uncertain|needs?\s+review)\b/i.test(m)) return { action: 'flags' };
  if (/\b(regenerate|re-?generate|download|export|package|zip|workbook|excel|spreadsheet|xlsx)\b/i.test(m) || (/\breport\b/i.test(m) && /\b(send|give|get|show|update)\b/i.test(m))) {
    return { action: 'export', what: /\b(workbook|excel|spreadsheet|xlsx)\b/i.test(m) && !/\b(all|everything|package|zip|complete)\b/i.test(m) ? 'workbook' : 'all' };
  }
  if (/\b(show|open|send|give|get|see|view)\b/i.test(m) && /\b(paper|script|pdf|corrected|marked|result|results|scores?)\b/i.test(m)) return { action: 'show_candidate', candidate: null };
  if (/\b(status|progress|how\s+far|done\s+yet|ready\s+yet|is\s+it\s+(?:ready|done)|finished)\b/i.test(m)) return { action: 'status' };
  return null;
}

const COMMAND_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['action', 'candidate', 'question', 'marks', 'reason', 'from', 'to', 'page', 'n'],
  properties: {
    action: { type: 'string', enum: ['status', 'confirm_scheme', 'show_candidate', 'explain', 'override', 'correct_reading', 'remark', 'failed_question', 'failed', 'top', 'stats', 'flags', 'export', 'confirm_candidate', 'none'] },
    candidate: { type: ['string', 'null'] }, question: { type: ['string', 'null'] }, marks: { type: ['number', 'null'] }, reason: { type: ['string', 'null'] },
    from: { type: ['string', 'null'] }, to: { type: ['string', 'null'] }, page: { type: ['number', 'null'] }, n: { type: ['number', 'null'] },
  },
};

const fmt = (n: number | null) => (n === null ? '–' : String(Number(n.toFixed(2))));

export function createExamChat(deps: ExamChatDeps) {
  const s = deps.service;
  const waitMs = deps.waitMs ?? 45_000;

  async function getCtx(userId: string): Promise<ExamChatContext> {
    const c = await deps.contexts.get(ctxId(userId), userId);
    return c ?? { id: ctxId(userId), ownerId: userId, createdAt: '', updatedAt: '', expiresAt: '', examId: null, lastCandidateId: null, pending: null };
  }
  async function saveCtx(userId: string, c: Partial<Pick<ExamChatContext, 'examId' | 'lastCandidateId' | 'pending'>>) {
    const cur = await getCtx(userId);
    await deps.contexts.put(ctxId(userId), userId, { examId: c.examId !== undefined ? c.examId : cur.examId, lastCandidateId: c.lastCandidateId !== undefined ? c.lastCandidateId : cur.lastCandidateId, pending: c.pending !== undefined ? c.pending : cur.pending } as Omit<ExamChatContext, keyof OwnedRecord>);
  }

  async function ref(id: string | undefined): Promise<AttachmentRef | null> {
    if (!id) return null;
    try { return deps.fileStore.toRef(await deps.fileStore.meta(id)); } catch { return null; }
  }

  async function waitJob(userId: string, jobId: string, onStatus?: (t: string) => void): Promise<'completed' | 'failed' | 'pending'> {
    const until = Date.now() + waitMs;
    let last = '';
    while (Date.now() < until) {
      const j = await deps.queue.get(jobId, userId);
      if (!j) return 'failed';
      if (j.status === 'completed') return 'completed';
      if (j.status === 'failed' || j.status === 'cancelled') return 'failed';
      if (onStatus && j.progress.stage !== last && !/^(queued|started)$/.test(j.progress.stage)) { last = j.progress.stage; onStatus(`${last[0].toUpperCase()}${last.slice(1)}…`); }
      await new Promise((r) => setTimeout(r, 400));
    }
    return 'pending';
  }

  /** Waits for the latest marking run to finish, reporting "Marked 3 of 20 scripts". */
  async function waitRun(userId: string, examId: string, onStatus?: (t: string) => void): Promise<'done' | 'pending'> {
    const until = Date.now() + waitMs;
    let last = '';
    while (Date.now() < until) {
      const e = await s.load(userId, examId);
      const run = e.runs[e.runs.length - 1];
      if (!run || ['completed', 'completed_with_warnings', 'failed'].includes(run.state)) return 'done';
      const p = s.progress(e);
      const done = (p.counts.completed ?? 0) + (p.counts.completed_with_warnings ?? 0) + (p.counts.failed ?? 0);
      const total = p.candidates.length;
      const line = run.state === 'generating_artifacts' ? 'Drawing the red-pen corrections on the scripts' : `Marked ${done} of ${total} script${total === 1 ? '' : 's'}`;
      if (onStatus && line !== last) { last = line; onStatus(`${line}…`); }
      await new Promise((r) => setTimeout(r, 700));
    }
    return 'pending';
  }

  /** Starts marking whatever is queued (if anything) and replies with the marked PDFs once the run is finished. */
  async function markAndFinish(userId: string, examId: string, lines: string[], onStatus?: (t: string) => void): Promise<ChatReply> {
    let e = await s.load(userId, examId);
    if (e.submissions.some((x) => x.state === 'queued')) {
      try { await s.startMarking(userId, examId); } catch (err) { if (!(err instanceof ExamInputError && ['NOTHING_TO_MARK', 'RUN_IN_PROGRESS'].includes(err.code))) throw err; }
    }
    e = await s.load(userId, examId);
    if (!e.runs.length) return { text: [...lines, statusText(e)].filter(Boolean).join('\n\n'), attachments: [] };
    const st = await waitRun(userId, examId, onStatus);
    e = await s.load(userId, examId);
    if (st === 'pending') return { text: [...lines, statusText(e), 'Marking is still running in the background; the marked PDFs will be ready shortly. Ask "status" to get them.'].filter(Boolean).join('\n\n'), attachments: [] };
    const fin = await finishedReply(e);
    return { text: [...lines, fin.text].filter(Boolean).join('\n\n'), attachments: fin.attachments };
  }

  /** Resolves a candidate reference: explicit id, a supplied name, an ordinal ("the second paper"), or the last one discussed. */
  function resolveCandidate(e: ExamRecord, msg: string, explicit: string | null, last: string | null): { id: string } | { ask: string } {
    const words = msg.toLowerCase();
    const hits = e.submissions.filter((x) => new RegExp(`(^|[^a-z0-9])${x.candidateId.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`).test(words) || (explicit && x.candidateId.toLowerCase() === explicit.toLowerCase()));
    const named = hits.length ? hits : e.submissions.filter((x) => x.candidateName && x.candidateName.length >= 3 && words.includes(x.candidateName.toLowerCase()));
    if (named.length === 1) return { id: named[0].candidateId };
    if (named.length > 1) return { ask: `Which candidate do you mean: ${named.map((x) => x.candidateId).join(', ')}?` };
    const ord = /\b(first|second|third|fourth|fifth|last)\b\s+(?:paper|script|candidate|one)/i.exec(msg);
    if (ord) {
      const i = { first: 0, second: 1, third: 2, fourth: 3, fifth: 4, last: e.submissions.length - 1 }[ord[1].toLowerCase() as 'first'];
      if (e.submissions[i]) return { id: e.submissions[i].candidateId };
    }
    if (last && e.submissions.some((x) => x.candidateId === last) && /\b(it|this|that|the (?:corrected|marked|same) one|their|his|her|same)\b/i.test(msg)) return { id: last };
    if (e.submissions.length === 1) return { id: e.submissions[0].candidateId };
    return { ask: `Which candidate? This examination has ${e.submissions.length}: ${e.submissions.slice(0, 12).map((x) => x.candidateId).join(', ')}${e.submissions.length > 12 ? ', …' : ''}.` };
  }

  function statusText(e: ExamRecord): string {
    const p = s.progress(e);
    const sv = s.latestScheme(e);
    const lines: string[] = [];
    if (!sv) lines.push('The marking scheme has not been received yet.');
    else if (sv.status === 'invalid') lines.push(`The marking scheme (version ${sv.version}) has problems that block marking:\n${sv.errors.slice(0, 8).map((x) => `- ${x}`).join('\n')}\nSend a corrected scheme or tell me the fix (for example "question 3 is worth 6 marks").`);
    else if (sv.status === 'needs_confirmation' && sv.scheme) lines.push(`The marking scheme is structured but needs your confirmation before marking:\n${schemeSummary(sv.scheme)}${sv.warnings.length ? `\nPlease check:\n${sv.warnings.slice(0, 8).map((x) => `- ${x}`).join('\n')}` : ''}\nReply "confirm the marking scheme", or correct it (for example "question 3 is worth 6 marks").`);
    if (p.run) {
      const c = p.counts;
      const done = (c.completed ?? 0) + (c.completed_with_warnings ?? 0);
      const total = p.candidates.length;
      const active = (Object.keys(STATE_TEXT) as CandidateState[]).filter((k) => !['completed', 'completed_with_warnings', 'failed', 'queued'].includes(k) && c[k]);
      if (p.run.state === 'generating_artifacts') lines.push(`All ${total} scripts are marked. Generating the annotated papers, the report and the workbook.`);
      else if (!['completed', 'completed_with_warnings', 'failed'].includes(p.run.state)) {
        lines.push(`Marking ${total} script${total === 1 ? '' : 's'}: ${done} done${c.failed ? `, ${c.failed} could not be processed` : ''}${c.queued ? `, ${c.queued} waiting` : ''}.`);
        if (active.length) lines.push(`Now ${active.map((k) => `${STATE_TEXT[k]} (${c[k]})`).join('; ')}.`);
      } else lines.push(`Marking run finished: ${done} of ${total} scripts marked${c.failed ? `, ${c.failed} could not be processed` : ''}.`);
    } else if (e.submissions.length) lines.push(`${e.submissions.length} candidate script(s) received; marking has not started.`);
    return lines.join('\n\n');
  }

  async function finishedReply(e: ExamRecord): Promise<ChatReply> {
    const { list, stats } = s.summaries(e);
    const set = e.artifacts.find((a) => a.status === 'ready');
    const flagged = list.reduce((a, x) => a + x.openFlags, 0);
    const failed = e.submissions.filter((x) => x.state === 'failed');
    const max = list[0]?.maxTotal;
    // The scripts themselves, corrected in red pen: one PDF per student (up to 10), otherwise the ZIP of all of them.
    const pdfIds = set ? e.submissions.map((x) => set.candidatePdfs[x.id]).filter(Boolean) : [];
    const pdfs = (await Promise.all((pdfIds.length && pdfIds.length <= 10 ? pdfIds : [set?.bundleFileId]).map(ref))).filter((x): x is AttachmentRef => !!x);
    const workbook = await ref(set?.workbookFileId);
    const rows = list.slice(0, 12).map((c) => `| ${c.candidateId}${c.candidateName ? ` (${c.candidateName})` : ''} | ${fmt(c.total)} / ${fmt(c.maxTotal)} | ${c.percent}% |${c.openFlags ? ' check' : ''}`);
    const text = [
      `**Marking finished.** ${list.length} script${list.length === 1 ? '' : 's'} marked${stats?.mean !== null && stats?.mean !== undefined && max ? `, class average ${fmt(stats.mean)} / ${max}` : ''}${stats?.passRate !== null && stats?.passRate !== undefined ? `, ${stats.passRate}% passed (pass mark ${e.passPercent}%)` : ''}.`,
      rows.length ? `| Student | Marks | % |\n|---|---|---|\n${rows.join('\n')}${list.length > 12 ? `\n\n… and ${list.length - 12} more in the results.` : ''}` : '',
      pdfs.length ? `The ${pdfIds.length && pdfIds.length <= 10 ? `marked paper${pdfIds.length === 1 ? ' is' : 's are'}` : 'marked papers are'} attached: each script with the red-pen ticks, crosses, marks per question, corrections and the circled total.` : '',
      flagged ? `${flagged} item${flagged === 1 ? '' : 's'} with unclear handwriting or uncertain marks ${flagged === 1 ? 'is' : 'are'} marked "check".` : '',
      failed.length ? `Could not process: ${failed.map((x) => `${x.candidateId} (${x.error?.message ?? 'error'})`).join('; ')}.` : '',
      `**Do you want the results in Excel?** ${workbook ? `[Download the Excel workbook](${workbook.url})` : 'Say "excel" and I will make it'} · ${link('Open the results', `/exams/${e.id}/review`)} to see every page, move a mark or change it before you share the PDFs.`,
      'You can also ask: "Why did C001 lose marks on question 2?" or "Change C001 question 2 to 4 because the method is right".',
    ].filter(Boolean).join('\n\n');
    return { text, attachments: pdfs };
  }

  async function exportReply(userId: string, examId: string, what: 'all' | 'workbook' | 'report', onStatus?: (t: string) => void): Promise<ChatReply> {
    const { job } = await s.requestExport(userId, examId);
    if (job) {
      onStatus?.('Generating the annotated papers, report and workbook from the saved results…');
      const st = await waitJob(userId, job.id, onStatus);
      if (st === 'pending') return { text: 'The package is still being generated. Ask "status" in a moment and I will send it.', attachments: [] };
      if (st === 'failed') { const j = await deps.queue.get(job.id, userId); return { text: `The package could not be generated: ${j?.error?.message ?? 'unknown error'}.`, attachments: [] }; }
    }
    const e = await s.load(userId, examId);
    const set = e.artifacts.find((a) => a.status === 'ready')!;
    const ids = what === 'workbook' ? [set.workbookFileId] : what === 'report' ? [set.htmlFileId, set.bundleFileId] : [set.bundleFileId, set.workbookFileId];
    const attachments = (await Promise.all(ids.map(ref))).filter((x): x is AttachmentRef => !!x);
    return { text: `Here is the ${what === 'workbook' ? 'results workbook' : 'complete marking package'} (result revision ${set.resultRevision}${set.resultRevision === e.resultRevision ? ', up to date' : ''}). Marks are provisional unless confirmed.\n\nCheck the red marks on each page, move any that landed in the wrong place, and release the PDFs: ${link('Open the review screen', `/exams/${e.id}/review`)}${set.problems.length ? `\n\nNotes: ${set.problems.slice(0, 5).join(' ')}` : ''}`, attachments };
  }

  /** Uses the latest scheme without a "confirm" round-trip when it has no errors; warnings are reported, not blocking. */
  async function autoConfirm(userId: string, examId: string): Promise<{ ok: true; summary: string; warnings: string } | { ok: false; text: string }> {
    const e = await s.load(userId, examId);
    const sv = s.latestScheme(e);
    if (!sv?.scheme || sv.status === 'invalid') return { ok: false, text: `The marking scheme could not be used:\n${(sv?.errors ?? ['it could not be read']).slice(0, 6).map((x) => `- ${x}`).join('\n')}\nSend a clearer scheme, or tell me the fix (for example "question 3 is worth 6 marks").` };
    if (sv.status !== 'confirmed') await s.confirmScheme(userId, examId, sv.version);
    const qs = sv.scheme.questions;
    return { ok: true, summary: `${qs.length} question${qs.length === 1 ? '' : 's'}, ${sv.scheme.totalMarks} marks`, warnings: sv.warnings.slice(0, 4).join(' ') };
  }

  /** Drafts a marking scheme (no official one) and shows it for confirmation; nothing is marked until confirmed. */
  async function draftReply(userId: string, examId: string, questionPaper: UploadFile | undefined, onStatus?: (t: string) => void): Promise<string> {
    const job = await s.draftScheme(userId, examId, { questionPaper });
    onStatus?.('Reading the questions and drafting a marking scheme…');
    const st = await waitJob(userId, job.id, onStatus);
    if (st === 'failed') { const j = await deps.queue.get(job.id, userId); return `I could not draft a marking scheme: ${j?.error?.message ?? 'unknown error'}.`; }
    if (st === 'pending') return 'Still drafting the marking scheme. Ask "status" in a moment to see it.';
    const e = await s.load(userId, examId);
    const sv = s.latestScheme(e);
    if (!sv?.scheme) return `The draft has problems:\n${(sv?.errors ?? []).slice(0, 8).map((x) => `- ${x}`).join('\n')}`;
    return `Here is a **draft** marking scheme I wrote (version ${sv.version}). It is not used until you confirm it:\n${schemeSummary(sv.scheme)}${sv.warnings.length ? `\n\nPlease check:\n${sv.warnings.slice(0, 8).map((x) => `- ${x}`).join('\n')}` : ''}${sv.errors.length ? `\n\nProblems to fix first:\n${sv.errors.slice(0, 8).map((x) => `- ${x}`).join('\n')}` : ''}\n\nReply **"confirm the marking scheme"** to start marking, or correct it (for example "question 3 is worth 6 marks").`;
  }

  async function startFromFiles(userId: string, message: string, files: UploadFile[], existingExamId: string | null, onStatus?: (t: string) => void): Promise<ChatReply> {
    const manifests = files.filter((f) => isText(f) && MANIFEST_NAME.test(f.name) && /\.(csv|tsv|json|txt)$/i.test(f.name));
    const rest = files.filter((f) => !manifests.includes(f));
    const forced = rest.filter((f) => f.name.startsWith('marking-scheme__'));
    // A text document is the scheme when its name says so, or when it is the only unnamed one next to scanned scripts;
    // otherwise typed documents are candidates' answers.
    const unnamedText = rest.filter((f) => isText(f) && !MANIFEST_NAME.test(f.name) && !SCHEME_NAME.test(f.name) && !PAPER_NAME.test(f.name));
    const textIsScheme = unnamedText.length === 1 && rest.some((f) => isVisual(f) && !PAPER_NAME.test(f.name));
    const draftWanted = DRAFT_REQUEST.test(message);
    const schemes = forced.length ? forced : rest.filter((f) => SCHEME_NAME.test(f.name) || (!draftWanted && textIsScheme && unnamedText.includes(f)));
    const papers = rest.filter((f) => !schemes.includes(f) && PAPER_NAME.test(f.name));
    const scripts = rest.filter((f) => !schemes.includes(f) && !papers.includes(f) && isScriptLike(f) && !(isText(f) && SCHEME_NAME.test(f.name)));
    const mapping = manifests.flatMap((f) => { try { return parseManifest(f.buffer.toString('utf8')); } catch { return []; } });
    // Explicit mappings in the message: "C014: alice.pdf" or "alice.pdf is C014".
    for (const m of message.matchAll(/\b([A-Za-z]{0,3}\d{1,6})\s*[:=]\s*([\w .()-]+\.(?:pdf|png|jpe?g|webp|tiff?|heic|docx|odt|rtf|txt))/gi)) mapping.push({ candidateId: m[1], fileName: m[2].trim() });
    for (const m of message.matchAll(/([\w .()-]+\.(?:pdf|png|jpe?g|webp|tiff?|heic|docx|odt|rtf|txt))\s+(?:is|belongs to|=)\s+(?:candidate\s+)?([A-Za-z]{0,3}\d{1,6})\b/gi)) mapping.push({ candidateId: m[2], fileName: m[1].trim() });

    let exam = existingExamId ? await s.load(userId, existingExamId).catch(() => null) : null;
    const hasScheme = !!(exam && s.confirmedScheme(exam));
    const inlineScheme = message.length > 300 && /\b\d+\s*marks?\b/i.test(message) ? message : null;
    // Never guess which file is the official scheme: ask, and keep the files so they need not be re-sent.
    const stage = async () => {
      const staged = [];
      for (const f of files) staged.push({ fileId: (await deps.fileStore.put({ userId, name: f.name.replace(/[^\w.\- ]/g, '_').slice(0, 120), mime: f.mime || 'application/octet-stream', kind: 'document', data: f.buffer, ttlMs: 24 * 60 * 60 * 1000 })).id, name: f.name.replace(/^marking-scheme__/, ''), mime: f.mime || 'application/octet-stream' });
      await saveCtx(userId, { pending: { files: staged, question: 'which_scheme', autoMark: true } });
    };
    const listing = files.map((f, i) => `${i + 1}) ${f.name}`).join(', ');
    if (schemes.length > 1 && !forced.length && schemes.filter((f) => SCHEME_NAME.test(f.name)).length !== 1) {
      await stage();
      return { text: `Several files could be the marking scheme. I received: ${listing}. Which one is the official marking scheme (for example "file 2")?`, attachments: [] };
    }
    // No marking scheme: Bwenge drafts one from the questions and marks with it straight away (the teacher can still
    // send their own scheme and re-mark). Without any scripts there is nothing to draft from, so ask for them.
    const autoDraft = !schemes.length && !inlineScheme && !hasScheme && (draftWanted || scripts.length > 0 || papers.length > 0);
    if (!schemes.length && !inlineScheme && !hasScheme && !autoDraft) {
      await stage();
      return { text: `I received: ${listing}. Attach the students' scripts (PDFs, photos, Word documents or a ZIP folder) and I will mark them${papers.length ? '' : ', with or without a marking scheme'}. You can also ${link('scan them with your phone', '/scan')}.`, attachments: [] };
    }
    if (!exam || (schemes.length && exam.runs.length)) {
      const title = /\b(?:exam|examination|test)\s+(?:called|named|titled)\s+["“]?([^"”\n]{3,80})/i.exec(message)?.[1];
      exam = await s.createExam(userId, { title });
    }
    await saveCtx(userId, { examId: exam.id, pending: null });
    const lines: string[] = [];
    if (scripts.length) {
      const { accepted, rejected } = await s.addSubmissions(userId, exam.id, scripts, mapping);
      // A file name without a candidate id gets a new id; its name is kept as a label so the mapping is visible.
      if (accepted.some((a) => a.identity === 'assigned')) {
        await s.mutate(userId, exam.id, (e) => { for (const a of accepted) { const x = e.submissions.find((y) => y.id === a.id); if (x && x.identity === 'assigned' && !x.candidateName) x.candidateName = x.fileName.replace(/\.[a-z0-9]+$/i, '').slice(0, 60); } });
      }
      onStatus?.(`Received ${accepted.length} script${accepted.length === 1 ? '' : 's'}…`);
      if (rejected.length) lines.push(`Not accepted: ${rejected.map((r) => `${r.fileName}: ${r.reason}`).join(' ')}`);
    }
    if (autoDraft) {
      const job = await s.draftScheme(userId, exam.id, { questionPaper: papers[0] });
      onStatus?.('Reading the questions and writing a marking scheme…');
      const st = await waitJob(userId, job.id, onStatus);
      if (st === 'failed') { const j = await deps.queue.get(job.id, userId); lines.push(`I could not work out a marking scheme from these papers: ${j?.error?.message ?? 'unknown error'}. Attach the marking scheme or the question paper and I will mark straight away.`); return { text: lines.join('\n\n'), attachments: [] }; }
      if (st === 'pending') { lines.push('Still working out the marking scheme. Ask "status" in a moment.'); return { text: lines.join('\n\n'), attachments: [] }; }
      const auto = await autoConfirm(userId, exam.id);
      if ('text' in auto) { lines.push(auto.text); return { text: lines.join('\n\n'), attachments: [] }; }
      lines.push(`No marking scheme was attached, so I wrote one from the questions (${auto.summary}). To use your own, send it and say "mark again with this scheme".`);
      return markAndFinish(userId, exam.id, lines, onStatus);
    }
    if (schemes.length || inlineScheme) {
      const schemeFiles = schemes.length ? schemes : [{ name: 'marking-scheme.txt', buffer: Buffer.from(inlineScheme!, 'utf8'), mime: 'text/plain' }];
      const job = await s.submitSchemeDocuments(userId, exam.id, { scheme: schemeFiles, questionPaper: papers[0], autoMark: true });
      onStatus?.('Reading the marking scheme…');
      const st = await waitJob(userId, job.id, onStatus);
      exam = await s.load(userId, exam.id);
      if (st === 'failed') { const j = await deps.queue.get(job.id, userId); lines.push(`The marking scheme could not be read: ${j?.error?.message ?? 'unknown error'}.`); return { text: lines.join('\n\n'), attachments: [] }; }
      if (st === 'pending') { lines.push('Still reading the marking scheme. Marking starts automatically once it is structured and unambiguous; ask "status" for progress.'); return { text: lines.join('\n\n'), attachments: [] }; }
      const auto = await autoConfirm(userId, exam.id);
      if ('text' in auto) { lines.push(auto.text); return { text: lines.join('\n\n'), attachments: [] }; }
      if (auto.warnings) lines.push(`Marking scheme read (${auto.summary}). Please check: ${auto.warnings}`);
      exam = await s.load(userId, exam.id);
      if (exam.submissions.length) return markAndFinish(userId, exam.id, lines, onStatus);
    } else if (hasScheme && exam.submissions.some((x) => x.state === 'queued')) {
      return markAndFinish(userId, exam.id, lines, onStatus);
    }
    const status = statusText(exam);
    if (status) lines.push(status);
    if (!exam.submissions.length) lines.push(`Got the marking scheme. Now attach the students' scripts (PDFs, photos, Word documents or a ZIP folder) and I will mark them straight away. You can also ${link('scan them with your phone', '/scan')}.`);
    return { text: lines.join('\n\n'), attachments: [] };
  }

  async function llmCommand(message: string, e: ExamRecord): Promise<Command | null> {
    const a = deps.agent?.();
    if (!a) return null;
    try {
      const { data } = await generateStructured<{ action: string; candidate: string | null; question: string | null; marks: number | null; reason: string | null; from: string | null; to: string | null; page: number | null; n: number | null }>(a.adapter, {
        model: a.model, schema: COMMAND_SCHEMA, maxTokens: 400, fallbackModel: a.fallbackModel,
        system: 'You map a teacher\'s chat message about an examination that is being marked to one action. Use "none" if the message is not about this examination. Copy candidate ids and question numbers exactly as written. Never invent marks.',
        prompt: `Candidates: ${e.submissions.slice(0, 50).map((x) => x.candidateId).join(', ')}\nMessage: ${message.slice(0, 2000)}`,
      });
      switch (data.action) {
        case 'none': return null;
        case 'override': return data.question && data.marks !== null ? { action: 'override', candidate: data.candidate, question: data.question, marks: data.marks, reason: data.reason ?? '' } : null;
        case 'correct_reading': return data.from && data.to ? { action: 'correct_reading', candidate: data.candidate, question: data.question, page: data.page, from: data.from, to: data.to, remark: true } : null;
        case 'failed_question': return data.question ? { action: 'failed_question', question: data.question, mode: 'zero' } : null;
        case 'top': return { action: 'top', n: data.n ?? 10, order: 'top' };
        case 'explain': return { action: 'explain', candidate: data.candidate, question: data.question };
        case 'remark': return { action: 'remark', candidate: data.candidate, question: data.question };
        case 'confirm_candidate': return { action: 'confirm_candidate', candidate: data.candidate, question: data.question };
        case 'show_candidate': return { action: 'show_candidate', candidate: data.candidate };
        case 'export': return { action: 'export', what: 'all' };
        default: return { action: data.action as 'status' };
      }
    } catch {
      return null;
    }
  }

  /**
   * Handles a chat message if it belongs to the examination workflow; returns null otherwise so the
   * normal chat continues. `onStatus` receives short progress lines while the turn is open.
   */
  async function handle(userId: string, message: string, files: UploadFile[], opts: { onStatus?: (t: string) => void } = {}): Promise<ChatReply | null> {
    const ctx = await getCtx(userId);
    const visual = files.filter(isScriptLike);
    try {
      // 1. Answer to "which file is the marking scheme?"
      if (ctx.pending?.question === 'which_scheme' && Date.now() - Date.parse(ctx.updatedAt) < 24 * 60 * 60 * 1000) {
        const staged = ctx.pending.files;
        const n = /\b(?:file|number|no\.?|#)\s*(\d{1,2})\b|^\s*(\d{1,2})\s*[.)]?\s*$/i.exec(message);
        const pick = n ? staged[Number(n[1] ?? n[2]) - 1] : staged.find((f) => message.toLowerCase().includes(f.name.toLowerCase()));
        if (pick || DRAFT_REQUEST.test(message) || (files.length && (isStart(message, files.filter(isVisual).length + staged.length) || /\b(scheme|rubric|marking|bar[eè]me)\b/i.test(message)))) {
          const restored: UploadFile[] = [];
          for (const f of staged) { try { const { data } = await deps.fileStore.read(f.fileId, userId); restored.push({ name: f === pick ? `marking-scheme__${f.name}` : f.name, buffer: data, mime: f.mime }); } catch { /* expired */ } }
          await saveCtx(userId, { pending: null });
          return await startFromFiles(userId, message, [...restored, ...files], ctx.examId, opts.onStatus);
        }
      }
      // 2. A new marking request with files.
      if (files.length && (isStart(message, visual.length) || (ctx.examId && visual.length && /\b(scheme|rubric|scripts|candidates|more\s+papers)\b/i.test(message)))) {
        return await startFromFiles(userId, message, files, ctx.examId, opts.onStatus);
      }
      if (!ctx.examId) return null;
      const exam = await s.load(userId, ctx.examId).catch(() => null);
      if (!exam) { await saveCtx(userId, { examId: null, pending: null }); return null; }
      // Only messages about the active examination are handled here.
      const mentionsCandidate = exam.submissions.some((x) => new RegExp(`\\b${x.candidateId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(message));
      const recent = Date.now() - Date.parse(exam.updatedAt) < RECENT_MS;
      const looksExam = mentionsCandidate || (recent && (EXAM_WORDS.test(message) || SHORT_STATUS.test(message) || DRAFT_REQUEST.test(message)));
      if (!looksExam) return null;
      if (DRAFT_REQUEST.test(message) && !s.confirmedScheme(exam)) return { text: await draftReply(userId, exam.id, undefined, opts.onStatus), attachments: [] };
      const cmd = parseCommand(message) ?? (await llmCommand(message, exam));
      if (!cmd) return null;
      return await run(userId, exam, cmd, message, ctx, opts.onStatus);
    } catch (err) {
      if (err instanceof ExamInputError || err instanceof JobError) return { text: err.message, attachments: [] };
      throw err;
    }
  }

  async function run(userId: string, exam: ExamRecord, cmd: Command, message: string, ctx: ExamChatContext, onStatus?: (t: string) => void): Promise<ChatReply> {
    const { list, scheme, stats } = s.summaries(exam);
    const needCandidate = async (explicit: string | null) => {
      const r = resolveCandidate(exam, message, explicit, ctx.lastCandidateId);
      if ('id' in r) await saveCtx(userId, { lastCandidateId: r.id });
      return r;
    };
    const runState = exam.runs[exam.runs.length - 1]?.state;
    switch (cmd.action) {
      case 'status': {
        if (runState && ['completed', 'completed_with_warnings'].includes(runState) && exam.artifacts.some((a) => a.status === 'ready')) return finishedReply(exam);
        if (runState && !['completed', 'completed_with_warnings', 'failed'].includes(runState)) return markAndFinish(userId, exam.id, [], onStatus);
        return { text: statusText(exam) || 'Nothing is being marked right now.', attachments: [] };
      }
      case 'confirm_scheme': {
        const sv = await s.confirmScheme(userId, exam.id);
        const e = await s.load(userId, exam.id);
        let started = '';
        if (e.submissions.some((x) => x.state === 'queued')) return markAndFinish(userId, exam.id, [`Marking scheme version ${sv.version} confirmed.`], onStatus);
        return { text: `Marking scheme version ${sv.version} confirmed.${started}`, attachments: [] };
      }
      case 'scheme_marks': {
        const sv = await s.editSchemeQuestion(userId, exam.id, cmd.question, { maxMarks: cmd.marks });
        return { text: sv.status === 'invalid' ? `Recorded as scheme version ${sv.version}, but it still has problems:\n${sv.errors.map((x) => `- ${x}`).join('\n')}` : `Scheme version ${sv.version} created with question ${cmd.question} worth ${cmd.marks} marks:\n${schemeSummary(sv.scheme!)}\nReply "confirm the marking scheme" to use it.`, attachments: [] };
      }
      case 'pass_mark': {
        if (!(cmd.percent >= 0 && cmd.percent <= 100)) return { text: 'The pass mark must be between 0 and 100%.', attachments: [] };
        await s.mutate(userId, exam.id, (e) => { e.passPercent = cmd.percent; e.resultRevision++; });
        return { text: `Pass mark set to ${cmd.percent}%. Say "regenerate" for an updated report and workbook.`, attachments: [] };
      }
      case 'show_candidate': case 'explain': case 'confirm_candidate': case 'override': case 'correct_reading': case 'remark': {
        const r = await needCandidate('candidate' in cmd ? cmd.candidate : null);
        if ('ask' in r) return { text: r.ask, attachments: [] };
        const cid = r.id;
        if (cmd.action === 'override') {
          const reason = cmd.reason || 'Examiner decision via chat';
          const out = await s.overrideMark(userId, exam.id, { submission: cid, question: cmd.question }, { marks: cmd.marks, reason });
          const view = await s.candidateView(userId, exam.id, cid);
          const reply = await exportReply(userId, exam.id, 'all', onStatus);
          return { text: `${cid}, question ${out.question}: ${fmt(out.before)} → ${out.after} (examiner override, reason: ${reason}). New total ${view.summary?.total} / ${view.summary?.maxTotal} (${view.summary?.percent}%).${out.rubricConflict ? `\nNote: ${out.rubricConflict}` : ''}\n\n${reply.text}`, attachments: reply.attachments };
        }
        if (cmd.action === 'correct_reading') {
          const out = await s.correctTranscription(userId, exam.id, { submission: cid }, { page: cmd.page ?? undefined, from: cmd.from, to: cmd.to, remark: cmd.remark });
          const qs = out.affectedQuestionIds.map((id) => scheme?.questions.find((q) => q.id === id)?.number ?? id);
          if (!out.jobId) return { text: `Corrected ${cid}'s reading on page ${out.page} (${out.elementId}) from "${out.before.slice(0, 120)}" to "${out.after.slice(0, 120)}". The original reading is kept in the history. No marked question uses that text, so no marks changed.`, attachments: [] };
          onStatus?.(`Re-marking question ${qs.join(', ')} for ${cid} with the corrected reading…`);
          const st = await waitJob(userId, out.jobId, onStatus);
          if (st !== 'completed') return { text: st === 'pending' ? `Correction saved; re-marking question ${qs.join(', ')} is still running. Ask "status" shortly.` : 'Correction saved, but re-marking failed. Try "re-mark question …" again.', attachments: [] };
          const view = await s.candidateView(userId, exam.id, cid);
          const changes = out.affectedQuestionIds.map((qid) => { const q = view.result?.questions.find((x) => x.questionId === qid); return q ? `question ${q.number}: ${fmt(q.awardedMarks)} / ${q.maxMarks}${q.openReviewFlags.length ? ' (still flagged)' : ''}` : ''; }).filter(Boolean);
          const reply = await exportReply(userId, exam.id, 'all', onStatus);
          return { text: `Corrected ${cid}'s reading "${out.before.slice(0, 80)}" → "${out.after.slice(0, 80)}" (original kept) and re-marked only the affected question(s): ${changes.join('; ')}. New total ${view.summary?.total} / ${view.summary?.maxTotal}.\n\n${reply.text}`, attachments: reply.attachments };
        }
        if (cmd.action === 'remark') {
          const e = await s.load(userId, exam.id);
          const sub = s.findSub(e, cid)!;
          const res = e.results[sub.id];
          if (!res) return { text: `${cid} has not been marked yet.`, attachments: [] };
          const sq = cmd.question && scheme ? s.findQuestion(scheme, cmd.question) : null;
          if (cmd.question && !sq) return { text: `There is no question ${cmd.question} in the marking scheme.`, attachments: [] };
          onStatus?.(`Re-marking ${sq ? `question ${sq.number}` : 'every question'} for ${cid}…`);
          const job = await s.requestRemark(userId, exam.id, sub.id, sq ? [sq.id] : null, 'Re-mark requested in chat');
          const st = await waitJob(userId, job.id, onStatus);
          if (st !== 'completed') return { text: st === 'pending' ? `Re-marking ${cid} is still running. Ask "status" shortly.` : 'Re-marking failed. Please try again.', attachments: [] };
          const reply = await exportReply(userId, exam.id, 'all', onStatus);
          const view = await s.candidateView(userId, exam.id, cid);
          return { text: `Re-marked ${cid}${sq ? ` question ${sq.number}` : ''}. Total now ${view.summary?.total} / ${view.summary?.maxTotal} (${view.summary?.percent}%).\n\n${reply.text}`, attachments: reply.attachments };
        }
        if (cmd.action === 'confirm_candidate') {
          await s.confirmResults(userId, exam.id, { submission: cid, question: cmd.question ?? undefined });
          return { text: `Confirmed ${cid}'s ${cmd.question ? `question ${cmd.question}` : 'marks'}. They are now recorded as user-confirmed. Say "regenerate" for updated files.`, attachments: [] };
        }
        const view = await s.candidateView(userId, exam.id, cid);
        if (!view.summary || !view.result) return { text: `${cid}'s script is ${STATE_TEXT[view.submission.state]}${view.submission.error ? `: ${view.submission.error.message}` : ''}.`, attachments: [] };
        if (cmd.action === 'explain') {
          const qs = view.result.questions.filter((q) => (!cmd.question || questionKey(q.number) === questionKey(cmd.question)) && (cmd.question || (q.awardedMarks ?? 0) < q.maxMarks));
          if (!qs.length) return { text: cmd.question ? `There is no question ${cmd.question} for ${cid}.` : `${cid} has full marks on every question.`, attachments: [] };
          const parts = qs.slice(0, 8).map((q) => [
            `Question ${q.number}: ${fmt(q.awardedMarks)} / ${q.maxMarks} (${q.source === 'examiner_override' ? 'examiner override' : q.status?.replace('_', ' ')})`,
            q.override ? `  Override: ${q.override.reason}` : '',
            q.answerAsRead ? `  Answer as read: "${q.answerAsRead.replace(/\s+/g, ' ').slice(0, 200)}"` : '',
            q.feedback ? `  ${q.feedback}` : '', q.lostMarks ? `  Lost marks: ${q.lostMarks}` : '',
            ...q.criterionResults.map((c) => `  ${c.awardedMarks >= c.maxMarks ? '✓' : '✗'} ${c.rubric ?? c.criterionId} – ${c.awardedMarks}/${c.maxMarks}${c.reason ? `: ${c.reason}` : ''}`),
            q.correction ? `  Correction: ${q.correction}` : '',
            q.confidence ? `  Confidence: ${q.confidence.level} (${Math.round(q.confidence.score * 100)}%)${q.confidence.basis.length > 1 ? ` – ${q.confidence.basis.slice(1).join('; ')}` : ''}` : '',
            q.evidenceQuotes.filter((x) => x.verified).length ? `  Evidence: ${q.evidenceQuotes.filter((x) => x.verified).slice(0, 3).map((x) => `"${x.quote.slice(0, 80)}" (${x.elementId})`).join('; ')}` : '',
            ...q.openReviewFlags.map((f) => `  Check: ${f.detail}`),
          ].filter(Boolean).join('\n'));
          return { text: `${cid}: ${view.summary.total} / ${view.summary.maxTotal} (${view.summary.percent}%), ${view.summary.status.replace('_', ' ')}.\n\n${parts.join('\n\n')}\n\nFrom the saved marking record (not a new judgement).`, attachments: [] };
        }
        // show_candidate
        let pdf = view.markedPdf;
        let note = '';
        if (!pdf || pdf.stale) {
          const reply = await exportReply(userId, exam.id, 'all', onStatus);
          const v2 = await s.candidateView(userId, exam.id, cid);
          pdf = v2.markedPdf;
          if (!pdf) note = `\n\n${reply.text}`;
        }
        const att = pdf ? await ref(pdf.fileId) : null;
        const qline = view.summary.questions.map((q) => `${q.number}: ${fmt(q.marks)}/${q.maxMarks}${q.flags.length ? ' (check)' : ''}`).join(', ');
        return { text: `${cid}${view.submission.candidateName ? ` (${view.submission.candidateName})` : ''}: ${view.summary.total} / ${view.summary.maxTotal} (${view.summary.percent}%), ${view.summary.status.replace('_', ' ')}.\n${qline}${att ? '\n\nThe marked paper is attached.' : '\n\nThe marked paper is not available yet.'}${note}`, attachments: att ? [att] : [] };
      }
      case 'failed_question': {
        if (!scheme) return { text: 'Nothing has been marked yet.', attachments: [] };
        const sq = s.findQuestion(scheme, cmd.question);
        if (!sq) return { text: `There is no question ${cmd.question} in the marking scheme.`, attachments: [] };
        const rows = list.map((c) => ({ c, q: c.questions.find((x) => x.questionId === sq.id)! })).filter((x) => x.q && (cmd.mode === 'zero' ? x.q.outcome === 'zero' : x.q.outcome !== 'full'));
        return { text: rows.length ? `${rows.length} candidate${rows.length === 1 ? '' : 's'} ${cmd.mode === 'zero' ? 'scored 0 on' : 'did not get full marks on'} question ${sq.number} (out of ${sq.maxMarks}):\n${rows.slice(0, 50).map((x) => `- ${x.c.candidateId}: ${fmt(x.q.marks)}${x.q.flags.length ? ' (flagged)' : ''}`).join('\n')}` : `No candidate ${cmd.mode === 'zero' ? 'scored 0 on' : 'lost marks on'} question ${sq.number}.`, attachments: [] };
      }
      case 'failed': {
        const rows = list.filter((c) => c.passed === false);
        return { text: rows.length ? `${rows.length} candidate${rows.length === 1 ? '' : 's'} below the ${exam.passPercent}% pass mark:\n${rows.map((c) => `- ${c.candidateId}: ${c.total} / ${c.maxTotal} (${c.percent}%)${c.openFlags ? ' – has items to check' : ''}`).join('\n')}` : `No fully marked candidate is below the ${exam.passPercent}% pass mark.`, attachments: [] };
      }
      case 'top': {
        const rows = list.filter((c) => c.complete).sort((a, b) => (cmd.order === 'top' ? b.percent - a.percent : a.percent - b.percent)).slice(0, Math.min(100, cmd.n));
        return { text: rows.length ? `${cmd.order === 'top' ? 'Top' : 'Bottom'} ${rows.length} by percentage:\n${rows.map((c, i) => `${i + 1}. ${c.candidateId}: ${c.percent}% (${c.total}/${c.maxTotal})${c.status === 'needs_review' ? ' – provisional, has items to check' : ''}`).join('\n')}` : 'No fully marked candidates yet.', attachments: [] };
      }
      case 'stats': {
        if (!stats) return { text: 'Nothing has been marked yet.', attachments: [] };
        const qs = [...stats.questions].sort((a, b) => (a.meanPercent ?? 0) - (b.meanPercent ?? 0));
        return {
          text: [`Class statistics (recalculated from the saved marks, revision ${exam.resultRevision}): ${stats.complete} fully marked; mean ${fmt(stats.mean)}, median ${fmt(stats.median)}, range ${fmt(stats.min)}–${fmt(stats.max)} of ${scheme?.totalMarks}; pass rate ${stats.passRate ?? '–'}% at ${exam.passPercent}%.`,
            `By question (hardest first):\n${qs.map((q) => `- ${q.number}: mean ${fmt(q.mean)}/${q.maxMarks} (${fmt(q.meanPercent)}%), full marks ${fmt(q.fullRate)}%, zero ${fmt(q.zeroRate)}%${q.flagged ? `, ${q.flagged} flagged` : ''}`).join('\n')}`].join('\n\n'),
          attachments: [],
        };
      }
      case 'flags': {
        const items = list.flatMap((c) => c.questions.flatMap((q) => q.flags.map((f) => `- ${c.candidateId}, question ${q.number}: ${f.detail}`)));
        return { text: items.length ? `${items.length} open item${items.length === 1 ? '' : 's'} to check:\n${items.slice(0, 40).join('\n')}${items.length > 40 ? `\n… and ${items.length - 40} more in the report's review list.` : ''}\n\nResolve one by correcting a reading, changing a mark, or confirming it (for example "confirm C001 question 2").` : 'There are no open review items.', attachments: [] };
      }
      case 'export': {
        if (!list.length) return { text: statusText(exam) || 'Nothing has been marked yet.', attachments: [] };
        return exportReply(userId, exam.id, cmd.what, onStatus);
      }
      default:
        return { text: statusText(exam), attachments: [] };
    }
  }

  /** Makes an examination the active one for this teacher (the review page they are looking at). */
  async function focus(userId: string, examId: string) {
    await s.load(userId, examId);
    await saveCtx(userId, { examId, pending: null });
  }

  return { handle, parseCommand, statusText, focus };
}

export type ExamChat = ReturnType<typeof createExamChat>;
