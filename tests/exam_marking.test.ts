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
import { isOvernight } from '../server/services/ai/batchMode.js';
import { OwnedRecordStore } from '../server/services/storage/ownedRecordStore.js';
import { createDocumentService, type DocumentRecord } from '../server/services/documents/service.js';
import { loadPages } from '../server/services/documents/pages.js';
import { changedQuestions, questionKey, validateScheme, type MarkingSchemeInput } from '../server/services/exams/scheme.js';
import { matchAnswers, readLabel } from '../server/services/exams/matching.js';
import { finalizeQuestion, markCandidate, markConfidence, preferenceLines } from '../server/services/exams/marking.js';
import { verifyMarkedPdf } from '../server/services/exams/verifyPdf.js';
import { computeLayout, symbolsFor } from '../server/services/exams/layout.js';
import { expandArchives, typedToPdf } from '../server/services/exams/inputs.js';
import { PDFParse } from 'pdf-parse';
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
  const unreadableMatch = structuredClone(match);
  unreadableMatch.elements.find(e => e.id === 'p1-e3')!.uncertainty = 'high';
  const unreadableMark = finalizeQuestion(scheme.questions[1], false, { ...base, questionId: 'Q2', evidenceElementIds: ['p1-e3'], evidenceQuotes: [{ elementId: 'p1-e3', quote: '3 x 5 = 15' }], criterionResults: [{ criterionId: 'Q2-B1', awardedMarks: 0, reason: 'Cannot read final digit' }] }, unreadableMatch, meta);
  assert.equal(unreadableMark.awardedMarks, null, 'unreadable handwriting is held for review, never turned into a wrong-answer cross');
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
const calls = { recognition: 0, marking: [] as string[][], extraction: 0, drafts: 0, markPrompts: [] as string[], markGate: null as Promise<void> | null };
const textOf = (req: ProviderRequest) => req.messages.map((m) => (typeof m.content === 'string' ? m.content : (m.content as any[]).map((c) => c.text ?? '').join(''))).join('\n');
const imageOf = (req: ProviderRequest) => { for (const m of req.messages) if (Array.isArray(m.content)) for (const c of m.content as any[]) if (c.type === 'image_url') return c.image_url.url as string; return null; };

let onMarkRequest: ((ids: string[]) => Promise<void>) | undefined;
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
    } else if (sys.startsWith('You convert a teacher') || sys.startsWith('There is no official marking scheme')) {
      calls.extraction++;
      if (sys.startsWith('There is no official')) { calls.drafts++; assert.match(textOf(req), /candidate_scripts_sample[\s\S]*x \+ 2 = 6/, 'drafts from the questions on the scripts'); }
      out = {
        title: 'Algebra quiz', statedTotal: 5, allowHalfMarks: false, ambiguities: [],
        questions: [
          { number: '1', text: 'Solve x + 2 = 6.', maxMarks: 3, marksQuote: '1. (3 marks)', marking: 'criteria', criteria: [{ description: 'Subtract 2 from both sides', marks: 1, kind: 'method' }, { description: 'x = 4', marks: 2, kind: 'accuracy' }], alternativePaths: [], levels: [], acceptedAnswers: ['4'], errorCarriedForward: null, workingRequired: true, noWorkingRule: null, notes: '' },
          { number: '2', text: 'Area.', maxMarks: 2, marksQuote: '2. (2 marks)', marking: 'criteria', criteria: [{ description: 'Area = 15', marks: 2, kind: 'answer' }], alternativePaths: [], levels: [], acceptedAnswers: ['15'], errorCarriedForward: null, workingRequired: false, noWorkingRule: null, notes: '' },
        ],
      };
    } else if (sys.startsWith('You are an experienced examiner')) {
      if (calls.markGate) await calls.markGate; // a test holds the marker mid-run (ignores the abort signal, like a slow provider)
      const prompt = textOf(req);
      const ids = /Mark exactly these question ids: ([^\n.]+)/.exec(prompt)![1].split(',').map((x) => x.trim());
      calls.marking.push(ids);
      calls.markPrompts.push(prompt);
      await onMarkRequest?.(ids);
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
              feedback: right ? 'Correct.' : 'Correct method, arithmetic slip.', lostMarks: right ? '' : '6 - 2 is 4, not 5.', correction: right ? null : 'x = 6 - 2 = 4', confidence: right ? 0.95 : 0.85, readingConcern: null, mappingConcern: null, rubricConcern: null };
          }
          const ev = find('= 15')!;
          return { questionId: q, answerFound: true, evidenceElementIds: [ev.id], evidenceQuotes: [{ elementId: ev.id, quote: '3 x 5 = 15' }], path: null, level: null, holisticMarks: null,
            criterionResults: [{ criterionId: cs[0], awardedMarks: 2, reason: 'Correct area' }], feedback: 'Correct.', lostMarks: '', correction: null, confidence: 0.9, readingConcern: null, mappingConcern: null, rubricConcern: null };
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
  const e = await exams.load(user, examId);
  const jobs = await Promise.all(e.runs.flatMap((r) => r.jobIds).map((id) => queue.get(id, user)));
  throw new Error(`run did not finish: ${JSON.stringify({ runs: e.runs.map((r) => [r.id.slice(0, 6), r.state, r.jobIds.length]), subs: e.submissions.map((x) => [x.candidateId, x.state, e.results[x.id]?.runId?.slice(0, 6) ?? null]), jobs: jobs.map((j) => j && [j.id.slice(0, 6), j.status, j.attempts, j.error?.code ?? null, j.progress?.stage]) })}`);
}
async function waitJob(user: string, id: string) {
  for (let i = 0; i < 600; i++) {
    const j = await queue.get(id, user);
    if (j && ['completed', 'failed'].includes(j.status)) return j;
    await new Promise((res) => setTimeout(res, 50));
  }
  throw new Error('job did not finish');
}

test('live marking persists validated questions before the next question and exports a combined PDF', async () => {
  const user = 'teacher-live';
  const exam = await exams.createExam(user, { title: 'Live scan' });
  await exams.setSchemeJson(user, exam.id, SCHEME, { confirm: true });
  const uploaded = await exams.addSubmissions(user, exam.id, [{ name: 'C001.pdf', buffer: C001_PDF }]);
  const sub = uploaded.accepted[0];
  let observed = false;
  onMarkRequest = async (ids) => {
    if (!ids.includes('Q2')) return;
    const saved = await exams.load(user, exam.id);
    assert.equal(saved.results[sub.id].questions[0].ai?.awardedMarks, 3);
    assert.equal(saved.results[sub.id].questions[1].ai, null, 'no fabricated mark before evaluation');
    const review = await exams.reviewCandidate(user, exam.id, sub.id);
    assert.ok(review.layout.items.some(i => i.questionId === 'Q1' && i.placed));
    assert.ok(!review.layout.items.some(i => i.questionId === 'Q2' && i.placed));
    observed = true;
  };
  // One group at a time, so the viewer can be checked between them (groups normally run in parallel).
  process.env.EXAM_QUESTION_CONCURRENCY = '1';
  try { await exams.startMarking(user, exam.id); await waitRun(user, exam.id); }
  finally { onMarkRequest = undefined; delete process.env.EXAM_QUESTION_CONCURRENCY; }
  assert.ok(observed, 'question 1 was available to the viewer while question 2 was pending');
  const done = await exams.load(user, exam.id);
  const artifact = done.artifacts.find(a => a.status === 'ready')!;
  assert.ok(artifact.classPdfFileId);
  const pdf = await PDFDocument.load((await fileStore.read(artifact.classPdfFileId!, user)).data);
  assert.ok(pdf.getPageCount() >= 1);
  assert.ok(exams.artifactRefs(artifact).classPdfUrl);
});

