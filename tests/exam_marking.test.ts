import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { JSDOM } from 'jsdom';
import { PDFDocument, degrees, rgb } from 'pdf-lib';
import type { ProviderAdapter, ProviderRequest } from '../server/services/ai/providers/types.js';
import { FileStore } from '../server/services/ai/files/FileStore.js';
import { FileJobQueue } from '../server/services/ai/jobs/fileJobQueue.js';
import { OwnedRecordStore } from '../server/services/storage/ownedRecordStore.js';
import { createDocumentService, type DocumentRecord } from '../server/services/documents/service.js';
import { loadPages } from '../server/services/documents/pages.js';
import { changedQuestions, questionKey, validateScheme, type MarkingSchemeInput } from '../server/services/exams/scheme.js';
import { matchAnswers, readLabel } from '../server/services/exams/matching.js';
import { finalizeQuestion } from '../server/services/exams/marking.js';
import { classStatistics, effectiveMarks, questionStatus, summarizeCandidate } from '../server/services/exams/results.js';
import { processedToViewed, viewedToPdf } from '../server/services/exams/pdfGeometry.js';
import { cellText } from '../server/services/exams/workbook.js';
import { renderExamReport, scriptJson, validateExamReport, type ReportData } from '../server/services/exams/report.js';
import { candidateIdFromFileName, createExamService, parseManifest } from '../server/services/exams/service.js';
import { createExamChat, parseCommand, type ExamChatContext } from '../server/services/exams/chat.js';
import type { CandidateResult, ExamRecord, QuestionResult, Submission } from '../server/services/exams/types.js';
import type { DocumentResult } from '../server/services/documents/pipeline.js';

// SYNTHETIC test data: printed pages and a scripted model. Nothing here measures real handwriting accuracy.

const SCHEME: MarkingSchemeInput = {
  title: 'Algebra quiz', totalMarks: 5, allowHalfMarks: false,
  questions: [
    { id: 'Q1', number: '1', text: 'Solve x + 2 = 6.', maxMarks: 3, criteria: [{ id: 'Q1-M1', description: 'Subtract 2 from both sides', marks: 1, kind: 'method' }, { id: 'Q1-A1', description: 'x = 4', marks: 2, kind: 'accuracy' }], workingRequired: true },
    { id: 'Q2', number: '2', text: 'Area of a 3 by 5 rectangle.', maxMarks: 2, criteria: [{ id: 'Q2-B1', description: 'Area = 15', marks: 2, kind: 'answer' }] },
  ],
};

// ── Scheme ────────────────────────────────────────────────────────────────
test('scheme: validation never adjusts marks, keys normalise, changes are detected', () => {
  const ok = validateScheme(SCHEME);
  assert.deepEqual(ok.errors, []);
  assert.ok(ok.scheme);
  const bad = validateScheme({ ...SCHEME, totalMarks: 6 });
  assert.match(bad.errors.join(' '), /add up to 5 marks, but the stated total is 6/);
  const crit = validateScheme({ ...SCHEME, questions: [{ ...SCHEME.questions[0], maxMarks: 4 }, SCHEME.questions[1]], totalMarks: 6 });
  assert.match(crit.errors.join(' '), /criteria add up to 3, but the question is worth 4/);
  const dup = validateScheme({ ...SCHEME, questions: [SCHEME.questions[0], { ...SCHEME.questions[1], id: 'Q1b', number: 'Q1' }] });
  assert.match(dup.errors.join(' '), /same number/);
  const half = validateScheme({ ...SCHEME, questions: [{ ...SCHEME.questions[0], criteria: [{ id: 'a', description: 'x', marks: 1.5 }, { id: 'b', description: 'y', marks: 1.5 }] }, SCHEME.questions[1]] });
  assert.match(half.errors.join(' '), /mark step/);
  const holistic = validateScheme({ title: 'Essay', totalMarks: 10, questions: [{ id: 'E', number: '1', text: 'Discuss.', maxMarks: 10, marking: 'holistic', levels: [{ label: 'Low', minMarks: 0, maxMarks: 4 }, { label: 'High', minMarks: 5, maxMarks: 10 }] }] });
  assert.deepEqual(holistic.errors, []);
  assert.equal(questionKey('Q1(a)(ii)'), '1.a.ii');
  assert.equal(questionKey('Question one b'), '1.b');
  assert.equal(questionKey('2 part c'), '2.c');
  assert.equal(questionKey('01'), '1');
  const next = structuredClone(ok.scheme!);
  next.questions[1].criteria[0].description = 'Area = 15 square units';
  assert.deepEqual(changedQuestions(ok.scheme, next), ['Q2']);
});

// ── Question matching ─────────────────────────────────────────────────────
function docOf(pages: Array<Array<{ id: string; text: string; crossedOut?: boolean; needsReview?: boolean }>>): DocumentResult {
  return {
    pipelineVersion: 't', file: { name: 'x.pdf', sha256: 'x', format: 'pdf', totalPages: pages.length }, needsReview: false, model: 'fake', usage: { input: 0, output: 0 }, limitations: [],
    pages: pages.map((els, i) => ({
      page: i + 1, source: 'recognition' as const, width: 1000, height: 1400, deskewDegrees: 0, transforms: [], quality: { width: 1000, height: 1400, estimatedDpi: 200, contrast: 100, sharpness: 10, warnings: [] },
      languages: ['en'], notes: [], needsReview: false, readingOrder: els.map((e) => `p${i + 1}-${e.id}`),
      elements: els.map((e, k) => ({
        id: `p${i + 1}-${e.id}`, type: 'paragraph' as const, text: e.text, latex: null, table: null, region: { x0: 80, y0: 80 + k * 60, x1: 600, y1: 120 + k * 60 },
        legibility: 'clear' as const, uncertainSpans: [], crossedOut: !!e.crossedOut, handwritten: true, language: 'en',
        checks: { region: 'ok' as const }, signals: e.needsReview ? [{ source: 'model_ambiguity' as const, severity: 'medium' as const, detail: 'x' }] : [], uncertainty: e.needsReview ? 'medium' as const : 'low' as const, flags: [], needsReview: !!e.needsReview,
      })),
    })),
  };
}

