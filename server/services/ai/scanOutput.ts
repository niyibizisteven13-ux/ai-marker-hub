export interface ValidScanGrade {
  detectedStudentName: string | null;
  studentId: string | null;
  ocrTranscript: string;
  totalAwardedMarks: number;
  maxTotalMarks: number;
  percentage: number;
  overallFeedback: string;
  confidence: number;
  flags: string[];
  questions: Array<{
    number: string;
    questionText: string;
    studentAnswer: string;
    awardedMarks: number;
    maxMarks: number;
    feedback: string;
    flag: string;
  }>;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export function validateScanGradeOutput(value: unknown): ValidScanGrade | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  const nullableModelText = (field: string) => {
    if (!Object.hasOwn(result, field)) return undefined;
    const item = result[field];
    return item === null || (typeof item === 'string' && item.trim().length > 0);
  };
  const awarded = result.totalAwardedMarks;
  const maximum = result.maxTotalMarks;
  const confidence = result.confidence;
  if (
    !nonEmpty(result.ocrTranscript) ||
    !nonEmpty(result.overallFeedback) ||
    nullableModelText('detectedStudentName') === undefined ||
    !nullableModelText('detectedStudentName') ||
    nullableModelText('studentId') === undefined ||
    !nullableModelText('studentId') ||
    !isStringArray(result.flags) ||
    typeof awarded !== 'number' ||
    !Number.isFinite(awarded) ||
    typeof maximum !== 'number' ||
    !Number.isFinite(maximum) ||
    maximum <= 0 ||
    awarded < 0 ||
    awarded > maximum ||
    typeof confidence !== 'number' ||
    !Number.isFinite(confidence) ||
    confidence < 0 ||
    confidence > 100 ||
    !Array.isArray(result.questions) ||
    result.questions.length === 0
  ) {
    return null;
  }

  const questions = result.questions.map((question): ValidScanGrade['questions'][number] | null => {
    if (!question || typeof question !== 'object' || Array.isArray(question)) return null;
    const item = question as Record<string, unknown>;
    const questionAwarded = item.awardedMarks;
    const questionMaximum = item.maxMarks;
    if (
      !nonEmpty(item.number) ||
      !nonEmpty(item.questionText) ||
      !nonEmpty(item.studentAnswer) ||
      !nonEmpty(item.feedback) ||
      !nonEmpty(item.flag) ||
      typeof questionAwarded !== 'number' ||
      !Number.isFinite(questionAwarded) ||
      typeof questionMaximum !== 'number' ||
      !Number.isFinite(questionMaximum) ||
      questionMaximum <= 0 ||
      questionAwarded < 0 ||
      questionAwarded > questionMaximum
    ) {
      return null;
    }
    return {
      number: item.number.trim(),
      questionText: item.questionText.trim(),
      studentAnswer: item.studentAnswer.trim(),
      awardedMarks: questionAwarded,
      maxMarks: questionMaximum,
      feedback: item.feedback.trim(),
      flag: item.flag.trim(),
    };
  });
  const validQuestions = questions.filter(
    (question): question is ValidScanGrade['questions'][number] => question !== null,
  );
  if (validQuestions.length !== questions.length) return null;
  const questionAwardedTotal = validQuestions.reduce((sum, question) => sum + question.awardedMarks, 0);
  const questionMaximumTotal = validQuestions.reduce((sum, question) => sum + question.maxMarks, 0);
  if (Math.abs(questionAwardedTotal - awarded) > 1e-6 || Math.abs(questionMaximumTotal - maximum) > 1e-6) return null;

  const studentName = result.detectedStudentName;
  const studentId = result.studentId;
  return {
    detectedStudentName: typeof studentName === 'string' ? studentName.trim() : null,
    studentId: typeof studentId === 'string' ? studentId.trim() : null,
    ocrTranscript: result.ocrTranscript.trim(),
    totalAwardedMarks: awarded,
    maxTotalMarks: maximum,
    percentage: Math.round((awarded / maximum) * 100),
    overallFeedback: result.overallFeedback.trim(),
    confidence,
    flags: result.flags,
    questions: validQuestions,
  };
}