test('handwriting review provides owner-scoped source crops and invalidates a released mark after correction', async () => {
  const user = 'teacher-source';
  const exam = await exams.createExam(user, { title: 'Handwriting review' });
  await exams.setSchemeJson(user, exam.id, SCHEME, { confirm: true });
  const { accepted } = await exams.addSubmissions(user, exam.id, [{ name: 'C001.pdf', buffer: C001_PDF }]);
  await exams.startMarking(user, exam.id); await waitRun(user, exam.id);
  const review = await exams.reviewCandidate(user, exam.id, accepted[0].id);
  const evidence = review.evidence.find(e => e.questionIds.includes('Q1'))!;
  assert.ok(evidence.text);
  assert.match(evidence.cropUrl, /evidence/);
  const crop = await exams.evidenceCrop(user, exam.id, accepted[0].id, evidence.id);
  const meta = await sharp(crop).metadata();
  assert.equal(meta.format, 'jpeg');
  assert.ok(meta.width! > 10 && meta.height! > 10);
  await assert.rejects(() => exams.evidenceCrop('another-teacher', exam.id, accepted[0].id, evidence.id), /not found/i);
  await exams.release(user, exam.id, [accepted[0].id]);
  assert.equal((await exams.reviewCandidate(user, exam.id, accepted[0].id)).released, true);
  await exams.correctTranscription(user, exam.id, { submission: accepted[0].id }, { elementId: evidence.id, to: '1. x = 4 (teacher checked)', remark: false });
  const corrected = await exams.reviewCandidate(user, exam.id, accepted[0].id);
  assert.equal(corrected.released, false, 'corrected readings require renewed teacher review');
  assert.match(corrected.evidence.find(e => e.id === evidence.id)!.text, /teacher checked/);
  assert.ok(corrected.questions.find(q => q.questionId === 'Q1')!.openReviewFlags.some(f => f.code === 'transcription_affects_mark'));
  assert.equal(corrected.markedPdf?.stale, true);
});

test('visual marking receives original answer images alongside the transcription', async () => {
  const scheme = validateScheme(SCHEME).scheme!;
  const match = matchAnswers(docOf([[{ id: 'e1', text: '2. 3 x 5 = 15' }]]), [], scheme);
  const jpeg = await sharp({ create: { width: 200, height: 100, channels: 3, background: 'white' } }).jpeg().toBuffer();
  let sawImage = false;
  const visual: ProviderAdapter = { name: 'visual-fixture', async *stream(req) { sawImage = !!imageOf(req); yield* adapter.stream(req); } };
  const result = await markCandidate(visual, 'fake-model', { scheme, questionIds: ['Q2'], match, runId: 'visual', schemeVersion: 1,
    imagesForQuestions: async ids => { assert.deepEqual(ids, ['Q2']); return [`data:image/jpeg;base64,${jpeg.toString('base64')}`]; } });
  assert.ok(sawImage); assert.equal(result.marks.Q2.awardedMarks, 2);
});

test('stop retains validated partial marks and a new run can finish the paper', async () => {
  const user = 'teacher-stop';
  const exam = await exams.createExam(user, { title: 'Stop and retry' });
  await exams.setSchemeJson(user, exam.id, SCHEME, { confirm: true });
  const { accepted } = await exams.addSubmissions(user, exam.id, [{ name: 'C001.pdf', buffer: C001_PDF }]);
  onMarkRequest = async ids => { if (ids.includes('Q2')) await exams.stopMarking(user, exam.id); };
  try { await exams.startMarking(user, exam.id); await waitRun(user, exam.id); }
  finally { onMarkRequest = undefined; }
  await new Promise(resolve => setTimeout(resolve, 30));
  const stopped = await exams.load(user, exam.id);
  assert.equal(stopped.results[accepted[0].id].questions[0].ai?.awardedMarks, 3);
  assert.equal(stopped.results[accepted[0].id].questions[1].ai, null);
  assert.equal(stopped.submissions[0].state, 'failed');
  await exams.startMarking(user, exam.id);
  assert.equal(exams.summaries(await waitRun(user, exam.id)).list[0].total, 5);
});

test('selected workspace student and question govern contextual chat without affecting another student', async () => {
  const user = 'teacher-focus';
  const exam = await exams.createExam(user, { title: 'Focused paper' });
  await exams.setSchemeJson(user, exam.id, SCHEME, { confirm: true });
  const { accepted } = await exams.addSubmissions(user, exam.id, [{ name: 'C001.pdf', buffer: C001_PDF }, { name: 'C002.pdf', buffer: await scriptPdf('C002') }]);
  await exams.startMarking(user, exam.id); await waitRun(user, exam.id);
  const focusedChat = createExamChat({ service: exams, fileStore, queue, contexts: new OwnedRecordStore<ExamChatContext>(path.join(root, 'focused-ctx')), agent: () => target });
  await focusedChat.focus(user, exam.id, accepted[1].id);
  const response = await focusedChat.handle(user, 'Why did this answer lose marks?', [], { submissionId: accepted[1].id, questionId: 'Q1' });
  assert.match(response!.text, /C002/);
  assert.match(response!.text, /arithmetic|slip|lost|1\s*\/\s*3/i);
  await assert.rejects(() => focusedChat.focus('another-user', exam.id, accepted[0].id), /not found/i);
});