test('matching: labels, sub-parts, continuation across pages, ambiguity and repeated attempts', () => {
  assert.deepEqual(readLabel('1) x + 2 = 6'), { main: '1', sub: undefined, rom: undefined });
  assert.deepEqual(readLabel('Question 2(b)(ii) area'), { main: '2', sub: 'b', rom: 'ii' });
  assert.deepEqual(readLabel('b) next part'), { sub: 'b' });
  assert.equal(readLabel('1.5 + 2 = 3.5'), null, 'a decimal is not a label');
  assert.equal(readLabel('2t + 3 = 5'), null, 'algebra is not a label');
  const scheme = validateScheme({ title: 'T', totalMarks: 6, questions: [
    { id: 'Q1a', number: '1(a)', maxMarks: 2, criteria: [{ id: 'c', description: 'x', marks: 2 }] },
    { id: 'Q1b', number: '1(b)', maxMarks: 2, criteria: [{ id: 'c', description: 'x', marks: 2 }] },
    { id: 'Q2', number: '2', maxMarks: 2, criteria: [{ id: 'c', description: 'x', marks: 2 }] },
  ] }).scheme!;
  const doc = docOf([
    [{ id: 'e1', text: 'Name: Alice' }, { id: 'e2', text: '1(a) x = 4' }, { id: 'e3', text: 'because 6 - 2' }, { id: 'e4', text: 'b) y = 3' }],
    [{ id: 'e1', text: 'continued working for b' }, { id: 'e2', text: '2. area 15' }, { id: 'e3', text: '1) more' }, { id: 'e4', text: '2) second try', crossedOut: true }],
  ]);
  const m = matchAnswers(doc, [], scheme);
  const by = Object.fromEntries(m.elements.map((e) => [e.id, e]));
  assert.deepEqual(by['p1-e1'].questionIds, [], 'text before any label is unassigned');
  assert.deepEqual(by['p1-e3'].questionIds, ['Q1a']);
  assert.deepEqual(by['p1-e4'].questionIds, ['Q1b']);
  assert.deepEqual(by['p2-e1'].questionIds, ['Q1b'], 'continues across the page break');
  assert.deepEqual(by['p2-e2'].questionIds, ['Q2']);
  assert.deepEqual(by['p2-e3'].questionIds, ['Q1a', 'Q1b'], 'a main-number label is ambiguous between sub-parts');
  assert.ok(m.questions.Q1a.flags.some((f) => f.code === 'multiple_attempts'), 'Q1 answered twice');
  assert.deepEqual(m.unassigned, ['p1-e1']);
  // Corrections are used for matching but the original reading is kept.
  const m2 = matchAnswers(doc, [{ elementId: 'p1-e1', text: '2) answer' }], scheme);
  assert.equal(m2.elements[0].corrected, true);
  assert.equal(m2.elements[0].originalText, 'Name: Alice');
});

// ── Marking validation ────────────────────────────────────────────────────
test('marking: code validates every mark, sums criteria, checks evidence and raises review flags', () => {
  const scheme = validateScheme(SCHEME).scheme!;
  const doc = docOf([[{ id: 'e1', text: '1) x + 2 = 6' }, { id: 'e2', text: 'x = 4', needsReview: true }, { id: 'e3', text: '2) 3 x 5 = 15' }]]);
  const match = matchAnswers(doc, [], scheme);
  const meta = { runId: 'r', schemeVersion: 1, model: 'fake' };
  const base = { questionId: 'Q1', answerFound: true, evidenceElementIds: ['p1-e1', 'p1-e2'], evidenceQuotes: [{ elementId: 'p1-e2', quote: 'x = 4' }], path: null, level: null, holisticMarks: null, feedback: 'Correct.', lostMarks: '', readingConcern: null, mappingConcern: null, rubricConcern: null };
  const good = finalizeQuestion(scheme.questions[0], false, { ...base, criterionResults: [{ criterionId: 'Q1-M1', awardedMarks: 1, reason: 'ok' }, { criterionId: 'Q1-A1', awardedMarks: 2, reason: 'ok' }] }, match, meta);
  assert.equal(good.awardedMarks, 3, 'total computed in code');
  assert.ok(good.reviewFlags.some((f) => f.code === 'uncertain_reading'), 'evidence read with uncertainty is flagged');
  const over = finalizeQuestion(scheme.questions[0], false, { ...base, criterionResults: [{ criterionId: 'Q1-M1', awardedMarks: 1, reason: '' }, { criterionId: 'Q1-A1', awardedMarks: 3, reason: '' }] }, match, meta);
  assert.equal(over.awardedMarks, null, 'an out-of-range criterion invalidates the mark instead of being clamped');
  assert.ok(over.reviewFlags.some((f) => f.code === 'marks_inconsistent'));
  const foreign = finalizeQuestion(scheme.questions[0], false, { ...base, evidenceElementIds: ['p9-e9'], evidenceQuotes: [{ elementId: 'p1-e1', quote: 'not on the page' }], criterionResults: [{ criterionId: 'Q1-M1', awardedMarks: 1, reason: '' }, { criterionId: 'Q1-A1', awardedMarks: 0, reason: '' }] }, match, meta);
  assert.ok(foreign.reviewFlags.some((f) => f.code === 'unsupported_justification' && /not in this script/.test(f.detail)));
  assert.ok(foreign.reviewFlags.some((f) => f.code === 'unsupported_justification' && /without a quote/.test(f.detail)));
  const unknown = finalizeQuestion(scheme.questions[0], false, { ...base, criterionResults: [{ criterionId: 'Q1-M1', awardedMarks: 1, reason: '' }, { criterionId: 'Q1-A1', awardedMarks: 2, reason: '' }, { criterionId: 'X', awardedMarks: 1, reason: '' }] }, match, meta);
  assert.equal(unknown.awardedMarks, null);
  const concern = finalizeQuestion(scheme.questions[1], false, { ...base, questionId: 'Q2', evidenceElementIds: ['p1-e3'], evidenceQuotes: [{ elementId: 'p1-e3', quote: '3 x 5 = 15' }], criterionResults: [{ criterionId: 'Q2-B1', awardedMarks: 2, reason: '' }], readingConcern: 'If 15 is 16 the answer is wrong.' }, match, meta);
  assert.equal(concern.awardedMarks, 2);
  assert.ok(concern.reviewFlags.some((f) => f.code === 'transcription_affects_mark' && f.severity === 'high'));
  assert.equal(finalizeQuestion(scheme.questions[1], false, undefined, match, meta).awardedMarks, null, 'a missing model result is never filled in');
});

