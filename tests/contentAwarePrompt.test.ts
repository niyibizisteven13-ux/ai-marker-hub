import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContentAwarePrompt, buildExamPaperContext } from '../src/utils/contentAwarePrompt.ts';
import { BWENGE_SYSTEM_PROMPT, buildBwengeGradingPrompt } from '../src/services/geminiService.ts';

test('buildExamPaperContext captures the exam structure', () => {
  const context = buildExamPaperContext({
    id: 'exam-1',
    title: 'Physics Midterm',
    subject: 'Physics',
    topic: 'Mechanics',
    gradeLevel: 'Grade 12',
    difficulty: 'Intermediate',
    totalMarks: 50,
    durationMinutes: 60,
    questions: [
      { id: 'q1', number: '1', questionText: 'State Newton\'s second law', maxMarks: 10, questionType: 'short_answer' },
    ],
    rubrics: [
      {
        questionId: 'q1',
        questionNumber: '1',
        maxMarks: 10,
        criteria: [{ id: 'c1', criterion: 'Definition', marksAvailable: 5, description: 'Correct law' }],
      },
    ],
    createdAt: 'now',
  } as any);

  assert.match(context || '', /Physics Midterm/);
  assert.match(context || '', /State Newton's second law/);
  assert.match(context || '', /Definition/);
});

test('buildContentAwarePrompt combines submission and exam context', () => {
  const prompt = buildContentAwarePrompt({
    userQuery: 'Grade this response',
    submissionText: 'The student wrote Newton\'s law accurately.',
    submissionName: 'student-response.txt',
    examPaperContext: 'Exam Paper: Physics Midterm',
    selectedTextContext: 'The answer includes Newton\'s second law.',
  });

  assert.match(prompt, /Grade this response/);
  assert.match(prompt, /student-response.txt/);
  assert.match(prompt, /Exam Paper: Physics Midterm/);
  assert.match(prompt, /selected evidence/i);
});

test('grading prompts instruct the model to return polished structured feedback', () => {
  const prompt = buildBwengeGradingPrompt('Grade this response', 'The student answered with Newton\'s law.', 'student-response.txt');

  assert.match(BWENGE_SYSTEM_PROMPT, /NEVER output raw prompt context/i);
  assert.match(prompt, /Executive Summary/i);
  assert.match(prompt, /Question-by-Question Detailed Analysis/i);
});
