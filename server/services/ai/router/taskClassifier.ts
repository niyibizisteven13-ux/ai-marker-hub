export type TaskClass = 'SIMPLE' | 'STANDARD' | 'COMPLEX' | 'DETERMINISTIC' | 'ARTIFACT_SPEC';

export interface ClassificationContext {
  prompt: string;
  hasFiles?: boolean;
  fileSizeKb?: number;
  hasTools?: boolean;
  overrideClass?: TaskClass;
}

/**
 * Deterministic heuristic task classifier mapping requests into
 * SIMPLE, STANDARD, COMPLEX, DETERMINISTIC, or ARTIFACT_SPEC.
 */
export class TaskClassifier {
  classify(ctx: ClassificationContext): TaskClass {
    if (ctx.overrideClass && ['SIMPLE', 'STANDARD', 'COMPLEX', 'DETERMINISTIC', 'ARTIFACT_SPEC'].includes(ctx.overrideClass)) {
      return ctx.overrideClass;
    }

    const prompt = ctx.prompt.toLowerCase();
    const len = prompt.length;

    if (prompt.includes('calculate') || prompt.includes('statistics') || prompt.includes('sum') || prompt.includes('average') || prompt.includes('median') || prompt.includes('percent change')) {
      return 'DETERMINISTIC';
    }

    if (prompt.includes('chart') || prompt.includes('diagram') || prompt.includes('quiz') || prompt.includes('form') || prompt.includes('table schema')) {
      return 'ARTIFACT_SPEC';
    }

    if (len > 1500 || (ctx.fileSizeKb && ctx.fileSizeKb > 500) || ctx.hasFiles || prompt.includes('synthesize') || prompt.includes('compare') || prompt.includes('analyze report')) {
      return 'COMPLEX';
    }

    if (len < 100 && (prompt.startsWith('hi') || prompt.startsWith('hello') || prompt.startsWith('what is') || prompt.startsWith('define'))) {
      return 'SIMPLE';
    }

    return 'STANDARD';
  }
}