// ── Results arithmetic and statuses ───────────────────────────────────────
function qr(over: Partial<QuestionResult> & { questionId: string; maxMarks: number; marks: number | null; flags?: boolean }): QuestionResult {
  return {
    questionId: over.questionId, number: over.questionId.slice(1), maxMarks: over.maxMarks, override: over.override ?? null, confirmed: over.confirmed ?? null, mappedElementIds: [], mappingFlags: [], history: [],
    ai: { runId: 'r', schemeVersion: 1, awardedMarks: over.marks, criterionResults: [], path: null, level: null, feedback: '', lostMarks: '', answerFound: true, evidenceElementIds: [], evidenceQuotes: [], reviewFlags: over.flags ? [{ code: 'uncertain_reading', severity: 'medium', detail: 'check' }] : [], model: 'm', at: '' },
  };
}

test('results: totals in code, overrides and confirmations change status, class statistics', () => {
  const scheme = validateScheme(SCHEME).scheme!;
  const sub = (id: string): Submission => ({ id, candidateId: id.toUpperCase(), identity: 'filename', fileId: 'f', fileName: `${id}.pdf`, mime: 'application/pdf', sha256: id, pages: 1, uploadedAt: '', state: 'completed', stateAt: '' });
  const res = (id: string, qs: QuestionResult[]): CandidateResult => ({ submissionId: id, candidateId: id.toUpperCase(), runId: 'r', schemeVersion: 1, questions: qs, updatedAt: '', usage: { input: 0, output: 0 } });
  const a = summarizeCandidate(res('a', [qr({ questionId: 'Q1', maxMarks: 3, marks: 3 }), qr({ questionId: 'Q2', maxMarks: 2, marks: 2 })]), sub('a'), scheme, 50);
  assert.deepEqual([a.total, a.percent, a.passed, a.status], [5, 100, true, 'provisional']);
  const flagged = qr({ questionId: 'Q2', maxMarks: 2, marks: 0, flags: true });
  const b = summarizeCandidate(res('b', [qr({ questionId: 'Q1', maxMarks: 3, marks: 1 }), flagged]), sub('b'), scheme, 50);
  assert.deepEqual([b.total, b.percent, b.passed, b.status, b.openFlags], [1, 20, false, 'needs_review', 1]);
  const overridden = { ...flagged, override: { marks: 2, reason: 'method correct', by: 'teacher', at: '', rubricConflict: null } };
  assert.equal(effectiveMarks(overridden), 2);
  assert.equal(questionStatus(overridden), 'user_corrected', 'an override resolves the flag and is marked as a user correction');
  assert.equal(questionStatus({ ...flagged, confirmed: { by: 't', at: '' } }), 'user_confirmed');
  const c = summarizeCandidate(res('c', [qr({ questionId: 'Q1', maxMarks: 3, marks: null }), qr({ questionId: 'Q2', maxMarks: 2, marks: 2 })]), sub('c'), scheme, 50);
  assert.deepEqual([c.complete, c.passed, c.status], [false, null, 'needs_review'], 'an invalid mark leaves the total incomplete');
  const stats = classStatistics([a, b, c], scheme, 50, 1);
  assert.deepEqual([stats.candidates, stats.complete, stats.mean, stats.median, stats.passRate, stats.failedProcessing], [4, 2, 3, 3, 50, 1]);
  assert.equal(stats.questions[0].fullRate, 50);
  assert.equal(stats.distribution.reduce((x, d) => x + d.count, 0), 2);
});

// ── Coordinates ───────────────────────────────────────────────────────────
async function darkCentroid(img: Buffer) {
  const { data, info } = await sharp(img).greyscale().raw().toBuffer({ resolveWithObject: true });
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) if (data[y * info.width + x] < 100) { sx += x; sy += y; n++; }
  return { x: sx / n, y: sy / n, width: info.width, height: info.height };
}

