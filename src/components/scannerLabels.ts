/**
 * User-facing wording for the scanner. Data fields keep their old names
 * (for example PageItem.studentName) so nothing that consumes the saved pages breaks;
 * only what people READ on screen changes.
 */
export type LabelSet = {
  person: string;   // one individual
  people: string;
  paper: string;    // one person's set of pages
  papers: string;
  score: string;    // noun and verb: "Score all papers"
  criteria: string; // what the scoring is based on
};

const base = { paper: 'Paper', papers: 'Papers', score: 'Score', criteria: 'Criteria' };

export const LABEL_PRESETS = {
  candidate:   { person: 'Candidate',   people: 'Candidates',   ...base },
  student:     { person: 'Student',     people: 'Students',     ...base },
  scholar:     { person: 'Scholar',     people: 'Scholars',     ...base },
  learner:     { person: 'Learner',     people: 'Learners',     ...base },
  participant: { person: 'Participant', people: 'Participants', ...base },
  applicant:   { person: 'Applicant',   people: 'Applicants',   ...base },
} satisfies Record<string, LabelSet>;

export type LabelPresetKey = keyof typeof LABEL_PRESETS;
export const DEFAULT_LABEL_PRESET: LabelPresetKey = 'candidate';