test('marking allowance failures block provider work and oversized papers are rejected before registration', async () => {
  const localQueue = new FileJobQueue({ storageDir: path.join(root, 'limited-jobs'), concurrency: 1 });
  const limited = createExamService({ fileStore, queue: localQueue, store: new OwnedRecordStore<ExamRecord>(path.join(root, 'limited-exams')), documents, agent: () => target,
    visionAvailable: () => true, maxBatchPages: 1, beforeAi: async () => { throw new Error('Marking allowance unavailable'); } });
  try {
    const exam = await limited.createExam('limited-owner', {});
    await limited.setSchemeJson('limited-owner', exam.id, SCHEME, { confirm: true });
    const original = await PDFDocument.load(C001_PDF);
    const doubled = await PDFDocument.create();
    for (const page of await doubled.copyPages(original, [0, 0])) doubled.addPage(page);
    const rejected = await limited.addSubmissions('limited-owner', exam.id, [{ name: 'two-pages.pdf', buffer: Buffer.from(await doubled.save()) }]);
    assert.equal(rejected.accepted.length, 0);
    assert.equal(rejected.rejected[0].code, 'BATCH_PAGE_LIMIT');
    await limited.addSubmissions('limited-owner', exam.id, [{ name: 'C001.pdf', buffer: C001_PDF }]);
    const before = calls.marking.length;
    await assert.rejects(() => limited.startMarking('limited-owner', exam.id), /allowance unavailable/);
    assert.equal(calls.marking.length, before);
    assert.equal((await limited.load('limited-owner', exam.id)).runs.length, 0);
  } finally { await localQueue.stop(); }
});

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
  assert.equal(await chat.handle(user, "Grade this student's essay", []), null, 'without files the normal chat answers');
  // One message: scheme and scripts in any order. Marking runs in the same turn; the reply carries the red-pen PDFs.
  const schemeTxt = Buffer.from('Marking scheme\n1. (3 marks) M1 subtract 2 from both sides; A1 x = 4 (2 marks)\n2. (2 marks) B1 area 15\nTotal: 5 marks');
  const statuses: string[] = [];
  const exams: string[] = [];
  const start = await chat.handle(user, 'Mark these papers', [
    { name: 'Mugenzi.pdf', buffer: C002_PDF, mime: 'application/pdf' }, { name: 'marking_scheme.txt', buffer: schemeTxt, mime: 'text/plain' }, { name: 'C001.pdf', buffer: C001_PDF, mime: 'application/pdf' },
  ], { onStatus: (t) => statuses.push(t), onExam: (id) => exams.push(id) });
  assert.match(start!.text, /\*\*Marking finished\.\*\* 2 scripts marked/);
  assert.ok(exams.length >= 1 && exams.every((id) => id === start!.examId), 'the chat learns which examination is being marked, to show its live card');
  const perStudent = statuses.filter((t) => /^Student \d marked: .+, \d+\/5$/.test(t));
  assert.equal(perStudent.length, 2, `one line per marked student: ${statuses.join(' | ')}`);
  assert.ok(perStudent.some((t) => /C001, 5\/5$/.test(t)));
  assert.match(start!.text, /\| C002 \(Mugenzi\) \| \d+ \/ 5 \|/, 'a new id for the unnamed file, with its name kept');
  assert.match(start!.text, /\| C001 \| 5 \/ 5 \| 100% \|/);
  assert.deepEqual(start!.attachments.map((a) => a.mime), ['application/pdf', 'application/pdf'], 'each marked script as a PDF');
  assert.match(start!.text, /\*\*Do you want the results in Excel\?\*\* \[Download the Excel workbook\]\(/);
  assert.match(start!.text, /Open the results\]\([^)]*\/exams\/[^)]+\/review\)/);
  assert.doesNotMatch(start!.text, /confirm|ask "status"/i, 'no extra round-trips');
  assert.ok(statuses.some((t) => /^Marked \d of 2 scripts/.test(t)), `progress reported: ${statuses.join(' | ')}`);
  const ctxExam = (await (await fs.readdir(path.join(root, 'ctx'))).length);
  assert.equal(ctxExam, 1);
  const reply = await chat.handle(user, 'status', []);
  assert.match(reply!.text, /Marking finished/);
  const excel = await chat.handle(user, 'excel please', []);
  assert.ok(excel!.attachments.some((a) => a.kind === 'spreadsheet'), 'Excel on request');
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
  assert.match(r2!.text, /Marking finished\.\*\* 1 script marked/);
  assert.deepEqual(r2!.attachments.map((a) => a.name), ['C001_marked.pdf']);
});

