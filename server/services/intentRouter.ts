export type MessageIntent = 'grading' | 'selection_scoring' | 'general_assist' | 'farming_advice';

const GRADING_KEYWORDS = /\b(grade|mark|marking|score|evaluate|assess|review|feedback|rubric|submission|re-grade|correction)\b/i;
const SCORING_KEYWORDS = /\b(applicant|candidate|hiring|recruitment|selection|scoring|ranking|interviewee|shortlist)\b/i;
const FARMING_KEYWORDS = /\b(crop|farm|farming|maize|beans|cassava|coffee|tea|potatoes|bananas|soil|fertilizer|pest|disease|rab|agronomist)\b/i;
const SMALL_TALK = /^(?:hi|hello|hey|howdy|good morning|good afternoon|good evening|how are you(?: doing)?|how['’]s it going|what['’]s up|nice to meet you|thanks|thank you|bonjour|bonsoir|salut|coucou|ça va|ca va|comment ça va|comment allez-vous|merci|muraho|mwaramutse|mwiriwe|amakuru|uraho|urakoze)[.!?,\s]*$/i;

export function isSmallTalkMessage(message: string, hasAttachment = false): boolean {
  if (hasAttachment) return false;
  const normalized = message.trim().normalize('NFC');
  return normalized.length <= 80 && SMALL_TALK.test(normalized);
}

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
