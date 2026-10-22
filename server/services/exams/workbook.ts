import ExcelJS from 'exceljs';
import type { ClassStatistics, CandidateSummary } from './results.js';
import type { MarkingScheme } from './scheme.js';
import type { ExamRecord } from './types.js';

/**
 * Results workbook (real .xlsx via exceljs). Formula cells carry the backend's computed value as their
 * cached result, so the file shows the authoritative totals even before a spreadsheet recalculates.
 */

const HEADER = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A5F' } } as const;
const FLAG = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF1D6' } } as const;

/** Cell text from user or model content: neutralise formula injection (=, +, -, @ at the start). */
export function cellText(v: unknown): string {
  const s = String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').slice(0, 32000);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

function styleHeader(ws: ExcelJS.Worksheet) {
  const row = ws.getRow(1);
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = HEADER;
  row.alignment = { vertical: 'middle', wrapText: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

const colName = (n: number) => { let s = ''; for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s; return s; };

export async function buildWorkbook(exam: ExamRecord, scheme: MarkingScheme, summaries: CandidateSummary[], stats: ClassStatistics, meta: { runId: string; schemeVersion: number; generatedAt: string }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Bwenge.AI';
  wb.created = new Date(meta.generatedAt);

  // 1. Class Results
  const cr = wb.addWorksheet('Class Results');
  const qCols = scheme.questions.map((q) => `Q${q.number} (/${q.maxMarks})`);
  cr.addRow(['Candidate ID', 'Name', 'Script', ...qCols, 'Total', 'Maximum', 'Percentage', 'Result', 'Status', 'Open flags', 'Changed by user']);
  styleHeader(cr);
  const first = 4, last = 3 + scheme.questions.length;
  summaries.forEach((s, i) => {
    const r = i + 2;
    const row = cr.addRow([
      cellText(s.candidateId), cellText(s.candidateName ?? ''), cellText(s.fileName),
      ...scheme.questions.map((q) => s.questions.find((x) => x.questionId === q.id)?.marks ?? null),
      { formula: `SUM(${colName(first)}${r}:${colName(last)}${r})`, result: s.total },
      s.maxTotal,
      { formula: `IF(${colName(last + 2)}${r}=0,0,${colName(last + 1)}${r}/${colName(last + 2)}${r})`, result: s.maxTotal ? s.total / s.maxTotal : 0 },
      s.passed === null ? 'Incomplete' : s.passed ? 'Pass' : 'Below pass mark',
      s.status.replace('_', ' '), s.openFlags, s.changedByUser ? 'Yes' : 'No',
    ]);
    row.getCell(last + 3).numFmt = '0.0%';
    if (s.openFlags) row.getCell(last + 6).fill = FLAG;
  });
  cr.columns.forEach((c, i) => { c.width = i < 3 ? 18 : i <= last ? 11 : 14; });

  // 2. Question Analysis
  const qa = wb.addWorksheet('Question Analysis');
  qa.addRow(['Question', 'Maximum', 'Marked', 'Mean', 'Median', 'Mean %', 'Full marks %', 'Partial %', 'Zero %', 'Flagged']);
  styleHeader(qa);
  for (const q of stats.questions) qa.addRow([cellText(q.number), q.maxMarks, q.marked, q.mean, q.median, q.meanPercent, q.fullRate, q.partialRate, q.zeroRate, q.flagged]);
  qa.addRow([]);
  qa.addRow(['Score distribution (% of total)', 'Candidates']).font = { bold: true };
  for (const d of stats.distribution) qa.addRow([`${d.from}–${d.to}%`, d.count]);
  qa.columns.forEach((c) => { c.width = 16; });

  // 3. Marking Details
  const md = wb.addWorksheet('Marking Details');
  md.addRow(['Candidate ID', 'Question', 'Criterion', 'Awarded', 'Maximum', 'Reason / feedback', 'Evidence (page: element)', 'Source of mark', 'Status']);
  styleHeader(md);
  for (const s of summaries) {
    const res = exam.results[s.submissionId];
    for (const q of res?.questions ?? []) {
      const sq = s.questions.find((x) => x.questionId === q.questionId);
      const ev = (q.ai?.evidenceElementIds ?? []).map((id) => `p${id.split('-')[0].replace(/^p/, '')}: ${id}`).join(', ');
      const source = q.override ? 'Examiner override' : q.ai?.basedOnCorrection ? 'AI (after transcription correction)' : q.ai ? 'AI proposal' : 'Not marked';
      md.addRow([cellText(s.candidateId), cellText(q.number), 'Question total', sq?.marks ?? null, q.maxMarks, cellText([q.ai?.feedback, q.ai?.lostMarks ? `Lost: ${q.ai.lostMarks}` : '', q.override ? `Override reason: ${q.override.reason}` : ''].filter(Boolean).join(' ')), cellText(ev), source, sq?.status.replace('_', ' ') ?? '']).font = { bold: true };
      for (const c of q.ai?.criterionResults ?? []) md.addRow([cellText(s.candidateId), cellText(q.number), cellText(c.criterionId), c.awardedMarks, c.maxMarks, cellText(c.reason), '', 'AI proposal', '']);
    }
  }
  md.columns.forEach((c, i) => { c.width = [14, 10, 16, 9, 9, 70, 30, 22, 14][i] ?? 14; });
  md.getColumn(6).alignment = { wrapText: true, vertical: 'top' };

  // 4. Review Log
  const rl = wb.addWorksheet('Review Log');
  rl.addRow(['Type', 'Candidate ID', 'Question', 'Severity / actor', 'Detail', 'Before', 'After', 'When', 'Revision']);
  styleHeader(rl);
  for (const s of summaries) for (const q of s.questions) for (const f of q.flags) rl.addRow(['Open flag', cellText(s.candidateId), cellText(q.number), f.severity, cellText(f.detail), '', '', '', '']);
  for (const a of exam.audit) {
    const cand = a.candidateId ?? '';
    rl.addRow([a.type.replace(/_/g, ' '), cellText(cand), cellText(a.questionId ?? ''), cellText(a.actor), cellText(a.reason ?? ''), cellText(typeof a.before === 'object' ? JSON.stringify(a.before) : a.before ?? ''), cellText(typeof a.after === 'object' ? JSON.stringify(a.after) : a.after ?? ''), a.at, a.revision]);
  }
  rl.columns.forEach((c, i) => { c.width = [22, 14, 10, 16, 60, 14, 14, 22, 9][i] ?? 14; });

  // 5. Metadata
  const mt = wb.addWorksheet('Metadata');
  mt.addRow(['Field', 'Value']);
  styleHeader(mt);
  for (const [k, v] of [
    ['Examination', exam.title], ['Exam ID', exam.id], ['Marking scheme version', meta.schemeVersion], ['Marking run ID', meta.runId],
    ['Result revision', exam.resultRevision], ['Exported at (UTC)', meta.generatedAt], ['Total marks', scheme.totalMarks], ['Pass mark (%)', exam.passPercent],
    ['Candidates', stats.candidates], ['Fully marked', stats.complete], ['Failed processing', stats.failedProcessing], ['With open flags', stats.flaggedCandidates],
    ['Status note', 'AI-proposed marks are provisional until a teacher confirms them. Totals and percentages are computed by the Bwenge.AI backend.'],
  ] as Array<[string, string | number]>) mt.addRow([k, typeof v === 'string' ? cellText(v) : v]);
  mt.getColumn(1).width = 26;
  mt.getColumn(2).width = 80;

  return Buffer.from(await wb.xlsx.writeBuffer());
}
