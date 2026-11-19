const PRIVATE_KEYS = new Set([
  'answer', 'answerkey', 'correct', 'correctanswer', 'correctanswers', 'expectedanswer', 'modelanswer',
  'rubric', 'scoringrubric', 'selectionsettings', 'requirements', 'solution', 'mysebexamid', 'importreview',
  'explanation', 'correctfeedback', 'incorrectfeedback',
  'sebkeys',
]);

export function sanitizePublicFormSchema(value: any): any {
  if (Array.isArray(value)) return value.map(sanitizePublicFormSchema);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !PRIVATE_KEYS.has(key.toLowerCase().replace(/[_\s-]/g, '')))
    .map(([key, item]) => [key, sanitizePublicFormSchema(item)]));
}