test('chat: roles set on the Mark page are used as given, and the teacher\'s instructions reach the marker', async () => {
  const user = 'teacher-roles';
  // A scheme named like a student's paper and wording no phrase detector knows: the explicit roles decide.
  const scheme = Buffer.from('1. (3 marks) M1 subtract 2; A1 x = 4 (2 marks)\n2. (2 marks) B1 area 15\nTotal: 5 marks');
  const before = calls.markPrompts.length;
  const statuses: string[] = [];
  const r = await chat.handle(user, 'check these', [
    { name: 'Maths S4.txt', buffer: scheme, mime: 'text/plain' }, { name: 'C001.pdf', buffer: C001_PDF, mime: 'application/pdf' },
  ], { onStatus: (t) => statuses.push(t), marking: { roles: { 'Maths S4.txt': 'scheme', 'C001.pdf': 'scripts' }, instructions: 'Accept answers in any unit.', credit: 'partial', feedback: 'brief' } });
  assert.match(r!.text, /Marking finished\.\*\* 1 script marked/);
  assert.doesNotMatch(r!.text, /Several files could be the marking scheme/);
  assert.ok(statuses.includes('Noted your marking instructions'), statuses.join(' | '));
  assert.ok(calls.markPrompts.slice(before).some((pr) => /TEACHER'S MARKING INSTRUCTIONS[\s\S]*Accept answers in any unit\./.test(pr)), 'the instructions are in the marking prompt');
  assert.match(preferenceLines({ credit: 'partial', feedback: 'brief', instructions: 'Ignore spelling.' }), /Ignore spelling\./);
});

// ── Red marks on the candidate's page, the saved record, teacher review and release ─────────────────

const crit = (id: string, awarded: number, max: number, rubric: string) => ({ criterionId: id, awardedMarks: awarded, maxMarks: max, reason: awarded >= max ? 'Correct' : 'Wrong value', rubric });

test('layout: one tick or cross per step in the right margin, level with the answer, never on the writing', () => {
  // Page 1: question 3 (wrong, with a correction) and question 4 (two steps: fraction right, decimal wrong).
  const doc = docOf([[
    { id: 'e1', text: '3) area = 7 x 5' }, { id: 'e2', text: '= 30 cm2' },
    { id: 'e3', text: '4) 3/4 = 0.75 ... 3/4' }, { id: 'e4', text: '= 0.34' },
  ]]);
  const ai = (over: Partial<NonNullable<QuestionResult['ai']>>) => ({ runId: 'r', schemeVersion: 1, awardedMarks: 0, criterionResults: [], path: null, level: null, feedback: '', lostMarks: '', answerFound: true, evidenceElementIds: [], evidenceQuotes: [], reviewFlags: [], model: 'm', at: '', ...over });
  const result: CandidateResult = {
    submissionId: 's', candidateId: 'C1', runId: 'r', schemeVersion: 1, updatedAt: 't', usage: { input: 0, output: 0 },
    questions: [
      { questionId: 'Q3', number: '3', maxMarks: 2, override: null, confirmed: null, mappedElementIds: [], mappingFlags: [], history: [],
        ai: ai({ awardedMarks: 0, criterionResults: [crit('Q3-A', 0, 2, 'Area = 35 cm2')], evidenceElementIds: ['p1-e1', 'p1-e2'], correction: '7 x 5 = 35 cm2' }) },
      { questionId: 'Q4', number: '4', maxMarks: 4, override: null, confirmed: null, mappedElementIds: [], mappingFlags: [], history: [],
        ai: ai({ awardedMarks: 2, criterionResults: [crit('Q4-A', 2, 2, 'Fraction 3/4'), crit('Q4-B', 0, 2, 'Decimal 0.75')], evidenceElementIds: ['p1-e3', 'p1-e4'] }) },
    ],
  };
  const { items } = computeLayout(doc, result, { total: 2, maxTotal: 6 });
  const q3 = items.find((i) => i.id === 'Q3:mark')!, q4 = items.find((i) => i.id === 'Q4:mark')!;
  assert.deepEqual(q3.symbols, ['cross']);
  assert.deepEqual(q4.symbols, ['tick', 'cross'], 'each step gets its own mark');
  assert.equal(q4.label, '2/4');
  const rightEdge = 0.6; // writing ends at x1 = 600/1000 in docOf
  for (const it of [q3, q4]) {
    assert.ok(it.placed);
    assert.ok(it.fx >= rightEdge, 'in the margin, right of every line of writing');
    assert.ok(it.fx + it.w <= 0.99);
  }
  // Level with the end of each answer: e2 spans y 0.14–0.18, e4 spans 0.26–0.30.
  assert.ok(q3.fy > 0.14 && q3.fy < 0.2, `Q3 level with its last line (${q3.fy})`);
  assert.ok(q4.fy > 0.26 && q4.fy < 0.32, `Q4 level with its last line (${q4.fy})`);
  const corr = items.find((i) => i.id === 'Q3:correction')!;
  assert.equal(corr.text, '7 x 5 = 35 cm2');
  assert.ok(corr.placed);
  // The correction never covers writing: the line below Q3 (e3, from y 0.2) blocks the space under the answer,
  // so it goes into the margin under the mark instead.
  const lines = [[0.08, 0.08, 0.6, 0.12], [0.08, 0.14, 0.6, 0.18], [0.08, 0.2, 0.6, 0.24], [0.08, 0.26, 0.6, 0.3]];
  const box = { x0: corr.fx, x1: corr.fx + corr.w, y0: corr.fy - corr.h / 2, y1: corr.fy + corr.h / 2 };
  assert.ok(!lines.some(([x0, y0, x1, y1]) => box.x0 < x1 && box.x1 > x0 && box.y0 < y1 && box.y1 > y0), 'correction does not overlap the writing');
  const total = items.find((i) => i.id === 'total')!;
  assert.deepEqual([total.page, total.label], [1, '2/6']);
  assert.ok(total.fy < 0.1, 'total at the top of page 1');

  // A teacher's adjustment wins over the automatic place; hiding removes the item from the page.
  result.layout = { 'Q4:mark': { page: 1, fx: 0.7, fy: 0.5, by: 't', at: 'x' }, 'Q3:correction': { page: 1, fx: 0, fy: 0, hidden: true, by: 't', at: 'x' } };
  const after = computeLayout(doc, result, { total: 2, maxTotal: 6 }).items;
  assert.deepEqual([after.find((i) => i.id === 'Q4:mark')!.fx, after.find((i) => i.id === 'Q4:mark')!.fy, after.find((i) => i.id === 'Q4:mark')!.auto], [0.7, 0.5, false]);
  assert.equal(after.find((i) => i.id === 'Q3:correction')!.hidden, true);

  // An override replaces the per-step marks with one symbol for the teacher's total.
  result.questions[1].override = { marks: 4, reason: 'accepted', by: 't', at: 'x', rubricConflict: null };
  assert.deepEqual(symbolsFor(result.questions[1]), ['tick']);
});

test('confidence: the marker\'s estimate is capped by what the checks found', () => {
  assert.deepEqual(markConfidence(0.95, [], 2, true)!.level, 'high');
  assert.equal(markConfidence(0.95, [{ code: 'uncertain_reading', severity: 'medium', detail: '' }], 2, true)!.score, 0.7);
  const low = markConfidence(0.95, [{ code: 'unreadable_handwriting', severity: 'high', detail: '' }], 2, true)!;
  assert.equal(low.level, 'low');
  assert.match(low.basis.join(' '), /unreadable handwriting/);
  assert.equal(markConfidence(0.9, [], 2, false)!.score, 0.5, 'marks without a matching quote');
  assert.equal(markConfidence(undefined, [], null, false)!.score, 0);
});

const pdfText = async (buf: Buffer) => { const p = new PDFParse({ data: new Uint8Array(buf) }); try { return (await p.getText()).text; } finally { await p.destroy(); } };

test('review: saved record, page images, moving a mark, release and the draft label', async () => {
  const user = 'teacher-review';
  const exam = await exams.createExam(user, { title: 'Review quiz' });
  await exams.setSchemeJson(user, exam.id, SCHEME, { confirm: true });
  const original = await scriptPdf('C002');
  await exams.addSubmissions(user, exam.id, [{ name: 'C002.pdf', buffer: original }]);
  await exams.startMarking(user, exam.id);
  const done = await waitRun(user, exam.id);
  const sub = done.submissions[0];

  const rv = await exams.reviewCandidate(user, exam.id, sub.id);
  const q1 = rv.questions.find((q) => q.number === '1')!;
  // The record a "why" answer is read from.
  assert.match(q1.answerAsRead!, /6 - 2 = 5/);
  assert.deepEqual(q1.criterionResults.map((c) => [c.rubric, c.awardedMarks]), [['Subtract 2 from both sides', 1], ['x = 4', 0]]);
  assert.equal(q1.correction, 'x = 6 - 2 = 4');
  assert.ok(q1.confidence && q1.confidence.score <= 0.85);
  const m1 = rv.layout.items.find((i) => i.id === `${q1.questionId}:mark`)!;
  assert.deepEqual([m1.symbols, m1.label, m1.placed], [['tick', 'cross'], '1/3', true]);
  assert.equal(rv.layout.items.find((i) => i.id === 'total')!.label, '3/5');
  assert.equal(rv.released, false);

  const img = await exams.pageImage(user, exam.id, sub.id, 1);
  assert.equal((await sharp(img).metadata()).format, 'jpeg');
  await assert.rejects(exams.pageImage('someone-else', exam.id, sub.id, 1));

  // The first marked PDF is a draft.
  const draftPdf = (await fileStore.read(done.artifacts[0].candidatePdfs[sub.id], user)).data;
  assert.match(await pdfText(draftPdf), /DRAFT/);

  // The teacher nudges the mark; release confirms the marks and the regenerated PDF has no draft label.
  await exams.setLayout(user, exam.id, sub.id, m1.id, { page: 1, fx: 0.7, fy: 0.3 });
  const moved = await exams.reviewCandidate(user, exam.id, sub.id);
  assert.deepEqual(((i) => [i.fx, i.fy, i.auto])(moved.layout.items.find((i) => i.id === m1.id)!), [0.7, 0.3, false]);
  const rel = await exams.release(user, exam.id, [sub.id]);
  assert.deepEqual(rel.released, ['C002']);
  const exp = await exams.requestExport(user, exam.id);
  if (exp.job) await waitJob(user, exp.job.id);
  const after = await exams.load(user, exam.id);
  const r = after.results[sub.id];
  assert.ok(r.questions.every((q) => q.confirmed), 'release confirms every mark');
  const releasedPdf = (await fileStore.read(after.artifacts[0].candidatePdfs[sub.id], user)).data;
  const text = await pdfText(releasedPdf);
  assert.doesNotMatch(text, /DRAFT/);
  assert.match(text, /Released by the teacher/);
  assert.match(text, /Correction: x = 6 - 2 = 4/);

  // The original scan is never changed.
  assert.ok((await fileStore.read(sub.fileId, user)).data.equals(original));

  // Any later change makes it a draft again until released again.
  await exams.setLayout(user, exam.id, sub.id, 'total', { page: 1, fx: 0.5, fy: 0.05 });
  const changed = await exams.reviewCandidate(user, exam.id, sub.id);
  assert.deepEqual([changed.released, changed.changedSinceRelease], [false, true]);
  await assert.rejects(exams.setLayout(user, exam.id, sub.id, 'Q9:mark', { reset: true }), /No item/);
});

test('chat: scripts without a scheme or question paper are kept and Bwenge asks for one; the scheme sent next starts marking', async () => {
  const user = 'teacher-needs-scheme';
  const before = calls.drafts;
  const ask = await chat.handle(user, 'Please mark these scripts', [{ name: 'C001.pdf', buffer: C001_PDF, mime: 'application/pdf' }]);
  assert.match(ask!.text, /I need \*\*the marking scheme or the question paper\*\*/);
  assert.equal(calls.drafts, before, 'nothing is drafted without being asked');
  // The scheme arrives as an unnamed photo-like file: it is the scheme because Bwenge asked for it.
  const scheme = Buffer.from('1. (3 marks) M1 subtract 2; A1 x = 4 (2 marks)\n2. (2 marks) B1 area 15\nTotal: 5 marks');
  const done = await chat.handle(user, 'here it is', [{ name: 'IMG_0042.txt', buffer: scheme, mime: 'text/plain' }]);
  assert.match(done!.text, /Marking finished\.\*\* 1 script marked/);
  assert.deepEqual(done!.attachments.map((a) => a.name), ['C001_marked.pdf']);
  // From the Mark page (explicit roles) the scheme or paper is required too; the page's settings are kept.
  const explicitAsk = await chat.handle('teacher-needs-scheme-2', 'Mark this script', [{ name: 'C001.pdf', buffer: C001_PDF, mime: 'application/pdf' }], { marking: { roles: { 'C001.pdf': 'scripts' }, credit: 'strict' } });
  assert.match(explicitAsk!.text, /marking scheme or the question paper/);
  assert.doesNotMatch(explicitAsk!.text, /write one from the questions/, 'the Mark page always needs one of the two');
});

test('chat: no marking scheme, the teacher says so, and the AI writes one from the questions and marks', async () => {
  const user = 'teacher-draft';
  const before = calls.drafts;
  const ask = await chat.handle(user, 'Please mark these scripts', [{ name: 'C001.pdf', buffer: C001_PDF, mime: 'application/pdf' }, { name: 'C002.pdf', buffer: C002_PDF, mime: 'application/pdf' }]);
  assert.match(ask!.text, /I don't have a marking scheme/);
  const r1 = await chat.handle(user, "I don't have a marking scheme", []);
  assert.equal(calls.drafts, before + 1, 'one draft');
  assert.match(r1!.text, /No marking scheme was attached, so I wrote one from the questions \(2 questions, 5 marks\)/);
  assert.match(r1!.text, /mark again with this scheme/, 'the teacher can still use their own');
  assert.match(r1!.text, /Marking finished\.\*\* 2 scripts marked/);
  assert.equal(r1!.attachments.length, 2);
  const e = await exams.load(user, (await exams.listExams(user))[0].examId);
  assert.equal(exams.latestScheme(e)!.source.note, 'Drafted by Bwenge AI (no official scheme)', 'the record says who wrote the scheme');
  assert.equal(Object.keys(e.results).length, 2);
  // Scripts with no marking words at all and no files: nothing to do here.
  assert.equal(await chat.handle('teacher-none', 'Please mark these scripts', []), null);
});

test('inputs: a ZIP folder becomes one script per student; typed answers are printed to a PDF and kept', async () => {
  const page = async (label: string) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="100%" height="100%" fill="#fff"/><text x="40" y="80" font-size="40">${label}</text></svg>`)).png().toBuffer();
  const zip = new JSZip();
  zip.file('class 3B/C014/page2.png', await page('p2'));
  zip.file('class 3B/C014/page1.png', await page('p1'));
  zip.file('class 3B/C015.pdf', C001_PDF);
  zip.file('class 3B/__MACOSX/._junk', 'x');
  const files = await expandArchives([{ name: 'class 3B.zip', buffer: await zip.generateAsync({ type: 'nodebuffer' }) }]);
  assert.deepEqual(files.map((f) => f.name).sort(), ['C014.pdf', 'C015.pdf']);
  const c014 = await PDFDocument.load(files.find((f) => f.name === 'C014.pdf')!.buffer);
  assert.equal(c014.getPageCount(), 2, 'one page per photo in the folder');

  const pdf = await typedToPdf({ name: 'C016.txt', buffer: Buffer.from('1) x + 2 = 6\nx = 4\n\n2) area = 15') });
  assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-');

  const user = 'teacher-inputs';
  const exam = await exams.createExam(user, { title: 'Inputs' });
  const out = await exams.addSubmissions(user, exam.id, [
    { name: 'class.zip', buffer: await zip.generateAsync({ type: 'nodebuffer' }) },
    { name: 'C016.txt', buffer: Buffer.from('1) x + 2 = 6\nx = 4') },
    { name: 'C017.rtf', buffer: Buffer.from('{\\rtf1\\ansi 1) x = 4\\par 2) area = 15}') },
  ]);
  assert.deepEqual(out.accepted.map((a) => a.candidateId).sort(), ['C014', 'C015', 'C016', 'C017']);
  assert.deepEqual(out.rejected, []);
  const typed = out.accepted.find((a) => a.candidateId === 'C016')!;
  assert.equal(typed.typed, true);
  assert.equal(typed.mime, 'application/pdf');
  assert.equal((await fileStore.read(typed.originalFileId!, user)).data.toString(), '1) x + 2 = 6\nx = 4', 'the teacher\'s file is kept unchanged');
});


// ── Live events, premium gate, preferences, cancellation and PDF checks ────────────────────────────────

test('live events: a run records real, ordered events that a viewer receives live and can replay', async () => {
  const user = 'teacher-live';
  const exam = await exams.createExam(user, { title: 'Live quiz' });
  await exams.setSchemeJson(user, exam.id, SCHEME, { confirm: true });
  await exams.addSubmissions(user, exam.id, [{ name: 'C001.pdf', buffer: C001_PDF }, { name: 'C002.pdf', buffer: C002_PDF }]);
  const live: number[] = [];
  const off = exams.subscribe(exam.id, (ev) => live.push(ev.seq));
  await exams.startMarking(user, exam.id);
  const done = await waitRun(user, exam.id);
  off();
  const { events, lastSeq } = await exams.eventsSince(user, exam.id, 0);
  assert.deepEqual(events.map((e) => e.seq), events.map((_, i) => i + 1), 'sequence numbers are gap-free and ordered');
  assert.equal(lastSeq, events.length);
  assert.deepEqual(live, events.map((e) => e.seq), 'a live viewer gets every event once, in order');
  const types = events.map((e) => e.type);
  for (const t of ['job_created', 'page_processing_started', 'document_inspected', 'marking_started', 'question_detected', 'question_marking_started', 'question_marked', 'script_marked', 'pdf_generation_started', 'pdf_generation_completed', 'job_completed'] as const) assert.ok(types.includes(t), `${t} is reported`);
  assert.ok(types.indexOf('job_created') < types.indexOf('page_processing_started') && types.indexOf('pdf_generation_completed') < types.indexOf('job_completed'), 'events follow the real order of work');
  assert.equal(types.filter((t) => t === 'question_marked').length, 4, 'one per question per script');
  // The uncertain reading on C002 is reported as uncertainty, not as a wrong answer.
  assert.ok(events.some((e) => e.type === 'uncertainty_detected' && e.candidateId === 'C002'));
  const marks = events.filter((e) => e.type === 'question_marked' && e.candidateId === 'C002').map((e) => e.data?.marks);
  assert.deepEqual(marks, [1, 2], 'event marks are the stored marks');
  const pdfDone = events.find((e) => e.type === 'pdf_generation_completed')!;
  assert.equal(pdfDone.data?.verified, 2, 'both marked PDFs were reopened, rendered and matched before release');
  assert.equal(done.artifacts[0].verified, 2);
  assert.equal(events.find((e) => e.type === 'job_created')!.progress?.total, 2);
  assert.deepEqual(events.find((e) => e.type === 'job_completed')!.progress, { done: 2, total: 2 });
  // Replay after a reconnect returns only what was missed.
  const after = await exams.eventsSince(user, exam.id, 5);
  assert.deepEqual(after.events.map((e) => e.seq)[0], 6);
  assert.equal(after.gap, false);
  // Events carry ids, counts and short messages: never the script's text.
  const json = JSON.stringify(events);
  assert.ok(!json.includes('x = 6 - 2 = 5') && !json.includes('area = 3 x 5'), 'no transcription in events');
});

test('premium: without the entitlement, new marking work is refused on the server; corrections and viewing still work', async () => {
  const user = 'teacher-free';
  let allowed = true;
  // Its own queue and store: a second service registers its own job handlers, which must not take over the shared queue.
  const gatedQueue = new FileJobQueue({ storageDir: path.join(root, 'jobs-gated'), concurrency: 2, retryDelayMs: 20, maxActivePerUser: 5 });
  const gatedStore = new OwnedRecordStore<ExamRecord>(path.join(root, 'exams-gated'));
  const gatedDocs = createDocumentService({ fileStore, queue: gatedQueue, store: new OwnedRecordStore<DocumentRecord>(path.join(root, 'docs-gated')), vision: () => target, agent: () => target, maxPages: 5 });
  const gated = createExamService({ fileStore, queue: gatedQueue, store: gatedStore, documents: gatedDocs, agent: () => target, visionAvailable: () => true, maxPages: 5, candidateConcurrency: 2, retryDelayMs: 10, forbiddenStrings: [root],
    entitlement: async () => (allowed ? { allowed: true } : { allowed: false, code: 'UPGRADE_REQUIRED', message: 'Automatic marking is part of the GO, PRO and Institution plans.', upgradeUrl: '/upgrade?reason=marking' }) });
  const exam = await gated.createExam(user, { title: 'Gated quiz' });
  await gated.setSchemeJson(user, exam.id, SCHEME, { confirm: true });
  await gated.addSubmissions(user, exam.id, [{ name: 'C002.pdf', buffer: C002_PDF }]);
  await gated.startMarking(user, exam.id);
  for (let i = 0; i < 600; i++) {
    const r = (await gated.load(user, exam.id)).runs[0];
    if (['completed', 'completed_with_warnings', 'failed'].includes(r.state)) break;
    await new Promise((res) => setTimeout(res, 50));
  }
  allowed = false;
  await assert.rejects(gated.startMarking(user, exam.id, { remarkAll: true }), (e: any) => e.code === 'UPGRADE_REQUIRED' && e.status === 402 && e.details?.upgradeUrl === '/upgrade?reason=marking');
  await assert.rejects(gated.requestRemark(user, exam.id, 'C002', null, 'again'), (e: any) => e.code === 'UPGRADE_REQUIRED');
  await assert.rejects(gated.draftScheme(user, exam.id), (e: any) => e.code === 'UPGRADE_REQUIRED');
  await assert.rejects(gated.submitSchemeDocuments(user, exam.id, { scheme: [{ name: 'scheme.txt', buffer: Buffer.from('1. (3 marks)') }] }), (e: any) => e.code === 'UPGRADE_REQUIRED');
  // A transcription correction is the teacher's own data: saved, but the AI re-mark is skipped and explained.
  const fix = await gated.correctTranscription(user, exam.id, { submission: 'C002' }, { from: 'x = 6 - 2 = 5', to: 'x = 6 - 2 = 4' });
  assert.equal(fix.jobId, null);
  assert.match((fix as any).remarkSkipped, /GO, PRO and Institution/);
  // Viewing existing results stays available.
  assert.ok((await gated.candidateView(user, exam.id, 'C002')).submission);
  // The chat explains instead of failing.
  const gatedChat = createExamChat({ service: gated, fileStore, queue: gatedQueue, contexts: new OwnedRecordStore<ExamChatContext>(path.join(root, 'ctx-gated')), agent: () => target, waitMs: 5_000 });
  const reply = await gatedChat.handle(user, 'Mark these scripts with this marking scheme', [{ name: 'marking-scheme.txt', buffer: Buffer.from('1. Solve (3 marks)') }, { name: 'C001.pdf', buffer: C001_PDF }]);
  assert.match(reply?.text ?? '', /GO, PRO and Institution/);
  await gatedQueue.stop();
});

test('preferences: strict marking reaches the marker, corrections can be turned off, chat sets both', async () => {
  assert.match(preferenceLines({ credit: 'strict', feedback: 'brief' }), /strict marking/);
  assert.match(preferenceLines({ credit: 'partial', feedback: 'detailed' }), /partial credit[\s\S]*detailed feedback[\s\S]*never override the official marking scheme/);
  assert.deepEqual(parseCommand('mark strictly please, and no corrections'), { action: 'preferences', credit: 'strict', corrections: false });
  assert.deepEqual(parseCommand('give partial credit with detailed feedback'), { action: 'preferences', credit: 'partial', feedback: 'detailed' });
  assert.deepEqual(parseCommand('stop the marking'), { action: 'cancel' });
  const user = 'teacher-prefs';
  const exam = await exams.createExam(user, { title: 'Strict quiz' });
  await exams.setSchemeJson(user, exam.id, SCHEME, { confirm: true });
  await exams.addSubmissions(user, exam.id, [{ name: 'C002.pdf', buffer: C002_PDF }]);
  const p = await exams.setPreferences(user, exam.id, { credit: 'strict', corrections: false });
  assert.deepEqual([p.credit, p.corrections, p.feedback], ['strict', false, 'brief']);
  await assert.rejects(exams.setPreferences(user, exam.id, { credit: 'lenient' as any }), (e: any) => e.code === 'INVALID_PREFERENCES');
  const before = calls.markPrompts.length;
  await exams.startMarking(user, exam.id);
  const done = await waitRun(user, exam.id);
  assert.ok(calls.markPrompts.slice(before).every((pr) => /TEACHER PREFERENCE - strict marking/.test(pr)), 'the marker was told to mark strictly');
  // C002 lost marks on Q1, but with corrections off no red correction is drawn.
  const pdf = (await fileStore.read(done.artifacts[0].candidatePdfs[done.submissions[0].id], user)).data;
  assert.doesNotMatch(await pdfText(pdf), /Correction:|x = 6 - 2 = 4/);
  const events = (await exams.eventsSince(user, exam.id, 0)).events;
  assert.match(events.find((e) => e.type === 'job_created')!.message, /strict marking/);
});

test('cancel: stops the run, finished scripts keep their marks, the rest wait and marking can resume', async () => {
  const user = 'teacher-cancel';
  const exam = await exams.createExam(user, { title: 'Cancel quiz' });
  await exams.setSchemeJson(user, exam.id, SCHEME, { confirm: true });
  await exams.addSubmissions(user, exam.id, [{ name: 'C001.pdf', buffer: C001_PDF }, { name: 'C002.pdf', buffer: C002_PDF }]);
  await assert.rejects(exams.cancelRun(user, exam.id), (e: any) => e.code === 'NO_ACTIVE_RUN');
  await exams.startMarking(user, exam.id);
  const r = await exams.cancelRun(user, exam.id);
  assert.equal(r.state, 'cancelled');
  const e1 = await exams.load(user, exam.id);
  assert.equal(e1.runs[0].state, 'cancelled');
  assert.ok(e1.submissions.every((s) => ['queued', 'completed', 'completed_with_warnings'].includes(s.state)), 'unfinished scripts wait, finished ones keep their marks');
  const ev = (await exams.eventsSince(user, exam.id, 0)).events.find((x) => x.type === 'job_cancelled');
  assert.ok(ev && ev.progress?.total === 2);
  // Let any in-flight attempt settle, then resume: a new run marks what is left.
  await new Promise((res) => setTimeout(res, 300));
  await exams.startMarking(user, exam.id);
  const done = await waitRun(user, exam.id);
  assert.ok(done.submissions.every((s) => s.state === 'completed' || s.state === 'completed_with_warnings'));
});

test('PDF check: a marked PDF must open, render, show red ink and carry the stored total', async () => {
  const user = 'teacher-live';
  const e = (await exams.listExams(user))[0];
  const exam = await exams.load(user, e.examId ?? (e as any).id);
  const sub = exam.submissions.find((s) => s.candidateId === 'C001')!;
  const pdf = (await fileStore.read(exam.artifacts[0].candidatePdfs[sub.id], user)).data;
  const good = { candidateId: 'C001', revision: exam.artifacts[0].resultRevision, sourcePages: 1, total: 5, maxTotal: 5, placedMarks: 2 };
  assert.deepEqual((await verifyMarkedPdf(pdf, good)).problems, []);
  const wrongTotal = await verifyMarkedPdf(pdf, { ...good, total: 4 });
  assert.equal(wrongTotal.ok, false);
  assert.match(wrongTotal.problems.join(' '), /total:4\/5/);
  assert.equal((await verifyMarkedPdf(Buffer.from('%PDF-1.4 broken'), good)).ok, false);
  // An unmarked copy of the script (no red ink, no summary) fails.
  const plain = await verifyMarkedPdf(C001_PDF, good);
  assert.equal(plain.ok, false);
});

test('cancel race: work still finishing from a cancelled run never blocks or changes the next run', async () => {
  const user = 'teacher-race';
  const exam = await exams.createExam(user, { title: 'Race quiz' });
  await exams.setSchemeJson(user, exam.id, SCHEME, { confirm: true });
  await exams.addSubmissions(user, exam.id, [{ name: 'C001.pdf', buffer: C001_PDF }, { name: 'C002.pdf', buffer: C002_PDF }]);
  let release!: () => void;
  calls.markGate = new Promise<void>((r) => { release = r; });
  try {
    await exams.startMarking(user, exam.id);
    // Wait until the first run is inside the marker, then cancel it and start again while it is still busy.
    for (let i = 0; i < 400 && !(await exams.eventsSince(user, exam.id, 0)).events.some((e) => e.type === 'question_marking_started'); i++) await new Promise((r) => setTimeout(r, 25));
    const first = (await exams.load(user, exam.id)).runs[0].id;
    await exams.cancelRun(user, exam.id);
    await exams.startMarking(user, exam.id);
  } finally {
    release();
    calls.markGate = null;
  }
  const done = await waitRun(user, exam.id);
  assert.equal(done.runs.length, 2);
  assert.equal(done.runs[0].state, 'cancelled', 'the cancelled run stays cancelled');
  assert.ok(['completed', 'completed_with_warnings'].includes(done.runs[1].state));
  for (const s of done.submissions) {
    assert.ok(['completed', 'completed_with_warnings'].includes(s.state), `${s.candidateId} finished`);
    assert.equal(done.results[s.id].runId, done.runs[1].id, 'marks come from the new run only');
  }
});

test('resume: a script already marked by this run but left in a working state finishes instead of looping', async () => {
  const user = 'teacher-stale';
  const exam = await exams.createExam(user, { title: 'Stale state quiz' });
  await exams.setSchemeJson(user, exam.id, SCHEME, { confirm: true });
  await exams.addSubmissions(user, exam.id, [{ name: 'C001.pdf', buffer: C001_PDF }]);
  await exams.startMarking(user, exam.id);
  const marked = await waitRun(user, exam.id);
  const runId = marked.runs[0].id;
  // What a late write from a cancelled run's leftover work leaves behind: marks from this run, status "marking".
  await exams.mutate(user, exam.id, (e) => { e.runs[0].state = 'marking'; e.submissions[0].state = 'marking'; });
  await queue.submit({ type: 'exam.mark', ownerId: user, payload: { examId: exam.id, runId, segment: 7 }, idempotencyKey: `${runId}:7`, maxAttempts: 1 });
  const done = await waitRun(user, exam.id);
  assert.equal(done.submissions[0].state, 'completed');
  assert.ok(['completed', 'completed_with_warnings'].includes(done.runs[0].state));
  assert.ok(done.runs[0].jobIds.length <= 2, 'no chain of continuation jobs');
});

test('incremental marking focuses context and resumes only validated same-run checkpoints', async () => {
  const scheme = validateScheme(SCHEME).scheme!;
  const match = matchAnswers(docOf([[{ id: 'e1', text: '1. x = 4 unrelated-secret' }, { id: 'e2', text: '2. 3 x 5 = 15' }]]), [], scheme);
  let requests = 0;
  const focused: ProviderAdapter = { name: 'focused', async *stream(req) { requests++; assert.ok(!textOf(req).includes('unrelated-secret')); yield* adapter.stream(req); } };
  const options = { scheme, questionIds: ['Q2'], match, runId: 'checkpoint', schemeVersion: 1, chunkSize: 1 };
  const first = await markCandidate(focused, 'fake', options);
  const resumed = await markCandidate(focused, 'fake', { ...options, checkpoints: first.marks });
  assert.equal(requests, 1);
  assert.deepEqual(resumed.marks, first.marks);
  await markCandidate(focused, 'fake', { ...options, runId: 'new-run', checkpoints: first.marks });
  assert.equal(requests, 2);
});

test('groups of questions are marked at the same time, with the whole scheme sent first as cached shared text', async () => {
  const scheme = validateScheme(SCHEME).scheme!;
  const match = matchAnswers(docOf([[{ id: 'e1', text: '1. x = 4' }, { id: 'e2', text: '2. 3 x 5 = 15' }]]), [], scheme);
  let inFlight = 0;
  let peak = 0;
  const shared: string[] = [];
  const parallel: ProviderAdapter = {
    name: 'parallel',
    async *stream(req) {
      const parts = req.messages[1].content as any[];
      assert.ok(Array.isArray(parts) && parts[0].cache === true, 'the scheme goes first, marked for caching');
      shared.push(parts[0].text);
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 40));
      inFlight--;
      yield* adapter.stream(req);
    },
  };
  const out = await markCandidate(parallel, 'fake', { scheme, questionIds: ['Q1', 'Q2'], match, runId: 'parallel', schemeVersion: 1, chunkSize: 1 });
  assert.equal(peak, 2, 'both questions were marked at once');
  assert.equal(new Set(shared).size, 1, 'every call shares the same cached text');
  assert.match(shared[0], /QUESTION Q1[\s\S]*QUESTION Q2/, 'the whole scheme is in the shared text');
  assert.equal(out.marks.Q1.awardedMarks, 3);
  assert.equal(out.marks.Q2.awardedMarks, 2);
});

test('live work counters count persisted questions, expose active work and separate failures', async () => {
  const exam = await exams.createExam('progress-teacher', { title: 'Progress' });
  await exams.setSchemeJson('progress-teacher', exam.id, SCHEME, { confirm: true });
  await exams.addSubmissions('progress-teacher', exam.id, [{ name: 'C001.pdf', buffer: C001_PDF }]);
  const loaded = await exams.load('progress-teacher', exam.id);
  loaded.submissions[0].state = 'marking';
  loaded.submissions[0].activity = { questionId: 'Q2', at: new Date().toISOString() };
  const work = exams.progress(loaded).work;
  assert.equal(work.totalQuestions, 2);
  assert.equal(work.savedQuestions, 0);
  assert.equal(work.active[0].question, '2');
  assert.equal(work.percent, 0);
});

test('criterion evidence places separate red symbols next to working without duplicating summary symbols', async () => {
  const scheme = validateScheme(SCHEME).scheme!;
  const doc = docOf([[{ id: 'e1', text: '1. x + 2 = 6' }, { id: 'e2', text: 'x = 4' }]]);
  const match = matchAnswers(doc, [], scheme);
  const marked = await markCandidate(adapter, 'fake', { scheme, questionIds: ['Q1'], match, runId: 'layout-step', schemeVersion: 1 });
  const ai = marked.marks.Q1;
  ai.criterionResults[0].evidenceElementIds = ['p1-e1'];
  ai.criterionResults[1].evidenceElementIds = ['p1-e2'];
  const result: CandidateResult = { submissionId: 's', candidateId: 'c', runId: 'layout-step', schemeVersion: 1, updatedAt: '', usage: marked.usage,
    questions: [{ questionId: 'Q1', number: '1', maxMarks: 3, ai, override: null, confirmed: null, mappedElementIds: ['p1-e1', 'p1-e2'], mappingFlags: [], history: [] }] };
  const layout = computeLayout(doc, result, { total: 3, maxTotal: 3 });
  const steps = layout.items.filter(i => i.id.includes(':criterion:'));
  assert.equal(steps.length, 2);
  assert.ok(steps.every(i => i.placed && i.fx >= 0.6));
  assert.ok(steps[0].fy < steps[1].fy);
  assert.deepEqual(layout.items.find(i => i.id === 'Q1:mark')!.symbols, []);
});

test('overnight: the run goes to the overnight queue, every model call runs in batch mode, credits are charged at half price', async () => {
  const nightQueue = new FileJobQueue({ storageDir: path.join(root, 'night-jobs'), concurrency: 1, retryDelayMs: 20, deadlineMs: 60_000 });
  const usage: Array<{ what: string; batch?: boolean }> = [];
  const night = createExamService({ fileStore, queue, overnightQueue: nightQueue, store: new OwnedRecordStore<ExamRecord>(path.join(root, 'night-exams')), documents, agent: () => target, visionAvailable: () => true, maxPages: 5, retryDelayMs: 10, forbiddenStrings: [root], onUsage: (_u, x) => usage.push(x) });
  const seen: boolean[] = [];
  const stream = adapter.stream;
  adapter.stream = (req) => { seen.push(isOvernight()); return stream.call(adapter, req); };
  try {
    const user = 'teacher-night';
    const exam = await night.createExam(user, { title: 'Algebra quiz' });
    await night.setSchemeJson(user, exam.id, SCHEME, { confirm: true });
    await night.addSubmissions(user, exam.id, [{ name: 'C001.pdf', buffer: await scriptPdf('C001') }]);
    await night.setPreferences(user, exam.id, { overnight: true });
    const started = await night.startMarking(user, exam.id);
    assert.ok(await nightQueue.get(started.jobId, user), 'the job is on the overnight queue');
    assert.equal(await queue.get(started.jobId, user), null, 'not on the live queue');
    let e = await night.load(user, exam.id);
    for (let i = 0; i < 600 && !['completed', 'completed_with_warnings', 'failed'].includes(e.runs[0].state); i++) { await new Promise((r) => setTimeout(r, 50)); e = await night.load(user, exam.id); }
    assert.equal(e.runs[0].mode, 'overnight');
    assert.equal(e.runs[0].state, 'completed');
    assert.ok(seen.length >= 2 && seen.every(Boolean), 'recognition and marking both ran in batch mode');
    assert.deepEqual(usage.map((u) => [u.what, u.batch]), [['mark', true]]);
    assert.match(e.events!.find((x) => x.type === 'job_created')!.message, /overnight at half price/);
  } finally {
    adapter.stream = stream;
    await nightQueue.stop();
  }
});
