import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { exportResultsToExcel } from './excelExporter.js';

dotenv.config();

const ai = new GoogleGenAI({});

/**
 * JSON schema passed to Gemini alongside responseMimeType so the model's
 * output structure is enforced by the API, not just requested in the prompt.
 */
const responseSchema = {
  type: "object",
  properties: {
    assessmentTitle: { type: "string" },
    studentId: { type: ["string", "null"] },
    studentName: { type: ["string", "null"] },
    identityConfidence: {
      type: "string",
      enum: ["high", "medium", "low", "unknown"]
    },
    gradedQuestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          questionNumber: { type: "string" },
          maxMarks: { type: "number" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          criteriaBreakdown: {
            type: "array",
            items: {
              type: "object",
              properties: {
                criterion: { type: "string" },
                marksAwarded: { type: "number" },
                marksAvailable: { type: "number" },
                reason: { type: "string" }
              },
              required: ["criterion", "marksAwarded", "marksAvailable", "reason"]
            }
          },
          feedbackToStudent: { type: "string" }
        },
        required: ["questionNumber", "maxMarks", "criteriaBreakdown", "feedbackToStudent"]
      }
    },
    commonMisconceptions: {
      type: "array",
      items: { type: "string" }
    }
  },
  required: ["assessmentTitle", "gradedQuestions"]
};

/**
 * Builds the grading prompt sent to the model.
 */
function buildPrompt(examPaper, rubrics, rawStudentText) {
  return `
You are an expert AI academic examiner. Analyze the student's submission text below based on the provided exam questions, model answers, and evaluation rubrics.

--- EXAM PAPER & RUBRICS ---
${JSON.stringify({ examPaper, rubrics }, null, 2)}

--- RAW STUDENT SUBMISSION TEXT ---
${rawStudentText}

Instructions:
1. Try to extract the student's Full Name and Student ID from the submission text.
   If you cannot find them with reasonable confidence, return null for that field and set identityConfidence to "low" or "unknown" — do NOT invent or guess a name or ID.
2. Generate a professional assessment Title based on the exam subject and topic.
3. Grade each question strictly against the criteria breakdown. Award marksAwarded only up to marksAvailable per criterion.
4. Rate your own confidence per question as "high", "medium", or "low" based on how clear-cut the student's answer was to evaluate.
5. Provide constructive, specific feedback per question.

Return ONLY valid JSON matching the required schema. No markdown, no commentary.
`;
}

/**
 * Recomputes score totals from the graded criteria rather than trusting
 * whatever total the model may have reported. LLMs are unreliable at
 * summing many numbers correctly, especially across a long exam.
 */
function computeTotals(gradedQuestions) {
  let totalAwardedScore = 0;
  let maxPossibleScore = 0;

  for (const question of gradedQuestions) {
    for (const criterion of question.criteriaBreakdown) {
      totalAwardedScore += criterion.marksAwarded;
      maxPossibleScore += criterion.marksAvailable;
    }
  }

  return { totalAwardedScore, maxPossibleScore };
}

/**
 * Calls Gemini once with the grading prompt and schema, returning the
 * raw response object.
 */
async function callModel(prompt) {
  return ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema,
      temperature: 0.15,
      maxOutputTokens: 8192,
    }
  });
}

/**
 * Evaluates a single student's submission against an exam paper and rubrics.
 * Retries once on JSON parse failure (e.g. a truncated or malformed response)
 * before giving up.
 *
 * @param {object} examPaper - The exam questions and model answers.
 * @param {object} rubrics - The marking criteria/rubric definitions.
 * @param {string} rawStudentText - The extracted/raw text of the student submission.
 * @returns {Promise<object>} Graded result including recomputed totals.
 */
export async function evaluateStudentSubmission(examPaper, rubrics, rawStudentText) {
  const prompt = buildPrompt(examPaper, rubrics, rawStudentText);

  let parsed;

  try {
    const response = await callModel(prompt);
    parsed = JSON.parse(response.text);
  } catch (firstError) {
    console.warn(
      "First grading attempt failed to parse, retrying once:",
      firstError.message
    );

    try {
      const retryResponse = await callModel(prompt);
      parsed = JSON.parse(retryResponse.text);
    } catch (secondError) {
      console.error(
        "Second grading attempt also failed to parse:",
        secondError.message
      );
      throw new Error(
        `Gemini grading failed after retry: ${secondError.message}`
      );
    }
  }

  const { totalAwardedScore, maxPossibleScore } = computeTotals(
    parsed.gradedQuestions || []
  );

  return {
    ...parsed,
    totalAwardedScore,
    maxPossibleScore,
  };
}

/**
 * Grades a whole batch of student submissions (e.g. a full class) against
 * the same exam paper and rubrics. Submissions are graded sequentially to
 * stay well within API rate limits; a failure on one submission is captured
 * and attached to its result rather than aborting the whole batch, so one
 * bad scan doesn't block grading the rest of the class.
 *
 * @param {object} examPaper
 * @param {object} rubrics
 * @param {Array<{ rawStudentText: string, sourceFile?: string }>} submissions
 * @returns {Promise<object[]>} One graded result per submission, in the same
 *   order as the input. Failed submissions have an `error` field instead of
 *   grading data.
 */
export async function evaluateBatch(examPaper, rubrics, submissions) {
  const results = [];

  for (const submission of submissions) {
    try {
      const graded = await evaluateStudentSubmission(
        examPaper,
        rubrics,
        submission.rawStudentText
      );
      results.push({ ...graded, sourceFile: submission.sourceFile ?? null });
    } catch (error) {
      console.error(
        `Failed to grade submission${submission.sourceFile ? ` (${submission.sourceFile})` : ''}:`,
        error.message
      );
      results.push({
        sourceFile: submission.sourceFile ?? null,
        error: error.message,
        studentName: null,
        studentId: null,
        totalAwardedScore: 0,
        maxPossibleScore: 0,
        gradedQuestions: [],
      });
    }
  }

  return results;
}

/**
 * Convenience function: grades a batch of submissions and writes the
 * results straight to a formatted Excel workbook in one call.
 *
 * @param {object} examPaper
 * @param {object} rubrics
 * @param {Array<{ rawStudentText: string, sourceFile?: string }>} submissions
 * @param {string} outputPath - Where to write the .xlsx file.
 * @returns {Promise<{ results: object[], excelPath: string }>}
 */
export async function evaluateBatchAndExport(examPaper, rubrics, submissions, outputPath) {
  const results = await evaluateBatch(examPaper, rubrics, submissions);
  const excelPath = await exportResultsToExcel(results, outputPath);
  return { results, excelPath };
}