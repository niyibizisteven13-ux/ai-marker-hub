import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import logger from '../utils/logger.js';
import { AiService } from '../services/AiService.js';
import { extractText } from '../services/ai/files/extract.js';
import { createForm } from '../services/forms/service.js';
import { allowAi, chargeAi, AI_PRICE } from '../services/billing/aiMeter.js';
import { FromFileError, draftQuiz, type QuizAi } from '../services/forms/fromFile.js';

/** The same model route the form generator uses; only the question-writing prompt differs. */
const defaultAi: QuizAi = {
  async json(system, user) {
    const ai = AiService.getInstance();
    return ai.parseModelJson(await ai.sendGonkaChat(user, { system }));
  },
};

const ALLOWED = new Set(['pdf', 'docx', 'pptx', 'xlsx', 'txt', 'md', 'csv', 'html', 'htm']);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 1 } });

/**
 * POST /api/forms/from-file   (signed in)   multipart: file, and optional count, kinds, points, longPoints, title
 * Reads the lecturer's file, has the model draft questions from it, checks every one against the file, and saves a CLOSED
 * quiz in the form builder together with a review of what to check. Mounted behind requireAuth.
 */
/** What the credits check and the charge do; tests replace them. */
export interface FromFileMeter { allow: (res: Response, userId: string) => Promise<boolean>; charge: (userId: string, inputChars: number, outputChars: number) => void }
const realMeter: FromFileMeter = {
  allow: (res, userId) => allowAi(res, userId, 'artifact'),
  charge: (userId, input, output) => void chargeAi(userId, { kind: 'artifact', input, output, minCredits: AI_PRICE.quizFromFile }),
};

export function createFormFromFileRouter(deps: { ai?: QuizAi; meter?: FromFileMeter } = {}) {
  const meter = deps.meter ?? realMeter;
  const r = Router();
  const ai = deps.ai ?? defaultAi;
  // Drafting costs money, so only requests that actually reach the model count: a wrong file type or a scan costs nothing.
  const max = Number(process.env.FROM_FILE_PER_HOUR || 8);
  const used = new Map<string, number[]>();
  const allow = (userId: string) => {
    const now = Date.now();
    const recent = (used.get(userId) ?? []).filter((t) => now - t < 3_600_000);
    if (recent.length >= max) { used.set(userId, recent); return false; }
    used.set(userId, [...recent, now]);
    if (used.size > 5000) used.clear();
    return true;
  };

  r.post('/', (req: Request, res: Response, next) => upload.single('file')(req, res, (err?: any) => {
    if (err) return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ code: 'BAD_UPLOAD', error: err.code === 'LIMIT_FILE_SIZE' ? 'That file is larger than 20 MB.' : 'The file could not be uploaded.' });
    next();
  }), async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const userId = (req as any).user?.userId;
      const file = (req as any).file as { originalname: string; mimetype: string; buffer: Buffer } | undefined;
      if (!userId) return res.status(401).json({ error: 'Authentication required.' });
      if (!file) return res.status(400).json({ code: 'NO_FILE', error: 'Choose a file first.' });
      const name = file.originalname.slice(0, 160);
      const ext = (name.split('.').pop() ?? '').toLowerCase();
      if (/^(png|jpe?g|webp|gif|bmp|heic)$/.test(ext)) return res.status(422).json({ code: 'IMAGE', error: 'Photos are not supported yet. Upload the notes as a PDF, Word or PowerPoint file, or paste them into a text file.' });
      if (!ALLOWED.has(ext)) return res.status(422).json({ code: 'TYPE', error: 'Upload a PDF, Word, PowerPoint, Excel, text or HTML file.' });

      const read = await extractText({ name, mime: file.mimetype, data: file.buffer }, { maxChars: 80_000 });
      if (read.kind !== 'text' || !read.text?.trim()) {
        return res.status(422).json({ code: 'NO_TEXT', error: read.note?.includes('scan') ? 'This PDF is a scan with no text we can read. Upload a version with selectable text, or a Word file.' : (read.note || 'We could not read any text in this file.') });
      }
      if (!allow(String(userId))) return res.status(429).json({ code: 'RATE_LIMITED', error: 'You have made several quizzes from files in the last hour. Please wait a while and try again.' });
      if (!(await meter.allow(res, String(userId)))) return;
      const draft = await draftQuiz({ text: read.text, fileName: name, options: { count: req.body?.count, kinds: req.body?.kinds, points: req.body?.points, longPoints: req.body?.longPoints, title: req.body?.title }, ai });
      meter.charge(String(userId), read.text.length, JSON.stringify(draft.schema).length);
      const formId = await createForm(userId, { ...draft.schema, importReview: draft.review });
      res.status(201).json({ formId, review: draft.review });
    } catch (e) {
      if (e instanceof FromFileError) return res.status(e.status).json({ code: e.code, error: e.message });
      logger.error('[from-file] failed', { errorType: (e as Error)?.name });
      res.status(500).json({ code: 'INTERNAL_ERROR', error: 'The quiz could not be made. Please try again.' });
    }
  });
  return r;
}
