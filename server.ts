import 'dotenv/config';
import express from 'express';
import path from 'path';
import net from 'net';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';
import { Queue, Worker, Job } from 'bullmq';
import { evaluateStudentSubmission as deepseekEvaluate, sendDeepseekChat } from './src/services/deepseekMarker.js';
import { createServer as createViteServer } from 'vite';
import { buildFallbackChatReply, buildFallbackMarkResults } from './src/utils/aiFallback.ts';
import { generateBatchExcelReport, StudentResultData } from './src/services/excelExporter.ts';
import { uploadBufferToCloud } from './src/services/cloudStorage.ts';
import { BWENGE_SYSTEM_PROMPT, buildBwengeGradingPrompt } from './src/services/geminiService.ts';
import fileRoutes from './routes/files.ts';
import { requireAuth, writeAuditLog } from './production/auth.js';
import { generalLimiter, gradingLimiter } from './production/rateLimiter.js';
import authRoutes from './server/routes/authRoutes.ts';
import userRoutes from './server/routes/userRoutes.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '20mb' }));
// Apply general rate limiting only to API routes so dev asset requests
// (e.g. Vite's /node_modules/.vite/* chunks) are not subject to the limiter.
app.use('/api', generalLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/user', requireAuth, userRoutes);
app.use('/exports', express.static(path.join(__dirname, 'exports')));
app.use('/api/files', fileRoutes);

// Helper to initialize Gemini API safely
function getAiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is not set. Please set a valid Gemini API key starting with APIa or AIza.');
  }

  if (!apiKey.startsWith('AIza') && !apiKey.startsWith('APIa')) {
    console.warn('GEMINI_API_KEY does not appear to be a standard Gemini API key. Make sure this value is a valid API key and not an expired AI Studio ephemeral token.');
  }

  return new GoogleGenAI({
    apiKey,
  });
}

function getOpenRouterHeaders() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  if (process.env.OPENROUTER_SITE_URL) {
    headers['HTTP-Referer'] = process.env.OPENROUTER_SITE_URL;
  }
  if (process.env.OPENROUTER_SITE_NAME) {
    headers['X-Title'] = process.env.OPENROUTER_SITE_NAME;
  }

  return headers;
}

const AI_PROVIDER = (process.env.AI_PROVIDER || '').toLowerCase();

/** OpenAI-compatible provider call. Kept server-side so API keys never reach the browser. */
async function sendOpenAIChat(prompt: string, options: { json?: boolean; system?: string } = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured.');
  const model = process.env.OPENAI_MODEL || 'gpt-5-mini';
  const isReasoningModel = /^(gpt-5|o[1-9])/i.test(model);
  const requestBody: Record<string, unknown> = {
    model,
    max_completion_tokens: Number(process.env.OPENAI_MAX_TOKENS || 5000),
    response_format: options.json ? { type: 'json_object' } : undefined,
    messages: [
      { role: 'system', content: options.system || 'You are Marker AI, a precise and fair academic assessment assistant.' },
      { role: 'user', content: prompt },
    ],
  };
  if (!isReasoningModel) {
    requestBody.temperature = 0.1;
    requestBody.max_tokens = requestBody.max_completion_tokens;
    delete requestBody.max_completion_tokens;
  }

  const response = await fetch(process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });
  const data: any = await response.json();
  if (!response.ok) throw new Error(`OpenAI API error: ${data?.error?.message || `${response.status} ${response.statusText}`}`);
  const answer = data?.choices?.[0]?.message?.content;
  if (!answer) throw new Error('OpenAI returned an empty response.');
  return String(answer).trim();
}

function providerAvailable(name: 'gemini' | 'openai' | 'deepseek' | 'openrouter') {
  if (name === 'gemini') return Boolean(process.env.GEMINI_API_KEY);
  if (name === 'openai') return Boolean(process.env.OPENAI_API_KEY);
  if (name === 'deepseek') return Boolean(process.env.DEEPSEEK_API_KEY);
  if (name === 'openrouter') return Boolean(process.env.OPENROUTER_API_KEY);
  return false;
}

/** Run independent provider opinions concurrently. One provider may be unavailable without taking down the API. */
async function runProviderRace<T>(
  geminiWork: () => Promise<T>,
  openAIWork: () => Promise<T>,
  deepseekWork?: () => Promise<T>,
  openRouterWork?: () => Promise<T>,
) {
  const promises = [
    providerAvailable('gemini') ? geminiWork() : Promise.reject(new Error('Gemini is not configured.')),
    providerAvailable('openai') ? openAIWork() : Promise.reject(new Error('OpenAI is not configured.')),
  ];

  if (deepseekWork && providerAvailable('deepseek')) {
    promises.push(deepseekWork());
  }

  if (openRouterWork && providerAvailable('openrouter')) {
    promises.push(openRouterWork());
  }

  const settled = await Promise.allSettled(promises);
  const successes: Array<{ provider: string; value: T }> = [];
  if (settled[0]?.status === 'fulfilled') successes.push({ provider: 'Gemini', value: (settled[0] as PromiseFulfilledResult<T>).value });
  if (settled[1]?.status === 'fulfilled') successes.push({ provider: 'OpenAI', value: (settled[1] as PromiseFulfilledResult<T>).value });
  if (deepseekWork && settled[2]?.status === 'fulfilled') successes.push({ provider: 'Deepseek', value: (settled[2] as PromiseFulfilledResult<T>).value });
  if (openRouterWork && settled[deepseekWork ? 3 : 2]?.status === 'fulfilled') {
    successes.push({ provider: 'OpenRouter', value: (settled[deepseekWork ? 3 : 2] as PromiseFulfilledResult<T>).value });
  }

  if (!successes.length) {
    const errors = settled.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    throw new Error(errors.map((e) => e.reason?.message || String(e.reason)).join(' | '));
  }

  return {
    successes,
    errors: settled.filter((r) => r.status === 'rejected').map((r: any) => r.reason?.message || String(r.reason)),
  };
}

