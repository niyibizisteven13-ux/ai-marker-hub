// Maps real backend events to varied, honest status text — never generic
// filler. Each key has several phrasings so repeated calls in one session
// don't feel robotic; pick one at random per event.

export type StatusStage =
  | 'classifying'
  | 'connecting'
  | 'reading_document'
  | 'planning'
  | 'tool:build_form'
  | 'tool:extract_structured_data'
  | 'tool:translate_text'
  | 'tool:calculate'
  | 'tool:lookup_pricing'
  | 'grading'
  | 'scoring'
  | 'farming_advice'
  | 'streaming'
  | 'finalizing';

const PHRASES: Record<StatusStage, string[]> = {
  classifying: [
    'Figuring out what you need',
    'Reading your request',
    'Sorting this into the right service',
  ],
  connecting: [
    'Connecting to the model',
    'Reaching out to Claude',
    'Opening the line',
  ],
  reading_document: [
    'Reading through your document',
    'Going through the file you sent',
    'Extracting the content',
    'Working through the pages',
  ],
  planning: [
    'Thinking through the steps',
    'Working out a plan',
    'Breaking this into steps',
  ],
  'tool:build_form': [
    'Building your form',
    'Laying out the fields',
    'Drafting the application form',
  ],
  'tool:extract_structured_data': [
    'Pulling out the structured data',
    'Organizing this into a clean format',
    'Extracting the fields you need',
  ],
  'tool:translate_text': [
    'Translating this for you',
    'Finding the right words in the target language',
    'Working through the translation',
  ],
  'tool:calculate': [
    'Running the numbers',
    'Double-checking the calculation',
    'Working out the exact figures',
  ],
  'tool:lookup_pricing': [
    'Checking current pricing',
    'Looking up the right price tier',
  ],
  grading: [
    'Marking against the rubric',
    'Checking each answer carefully',
    'Comparing this script to the answer key',
  ],
  scoring: [
    'Scoring this application',
    'Weighing it against your criteria',
    'Comparing this applicant to the rubric',
  ],
  farming_advice: [
    'Thinking through the growing conditions',
    'Considering the crop and season',
  ],
  streaming: [
    'Putting the answer together',
    'Writing this out',
  ],
  finalizing: [
    'Wrapping up',
    'Finishing the last details',
  ],
};

export function getStatusPhrase(stage: StatusStage): string {
  const options = PHRASES[stage] || ['Working on it'];
  return options[Math.floor(Math.random() * options.length)];
}

// Maps a tool name (as called by the agent loop) to its status stage
export function stageForTool(toolName: string): StatusStage {
  const key = `tool:${toolName}` as StatusStage;
  return PHRASES[key] ? key : 'planning';
}
