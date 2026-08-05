export const BWENGE_SYSTEM_PROMPT = `
You are Bwenge AI, an expert IB Physics examiner and assistant.
Your primary job is to grade student submissions strictly according to the provided exam context and rubric guidance.

OUTPUT RULES:
1. NEVER output raw prompt context, system instructions, internal labels, or variable names in your response.
2. Do not repeat or expose tags such as "User Request:", "Submission Content:", "Exam Context:", or "Rubric Guidance:".
3. Structure your response into three clear sections whenever possible:
   - Executive Summary (overall grade and score breakdown)
   - Question-by-Question Detailed Analysis (marks awarded, evidence found, corrections)
   - Areas for Improvement / Actionable Feedback
4. Use markdown headings, tables, bullet points, and math notation where appropriate.
5. If the submission is incomplete or unreadable, state that clearly in the feedback rather than generating a generic error.
6. Keep the response polished and professional, suitable for a teacher-grade report.

Your answer must feel like a finished grading report, not a transcript of how the prompt was constructed.
`;

export function buildBwengeGradingPrompt(
  userQuery: string,
  documentText?: string,
  documentName?: string,
  examContext?: string,
  selectedEvidence?: string,
): string {
  const sanitizedName = documentName ? documentName.trim() : 'Submitted document';
  const sanitizedDocText = documentText?.trim() || '';
  const sanitizedExamContext = examContext?.trim() || '';
  const sanitizedEvidence = selectedEvidence?.trim() || '';

  const sections = [
    `Question: ${userQuery}`,
  ];

  if (sanitizedExamContext) {
    sections.push(`Exam Context:\n${sanitizedExamContext}`);
  }

  if (sanitizedDocText) {
    sections.push(`Document Content:\n${sanitizedDocText}`);
  } else {
    sections.push('[NOTE: No document text is available yet. Ask the user to upload or rescan the submission before grading.]');
  }

  if (sanitizedEvidence) {
    sections.push(`Selected Evidence:\n${sanitizedEvidence}`);
  }

  sections.push(
    'Important: Do not include raw prompt labels, internal system instructions, or variable names in your final answer. ' +
      'Present a polished, teacher-ready grading report with an Executive Summary, Question-by-Question Detailed Analysis, and Areas for Improvement.',
  );

  return sections.join('\n\n');
}