function clampNumber(value: unknown, min: number, max: number) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
}

const redisConnection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT || 6379),
};

let gradingQueue: Queue<any, any, string> | null = null;
let gradingWorker: Worker<any, any, string> | null = null;
let isRedisAvailable = false;

async function checkRedisAvailability(): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = net.createConnection({
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: Number(process.env.REDIS_PORT || 6379),
    });

    socket.setTimeout(1000);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function processBatchSynchronously(examPaper: any, studentScripts: any[]) {
  const results: any[] = [];
  for (let i = 0; i < studentScripts.length; i++) {
    const script = studentScripts[i];
    const evaluation = await evaluateStudentScriptWithAI(examPaper, script);
    results.push({ studentId: script.studentId, markedScript: evaluation.markedScript, providers: evaluation.providers, providerWarnings: evaluation.providerWarnings });
  }
  return { success: true, results };
}

async function initializeQueue() {
  isRedisAvailable = await checkRedisAvailability();

  if (!isRedisAvailable) {
    console.warn('Redis is not available. Batch grading queue is disabled and will run synchronously.');
    return;
  }

  try {
    gradingQueue = new Queue('exam-grading-queue', { connection: redisConnection });
    gradingWorker = new Worker(
      'exam-grading-queue',
      async (job) => {
        const { examPaper, studentScripts } = job.data as { examPaper: any; studentScripts: any[] };
        const total = studentScripts.length;
        const results: any[] = [];

        for (let i = 0; i < total; i++) {
          const script = studentScripts[i];
          const evaluation = await evaluateStudentScriptWithAI(examPaper, script);
          results.push({ studentId: script.studentId, markedScript: evaluation.markedScript, providers: evaluation.providers, providerWarnings: evaluation.providerWarnings });
          await job.updateProgress(Math.round(((i + 1) / total) * 100));
        }

        return { success: true, results };
      },
      { connection: redisConnection },
    );
  } catch (error: any) {
    isRedisAvailable = false;
    console.warn('Redis is not available. Batch grading queue is disabled and will run synchronously.', error?.message || error);
  }
}

await initializeQueue();

// NOTE: `gradingWorker` is a module-level `let` that gets reassigned inside
// `initializeQueue()` above. Because of that indirection, TypeScript's control-flow
// narrowing can't reliably keep `gradingWorker` narrowed to non-null across the
// `.on(...)` method calls below (it was reporting "Property 'on' does not exist on
// type 'never'"). Binding it to an explicitly-typed local const fixes that, since the
// type is now taken from the annotation instead of being re-derived at each call site.
if (gradingWorker) {
  const worker: Worker<any, any, string> = gradingWorker;
  worker.on('failed', (job: Job<any, any, string> | undefined, err: Error) => {
    console.error(`Grading worker failed on job ${job?.id}:`, err);
  });

  worker.on('completed', async (job: Job<any, any, string>, result: any) => {
    console.log(`Grading worker completed job ${job.id}`);

  try {
    const rawResults: any[] = Array.isArray(result)
      ? result
      : result?.results || job.returnvalue?.results || [];

    if (!rawResults.length) {
      console.warn(`Job ${job.id} completed with no grading results available.`);
      return;
    }

    const excelResults: StudentResultData[] = rawResults.map((item) => {
      const script = item.markedScript || item;
      const totalScore = Number(script.totalAwardedMarks || 0);
      const maxScore = Number(script.maxTotalMarks || 0);
      const gradePercentage = maxScore > 0 ? totalScore / maxScore : 0;
      const status = script.flags?.length
        ? 'Needs Review'
        : gradePercentage >= 0.5
        ? 'Passed'
        : 'Failed';
      const breakdown = Array.isArray(script.results)
        ? script.results.map((q: any) => ({
            question: q.questionNumber || q.questionId || 'Question',
            score: Number(q.awardedMarks || 0),
            max: Number(q.maxMarks || 0),
            feedback: q.feedbackToStudent || q.criteriaBreakdown?.map((c: any) => c.reason).join(' | ') || '',
          }))
        : [];

      return {
        studentId: String(script.studentId || item.studentId || 'unknown'),
        studentName: String(script.studentName || script.studentName || `Student ${script.studentId || item.studentId || job.id}`),
        totalScore,
        maxScore,
        gradePercentage,
        status,
        identityVerified: Boolean(script.studentId && script.studentName),
        breakdown,
      };
    });

    const excelBuffer = await generateBatchExcelReport(`Batch_${job.id}`, excelResults);
    const fileKey = `batch_results_${job.id}.xlsx`;
    const fileUrl = await uploadBufferToCloud(
      excelBuffer,
      fileKey,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );

    console.log(`Excel report for job ${job.id} saved to ${fileUrl}`);
    return { success: true, results: rawResults, excelReportUrl: fileUrl };
  } catch (error: any) {
    console.error(`Error generating Excel report for job ${job.id}:`, error);
  }
});
}

