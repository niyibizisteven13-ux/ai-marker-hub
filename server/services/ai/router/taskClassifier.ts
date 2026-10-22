export type TaskClass = 'SIMPLE' | 'STANDARD' | 'COMPLEX' | 'DETERMINISTIC' | 'ARTIFACT_SPEC';

export const TASK_CLASSES: readonly TaskClass[] = ['SIMPLE', 'STANDARD', 'COMPLEX', 'DETERMINISTIC', 'ARTIFACT_SPEC'];

export type RoutingReasonCode =
  | 'OVERRIDE'
  | 'GREETING_OR_SHORT_QA'
  | 'DETERMINISTIC_CALCULATION'
  | 'ARTIFACT_SPECIFICATION'
  | 'LONG_OR_MULTI_SOURCE'
  | 'ATTACHED_FILES'
  | 'DEFAULT';

export interface ClassificationContext {
  prompt: string;
  hasFiles?: boolean;
  fileSizeKb?: number;
  hasTools?: boolean;
  /** Internal/testing override only. Never derived from user input. */
  overrideClass?: TaskClass;
}

export interface Classification {
  taskClass: TaskClass;
  reasonCode: RoutingReasonCode;
}

// Word-boundary patterns so e.g. "summary" does not match "sum" and "information" does not match "form".
const CALC = /\b(calculate|compute|statistics?|statistical|sum|total|average|mean|median|percent(age)? change|growth rate|standard deviation|correlation)\b/i;
const ARTIFACT = /\b(chart|graph|plot|diagram|quiz|flashcards?|questionnaire|survey form|table schema)\b/i;
const COMPLEX = /\b(synthesi[sz]e|compare|comparison|analy[sz]e (the |this )?report|multi-?document|step[- ]by[- ]step proof|refactor|debug)\b/i;
const GREETING = /^(hi|hello|hey|muraho|mwaramutse|mwiriwe|bonjour|thanks|thank you|murakoze)\b/i;
const SHORT_QA = /^(what is|what's|who is|define|meaning of|translate)\b/i;

/**
 * Cheap, deterministic heuristics that map a request to a task class.
 * Returns a stable reason code so routing decisions can be logged and tested.
 */
export class TaskClassifier {
  classifyWithReason(ctx: ClassificationContext): Classification {
    if (ctx.overrideClass && TASK_CLASSES.includes(ctx.overrideClass)) {
      return { taskClass: ctx.overrideClass, reasonCode: 'OVERRIDE' };
    }
    const prompt = ctx.prompt.trim();
    const len = prompt.length;

    if (len < 120 && !ctx.hasFiles && GREETING.test(prompt)) return { taskClass: 'SIMPLE', reasonCode: 'GREETING_OR_SHORT_QA' };
    if (CALC.test(prompt)) return { taskClass: 'DETERMINISTIC', reasonCode: 'DETERMINISTIC_CALCULATION' };
    if (ARTIFACT.test(prompt)) return { taskClass: 'ARTIFACT_SPEC', reasonCode: 'ARTIFACT_SPECIFICATION' };
    if (len > 1500 || COMPLEX.test(prompt) || (ctx.fileSizeKb ?? 0) > 500) return { taskClass: 'COMPLEX', reasonCode: 'LONG_OR_MULTI_SOURCE' };
    if (ctx.hasFiles) return { taskClass: 'STANDARD', reasonCode: 'ATTACHED_FILES' };
    if (len < 120 && SHORT_QA.test(prompt)) return { taskClass: 'SIMPLE', reasonCode: 'GREETING_OR_SHORT_QA' };
    return { taskClass: 'STANDARD', reasonCode: 'DEFAULT' };
  }

  classify(ctx: ClassificationContext): TaskClass {
    return this.classifyWithReason(ctx).taskClass;
  }
}
