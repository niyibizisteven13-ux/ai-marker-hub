import logger from '../utils/logger.js';

export type QuestionType = 'mcq' | 'essay' | 'short_answer' | 'math' | 'coding';

export interface ModelRoutingDecision {
  model: string;
  provider: 'gonkarouter' | 'anthropic' | 'openai' | 'ollama' | 'gemini';
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
    return {
      model: 'zai-org/GLM-5.3-Flash',
      provider: 'gonkarouter',
      reason: 'GonkaRouter (GLM-5.3-Flash) configured as exclusive AI provider.',
    };
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