async function evaluateStudentScriptWithAI(examPaper: any, studentScript: any) {
  const ai = providerAvailable('gemini') ? getAiClient() : null;

  const draftSystemInstruction = `You are Marker AI, an exam-marking assistant for schools and universities.

ROLE
Grade student answers strictly against the provided rubric/answer key. Be consistent, fair, and evidence-based.

WHAT TO DO FOR EACH QUESTION
1. Read the question and its rubric criteria.
2. Read the student's answer for that question only.
3. Match answer content against each rubric criterion.
4. Award partial marks where partially correct — never all-or-nothing unless rubric says so.
5. Ignore spelling/grammar unless the rubric specifically grades language.
6. Flag (do not silently penalize) illegible, blank, or off-topic answers or possible plagiarism.

FLAG OPTIONS:
- "none": Answer is legible and evaluates normally.
- "illegible": Handwriting or text is unreadable.
- "blank": Student left question blank or explicitly wrote blank/N/A.
- "off_topic": Answer is completely irrelevant to the question asked.
- "possible_plagiarism": Answer appears copied word-for-word from external material or model answer without reasoning.
- "needs_teacher_review": Low confidence or highly ambiguous student response requiring human eyes.

OUTPUT RULES
Return a JSON array where each item represents the mark evaluation for a question:
- questionNumber: string (e.g. Q1)
- questionId: string
- maxMarks: number
- awardedMarks: number
- criteriaBreakdown: array of { criterion: string, marksAvailable: number, marksAwarded: number, reason: string }
- feedbackToStudent: string
- flag: "none" | "illegible" | "blank" | "off_topic" | "possible_plagiarism" | "needs_teacher_review"`;

  const reviewSystemInstruction = `You are Marker AI's quality reviewer for marking.
Review the draft marking results for consistency, fairness, and alignment to the rubric. If any question appears over- or under-marked, correct it. Keep the structure unchanged but improve accuracy and tone.`;

  const prompt = `Evaluate the following student answer script against the exam paper and rubric.

STUDENT NAME: ${studentScript.studentName} (ID: ${studentScript.studentId})

EXAM PAPER & RUBRIC:
${JSON.stringify(examPaper, null, 2)}

STUDENT ANSWERS:
${JSON.stringify(studentScript.answers, null, 2)}`;

  const responseSchema = {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        questionNumber: { type: Type.STRING },
        questionId: { type: Type.STRING },
        maxMarks: { type: Type.INTEGER },
        awardedMarks: { type: Type.NUMBER },
        criteriaBreakdown: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              criterion: { type: Type.STRING },
              marksAvailable: { type: Type.NUMBER },
              marksAwarded: { type: Type.NUMBER },
              reason: { type: Type.STRING },
            },
            required: ['criterion', 'marksAvailable', 'marksAwarded', 'reason'],
          },
        },
        feedbackToStudent: { type: Type.STRING },
        flag: { type: Type.STRING },
      },
      required: ['questionNumber', 'questionId', 'maxMarks', 'awardedMarks', 'criteriaBreakdown', 'feedbackToStudent', 'flag'],
    },
  };

  let providerRun;
  try {
    providerRun = await runProviderRace(
      async () => runAgenticWorkflow({
        ai: ai!,
        draftPrompt: prompt,
        reviewPrompt: 'Review and refine this draft marking output for fairness and consistency. Keep it structured and make sure no marks exceed the maximum allowed for each question.',
        draftSystemInstruction,
        reviewSystemInstruction,
        responseSchema,
      }),
      async () => parseModelJson(await sendOpenAIChat(`${prompt}

Return JSON only. Do not include markdown fences.`, { json: true, system: draftSystemInstruction })),
      async () => deepseekEvaluate(examPaper, examPaper.rubrics || [], JSON.stringify(studentScript.answers || [])),
      async () => parseModelJson(await sendOpenRouterChat(`${prompt}

Return JSON only. Do not include markdown fences.`)),
    );
  } catch (error: any) {
    const fallbackResults = buildFallbackMarkResults(examPaper, studentScript);
    return {
      markedScript: {
        ...studentScript,
        status: 'marked',
        results: fallbackResults,
        totalAwardedMarks: 0,
        maxTotalMarks: fallbackResults.reduce((sum: number, item: any) => sum + Number(item.maxMarks || 0), 0),
        percentage: 0,
        flags: ['needs_teacher_review'],
        teacherApproved: false,
      },
      providers: ['fallback'],
      providerWarnings: [error?.message || String(error)],
    };
  }

  const geminiResult = providerRun.successes.find((p) => p.provider === 'Gemini')?.value;
  const openAIResult: any = providerRun.successes.find((p) => p.provider === 'OpenAI')?.value;
  const deepseekResult: any = providerRun.successes.find((p) => p.provider === 'Deepseek')?.value;
  let results: any[] = (geminiResult || openAIResult || deepseekResult || []) as any[];
  if (!Array.isArray(results)) results = [];
  if (geminiResult && Array.isArray(openAIResult)) {
    const secondOpinion = new Map(openAIResult.map((r: any) => [r.questionId || r.questionNumber, r]));
    results = results.map((r: any) => {
      const other: any = secondOpinion.get(r.questionId || r.questionNumber);
      if (!other) return r;
      const max = clampNumber(r.maxMarks ?? other.maxMarks, 0, Number.MAX_SAFE_INTEGER);
      const blended = (clampNumber(r.awardedMarks, 0, max) + clampNumber(other.awardedMarks, 0, max)) / 2;
      return { ...r, awardedMarks: Math.round(blended * 2) / 2, providerAgreement: Math.abs(Number(r.awardedMarks) - Number(other.awardedMarks)) < 1 };
    });
  }

  let totalAwarded = 0;
  let totalMax = 0;
  const flagsDetected: string[] = [];

  results.forEach((r: any) => {
    totalAwarded += r.awardedMarks || 0;
    totalMax += r.maxMarks || 0;
    if (r.flag && r.flag !== 'none' && !flagsDetected.includes(r.flag)) {
      flagsDetected.push(r.flag);
    }
  });

  const percentage = totalMax > 0 ? Math.round((totalAwarded / totalMax) * 100) : 0;

  return {
    markedScript: {
      ...studentScript,
      status: 'marked',
      results,
      totalAwardedMarks: Math.round(totalAwarded * 10) / 10,
      maxTotalMarks: totalMax,
      percentage,
      flags: flagsDetected,
      teacherApproved: false,
    },
    providers: providerRun.successes.map((p) => p.provider),
    providerWarnings: providerRun.errors,
  };
}

