import { BWENGE_SYSTEM_PROMPT, buildBwengeGradingPrompt } from '../../../src/services/geminiService.js';
import { BWENGE_GENERAL_SYSTEM_PROMPT } from './bwengeGeneralPrompt.js';
import { buildPromptForIntent as buildEffectivePrompt } from '../../../src/utils/buildPromptForIntent.ts';

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
  }
) {
  const hasAttachment = !!(opts.attachmentText || opts.attachmentName);
  const effectiveQuery = buildEffectivePrompt({ userQuery: query, hasAttachment });

  switch (intent) {
    case 'grading':
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
          local agronomist or RAB extension officer.`,
        prompt: effectiveQuery,
      };
    case 'selection_scoring':
      return {
        system: `You are an application/selection scoring assistant. Score submissions against the
          provided rubric and explain your reasoning per criterion.`,
        prompt: effectiveQuery,
      };
    default: {
      const fullPrompt = opts.attachmentText
        ? `ATTACHED DOCUMENT CONTENT:\n${opts.attachmentText}\n\nUSER QUERY:\n${effectiveQuery}`
        : effectiveQuery;
      return {
        system: `${BWENGE_GENERAL_SYSTEM_PROMPT}\n\n${opts.hydratedContext}`,
        prompt: fullPrompt,
      };
    }
  }
}