test('coordinates: deskew is inverted exactly as preprocessing applies it', async () => {
  const W = 1200, H = 1600;
  const dot = { fx: 0.7, fy: 0.25 };
  const page = await sharp({ create: { width: W, height: H, channels: 3, background: '#ffffff' } })
    .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect x="${dot.fx * W - 10}" y="${dot.fy * H - 10}" width="20" height="20" fill="#000"/></svg>`), top: 0, left: 0 }]).png().toBuffer();
  for (const deskew of [0, 4, -7.5]) {
    const processed = Math.abs(deskew) >= 0.3 ? await sharp(page).rotate(-deskew, { background: { r: 255, g: 255, b: 255 } }).flatten({ background: '#ffffff' }).png().toBuffer() : page;
    const c = await darkCentroid(processed);
    const v = processedToViewed((c.x / c.width) * 1000, (c.y / c.height) * 1000, { width: c.width, height: c.height, deskewDegrees: deskew });
    assert.ok(Math.abs(v.fx - dot.fx) < 0.01 && Math.abs(v.fy - dot.fy) < 0.01, `deskew ${deskew}: got ${v.fx.toFixed(3)},${v.fy.toFixed(3)}`);
  }
});

test('coordinates: PDF crop box and /Rotate map correctly (checked by rendering the PDF)', async () => {
  for (const rot of [0, 90, 180, 270]) {
    const doc = await PDFDocument.create();
    const p = doc.addPage([500, 700]);
    p.setCropBox(20, 30, 400, 600);
    p.setRotation(degrees(rot));
    const target = { fx: 0.25, fy: 0.2 };
    const at = viewedToPdf(target.fx, target.fy, { x: 20, y: 30, width: 400, height: 600 }, rot);
    p.drawRectangle({ x: at.x - 8, y: at.y - 8, width: 16, height: 16, color: rgb(0, 0, 0) });
    const { pages } = await loadPages(Buffer.from(await doc.save()), 'r.pdf', { pdfScale: 1 });
    const c = await darkCentroid(pages[0].image);
    assert.ok(Math.abs(c.x / c.width - target.fx) < 0.03 && Math.abs(c.y / c.height - target.fy) < 0.03, `rotation ${rot}: rendered at ${(c.x / c.width).toFixed(3)},${(c.y / c.height).toFixed(3)}`);
  }
});

// ── Report, workbook helpers, commands, ids ────────────────────────────────
test('report: escaped data, no network, working candidate filters', () => {
  assert.equal(cellText('=HYPERLINK("x")'), `'=HYPERLINK("x")`, 'spreadsheet formula injection is neutralised');
  const evil = '<img src=x onerror=alert(1)></script><script>alert(2)</script>';
  assert.ok(!scriptJson({ evil }).includes('<'), 'no raw "<" inside the embedded JSON');
  const q = (id: string, marks: number, max: number, flags = 0) => ({ questionId: id, number: id.slice(1), maxMarks: max, marks, status: (flags ? 'needs_review' : 'provisional') as 'provisional', flags: flags ? [{ code: 'uncertain_reading' as const, severity: 'medium' as const, detail: 'check' }] : [], outcome: (marks >= max ? 'full' : marks ? 'partial' : 'zero') as 'full' });
  const cand = (id: string, name: string, q1: number, q2: number, flags: number, changed = false) => ({
    submissionId: id, candidateId: id, candidateName: name, fileName: `${id}.pdf`, total: q1 + q2, maxTotal: 5, percent: ((q1 + q2) / 5) * 100, complete: true, passed: (q1 + q2) / 5 >= 0.5,
    status: (flags ? 'needs_review' : changed ? 'user_corrected' : 'provisional') as 'provisional', openFlags: flags, changedByUser: changed, questions: [q('Q1', q1, 3), q('Q2', q2, 2, flags)], pdfPath: `candidates/${id}_marked.pdf`, details: [],
  });
  const data: ReportData = {
    exam: { id: 'e'.repeat(36), title: 'Quiz <b>1</b>', schemeVersion: 1, runId: 'r'.repeat(36), resultRevision: 3, generatedAt: '2026-01-01T00:00:00Z', passPercent: 50, totalMarks: 5 },
    stats: { candidates: 3, marked: 3, complete: 3, failedProcessing: 0, flaggedCandidates: 1, mean: 3, median: 3, min: 1, max: 5, sd: 1, passPercent: 50, passRate: 66.67, distribution: Array.from({ length: 10 }, (_, i) => ({ from: i * 10, to: i * 10 + 10, count: 0 })), questions: [] },
    questions: [{ id: 'Q1', number: '1', maxMarks: 3 }, { id: 'Q2', number: '2', maxMarks: 2 }],
    candidates: [cand('C001', evil, 3, 2, 0), cand('C002', 'Bob', 1, 0, 1), cand('C003', 'Cy', 0, 2, 0, true)],
    failed: [],
  };
  const html = renderExamReport(data);
  assert.deepEqual(validateExamReport(html, ['/srv/secret-path']), { valid: true, problems: [] });
  assert.ok(!html.includes('<img src=x'), 'candidate text never appears as markup');
  assert.ok(html.includes('Quiz &lt;b&gt;1&lt;/b&gt;'));
  const dom = new JSDOM(html, { runScripts: 'dangerously' });
  const d = dom.window.document;
  const rows = () => d.querySelectorAll('#cbody tr').length;
  assert.equal(rows(), 3);
  assert.equal(d.querySelectorAll('img').length, 0, 'the injected <img> was rendered as text');
  const set = (id: string, v: string | boolean) => { const el = d.getElementById(id) as any; if (typeof v === 'boolean') el.checked = v; else el.value = v; el.dispatchEvent(new dom.window.Event('change')); };
  set('f-flag', true);
  assert.equal(rows(), 1);
  set('f-flag', false); set('f-fail', true);
  assert.equal(rows(), 2, 'C002 (20%) and C003 (40%) are below 50%');
  set('f-fail', false); set('f-changed', true);
  assert.equal(rows(), 1);
  set('f-changed', false); set('f-q', 'Q1'); set('f-qo', 'correct');
  assert.equal(rows(), 1);
  set('f-qo', 'incorrect');
  assert.equal(rows(), 1);
  set('f-q', ''); set('f-qo', ''); set('f-search', 'bob');
  assert.equal(rows(), 1);
  (d.querySelector('#cbody tr') as any).click();
  assert.match(d.getElementById('detail')!.textContent!, /Candidate C002/);
  assert.equal((d.querySelector('#detail a') as any).getAttribute('href'), 'candidates/C002_marked.pdf');
  assert.equal(validateExamReport(html.replace('</style>', '</style><script src="https://x.test/a.js"></script>')).valid, false);
});