function parseModelJson(rawText: string): any {
  if (!rawText) return {};

  const cleaned = rawText.trim();
  const fenced = cleaned.match(/```(?:json)?([\s\S]*?)```/i);
  const content = fenced ? fenced[1].trim() : cleaned;

  try {
    return JSON.parse(content);
  } catch {
    const objectStart = content.indexOf('{');
    const objectEnd = content.lastIndexOf('}');
    if (objectStart >= 0 && objectEnd > objectStart) {
      try {
        return JSON.parse(content.slice(objectStart, objectEnd + 1));
      } catch {
        // fall through to array parsing
      }
    }

    const arrayStart = content.indexOf('[');
    const arrayEnd = content.lastIndexOf(']');
    if (arrayStart >= 0 && arrayEnd > arrayStart) {
      try {
        return JSON.parse(content.slice(arrayStart, arrayEnd + 1));
      } catch {
        // ignore and return empty object
      }
    }
  }

  return {};
}

async function runAgenticWorkflow(options: {
  ai: GoogleGenAI;
  draftPrompt: string;
  reviewPrompt: string;
  draftSystemInstruction: string;
  reviewSystemInstruction: string;
  responseSchema: any;
  model?: string;
}) {
  const {
    ai,
    draftPrompt,
    reviewPrompt,
    draftSystemInstruction,
    reviewSystemInstruction,
    responseSchema,
    model = 'gemini-2.0-flash',
  } = options;

  const draftResponse = await ai.models.generateContent({
    model,
    contents: draftPrompt,
    config: {
      systemInstruction: draftSystemInstruction,
      responseMimeType: 'application/json',
      responseSchema,
    },
  });

  const draft = parseModelJson(draftResponse.text || '{}');

  const reviewResponse = await ai.models.generateContent({
    model,
    contents: `${reviewPrompt}\n\nDRAFT_OUTPUT:\n${JSON.stringify(draft, null, 2)}`,
    config: {
      systemInstruction: reviewSystemInstruction,
      responseMimeType: 'application/json',
      responseSchema,
    },
  });

  return parseModelJson(reviewResponse.text || '{}');
}

async function sendOpenRouterChat(prompt: string) {
  const headers = getOpenRouterHeaders();
  if (!headers) {
    throw new Error('OPENROUTER_API_KEY is not configured.');
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL || 'openai/gpt-4o',
      max_tokens: 1200,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: 'You are Claude AI Assistant inside AI Marker Hub.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    const message = data?.error?.message || data?.error || `${response.status} ${response.statusText}`;
    throw new Error(`OpenRouter API error: ${message}`);
  }

  const openRouterAnswer =
    data?.choices?.[0]?.message?.content ||
    data?.choices?.[0]?.delta?.content ||
    data?.choices?.[0]?.text ||
    '';

  return openRouterAnswer.trim();
}

// Health Check API
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    geminiKeyPresent: !!process.env.GEMINI_API_KEY,
    openAIKeyPresent: !!process.env.OPENAI_API_KEY,
    openAIModel: process.env.OPENAI_MODEL || 'gpt-5-mini',
    openRouterKeyPresent: !!process.env.OPENROUTER_API_KEY,
    openRouterModel: process.env.OPENROUTER_MODEL || 'openai/gpt-4o',
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/providers', (_req, res) => {
  res.json({
    providers: [
      { id: 'gemini', name: 'Gemini Flash', configured: providerAvailable('gemini'), role: 'primary marker / exam reasoning' },
      { id: 'openai', name: 'OpenAI', configured: providerAvailable('openai'), model: process.env.OPENAI_MODEL || 'gpt-5-mini', role: 'independent second opinion / reconciliation' },
      { id: 'deepseek', name: 'Deepseek', configured: providerAvailable('deepseek'), role: 'alternative marker / fallback' },
    ],
    mode: providerAvailable('gemini') && providerAvailable('openai') ? 'dual-consensus' : 'single-provider',
  });
});

