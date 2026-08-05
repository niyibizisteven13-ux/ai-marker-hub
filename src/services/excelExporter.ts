import ExcelJS from 'exceljs';

/**
 * Shape of a single graded submission as produced by geminiMarker's
 * evaluateStudentSubmission / evaluateBatch functions.
 */
export interface GradedResult {
  assessmentTitle?: string;
  studentId: string | null;
  studentName: string | null;
  identityConfidence?: 'high' | 'medium' | 'low' | 'unknown';
  totalAwardedScore: number;
  maxPossibleScore: number;
  gradedQuestions: Array<{
    questionNumber: string;
    maxMarks: number;
    confidence?: 'high' | 'medium' | 'low';
    criteriaBreakdown: Array<{
      criterion: string;
      marksAwarded: number;
      marksAvailable: number;
      reason: string;
    }>;
    feedbackToStudent: string;
  }>;
  sourceFile?: string | null;
  error?: string;
}

export type ReportStatus = 'Passed' | 'Needs Review' | 'Failed';

export interface StudentResultData {
  studentId: string;
  studentName: string;
  totalScore: number;
  maxScore: number;
  gradePercentage: number;
  status: ReportStatus;
  identityVerified: boolean;
  breakdown: Array<{
    question: string;
    score: number;
    max: number;
    feedback: string;
    confidence?: 'high' | 'medium' | 'low';
  }>;
}

export interface MappingOptions {
  /** Fraction (0-1) at or above which a confidently-identified, fully-graded submission counts as Passed. Default 0.5. */
  passThreshold?: number;
}

const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } };
const HEADER_ALIGNMENT: Partial<ExcelJS.Alignment> = { vertical: 'middle', horizontal: 'center' };
const SUMMARY_HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD97706' } };
const DETAIL_HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
const LOW_CONFIDENCE_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };

const STATUS_COLORS: Record<ReportStatus, string> = {
  Passed: 'FF10B981',
  'Needs Review': 'FFF59E0B',
  Failed: 'FFEF4444',
};

/**
 * Converts one raw graded result from the marker into the flatter shape
 * the Excel report is built from — deciding pass/fail/review status along
 * the way.
 *
 * Rules, in priority order:
 * 1. A grading error, or a missing/unconfident student identity, always
 *    forces "Needs Review" — a score should never be reported as Passed
 *    or Failed against a submission we can't confidently attribute to a
 *    real student.
 * 2. If any individual question was graded with low AI confidence, the
 *    whole submission is flagged "Needs Review" rather than trusted at
 *    face value.
 * 3. Otherwise, status is Passed/Failed purely based on gradePercentage
 *    vs. passThreshold.
 */
function mapGradedResultToStudentData(
  result: GradedResult,
  options: MappingOptions = {},
): StudentResultData {
  const passThreshold = options.passThreshold ?? 0.5;

  const identityVerified =
    !!result.studentId &&
    !!result.studentName &&
    result.identityConfidence !== 'low' &&
    result.identityConfidence !== 'unknown';

  const hasLowConfidenceQuestion = (result.gradedQuestions ?? []).some(
    (q) => q.confidence === 'low',
  );

  const gradePercentage =
    result.maxPossibleScore > 0 ? result.totalAwardedScore / result.maxPossibleScore : 0;

  let status: ReportStatus;
  if (result.error || !identityVerified || hasLowConfidenceQuestion) {
    status = 'Needs Review';
  } else {
    status = gradePercentage >= passThreshold ? 'Passed' : 'Failed';
  }

  const breakdown = (result.gradedQuestions ?? []).map((q) => ({
    question: q.questionNumber,
    score: q.criteriaBreakdown.reduce((sum, c) => sum + c.marksAwarded, 0),
    max: q.maxMarks,
    feedback: result.error ? `Grading failed: ${result.error}` : q.feedbackToStudent,
    confidence: q.confidence,
  }));

  return {
    studentId: result.studentId ?? 'UNVERIFIED',
    studentName: result.studentName ?? 'UNVERIFIED — needs manual entry',
    totalScore: result.totalAwardedScore,
    maxScore: result.maxPossibleScore,
    gradePercentage,
    status,
    identityVerified,
    breakdown,
  };
}

/** Maps a whole batch of raw graded results to report-ready student data. */
export function mapGradedResultsToStudentData(
  results: GradedResult[],
  options: MappingOptions = {},
): StudentResultData[] {
  return results.map((r) => mapGradedResultToStudentData(r, options));
}

function styleHeaderRow(worksheet: ExcelJS.Worksheet, fill: ExcelJS.Fill, lastColumnLetter: string) {
  const headerRow = worksheet.getRow(1);
  headerRow.font = HEADER_FONT;
  headerRow.fill = fill;
  headerRow.alignment = HEADER_ALIGNMENT;
  headerRow.height = 20;
  worksheet.autoFilter = { from: 'A1', to: `${lastColumnLetter}1` };
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
}