test('commands and identities: chat phrases, file-name ids and manifests', () => {
  assert.deepEqual(parseCommand("Change candidate C014's question 2 mark to 4 because the method is correct."), { action: 'override', candidate: null, question: '2', marks: 4, reason: 'the method is correct' });
  assert.deepEqual(parseCommand('Correct the reading on page 3 from 200 to 280'), { action: 'correct_reading', candidate: null, question: null, page: 3, from: '200', to: '280', remark: true });
  assert.deepEqual(parseCommand("Candidate C014's answer to question 2 is 280, not 200. Re-evaluate that question and update the report."), { action: 'correct_reading', candidate: null, question: '2', page: null, from: '200', to: '280', remark: true });
  assert.equal(parseCommand('Show the corrected paper for candidate C014')?.action, 'show_candidate');
  assert.deepEqual(parseCommand('Find all candidates who failed question 3'), { action: 'failed_question', question: '3', mode: 'zero' });
  assert.equal(parseCommand('Explain why candidate C009 lost two marks')?.action, 'explain');
  assert.equal(parseCommand('Regenerate the Excel workbook')?.action, 'export');
  assert.deepEqual(parseCommand('Regenerate the Excel workbook'), { action: 'export', what: 'workbook' });
  assert.deepEqual(parseCommand('Download all corrected papers and results'), { action: 'export', what: 'all' });
  assert.equal(parseCommand('Recalculate the class statistics')?.action, 'stats');
  assert.equal(parseCommand('Compare performance across questions')?.action, 'stats');
  assert.deepEqual(parseCommand('Show me the top 10 candidates by percentage'), { action: 'top', n: 10, order: 'top' });
  assert.equal(parseCommand('confirm the marking scheme')?.action, 'confirm_scheme');
  assert.equal(candidateIdFromFileName('C014_alice.pdf'), 'C014');
  assert.equal(candidateIdFromFileName('candidate-7.pdf'), 'C7');
  assert.equal(candidateIdFromFileName('Mugenzi.pdf'), null, 'a plain name is not treated as an id');
  assert.deepEqual(parseManifest('candidate_id,file,name\nC001,a.pdf,Ann\nC002,b.pdf,Ben'), [{ candidateId: 'C001', fileName: 'a.pdf', candidateName: 'Ann' }, { candidateId: 'C002', fileName: 'b.pdf', candidateName: 'Ben' }]);
});

// ── End to end with a scripted model ──────────────────────────────────────
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'exam-test-'));
test.after(async () => { await queue.stop(); await fs.rm(root, { recursive: true, force: true }); });

const fileStore = new FileStore({ dir: path.join(root, 'files'), secret: 'test-secret-1234567890' });
const queue = new FileJobQueue({ storageDir: path.join(root, 'jobs'), concurrency: 2, retryDelayMs: 20, maxActivePerUser: 5 });
const PAGE_W: Record<string, number> = { C001: 420, C002: 520, C003: 610 };

/** Lines written on each synthetic script; y positions in PDF points from the top. */
const SCRIPTS: Record<string, string[]> = {
  C001: ['1) x + 2 = 6', 'x = 6 - 2 = 4', '2) area = 3 x 5 = 15'],
  C002: ['1) x + 2 = 6', 'x = 6 - 2 = 5', '2) area = 3 x 5 = 15'],
  C003: ['1) refused'],
};

async function scriptPdf(id: string, rotate = 0) {
  const w = PAGE_W[id], h = 700;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w * 2}" height="${h * 2}"><rect width="100%" height="100%" fill="#fff"/>${SCRIPTS[id].map((l, i) => `<text x="80" y="${180 + i * 120}" font-size="44" fill="#111">${l}</text>`).join('')}</svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  const doc = await PDFDocument.create();
  const page = doc.addPage([w, h]);
  page.drawImage(await doc.embedPng(png), { x: 0, y: 0, width: w, height: h });
  if (rotate) page.setRotation(degrees(rotate));
  return Buffer.from(await doc.save());
}

const C001_PDF = await scriptPdf('C001');
const C002_PDF = await scriptPdf('C002');
const calls = { recognition: 0, marking: [] as string[][], extraction: 0 };
const textOf = (req: ProviderRequest) => req.messages.map((m) => (typeof m.content === 'string' ? m.content : (m.content as any[]).map((c) => c.text ?? '').join(''))).join('\n');
const imageOf = (req: ProviderRequest) => { for (const m of req.messages) if (Array.isArray(m.content)) for (const c of m.content as any[]) if (c.type === 'image_url') return c.image_url.url as string; return null; };

