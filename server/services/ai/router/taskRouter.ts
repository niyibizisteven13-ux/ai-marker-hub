export type TaskClass = 'simple' | 'standard' | 'complex' | 'tool' | 'artifact';

export interface ModelRoutingConfig {
  economicalModel: string;
  defaultModel: string;
  premiumModel: string;
  maxTokensSimple?: number;
  maxTokensStandard?: number;
  maxTokensComplex?: number;
}

export interface ClassificationResult {
  taskClass: TaskClass;
  model: string;
  maxTokens: number;
  temperature: number;
}

/**
 * Task-based Model Router for selecting cost-effective models based on prompt complexity,
 * length, tool requirements, and expected output types.
 */
export class TaskRouter {
  constructor(private config: ModelRoutingConfig) {}

  classify(prompt: string, options?: { hasFiles?: boolean; hasTools?: boolean; forceClass?: TaskClass }): ClassificationResult {
    if (options?.forceClass) {
      return this.getResultForClass(options.forceClass);
    }

    const len = prompt.length;
    const lower = prompt.toLowerCase();

    if (lower.includes('calculate') || lower.includes('statistics') || lower.includes('sum') || lower.includes('average') || options?.hasTools) {
      return this.getResultForClass('tool');
    }

    if (lower.includes('chart') || lower.includes('diagram') || lower.includes('create document') || lower.includes('spreadsheet')) {
      return this.getResultForClass('artifact');
    }

    if (len > 1500 || options?.hasFiles || lower.includes('synthesize') || lower.includes('compare') || lower.includes('analyze report')) {
      return this.getResultForClass('complex');
    }

    if (len < 100 && (lower.startsWith('hi') || lower.startsWith('hello') || lower.includes('what is'))) {
      return this.getResultForClass('simple');
    }

    return this.getResultForClass('standard');
  }

  private getResultForClass(taskClass: TaskClass): ClassificationResult {
    switch (taskClass) {
      case 'simple':
        return {
          taskClass,
          model: this.config.economicalModel,
          maxTokens: this.config.maxTokensSimple ?? 1024,
          temperature: 0.2,
        };
      case 'standard':
        return {
          taskClass,
          model: this.config.defaultModel,
          maxTokens: this.config.maxTokensStandard ?? 4096,
          temperature: 0.3,
        };
      case 'complex':
      case 'artifact':
        return {
          taskClass,
          model: this.config.premiumModel,
          maxTokens: this.config.maxTokensComplex ?? 8192,
          temperature: 0.3,
        };
      case 'tool':
        return {
          taskClass,
          model: this.config.defaultModel,
          maxTokens: this.config.maxTokensStandard ?? 4096,
          temperature: 0.1,
        };
    }
  }
}
