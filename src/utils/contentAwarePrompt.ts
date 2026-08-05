export interface ContentAwarePromptInput {
  userQuery: string;
  submissionText?: string;
  submissionName?: string;
  examPaperContext?: string;
  selectedTextContext?: string;
}

export function buildExamPaperContext(examPaper: any): string | null {
  if (!examPaper) return null;

  const questions = Array.isArray(examPaper.questions) ? examPaper.questions : [];
  const rubrics = Array.isArray(examPaper.rubrics) ? examPaper.rubrics : [];

  const questionLines = questions
    .slice(0, 8)
    .map((question: any) => {
      const maxMarks = question.maxMarks ? ` [${question.maxMarks} marks]` : '';
      const questionText = question.questionText || question.prompt || '';
      return `- ${question.number || question.id}: ${questionText}${maxMarks}`;
    })
    .join('\n');

  const rubricLines = rubrics
    .slice(0, 6)
    .map((rubric: any) => {
      const criteria = Array.isArray(rubric.criteria)
        ? rubric.criteria.map((criterion: any) => `    • ${criterion.criterion || criterion.name}: ${criterion.marksAvailable || ''}`).join('\n')
        : '';
      return `- ${rubric.questionNumber || rubric.questionId}:\n${criteria}`.trim();
    })
    .join('\n');

  const parts = [
    `Exam Paper: ${examPaper.title || examPaper.subject || 'Current assessment'}`,
    `Subject: ${examPaper.subject || 'N/A'}`,
    `Topic: ${examPaper.topic || 'N/A'}`,
    `Total Marks: ${examPaper.totalMarks || 'N/A'}`,
    `Questions:\n${questionLines || '- No question list available.'}`,
  ];

  if (rubricLines) {
    parts.push(`Rubric Guidance:\n${rubricLines}`);
  }

  return parts.join('\n\n');
}

export function buildContentAwarePrompt({
  userQuery,
  submissionText,
  submissionName,
  examPaperContext,
  selectedTextContext,
}: ContentAwarePromptInput): string {
  const sections = [`User Request: ${userQuery}`];

  if (submissionName) {
    sections.push(`Submission: ${submissionName}`);
  }

  if (submissionText && submissionText.trim()) {
    sections.push(`Submission Content:\n${submissionText.trim()}`);
  }

  if (examPaperContext && examPaperContext.trim()) {
    sections.push(`Exam Context:\n${examPaperContext.trim()}`);
  }

  if (selectedTextContext && selectedTextContext.trim()) {
    sections.push(`Selected Evidence:\n${selectedTextContext.trim()}`);
  }

  sections.push(`Instruction: Use the submission content, the exam context, and the selected evidence together. Grade or analyze only what is supported by the provided material, and explicitly mention uncertainty when the evidence is incomplete.`);

  return sections.join('\n\n');
}