const adapter: ProviderAdapter = {
  name: 'fake',
  async *stream(req) {
    const sys = typeof req.messages[0].content === 'string' ? req.messages[0].content : '';
    let out: unknown;
    if (sys.startsWith('You transcribe scanned pages')) {
      calls.recognition++;
      // Identify the script by page aspect ratio (scale-independent; rotated pages are seen sideways).
      const meta = await sharp(Buffer.from(imageOf(req)!.split(',')[1], 'base64')).metadata();
      const ar = meta.width! / meta.height!;
      const dist = (w: number) => Math.min(Math.abs(w / 700 - ar), Math.abs(700 / w - ar));
      const id = Object.entries(PAGE_W).sort((a, b) => dist(a[1]) - dist(b[1]))[0][0];
      if (id === 'C003') throw Object.assign(new Error('refused'), { category: 'CONTENT_REFUSED' });
      const lines = SCRIPTS[id];
      out = {
        languages: ['en'], notes: [], readingOrder: lines.map((_, i) => `e${i + 1}`),
        elements: lines.map((t, i) => ({
          id: `e${i + 1}`, type: 'paragraph', text: t, latex: null, table: null, region: { x0: 150, y0: Math.round(((180 + i * 120 - 50) / 1400) * 1000), x1: 600, y1: Math.round(((180 + i * 120 + 15) / 1400) * 1000) },
          legibility: id === 'C002' && i === 2 ? 'partly_unclear' : 'clear', uncertainSpans: id === 'C002' && i === 2 ? [{ text: '15', alternatives: ['16'], reason: 'faint' }] : [], crossedOut: false, handwritten: true, language: 'en',
        })),
      };
    } else if (sys.startsWith('You convert a teacher')) {
      calls.extraction++;
      out = {
        title: 'Algebra quiz', statedTotal: 5, allowHalfMarks: false, ambiguities: [],
        questions: [
          { number: '1', text: 'Solve x + 2 = 6.', maxMarks: 3, marksQuote: '1. (3 marks)', marking: 'criteria', criteria: [{ description: 'Subtract 2 from both sides', marks: 1, kind: 'method' }, { description: 'x = 4', marks: 2, kind: 'accuracy' }], alternativePaths: [], levels: [], acceptedAnswers: ['4'], errorCarriedForward: null, workingRequired: true, noWorkingRule: null, notes: '' },
          { number: '2', text: 'Area.', maxMarks: 2, marksQuote: '2. (2 marks)', marking: 'criteria', criteria: [{ description: 'Area = 15', marks: 2, kind: 'answer' }], alternativePaths: [], levels: [], acceptedAnswers: ['15'], errorCarriedForward: null, workingRequired: false, noWorkingRule: null, notes: '' },
        ],
      };
    } else if (sys.startsWith('You are an experienced examiner')) {
      const prompt = textOf(req);
      const ids = /Mark exactly these question ids: ([^\n.]+)/.exec(prompt)![1].split(',').map((x) => x.trim());
      calls.marking.push(ids);
      assert.ok(!/C00\d/.test(prompt.split('<candidate_script>')[1]), 'the marker never sees the candidate id');
      const lines = [...prompt.matchAll(/^\[(p\d+-e\d+) [^\]]*\] (.*)$/gm)].map((m) => ({ id: m[1], text: m[2] }));
      const find = (s: string) => lines.find((l) => l.text.includes(s));
      // Criterion ids as the prompt lists them for each question (works for JSON and extracted schemes).
      const critIds = (q: string) => [...prompt.matchAll(new RegExp(`- (${q}-[\\w-]+) \\[(\\w+)\\]`, 'g'))].map((m) => m[1]);
      out = {
        questions: ids.map((q) => {
          const cs = critIds(q);
          if (q === 'Q1') {
            const right = find('= 4');
            const ev = right ?? find('= 5')!;
            return { questionId: 'Q1', answerFound: true, evidenceElementIds: [ev.id], evidenceQuotes: [{ elementId: ev.id, quote: ev.text }], path: null, level: null, holisticMarks: null,
              criterionResults: [{ criterionId: cs[0], awardedMarks: 1, reason: 'Subtracted 2' }, { criterionId: cs[1], awardedMarks: right ? 2 : 0, reason: right ? 'Correct' : 'Arithmetic error' }],
              feedback: right ? 'Correct.' : 'Correct method, arithmetic slip.', lostMarks: right ? '' : '6 - 2 is 4, not 5.', readingConcern: null, mappingConcern: null, rubricConcern: null };
          }
          const ev = find('= 15')!;
          return { questionId: q, answerFound: true, evidenceElementIds: [ev.id], evidenceQuotes: [{ elementId: ev.id, quote: '3 x 5 = 15' }], path: null, level: null, holisticMarks: null,
            criterionResults: [{ criterionId: cs[0], awardedMarks: 2, reason: 'Correct area' }], feedback: 'Correct.', lostMarks: '', readingConcern: null, mappingConcern: null, rubricConcern: null };
        }),
      };
    } else if (sys.startsWith('You map a teacher')) {
      out = { action: 'none', candidate: null, question: null, marks: null, reason: null, from: null, to: null, page: null, n: null };
    } else {
      throw new Error(`unexpected request: ${sys.slice(0, 60)}`);
    }
    yield { type: 'text', text: JSON.stringify(out) };
    yield { type: 'usage', input: 100, output: 20 };
  },
};

const target = { adapter, model: 'fake-model', fallbackModel: null };
const documents = createDocumentService({ fileStore, queue, store: new OwnedRecordStore<DocumentRecord>(path.join(root, 'docs')), vision: () => target, agent: () => target, maxPages: 5 });
const examStore = new OwnedRecordStore<ExamRecord>(path.join(root, 'exams'));
const exams = createExamService({ fileStore, queue, store: examStore, documents, agent: () => target, visionAvailable: () => true, maxPages: 5, candidateConcurrency: 2, retryDelayMs: 10, forbiddenStrings: [root] });
const chat = createExamChat({ service: exams, fileStore, queue, contexts: new OwnedRecordStore<ExamChatContext>(path.join(root, 'ctx')), agent: () => target, waitMs: 30_000 });

async function waitRun(user: string, examId: string) {
  for (let i = 0; i < 600; i++) {
    const e = await exams.load(user, examId);
    const r = e.runs[e.runs.length - 1];
    if (r && ['completed', 'completed_with_warnings', 'failed'].includes(r.state)) return e;
    await new Promise((res) => setTimeout(res, 50));
  }
  throw new Error('run did not finish');
}
async function waitJob(user: string, id: string) {
  for (let i = 0; i < 600; i++) {
    const j = await queue.get(id, user);
    if (j && ['completed', 'failed'].includes(j.status)) return j;
    await new Promise((res) => setTimeout(res, 50));
  }
  throw new Error('job did not finish');
}

