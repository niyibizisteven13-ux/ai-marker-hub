import logger from '../utils/logger.js';

export interface ValidationResult {
  isValid: boolean;
  reason?: string;
  flag?: string;
}

export class PreFlightService {
  /**
   * Checks if a student script is likely garbage (blank, too short, or corrupted OCR).
   */
  public static validateScriptQuality(studentScript: any): ValidationResult {
    const answers = studentScript.answers || [];

    if (answers.length === 0) {
      return { isValid: false, reason: 'No answers found in script', flag: 'blank' };
    }

    let totalLength = 0;
    let emptyAnswers = 0;

    for (const answer of answers) {
      const content = String(answer.text || answer.content || '').trim();
      totalLength += content.length;
      if (content.length === 0) {
        emptyAnswers++;
      }
    }

    // Heuristic: If more than 80% of answers are empty, it's likely a bad scan or blank paper
    if (emptyAnswers / answers.length > 0.8) {
      return { isValid: false, reason: 'Majority of answers are empty', flag: 'blank' };
    }

    // Heuristic: If total text content is extremely low for the whole script
    if (totalLength < 10 && answers.length > 2) {
      return { isValid: false, reason: 'Script content too short for reliable grading', flag: 'illegible' };
    }

    return { isValid: true };
  }

  /**
   * Checks if the rubric is healthy and consistent.
   */
  public static validateRubricHealth(examPaper: any): ValidationResult {
    const questions = examPaper.questions || [];
    if (questions.length === 0) {
      return { isValid: false, reason: 'Exam paper has no questions' };
    }

    for (const q of questions) {
      if (!q.maxMarks || q.maxMarks <= 0) {
        return { isValid: false, reason: `Question ${q.id || ''} has invalid maxMarks` };
      }

      // If there's a detailed rubric, check it
      if (q.rubric && Array.isArray(q.rubric.criteria)) {
        const totalWeight = q.rubric.criteria.reduce((sum: number, c: any) => sum + (c.maxMarks || 0), 0);
        // Warning: criteria marks should usually sum to question max marks, but some systems differ.
        // We'll just log a warning for now rather than failing, unless it's zero.
        if (totalWeight === 0) {
           return { isValid: false, reason: `Question ${q.id} rubric criteria sum to 0` };
        }
      }
    }

    return { isValid: true };
  }
}
