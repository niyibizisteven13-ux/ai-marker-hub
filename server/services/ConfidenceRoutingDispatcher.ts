import logger from '../utils/logger.js';

export type QuestionType = 'mcq' | 'essay' | 'short_answer' | 'math' | 'coding';

export interface ModelRoutingDecision {
  model: string;
  provider: 'anthropic' | 'openai' | 'ollama' | 'gemini';
  reason: string;
}

export class ConfidenceRoutingDispatcher {
  private static instance: ConfidenceRoutingDispatcher;

  private constructor() {}

  public static getInstance(): ConfidenceRoutingDispatcher {
    if (!ConfidenceRoutingDispatcher.instance) {
      ConfidenceRoutingDispatcher.instance = new ConfidenceRoutingDispatcher();
    }
    return ConfidenceRoutingDispatcher.instance;
  }

  public routeQuestion(questionType: QuestionType, difficulty: 'easy' | 'medium' | 'hard' = 'medium'): ModelRoutingDecision {
    switch (questionType) {
      case 'mcq':
      case 'short_answer':
        return {
          model: 'claude-3-5-haiku-20241022',
          provider: 'anthropic',
          reason: 'MCQs and structured short answers require high speed and low cost; Haiku is optimal.',
        };
      case 'essay':
      case 'math':
      case 'coding':
        if (difficulty === 'hard') {
          return {
            model: 'claude-3-5-sonnet-20241022',
            provider: 'anthropic',
            reason: 'Complex essay, advanced math, or coding evaluations require superior reasoning; Sonnet is selected.',
          };
        }
        return {
          model: 'claude-3-5-haiku-20241022',
          provider: 'anthropic',
          reason: 'Standard essay/math evaluation handled efficiently by Haiku.',
        };
      default:
        return {
          model: 'claude-3-5-haiku-20241022',
          provider: 'anthropic',
          reason: 'Default fallback to Haiku for cost efficiency.',
        };
    }
  }

  public routeBatch(questions: Array<{ id: string; type: QuestionType; difficulty?: 'easy' | 'medium' | 'hard' }>): Map<string, ModelRoutingDecision> {
    const routingMap = new Map<string, ModelRoutingDecision>();
    for (const q of questions) {
      routingMap.set(q.id, this.routeQuestion(q.type, q.difficulty || 'medium'));
    }
    logger.info(`[ConfidenceRoutingDispatcher] Routed ${questions.length} questions across models.`);
    return routingMap;
  }
}