test('end to end: batch marking, failures isolated, package contents match the persisted results', async () => {
  const user = 'teacher-1';
  const exam = await exams.createExam(user, { title: 'Algebra quiz' });
  const sv = await exams.setSchemeJson(user, exam.id, SCHEME, { confirm: true });
  assert.equal(sv.status, 'confirmed');
  const c1 = C001_PDF;
  const { accepted, rejected } = await exams.addSubmissions(user, exam.id, [
    { name: 'C001.pdf', buffer: c1 }, { name: 'C002_bob.pdf', buffer: await scriptPdf('C002', 90) }, { name: 'C003.pdf', buffer: await scriptPdf('C003') },
    { name: 'copy-of-C001.pdf', buffer: c1 }, { name: 'broken.pdf', buffer: Buffer.from('%PDF-1.4 garbage') }, { name: 'notes.exe', buffer: Buffer.from('MZ...') },
  ]);
  assert.deepEqual(accepted.map((a) => a.candidateId), ['C001', 'C002', 'C003']);
  assert.deepEqual(rejected.map((r) => r.code).sort(), ['DUPLICATE', 'UNREADABLE', 'UNSUPPORTED_FORMAT']);

  const started = await exams.startMarking(user, exam.id);
  assert.equal(started.candidates, 3);
  const done = await waitRun(user, exam.id);
  const run = done.runs[0];
  assert.equal(run.state, 'completed_with_warnings', 'one script failed and one has an uncertain reading');
  const byId = Object.fromEntries(done.submissions.map((s) => [s.candidateId, s]));
  assert.equal(byId.C003.state, 'failed');
  assert.equal(byId.C003.error?.code, 'CONTENT_REFUSED');
  assert.equal(byId.C001.state, 'completed');
  assert.equal(byId.C002.state, 'completed_with_warnings');

  const { list, stats } = exams.summaries(done);
  const s1 = list.find((x) => x.candidateId === 'C001')!, s2 = list.find((x) => x.candidateId === 'C002')!;
  assert.deepEqual([s1.total, s1.percent, s1.status], [5, 100, 'provisional']);
  assert.deepEqual([s2.total, s2.percent, s2.status], [3, 60, 'needs_review']);
  assert.equal(stats!.failedProcessing, 1);

  // Package: one ZIP with the report, workbook, summary, manifest, marked PDFs and per-candidate JSON.
  const set = done.artifacts[0];
  assert.equal(set.resultRevision, done.resultRevision);
  const zip = await JSZip.loadAsync((await fileStore.read(set.bundleFileId!, user)).data);
  const names = Object.keys(zip.files).filter((n) => !n.endsWith('/')).sort();
  assert.deepEqual(names, ['examination-results/candidates/C001_marked.pdf', 'examination-results/candidates/C002_marked.pdf', 'examination-results/index.html', 'examination-results/manifest.json', 'examination-results/reports/C001_marking.json', 'examination-results/reports/C002_marking.json', 'examination-results/results.xlsx', 'examination-results/summary.json']);
  const manifest = JSON.parse(await zip.file('examination-results/manifest.json')!.async('string'));
  assert.equal(manifest.resultRevision, done.resultRevision);
  assert.equal(manifest.files.length, 7);
  const html = await zip.file('examination-results/index.html')!.async('string');
  assert.equal(validateExamReport(html, [root]).valid, true);
  assert.ok(!html.includes(root), 'no server paths in the artifact');

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await zip.file('examination-results/results.xlsx')!.async('nodebuffer') as any);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Class Results', 'Question Analysis', 'Marking Details', 'Review Log', 'Metadata']);
  const cr = wb.getWorksheet('Class Results')!;
  const totals = new Map<string, number>();
  cr.eachRow((row, i) => { if (i > 1) totals.set(String(row.getCell(1).value), (row.getCell(6).value as any).result); });
  assert.deepEqual(Object.fromEntries(totals), { C001: 5, C002: 3 }, 'workbook totals equal the persisted results');

  // Marked PDFs keep the source pages, add a summary page and carry stable metadata.
  const marked = await PDFDocument.load(await zip.file('examination-results/candidates/C002_marked.pdf')!.async('nodebuffer'));
  assert.equal(marked.getPageCount(), 2);
  assert.equal(marked.getPage(0).getRotation().angle, 90, 'source page rotation preserved');
  assert.match(marked.getSubject()!, new RegExp(`run ${run.id}; revision ${done.resultRevision}`));
  assert.ok(!set.problems.some((p) => p.startsWith('C001')), 'C001 marks were placed on the page');
});

test('end to end: overrides and corrections create revisions, re-mark only affected questions, regenerate stale files', async () => {
  const user = 'teacher-1';
  const exam = await exams.createExam(user, {});
  await exams.setSchemeJson(user, exam.id, SCHEME, { confirm: true });
  await exams.addSubmissions(user, exam.id, [{ name: 'C001.pdf', buffer: C001_PDF }, { name: 'C002.pdf', buffer: C002_PDF }]);
  const recBefore = calls.recognition;
  await exams.startMarking(user, exam.id);
  let e = await waitRun(user, exam.id);
  assert.equal(calls.recognition, recBefore + 1, 'C001 is identical to the first exam\'s script and reuses its recognition; only C002 is read');
  assert.deepEqual(e.submissions.map((s) => s.recognitionCached), [true, false]);
  const rev0 = e.resultRevision;

  // Examiner override: recorded separately from the AI mark, revision increments, exports become stale.
  const o = await exams.overrideMark(user, exam.id, { submission: 'C002', question: '1' }, { marks: 2, reason: 'Method fully correct' });
  assert.deepEqual([o.before, o.after], [1, 2]);
  e = await exams.load(user, exam.id);
  assert.equal(e.resultRevision, rev0 + 1);
  const q1 = e.results[e.submissions[1].id].questions[0];
  assert.equal(q1.ai!.awardedMarks, 1, 'the AI proposal is kept');
  assert.equal(q1.override!.marks, 2);
  assert.ok((await exams.artifacts(user, exam.id))[0].stale);
  await assert.rejects(exams.overrideMark(user, exam.id, { submission: 'C002', question: '1' }, { marks: 4, reason: 'x' }), /worth 3 marks/);
  await assert.rejects(exams.overrideMark(user, exam.id, { submission: 'C002', question: '1' }, { marks: 1.5, reason: 'x' }), /whole marks only/);

  // Transcription correction: the original reading is kept; only question 1 is re-marked.
  const markCalls = calls.marking.length;
  const c = await exams.correctTranscription(user, exam.id, { submission: 'C002' }, { from: '= 5', to: '= 4' });
  assert.deepEqual(c.affectedQuestionIds, ['Q1']);
  const job = await waitJob(user, c.jobId!);
  assert.equal(job.status, 'completed');
  assert.deepEqual(calls.marking.slice(markCalls), [['Q1']], 'only the affected question was sent for re-marking');
  e = await exams.load(user, exam.id);
  const sub2 = e.submissions[1];
  const doc = await documents.get(user, sub2.documentId!);
  assert.equal(doc!.corrections.length, 1);
  assert.equal(doc!.corrections[0].by, user);
  assert.ok(doc!.result.pages[0].elements.some((x) => x.text === 'x = 6 - 2 = 5'), 'original recognition preserved');
  const rq = e.results[sub2.id].questions[0];
  assert.equal(rq.ai!.awardedMarks, 3);
  assert.equal(rq.ai!.basedOnCorrection, true);
  assert.equal(rq.override!.marks, 2, 'an examiner override still takes precedence over a later AI re-mark');
  assert.deepEqual(rq.history.map((h) => h.kind), ['ai_mark', 'override', 'ai_remark']);
  const latest = (await exams.artifacts(user, exam.id))[0];
  assert.equal(latest.stale, false, 'artifacts regenerated after the re-mark');
  assert.ok(e.audit.some((a) => a.type === 'transcription_correction' && a.before === 'x = 6 - 2 = 5'));

  // Restart safety: re-running a finished marking segment does not mark anyone again.
  const before = calls.marking.length;
  const again = await queue.submit({ type: 'exam.mark', ownerId: user, payload: { examId: exam.id, runId: e.runs[0].id, segment: 9 } });
  await waitJob(user, again.job.id);
  assert.equal(calls.marking.length, before, 'no duplicate scoring');
  const after = await exams.load(user, exam.id);
  assert.equal(Object.keys(after.results).length, 2);

  // Ownership: another user cannot see the exam, its candidates or its artifacts.
  await assert.rejects(exams.load('intruder', exam.id), /not found/i);
  await assert.rejects(exams.candidateView('intruder', exam.id, 'C001'), /not found/i);
  await assert.rejects(fileStore.read(latest.id === after.artifacts[0].id ? after.artifacts[0].bundleFileId! : '', 'intruder'));
});