// 1. Exam Generator API Endpoint
app.post('/api/generate-exam', requireAuth, async (req, res) => {
  try {
    const { subject, topic, gradeLevel, difficulty, questionTypes, totalMarks, durationMinutes, additionalInstructions } = req.body;

    if (!subject || !topic) {
      return res.status(400).json({ error: 'Subject and topic are required.' });
    }

    const ai = getAiClient();
    const prompt = `Generate a high-quality exam paper and matching marking rubric based on the following specs:
Subject: ${subject}
Topic: ${topic}
Grade/Year Level: ${gradeLevel || 'Secondary / High School'}
Difficulty Level: ${difficulty || 'Intermediate'}
Requested Question Types: ${(questionTypes || ['short_answer', 'essay', 'calculation']).join(', ')}
Total Marks Target: ${totalMarks || 30}
Duration Target: ${durationMinutes || 45} minutes
Additional Instructions: ${additionalInstructions || 'Ensure clear cognitive levels and unambiguous mark allocations.'}

Return JSON with:
- title: string
- subject: string
- topic: string
- gradeLevel: string
- totalMarks: number (sum of question maxMarks must equal totalMarks)
- durationMinutes: number
- questions: array of { id, number (e.g. Q1, Q2), questionText, maxMarks, questionType ("short_answer" | "essay" | "mcq" | "calculation"), modelAnswer, options (optional array for MCQ) }
- rubrics: array of { questionId, questionNumber, maxMarks, criteria: array of { id, criterion, marksAvailable, description } }`;

    const draftSystemInstruction = `You are Marker AI's Exam Prep engine for schools and universities.
You create rigorous, curriculum-aligned exam papers with matching detailed marking rubrics.
RULES:
1. The sum of maxMarks across all questions MUST EXACTLY EQUAL totalMarks requested (${totalMarks || 30}).
2. For every question, the sum of criteria marksAvailable in its rubric MUST EXACTLY EQUAL that question's maxMarks.
3. Include model answers for every question.
4. Return valid JSON only.`;

    const reviewSystemInstruction = `You are Marker AI's quality reviewer for exam generation.
Check the draft exam for consistency and correctness. Fix any issue before returning the final JSON.
Rules:
- Keep the exam content clear and curriculum-aligned.
- Ensure question marks sum exactly to the requested total.
- Ensure each rubric's criterion marks sum exactly to the question maxMarks.
- Return valid JSON only.`;

    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING },
        subject: { type: Type.STRING },
        topic: { type: Type.STRING },
        gradeLevel: { type: Type.STRING },
        totalMarks: { type: Type.INTEGER },
        durationMinutes: { type: Type.INTEGER },
        questions: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              number: { type: Type.STRING },
              questionText: { type: Type.STRING },
              maxMarks: { type: Type.INTEGER },
              questionType: { type: Type.STRING },
              modelAnswer: { type: Type.STRING },
              options: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ['id', 'number', 'questionText', 'maxMarks', 'questionType', 'modelAnswer'],
          },
        },
        rubrics: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              questionId: { type: Type.STRING },
              questionNumber: { type: Type.STRING },
              maxMarks: { type: Type.INTEGER },
              criteria: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    criterion: { type: Type.STRING },
                    marksAvailable: { type: Type.INTEGER },
                    description: { type: Type.STRING },
                  },
                  required: ['id', 'criterion', 'marksAvailable'],
                },
              },
            },
            required: ['questionId', 'questionNumber', 'maxMarks', 'criteria'],
          },
        },
      },
      required: ['title', 'subject', 'topic', 'gradeLevel', 'totalMarks', 'durationMinutes', 'questions', 'rubrics'],
    };

    const generatedJson = await runAgenticWorkflow({
      ai,
      draftPrompt: prompt,
      reviewPrompt: `Review and refine this draft exam paper. Ensure the structure is valid, the marks add up, and the rubric is aligned with each question. If the draft is already good, keep it and only improve clarity where needed.`,
      draftSystemInstruction,
      reviewSystemInstruction,
      responseSchema,
    });

    generatedJson.id = 'exam-' + Date.now();
    generatedJson.createdAt = new Date().toISOString();

    res.json({ success: true, examPaper: generatedJson });
  } catch (error: any) {
    console.error('Error generating exam:', error);
    res.status(500).json({ error: error.message || 'Failed to generate exam paper.' });
  }
});

