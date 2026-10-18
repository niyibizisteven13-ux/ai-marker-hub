const SENSITIVE_FIELD_LABEL = /\b(name|email|e-mail|phone|telephone|mobile|contact|address|national\s*id|passport|student\s*id|registration\s*(number|no)|date\s*of\s*birth|birth\s*date|\bdob\b|guardian|parent)\b/i;
const SENSITIVE_KEY = /(?:^|[_\s-])(name|email|e-mail|phone|telephone|mobile|contact|address|national[_\s-]*id|passport|student[_\s-]*id|registration[_\s-]*(?:number|no)|date[_\s-]*of[_\s-]*birth|dob|guardian|parent)(?:$|[_\s-])/i;

export function redactFormAnswersForAi(schema: any, answers: Record<string, any>) {
  const definitions = [
    ...(Array.isArray(schema?.questions) ? schema.questions : []),
    ...(Array.isArray(schema?.fields) ? schema.fields : []),
  ];
  const privateKeys = new Set<string>();
  definitions.forEach((field: any, index: number) => {
    const key = String(field?.id ?? field?.number ?? index + 1);
    const label = String(field?.title || field?.label || '');
    const type = String(field?.type || '').toUpperCase();
    if (['EMAIL', 'PHONE', 'TEL'].includes(type) || SENSITIVE_FIELD_LABEL.test(label)) privateKeys.add(key);
  });

  const redactValue = (value: any): any => {
    if (typeof value === 'string') {
      return value
        .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]')
        .replace(/\b(?:\+?\d[\d\s().-]{7,}\d)\b/g, '[redacted phone]');
    }
    if (Array.isArray(value)) return value.map(redactValue);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactValue(item)]));
    }
    return value;
  };

  return Object.fromEntries(Object.entries(answers || {}).map(([key, value]) => {
    if (key === '_respondentEmail' || privateKeys.has(key) || SENSITIVE_KEY.test(key)) {
      return [key, '[redacted personal information]'];
    }
    return [key, redactValue(value)];
  }));
}
