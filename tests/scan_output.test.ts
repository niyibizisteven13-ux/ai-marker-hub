import test from 'node:test';
import assert from 'node:assert/strict';
import { validateScanGradeOutput } from '../server/services/ai/scanOutput.js';

const validOutput = {
  detectedStudentName: 'Sample Name',
  studentId: null,
  ocrTranscript: "The student's transcribed answer.",
  totalAwardedMarks: 4,
  maxTotalMarks: 5,
  overallFeedback: 'The answer identifies the key concept.',
  confidence: 87,
  flags: [],
  questions: [{
    number: 'Q1',
    questionText: 'Explain the concept.',
    studentAnswer: 'The response cites the correct concept.',
    awardedMarks: 4,
    maxMarks: 5,
    feedback: 'One detail is missing.',
    flag: 'none',
  }],
};

test('scan output validation preserves only supplied evidence and never fabricates defaults', () => {
  const valid = validateScanGradeOutput(validOutput);
  assert.ok(valid);
  assert.equal(valid.studentId, null);
  assert.equal(valid.percentage, 80);
  assert.equal(validateScanGradeOutput({ ...validOutput, studentId: undefined }), null);
  assert.equal(validateScanGradeOutput({ ...validOutput, ocrTranscript: '' }), null);
  assert.equal(validateScanGradeOutput({ ...validOutput, overallFeedback: null }), null);
  assert.equal(validateScanGradeOutput({ ...validOutput, questions: [] }), null);
  assert.equal(validateScanGradeOutput({ ...validOutput, totalAwardedMarks: 6 }), null);
  assert.equal(validateScanGradeOutput({ ...validOutput, totalAwardedMarks: null }), null);
  assert.equal(validateScanGradeOutput({ ...validOutput, maxTotalMarks: '5' }), null);
  assert.equal(validateScanGradeOutput({ ...validOutput, questions: [{ ...validOutput.questions[0], awardedMarks: 3 }] }), null);
  assert.equal(validateScanGradeOutput({ ...validOutput, flags: [42] }), null);
});