// 2. Marking Engine API Endpoint
app.post('/api/mark-script', requireAuth, gradingLimiter, async (req, res) => {
  try {
    const { examPaper, studentScript } = req.body;

    if (!examPaper || !studentScript) {
      return res.status(400).json({ error: 'examPaper and studentScript are required.' });
    }

    const ai = providerAvailable('gemini') ? getAiClient() : null;

    const draftSystemInstruction = `You are Marker AI, an exam-marking assistant for schools and universities.

ROLE
Grade student answers strictly against the provided rubric/answer key. Be consistent, fair, and evidence-based.

WHAT TO DO FOR EACH QUESTION
1. Read the question and its rubric criteria.
2. Read the student's answer for that question only.
3. Match answer content against each rubric criterion.
4. Award partial marks where partially correct — never all-or-nothing unless rubric says so.
5. Ignore spelling/grammar unless the rubric specifically grades language.
6. Flag (do not silently penalize) illegible, blank, or off-topic answers or possible plagiarism (e.g. word-for-word copy of model answer).

FLAG OPTIONS:
- "none": Answer is legible and evaluates normally.
- "illegible": Handwriting or text is unreadable.
- "blank": Student left question blank or explicitly wrote blank/N/A.
- "off_topic": Answer is completely irrelevant to the question asked.
- "possible_plagiarism": Answer appears copied word-for-word from external material or model answer without reasoning.
- "needs_teacher_review": Low confidence or highly ambiguous student response requiring human eyes.

OUTPUT RULES
- Return an array of results, one per question.
- Feedback to student must be 1-2 constructive, encouraging, evidence-based sentences.
- Total awarded_marks for a question must never exceed its max_marks.`;

    const reviewSystemInstruction = `You are Marker AI's quality reviewer for marking.
Review the draft marking results for consistency, fairness, and alignment to the rubric. If any question appears over- or under-marked, correct it.
Keep the structure unchanged but improve accuracy and tone.`;

    const prompt = `Evaluate the following student answer script against the exam paper and rubric.

STUDENT NAME: ${studentScript.studentName} (ID: ${studentScript.studentId})

EXAM PAPER & RUBRIC:
${JSON.stringify(examPaper, null, 2)}

STUDENT ANSWERS:
${JSON.stringify(studentScript.answers, null, 2)}

Return a JSON array where each item represents the mark evaluation for a question:
- questionNumber: string (e.g. Q1)
- questionId: string
- maxMarks: number
- awardedMarks: number
- criteriaBreakdown: array of { criterion: string, marksAvailable: number, marksAwarded: number, reason: string }
- feedbackToStudent: string
- flag: "none" | "illegible" | "blank" | "off_topic" | "possible_plagiarism" | "needs_teacher_review"`;

    const responseSchema = {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          questionNumber: { type: Type.STRING },
          questionId: { type: Type.STRING },
          maxMarks: { type: Type.INTEGER },
          awardedMarks: { type: Type.NUMBER },
          criteriaBreakdown: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                criterion: { type: Type.STRING },
                marksAvailable: { type: Type.NUMBER },
                marksAwarded: { type: Type.NUMBER },
                reason: { type: Type.STRING },
              },
              required: ['criterion', 'marksAvailable', 'marksAwarded', 'reason'],
            },
          },
          feedbackToStudent: { type: Type.STRING },
          flag: { type: Type.STRING },
        },
        required: ['questionNumber', 'questionId', 'maxMarks', 'awardedMarks', 'criteriaBreakdown', 'feedbackToStudent', 'flag'],
      },
    };

    let providerRun;
    try {
      providerRun = await runProviderRace(
        async () => runAgenticWorkflow({
          ai: ai!,
          draftPrompt: prompt,
          reviewPrompt: 'Review and refine this draft marking output for fairness and consistency. Keep it structured and make sure no marks exceed the maximum allowed for each question.',
          draftSystemInstruction,
          reviewSystemInstruction,
          responseSchema,
        }),
        async () => parseModelJson(await sendOpenAIChat(`${prompt}\n\nReturn JSON only. Do not include markdown fences.`, { json: true, system: draftSystemInstruction })),
        async () => deepseekEvaluate(examPaper, examPaper.rubrics || [], JSON.stringify(studentScript.answers || [])),
      );
    } catch (error: any) {
      console.warn('Primary AI providers unavailable for marking, using fallback results.', error?.message || error);
      const fallbackResults = buildFallbackMarkResults(examPaper, studentScript);
      const fallbackMarkedScript = {
        ...studentScript,
        status: 'marked',
        results: fallbackResults,
        totalAwardedMarks: 0,
        maxTotalMarks: fallbackResults.reduce((sum: number, item: any) => sum + Number(item.maxMarks || 0), 0),
        percentage: 0,
        flags: ['needs_teacher_review'],
        teacherApproved: false,
      };
      return res.json({ success: true, markedScript: fallbackMarkedScript, providers: ['fallback'], providerWarnings: [error?.message || String(error)] });
    }

    // Gemini remains the detailed marker when available; OpenAI is a concurrent second opinion.
    // When both respond, reconcile only the numeric award while retaining the richer breakdown.
    const geminiResult = providerRun.successes.find((p) => p.provider === 'Gemini')?.value;
    const openAIResult: any = providerRun.successes.find((p) => p.provider === 'OpenAI')?.value;
    const deepseekResult: any = providerRun.successes.find((p) => p.provider === 'Deepseek')?.value;
    let results: any[] = (geminiResult || openAIResult || deepseekResult || []) as any[];
    if (!Array.isArray(results)) results = [];
    if (geminiResult && Array.isArray(openAIResult)) {
      const secondOpinion = new Map(openAIResult.map((r: any) => [r.questionId || r.questionNumber, r]));
      results = results.map((r: any) => {
        const other: any = secondOpinion.get(r.questionId || r.questionNumber);
        if (!other) return r;
        const max = clampNumber(r.maxMarks ?? other.maxMarks, 0, Number.MAX_SAFE_INTEGER);
        const blended = (clampNumber(r.awardedMarks, 0, max) + clampNumber(other.awardedMarks, 0, max)) / 2;
        return { ...r, awardedMarks: Math.round(blended * 2) / 2, providerAgreement: Math.abs(Number(r.awardedMarks) - Number(other.awardedMarks)) < 1 };
      });
    }

    // Calculate totals
    let totalAwarded = 0;
    let totalMax = 0;
    const flagsDetected: string[] = [];

    results.forEach((r: any) => {
      totalAwarded += r.awardedMarks || 0;
      totalMax += r.maxMarks || 0;
      if (r.flag && r.flag !== 'none' && !flagsDetected.includes(r.flag)) {
        flagsDetected.push(r.flag);
      }
    });

    const percentage = totalMax > 0 ? Math.round((totalAwarded / totalMax) * 100) : 0;

    const markedScript = {
      ...studentScript,
      status: 'marked',
      results,
      totalAwardedMarks: Math.round(totalAwarded * 10) / 10,
      maxTotalMarks: totalMax,
      percentage,
      flags: flagsDetected,
      teacherApproved: false,
    };

    await writeAuditLog((req as any).teacher?.teacherId || 'local-dev', 'MARK_SCRIPT', 'StudentScript', studentScript.studentId, {
      totalAwardedMarks: markedScript.totalAwardedMarks,
      maxTotalMarks: markedScript.maxTotalMarks,
      providers: providerRun.successes.map((p) => p.provider),
    });

    res.json({ success: true, markedScript, providers: providerRun.successes.map((p) => p.provider), providerWarnings: providerRun.errors });
  } catch (error: any) {
    console.error('Error marking script:', error);
    res.status(500).json({ error: error.message || 'Failed to mark student script.' });
  }
});

// 3. Batch Grading Queue API
app.post('/api/grade-batch', requireAuth, gradingLimiter, async (req, res) => {
  try {
    const { examPaper, studentScripts } = req.body;
    if (!examPaper || !Array.isArray(studentScripts) || studentScripts.length === 0) {
      return res.status(400).json({ error: 'examPaper and studentScripts are required.' });
    }

    if (isRedisAvailable && gradingQueue) {
      const job = await gradingQueue.add('grade-batch', {
        examPaper,
        studentScripts,
        submittedAt: new Date().toISOString(),
      });

      await writeAuditLog((req as any).teacher?.teacherId || 'local-dev', 'GRADE_BATCH_SUBMITTED', 'BatchGrade', String(job.id), {
        studentCount: studentScripts.length,
        queued: true,
      });

      return res.status(202).json({
        success: true,
        jobId: job.id,
        message: `Queued ${studentScripts.length} student scripts for batch grading.`,
      });
    }

    const result = await processBatchSynchronously(examPaper, studentScripts);
    await writeAuditLog((req as any).teacher?.teacherId || 'local-dev', 'GRADE_BATCH_SUBMITTED', 'BatchGrade', 'sync', {
      studentCount: studentScripts.length,
      queued: false,
    });
    return res.status(200).json({
      success: true,
      fallback: true,
      message: 'Redis unavailable; processed batch grading synchronously.',
      result,
    });
  } catch (error: any) {
    console.error('Failed to queue batch grading job:', error);
    res.status(500).json({ error: error.message || 'Failed to queue batch grading.' });
  }
});