function buildSummarySheet(workbook: ExcelJS.Workbook, results: StudentResultData[]) {
  const sheet = workbook.addWorksheet('Class Master Summary');

  sheet.columns = [
    { header: 'Student ID', key: 'studentId', width: 18 },
    { header: 'Student Name', key: 'studentName', width: 28 },
    { header: 'Score Obtained', key: 'totalScore', width: 16 },
    { header: 'Max Score', key: 'maxScore', width: 12 },
    { header: 'Percentage (%)', key: 'gradePercentage', width: 16 },
    { header: 'Status', key: 'status', width: 14 },
  ];

  results.forEach((res) => {
    const row = sheet.addRow({
      studentId: res.studentId,
      studentName: res.studentName,
      totalScore: res.totalScore,
      maxScore: res.maxScore,
      gradePercentage: res.gradePercentage,
      status: res.status,
    });
    row.getCell('gradePercentage').numFmt = '0.0%';

    const statusCell = row.getCell('status');
    statusCell.font = { color: { argb: STATUS_COLORS[res.status] }, bold: true };

    if (!res.identityVerified) {
      row.eachCell((cell) => {
        cell.fill = LOW_CONFIDENCE_FILL;
      });
    }
  });

  styleHeaderRow(sheet, SUMMARY_HEADER_FILL, 'F');

  // Class average — computed in JS (not a live Excel formula) so it can
  // correctly exclude submissions flagged "Needs Review" or with grading
  // errors, which would otherwise skew a simple AVERAGE() range.
  const gradeable = results.filter((r) => r.status !== 'Needs Review');
  const reviewCount = results.length - gradeable.length;

  if (results.length > 0) {
    sheet.addRow([]);

    if (gradeable.length > 0) {
      const avgScore =
        gradeable.reduce((sum, r) => sum + r.totalScore, 0) / gradeable.length;
      const avgPercentage =
        gradeable.reduce((sum, r) => sum + r.gradePercentage, 0) / gradeable.length;

      const avgRow = sheet.addRow(['', 'Class average (confidently graded)', avgScore, '', avgPercentage, '']);
      avgRow.font = { bold: true };
      avgRow.getCell(5).numFmt = '0.0%';
    }

    if (reviewCount > 0) {
      const flagRow = sheet.addRow(['', `Flagged for review`, '', '', '', `${reviewCount} submission(s)`]);
      flagRow.font = { italic: true, color: { argb: STATUS_COLORS['Needs Review'] } };
    }
  }

  return sheet;
}

function buildDetailSheet(workbook: ExcelJS.Workbook, results: StudentResultData[]) {
  const sheet = workbook.addWorksheet('Detailed Item Feedback');

  sheet.columns = [
    { header: 'Student Name', key: 'studentName', width: 24 },
    { header: 'Question', key: 'question', width: 14 },
    { header: 'Confidence', key: 'confidence', width: 12 },
    { header: 'Marks Given', key: 'score', width: 12 },
    { header: 'Max Marks', key: 'max', width: 12 },
    { header: 'AI Feedback / Notes', key: 'feedback', width: 58 },
  ];

  results.forEach((res) => {
    res.breakdown.forEach((item) => {
      const row = sheet.addRow({
        studentName: res.studentName,
        question: item.question,
        confidence: item.confidence ?? 'n/a',
        score: item.score,
        max: item.max,
        feedback: item.feedback,
      });

      if (item.confidence === 'low' || !res.identityVerified) {
        row.eachCell((cell) => {
          cell.fill = LOW_CONFIDENCE_FILL;
        });
      }
    });
  });

  styleHeaderRow(sheet, DETAIL_HEADER_FILL, 'F');

  return sheet;
}

/**
 * Builds a formatted two-sheet Excel workbook (class summary + per-question
 * detail) from already-mapped StudentResultData and returns it as a Buffer.
 */
export async function generateBatchExcelReport(
  batchTitle: string,
  results: StudentResultData[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Bwenge AI Automated Evaluator';
  workbook.created = new Date();
  workbook.subject = 'Automated grading report';
  workbook.category = 'Assessment';
  workbook.title = batchTitle;

  buildSummarySheet(workbook, results);
  buildDetailSheet(workbook, results);

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * Convenience one-call path: takes raw grading output straight from
 * geminiMarker (evaluateBatch), maps it to report data, and returns the
 * finished Excel buffer — no manual mapping step needed by the caller.
 */
export async function generateBatchExcelReportFromGradedResults(
  batchTitle: string,
  gradedResults: GradedResult[],
  options: MappingOptions = {},
): Promise<Buffer> {
  const mapped = mapGradedResultsToStudentData(gradedResults, options);
  return generateBatchExcelReport(batchTitle, mapped);
}

/**
 * Same as generateBatchExcelReport, but writes directly to disk and
 * returns the file path — handy for CLI/batch-job usage.
 */
export async function writeBatchExcelReport(
  batchTitle: string,
  results: StudentResultData[],
  outputPath: string,
): Promise<string> {
  const buffer = await generateBatchExcelReport(batchTitle, results);
  const fs = await import('fs/promises');
  await fs.writeFile(outputPath, buffer);
  return outputPath;
}