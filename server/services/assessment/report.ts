import type { ReportInput, ReportSection } from '../analytics/htmlReport.js';
import type { AssessmentOutcome, InstructorReview } from './assess.js';
import { applyReviews } from './assess.js';
import type { Rubric } from './rubric.js';

const fmt = (x: number | null) => (x === null ? '—' : String(Number(x.toFixed(2))));

export function buildAssessmentReport(input: {
  rubric: Rubric; outcome: AssessmentOutcome; reviews: InstructorReview[]; status: 'proposed' | 'instructor_confirmed';
  studentLabel?: string; generatedAt: string; rubricWarnings: string[]; submissionSha256: string;
}): ReportInput {
  const { rubric, outcome, reviews, status } = input;
  const applied = applyReviews(outcome, reviews, rubric);
  const confirmed = status === 'instructor_confirmed';
  const sections: ReportSection[] = [
    {
      heading: 'Rubric',
      tables: [{
        caption: `${rubric.title ?? 'Rubric'}: ${rubric.totalMarks} marks in total`,
        columns: ['Criterion', 'Max marks', 'Description', 'Levels'],
        rows: rubric.criteria.map((c) => [c.name, c.maxMarks, c.description || null, c.levels?.map((l) => `${l.label} (${l.minMarks}–${l.maxMarks})`).join('; ') || null]),
      }],
      bullets: input.rubricWarnings.map((w) => ({ text: `Rubric note: ${w}` })),
    },
    {
      heading: 'Marks',
      tables: [{
        caption: 'Marks by criterion',
        columns: ['Criterion', 'Max', 'AI-proposed', 'Instructor', 'Final', 'Level', 'Needs review'],
        rows: outcome.criteria.map((c) => {
          const row = applied.rows.find((r) => r.criterionId === c.criterionId)!;
          return [c.criterionName, c.maxMarks, c.proposedMarks, row.instructor, row.final, c.levelLabel, c.needsHumanReview && !row.reviewed ? 'yes' : 'no'];
        }),
        note: 'Totals are calculated by adding the criterion marks; they are not estimated by the AI.',
      }],
    },
    ...outcome.criteria.map((c): ReportSection => ({
      heading: `${c.criterionName} (${fmt(applied.rows.find((r) => r.criterionId === c.criterionId)!.final)} / ${c.maxMarks})`,
      paragraphs: [
        { text: c.rationale || 'No rationale was provided.', kind: 'interpretation' },
        ...(c.flags.length ? [{ text: `Review flags: ${c.flags.join(' ')}` }] : []),
      ],
      bullets: [
        ...c.evidence.map((e) => ({ text: `${e.verified ? '' : '[NOT FOUND IN SUBMISSION] '}“${e.quote}” (${e.foundIn ?? e.paragraph}${e.page ? `, page ${e.page}` : ''})`, kind: 'source' as const })),
        ...c.missingRequirements.map((m) => ({ text: `Missing: ${m}` })),
        ...c.factualErrors.map((m) => ({ text: `Possible error: ${m}` })),
        ...c.improvements.map((m) => ({ text: `To improve: ${m}` })),
      ],
    })),
  ];
  if (reviews.length) {
    sections.push({ heading: 'Instructor review log', tables: [{ caption: 'Changes made by the instructor', columns: ['When', 'Criterion', 'Mark', 'Comment'], rows: reviews.map((r) => [r.at, r.criterionId, r.marks, r.comment ?? null]) }] });
  }
  if (outcome.ambiguities.length) sections.push({ heading: 'Ambiguities to check', bullets: outcome.ambiguities.map((a) => ({ text: a })) });

  const totalText = applied.finalTotal !== null ? `${fmt(applied.finalTotal)} / ${rubric.totalMarks} (${fmt(applied.finalPercent)}%)` : `not available: ${applied.unresolved.length} criterion/criteria still need a mark`;
  return {
    title: `${confirmed ? 'Assessment' : 'Proposed assessment'}${input.studentLabel ? `: ${input.studentLabel}` : ''}`,
    subtitle: rubric.title ?? undefined,
    notice: confirmed
      ? 'Instructor-confirmed grade. AI proposals and instructor changes are both shown for transparency.'
      : 'PROPOSED AI-ASSISTED ASSESSMENT — not a final grade. An instructor must review and confirm it.',
    summary: [
      { text: `${confirmed ? 'Final' : 'Current'} total: ${totalText}.`, kind: 'calculated' },
      { text: outcome.overallFeedback || 'No overall feedback.', kind: 'interpretation' },
      ...(applied.unresolved.length && !confirmed ? [{ text: `Criteria awaiting instructor review: ${applied.unresolved.join(', ')}.` }] : []),
    ],
    sections,
    limitations: outcome.limitations,
    reproducibility: {
      engineVersion: `bwenge-assessment-1.0.0 (model ${outcome.model})`, generatedAt: input.generatedAt,
      transformations: [`Submission split into ${outcome.submission.paragraphs} paragraphs (sha256 ${input.submissionSha256.slice(0, 16)}…); quotes verified by normalised text match.`],
      methods: ['Proposed marks must lie within each criterion\'s range (and level range, if levels exist); otherwise they are not used.', 'Criterion and total marks are summed in code.'],
    },
  };
}