test('chat: start, progress, explanations, edits and downloads through conversation only', async () => {
  const user = 'teacher-3';
  assert.equal(await chat.handle(user, 'hello, how are you?', []), null, 'ordinary chat is not captured');
  assert.equal(await chat.handle(user, "Grade this student's essay", [{ name: 'essay.pdf', buffer: C002_PDF, mime: 'application/pdf' }]), null, 'a single-essay request stays with the existing chat');
  const ask = await chat.handle(user, 'Mark this paper using the marking scheme', [{ name: 'Mugenzi.pdf', buffer: C002_PDF, mime: 'application/pdf' }]);
  assert.match(ask!.text, /official marking scheme/);
  assert.match(ask!.text, /won't invent one/);
  const schemeTxt = Buffer.from('Marking scheme\n1. (3 marks) M1 subtract 2 from both sides; A1 x = 4 (2 marks)\n2. (2 marks) B1 area 15\nTotal: 5 marks');
  const start = await chat.handle(user, 'Mark these examination papers using the attached official marking scheme. Return corrected papers and an Excel file.', [
    { name: 'marking_scheme.txt', buffer: schemeTxt, mime: 'text/plain' }, { name: 'C001.pdf', buffer: C001_PDF, mime: 'application/pdf' },
  ]);
  assert.match(start!.text, /Exam materials received/);
  // The script staged with the first message is kept; it gets a new id that does not collide with C001.pdf.
  assert.match(start!.text, /2 candidate scripts registered: C002 ← Mugenzi\.pdf \(new id\), C001 ← C001\.pdf/);
  assert.match(start!.text, /2 questions, 5 marks in total/);
  const ctxExam = (await (await fs.readdir(path.join(root, 'ctx'))).length);
  assert.equal(ctxExam, 1);
  // Wait for the run, then "status" returns the package.
  let reply = await chat.handle(user, 'status', []);
  for (let i = 0; i < 300 && !/package is ready/.test(reply!.text); i++) { await new Promise((r) => setTimeout(r, 50)); reply = await chat.handle(user, 'status', []); }
  assert.match(reply!.text, /package is ready/);
  assert.match(reply!.text, /provisional/);
  assert.deepEqual(reply!.attachments.map((a) => a.kind), ['archive', 'spreadsheet']);
  const why = await chat.handle(user, 'Why did C002 lose marks on question 1?', []);
  assert.match(why!.text, /Question 1: 1 \/ 3/);
  assert.match(why!.text, /6 - 2 is 4, not 5/);
  const failedQ = await chat.handle(user, 'Show all candidates who failed question 1', []);
  assert.match(failedQ!.text, /No candidate scored 0/);
  const edit = await chat.handle(user, "Change C002's question 1 score to 3 because the method is correct.", []);
  assert.match(edit!.text, /C002, question 1: 1 → 3 \(examiner override, reason: the method is correct\)\. New total 5 \/ 5/);
  assert.ok(edit!.attachments.some((a) => a.kind === 'archive'), 'updated package returned');
  const paper = await chat.handle(user, 'Show me the corrected paper for C001 among all candidates', []);
  assert.match(paper!.text, /^C001: 5 \/ 5/);
  assert.deepEqual(paper!.attachments.map((a) => a.mime), ['application/pdf']);
  assert.match(paper!.attachments[0].name, /^C001_marked\.pdf$/);
  const top = await chat.handle(user, 'Show me the top 10 candidates by percentage', []);
  assert.match(top!.text, /1\. C00[12]: 100%/);
  const ambiguous = await chat.handle(user, 'Why did they lose marks?', []);
  assert.match(ambiguous!.text, /Which candidate\?/);
  assert.equal(await chat.handle(user, 'how do I download python on windows?', []), null, 'general questions are not captured');
});

test('chat: ambiguous scheme files are kept and resolved by the reply, not guessed', async () => {
  const user = 'teacher-4';
  const scheme = Buffer.from('1. (3 marks) M1 subtract 2; A1 x = 4 (2 marks)\n2. (2 marks) B1 area 15\nTotal: 5 marks');
  const r1 = await chat.handle(user, 'Mark these scripts with the marking scheme', [
    { name: 'rubric_v1.txt', buffer: scheme, mime: 'text/plain' }, { name: 'rubric_v2.txt', buffer: scheme, mime: 'text/plain' }, { name: 'C001.pdf', buffer: C001_PDF, mime: 'application/pdf' },
  ]);
  assert.match(r1!.text, /Several files could be the marking scheme/);
  assert.match(r1!.text, /1\) rubric_v1\.txt, 2\) rubric_v2\.txt, 3\) C001\.pdf/);
  const r2 = await chat.handle(user, 'file 2', []);
  assert.match(r2!.text, /1 candidate script registered: C001 ← C001\.pdf/);
  assert.match(r2!.text, /2 questions, 5 marks in total/);
});
