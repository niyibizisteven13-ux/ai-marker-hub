// src/utils/contentAwarePrompt.ts
//
// Assembles context (exam paper + rubric, student submission, teacher-highlighted
// evidence) into prompt-ready text blocks. Kept deliberately separate from the
// system-prompt / persona logic in geminiService.ts so context assembly can be
// unit-tested and reused across providers (Gemini today, Claude once migrated).

export interface RubricCriterion {
  id: string;
  criterion: string;
  marksAvailable: number;
  description?: string;
}

export interface QuestionRubric {
  questionId: string;
  questionNumber: string;
  maxMarks: number;
  criteria: RubricCriterion[];
}

export interface ExamQuestion {
  id: string;
  number: string;
  questionText: string;
  maxMarks: number;
  questionType: 'short_answer' | 'long_answer' | 'multiple_choice' | 'essay' | string;
}

export interface ExamPaper {
  id: string;
  title: string;
  subject: string;
  topic?: string;
  gradeLevel?: string;
  difficulty?: string;
  totalMarks: number;
  durationMinutes?: number;
  questions: ExamQuestion[];
  rubrics: QuestionRubric[];
  createdAt: string;
}

/**
 * Renders an exam paper (with its per-question rubrics) into a plain-text block
 * suitable for inclusion in a grading prompt. Returns '' for a missing exam paper
 * so callers can safely omit the "Exam Context" section rather than branching.
 */
export function buildExamPaperContext(examPaper: ExamPaper | null | undefined): string {
  if (!examPaper) return '';

  const lines: string[] = [];
  lines.push(`Exam Paper: ${examPaper.title}`);
  lines.push(`Subject: ${examPaper.subject}${examPaper.topic ? ` — ${examPaper.topic}` : ''}`);
  if (examPaper.gradeLevel) lines.push(`Grade Level: ${examPaper.gradeLevel}`);
  if (examPaper.difficulty) lines.push(`Difficulty: ${examPaper.difficulty}`);
  lines.push(`Total Marks: ${examPaper.totalMarks}`);
  if (examPaper.durationMinutes) lines.push(`Duration: ${examPaper.durationMinutes} minutes`);
  lines.push('');
  lines.push('Questions:');

  for (const q of examPaper.questions) {
    lines.push(`  Q${q.number} (${q.maxMarks} marks, ${q.questionType}): ${q.questionText}`);
    const rubric = examPaper.rubrics.find(
      (r) => r.questionId === q.id || r.questionNumber === q.number
    );
    if (rubric) {
      lines.push(`  Marking Rubric for Q${q.number} (max ${rubric.maxMarks} marks):`);
      for (const c of rubric.criteria) {
        lines.push(
          `    - ${c.criterion} (${c.marksAvailable} marks)${c.description ? `: ${c.description}` : ''}`
        );
      }
    }
  }

  return lines.join('\n');
}

export interface ContentAwarePromptOptions {
  userQuery: string;
  submissionText?: string;
  submissionName?: string;
  examPaperContext?: string;
  selectedTextContext?: string;
}

/**
 * Combines the teacher's chat query with whichever context blocks are available
 * (exam paper, raw submission, teacher-selected evidence). Sections are omitted
 * cleanly when not supplied, so this is safe to call from any point in the chat
 * flow (e.g. before a document has been uploaded).
 */
export function buildContentAwarePrompt(options: ContentAwarePromptOptions): string {
  const { userQuery, submissionText, submissionName, examPaperContext, selectedTextContext } =
    options;
  const sections: string[] = [];

  sections.push(`User Request: ${userQuery}`);

  if (examPaperContext) {
    sections.push(`--- Exam Context ---\n${examPaperContext}`);
  }

  if (submissionText) {
    sections.push(
      `--- Student Submission${submissionName ? ` (${submissionName})` : ''} ---\n${submissionText}`
    );
  }

  if (selectedTextContext) {
    sections.push(`--- Selected evidence highlighted by the teacher ---\n${selectedTextContext}`);
  }

  return sections.join('\n\n');
}