app.post('/api/export-gradebook', requireAuth, async (req, res) => {
  try {
    const { batchTitle, results } = req.body;
    if (!Array.isArray(results) || results.length === 0) {
      return res.status(400).json({ error: 'Batch title and results are required.' });
    }

    const exportResults = results.map((item: any) => ({
      studentId: String(item.studentId || item.id || 'unknown'),
      studentName: String(item.studentName || item.name || 'Student'),
      totalScore: Number(item.totalScore || item.score || 0),
      maxScore: Number(item.maxScore || item.maxScore || 0),
      gradePercentage: Number(item.gradePercentage || (item.score || 0) / Math.max(item.maxScore || 1, 1)),
      status: item.status || 'Needs Review',
      identityVerified: item.identityVerified ?? true,
      breakdown: Array.isArray(item.breakdown)
        ? item.breakdown.map((row: any) => ({
            question: String(row.question || ''),
            score: Number(row.score || 0),
            max: Number(row.max || row.maxScore || 0),
            feedback: String(row.feedback || row.feedbackToStudent || ''),
          }))
        : [],
    }));

    const buffer = await generateBatchExcelReport(batchTitle || 'Batch Results', exportResults);
    const fileKey = `ad_hoc_export_${Date.now()}.xlsx`;
    const fileUrl = await uploadBufferToCloud(
      buffer,
      fileKey,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );

    res.json({ success: true, excelReportUrl: fileUrl });
  } catch (error: any) {
    console.error('Failed to generate export gradebook:', error);
    res.status(500).json({ error: error.message || 'Failed to generate gradebook export.' });
  }
});

app.get('/api/grade-batch/:jobId/progress', async (req, res) => {
  try {
    if (!isRedisAvailable || !gradingQueue) {
      return res.status(503).json({ error: 'Batch progress is unavailable while Redis is offline.' });
    }

    const { jobId } = req.params;
    const job = await gradingQueue.getJob(jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found.' });
    }

    const state = await job.getState();
    const progress = job.progress;
    const result = job.returnvalue;
    const excelReportUrl = (job.data as any)?.excelReportUrl || (result as any)?.excelReportUrl || null;

    res.json({ success: true, jobId, state, progress, result, excelReportUrl });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to read job progress.' });
  }
});

app.get('/api/grade-batch/:jobId/stream', async (req, res) => {
  if (!isRedisAvailable || !gradingQueue) {
    res.status(503).json({ error: 'Batch streaming is unavailable while Redis is offline.' });
    return;
  }

  // Same reasoning as the worker event-listener block above: `gradingQueue` is a
  // module-level `let`, so it needs to be captured in an explicitly-typed local
  // before being used inside the `setInterval` closure below. Referencing
  // `gradingQueue` directly inside that closure is what produced the
  // "'gradingQueue' is possibly 'null'" error, since TypeScript can't prove the
  // outer variable is still non-null by the time the interval callback runs.
  const queue: Queue<any, any, string> = gradingQueue;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const { jobId } = req.params;

  const interval = setInterval(async () => {
    const job = await queue.getJob(jobId);
    if (!job) return;

    const progress = job.progress;
    const state = await job.getState();
    res.write(`data: ${JSON.stringify({ jobId, state, progress })}\n\n`);

    if (state === 'completed' || state === 'failed') {
      const result = state === 'completed' ? job.returnvalue : null;
      res.write(`data: ${JSON.stringify({ jobId, state, progress, result, completed: state === 'completed' })}\n\n`);
      clearInterval(interval);
      res.end();
    }
  }, 1000);

  req.on('close', () => {
    clearInterval(interval);
  });
});

// 4. Auto-draft / Refine Rubric API
app.post('/api/generate-rubric', requireAuth, async (req, res) => {
  try {
    const { questionText, maxMarks, modelAnswer } = req.body;

    const ai = getAiClient();
    const prompt = `Create a granular marking rubric for this exam question:
Question: "${questionText}"
Max Marks: ${maxMarks}
Model Answer: "${modelAnswer || 'N/A'}"

Break down into specific criteria whose total points sum to ${maxMarks}.`;

    const draftSystemInstruction = `You are Marker AI's rubric designer. Create a detailed criteria breakdown that totals exactly to the requested maximum marks.`;
    const reviewSystemInstruction = `You are Marker AI's rubric reviewer. Verify that the criteria sum to the requested marks and improve wording for clarity.`;

    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        criteria: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              criterion: { type: Type.STRING },
              marksAvailable: { type: Type.NUMBER },
              description: { type: Type.STRING },
            },
            required: ['id', 'criterion', 'marksAvailable'],
          },
        },
      },
      required: ['criteria'],
    };

    const data = await runAgenticWorkflow({
      ai,
      draftPrompt: prompt,
      reviewPrompt: 'Review the rubric and ensure each criterion contributes to the total marks exactly and stays clear for marker use.',
      draftSystemInstruction,
      reviewSystemInstruction,
      responseSchema,
    });

    res.json({ success: true, criteria: data.criteria || [] });
  } catch (error: any) {
    console.error('Error generating rubric:', error);
    res.status(500).json({ error: error.message || 'Failed to generate rubric.' });
  }
});

// 4. Summarize AI Endpoint
app.post('/api/ai/summarize', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Text required' });

    const ai = getAiClient();
    const draftPrompt = `Summarize the following text into 1 concise, high-impact bullet point insight for academic study:\n\n"${text}"`;

    const draftResponse = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: draftPrompt,
    });

    const draftSummary = (draftResponse.text || 'Key insight summarized.').trim();

    const reviewResponse = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: `Review the summary for clarity and brevity. Return only one improved sentence or bullet point.\n\nDRAFT_SUMMARY:\n${draftSummary}`,
    });

    res.json({ success: true, summary: (reviewResponse.text || draftSummary).trim() || 'Key insight summarized.' });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Summarization failed' });
  }
});

