import { BWENGE_SYSTEM_PROMPT, buildBwengeGradingPrompt } from '../../../src/services/geminiService.js';
import { BWENGE_CHAT_RESPONSE_RULES, BWENGE_GENERAL_SYSTEM_PROMPT } from './bwengeGeneralPrompt.js';
import { buildPromptForIntent as buildEffectivePrompt } from '../../../src/utils/buildPromptForIntent.ts';
import { buildLanguageBlock, detectLanguage, type QueryLanguage } from './kinyarwandaStyle.js';

/**
 * Shared intent -> {system, prompt} prompt builder used by web chat (/api/ai/chat)
 * and Telegram bot routes to prevent logic drift between surfaces.
 */
export function buildPromptForIntent(
  intent: string,
  query: string,
  opts: {
    attachmentText?: string;
    attachmentName?: string;
    examContext?: any;
    selectedEvidence?: any;
    hydratedContext: string;
    /** Override auto-detection (for example when the Telegram or UI layer already knows the language). */
    language?: QueryLanguage;
    /** Short native-speaker-approved Kinyarwanda examples, e.g. top approved items from the admin dataset curator. */
    styleExemplars?: string;
  }
) {
  const hasAttachment = !!(opts.attachmentText || opts.attachmentName);
  const effectiveQuery = buildEffectivePrompt({ userQuery: query, hasAttachment });

  // Detect on the user's own words, not on the wrapped prompt or attachment text.
  const language = opts.language ?? detectLanguage(query);
  const languageBlock = buildLanguageBlock(language, opts.styleExemplars);

  switch (intent) {
    case 'grading':
      // Intentionally unchanged: grading output format and feedback language are
      // controlled by BWENGE_SYSTEM_PROMPT, and appending a language rule here
      // could change the grading format.
      return {
        system: `${BWENGE_SYSTEM_PROMPT}\n\n${opts.hydratedContext}`,
        prompt: buildBwengeGradingPrompt(
          effectiveQuery,
          opts.attachmentText,
          opts.attachmentName,
          opts.examContext,
          opts.selectedEvidence,
          hasAttachment
        ),
      };
    case 'farming_advice':
      return {
        system: `You are an agricultural advisor for Rwandan farmers. Give practical, actionable advice
          for common crops (maize, beans, cassava, coffee, tea, potatoes, bananas). Keep answers short
          and specific. If symptoms suggest a serious disease/pest outbreak, recommend contacting a
          local agronomist or RAB extension officer.

          ${languageBlock}`,
        prompt: effectiveQuery,
      };
    case 'selection_scoring':
      return {
        system: `You are an application/selection scoring assistant. Score submissions against the
          provided rubric and explain your reasoning per criterion.

          ${languageBlock}`,
        prompt: effectiveQuery,
      };
    default: {
      const fullPrompt = opts.attachmentText
        ? `ATTACHED DOCUMENT CONTENT:\n${opts.attachmentText}\n\nUSER QUERY:\n${effectiveQuery}`
        : effectiveQuery;
      return {
        system: `${BWENGE_GENERAL_SYSTEM_PROMPT}\n\n${opts.hydratedContext}\n\n${languageBlock}\n\n${BWENGE_CHAT_RESPONSE_RULES}`,
        prompt: fullPrompt,
      };
    }
  }
}

export function buildSmallTalkPrompt(query: string) {
  const language = detectLanguage(query);
  return {
    system: `You are Bwenge, a friendly and helpful assistant. Reply naturally in the user's language: Kinyarwanda, English, or French. Keep small-talk replies brief. Say when you are unsure. Do not mention model names, AI providers, adapters, or internal implementation details.\n\n${buildLanguageBlock(language)}`,
    prompt: query,
  };
}