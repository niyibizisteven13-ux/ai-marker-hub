export function buildFallbackMarkResults(examPaper: any, studentScript: any) {
  const questions = Array.isArray(examPaper?.questions) ? examPaper.questions : [];
  return questions.map((question: any, index: number) => {
    const answer = Array.isArray(studentScript?.answers)
      ? studentScript.answers.find((entry: any) => entry.questionId === question.id || entry.questionNumber === question.number)
      : null;

    return {
      questionNumber: question.number || `Q${index + 1}`,
      questionId: question.id || `q-${index + 1}`,
      maxMarks: Number(question.maxMarks || 0),
      awardedMarks: 0,
      criteriaBreakdown: [
        {
          criterion: 'AI assistance unavailable',
          marksAvailable: Number(question.maxMarks || 0),
          marksAwarded: 0,
          reason: 'The AI marking service is temporarily unavailable, so marks were not auto-assigned.',
        },
      ],
      feedbackToStudent: 'This response requires manual review because automated marking is temporarily unavailable. Please review the rubric and add teacher feedback manually.',
      flag: 'needs_teacher_review',
    };
  });
}

export function buildFallbackChatReply(query: string, attachmentName?: string, attachmentMimeType?: string) {
  const normalized = (query || '').trim();
  const fileInfo = attachmentName
    ? `File attached: ${attachmentName} (${attachmentMimeType || 'unknown'})\n\n`
    : '';
  return `⚠️ AI Marking Engine Offline\n\n${fileInfo}The AI assistant is temporarily unavailable right now. I can still help you structure the next step manually. ${normalized ? `For your request: "${normalized}"` : 'Please describe the task'}.`;
}
