/** Learning modes shared by the web app and the server. */
export type LearningMode = 'normal' | 'socratic' | 'roleplay';

export interface LearningSettings {
  mode: LearningMode;
  /** Roleplay: who the AI plays and the situation. */
  character?: string;
  scenario?: string;
  /** Language practice: target language and CEFR level. */
  language?: string;
  level?: string;
  /** Socratic: subject or task the student is working on (optional). */
  topic?: string;
}

export const ROLEPLAY_PRESETS: Array<{ id: string; title: string; settings: LearningSettings }> = [
  { id: 'english-cafe', title: 'English conversation: at a café (B1)', settings: { mode: 'roleplay', character: 'a friendly café owner in London', scenario: 'The student orders, asks about the menu and makes small talk.', language: 'English', level: 'B1' } },
  { id: 'french-market', title: 'French: buying at the market (A2)', settings: { mode: 'roleplay', character: 'un vendeur au marché de Lyon', scenario: "L'élève achète des fruits et légumes et négocie le prix.", language: 'French', level: 'A2' } },
  { id: 'job-interview', title: 'Job interview (English)', settings: { mode: 'roleplay', character: 'an interviewer at a Kigali technology company', scenario: 'A first-round interview for a junior data analyst role.', language: 'English', level: 'B2' } },
  { id: 'moot-court', title: 'Moot court: contract dispute', settings: { mode: 'roleplay', character: 'the presiding judge', scenario: 'A small business sues a supplier for late delivery. The student argues for the business; the judge asks hard questions.' } },
  { id: 'debate', title: 'Parliamentary debate', settings: { mode: 'roleplay', character: 'the opposition speaker', scenario: 'Motion: "This house would make secondary school coding classes compulsory." The student proposes the motion.' } },
  { id: 'history', title: 'Meet a historical figure', settings: { mode: 'roleplay', character: 'Marie Curie in 1911', scenario: 'A student journalist interviews her about her research on radioactivity.' } },
];

/** BCP-47 tag for speech recognition and read-aloud. */
export function speechLang(language?: string, answerLanguage?: string): string {
  const l = (language || answerLanguage || '').toLowerCase();
  if (l.startsWith('fr')) return 'fr-FR';
  if (l.startsWith('kin') || l === 'rw') return 'rw-RW';
  if (l.startsWith('sw')) return 'sw-KE';
  if (l.startsWith('es')) return 'es-ES';
  if (l.startsWith('de')) return 'de-DE';
  return 'en-US';
}