// 5. Translate AI Endpoint
app.post('/api/ai/translate', async (req, res) => {
  try {
    const { text, targetLanguage } = req.body;
    if (!text || !targetLanguage) return res.status(400).json({ error: 'Text and targetLanguage required' });

    const ai = getAiClient();
    const draftPrompt = `Translate the following academic text accurately into ${targetLanguage}:\n\n"${text}"`;

    const draftResponse = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: draftPrompt,
    });

    const draftTranslation = (draftResponse.text || 'Translation complete.').trim();

    const reviewResponse = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: `Review the translation for accuracy and fluency in ${targetLanguage}. Return only the improved translation.\n\nDRAFT_TRANSLATION:\n${draftTranslation}`,
    });

    res.json({ success: true, translation: (reviewResponse.text || draftTranslation).trim() || 'Translation complete.' });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Translation failed' });
  }
});

// 6. Claude Assistant Chat Endpoint
app.post('/api/ai/chat', requireAuth, async (req, res) => {
  try {
    const { query, documentContext, fileContext, examContext, selectedEvidence, replyTo, attachmentBase64, attachmentMimeType, prompt: promptBody, attachmentText, attachmentName } = req.body;
    const userQuery = String(query || promptBody || '').trim();
    if (!userQuery) return res.status(400).json({ error: 'Query required' });

    const normalizedMimeType = attachmentMimeType === 'image/jfif' ? 'image/jpeg' : attachmentMimeType;
    const useClaude = AI_PROVIDER === 'claude' || (!process.env.GEMINI_API_KEY && process.env.OPENROUTER_API_KEY);
    let ai: any = null;
    if (!useClaude) {
      ai = getAiClient();
    }
    const documentText = String(attachmentText || fileContext || '').trim();
    const documentName = String(attachmentName || documentContext || 'Submission').trim();

    const isFileSummaryRequest = /\b(type of this file|what is type of this file|file summary|file info|format of this file|what format|mime type)\b/i.test(userQuery);
    if (isFileSummaryRequest && (attachmentName || documentName)) {
      const friendlyMime = normalizedMimeType === 'image/jpeg' ? 'JPEG Image' : normalizedMimeType || 'Unknown file type';
      const fileAnswer = `**File Summary:**\n- **Name:** ${attachmentName || documentName}\n- **Format:** ${friendlyMime}\n- **Status:** Ready for optical scan & rubric evaluation. Click **Start Marking** to evaluate.`;
      return res.json({ success: true, answer: fileAnswer, provider: 'System' });
    }

    const prompt = buildBwengeGradingPrompt(
      userQuery,
      documentText || undefined,
      documentName || undefined,
      String(examContext || '').trim() || undefined,
      String(selectedEvidence || '').trim() || undefined,
    );

    const isGradingRequest = /grade|evaluate|mark|score|feedback|correct|analysis?/i.test(userQuery);
    const promptLines = [
      BWENGE_SYSTEM_PROMPT,
      prompt,
    ];

    if (isGradingRequest) {
      promptLines.push('When grading, return a structured report with evidence, corrections, and practical next steps rather than generic commentary.');
    }

    promptLines.push('Format the final answer with markdown headings, bullet points, tables if useful, and concise explanatory prose so it feels like a polished AI assistant response.');

    if (replyTo) {
      promptLines.push(`Replying to: "${replyTo}"`);
    }

    const finalPrompt = promptLines.join('\n\n');

    let answer = '';
    let usedProvider = 'Gemini';
    let providerError: any = null;
    const useClaude = AI_PROVIDER === 'claude' || (!process.env.GEMINI_API_KEY && process.env.OPENROUTER_API_KEY);

    try {
      if (useClaude) {
        usedProvider = 'Claude';
        answer = await sendOpenRouterChat(finalPrompt);
      } else {
        const contents: any[] = [];
        if (attachmentBase64) {
          contents.push({
            inlineData: {
              data: attachmentBase64,
              mimeType: attachmentMimeType || 'application/octet-stream',
            },
          });
        }
        contents.push(finalPrompt);

        const response = await ai.models.generateContent({
          model: 'gemini-2.0-flash',
          contents,
          config: {
            systemInstruction: BWENGE_SYSTEM_PROMPT,
            temperature: 0.2,
            topP: 0.95,
            responseMimeType: 'text/plain',
          },
        });

        answer = response.text?.trim() || '';
        if (!answer) {
          throw new Error('Empty response from Gemini');
        }

        const reviewResponse = await ai.models.generateContent({
          model: 'gemini-2.0-flash',
          contents: `Review the answer below for accuracy, completeness, and direct relevance to the user's question. If the answer is already strong, return it unchanged. Otherwise, improve it.\n\nUSER_QUESTION:\n${userQuery}\n\nDRAFT_ANSWER:\n${answer}`,
          config: {
            systemInstruction: 'You are a careful academic reviewer. Improve structure, evidence, and precision without inventing facts. Keep the response focused on the actual document content and the user question.',
            temperature: 0.1,
            topP: 0.9,
            responseMimeType: 'text/plain',
          },
        });

        const refinedAnswer = reviewResponse.text?.trim() || answer;
        answer = refinedAnswer;
      }
    } catch (error: any) {
      providerError = error;
      console.error(`${usedProvider} chat failed:`, providerError);
      answer = buildFallbackChatReply(userQuery, attachmentName, normalizedMimeType);
      usedProvider = 'Fallback';
    }

    res.json({ success: true, answer, provider: usedProvider });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Chat failed' });
  }
});

// Vite Middleware Integration
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Marker AI server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();