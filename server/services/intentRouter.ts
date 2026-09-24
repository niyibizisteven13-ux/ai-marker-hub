export type MessageIntent = 'grading' | 'selection_scoring' | 'general_assist' | 'farming_advice';

const GRADING_KEYWORDS = /\b(grade|mark|marking|score|evaluate|assess|review|feedback|rubric|submission|re-grade|correction)\b/i;
const SCORING_KEYWORDS = /\b(applicant|candidate|hiring|recruitment|selection|scoring|ranking|interviewee|shortlist)\b/i;
const FARMING_KEYWORDS = /\b(crop|farm|farming|maize|beans|cassava|coffee|tea|potatoes|bananas|soil|fertilizer|pest|disease|rab|agronomist)\b/i;

export async function classifyIntent(message: string, hasAttachment: boolean): Promise<MessageIntent> {
  const text = message.toLowerCase();

  // 1. If an image/file IS attached, bypass hardcoded forms and pass directly to dynamic vision model
  if (hasAttachment) {
    // Only route to grading if the user explicitly typed grading/rubric keywords
    if (GRADING_KEYWORDS.test(text)) {
      return 'grading';
    }
    // Default ALL attachment-based queries to general_assist (Vision/Multimodal Extraction)
    return 'general_assist';
  }

  // 2. Strict keyword matching for text-only requests
  if (GRADING_KEYWORDS.test(text)) return 'grading';
  if (SCORING_KEYWORDS.test(text)) return 'selection_scoring';
  if (FARMING_KEYWORDS.test(text)) return 'farming_advice';

  return 'general_assist';
}
