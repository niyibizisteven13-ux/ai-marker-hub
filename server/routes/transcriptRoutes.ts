import { Router, type Request, type Response } from 'express';
import { LearnError } from '../services/learning/practice.js';
import { publicTranscript } from '../services/transcripts.js';

/** Public: a student opens their private transcript link. No account; the unguessable token is the key. */
export function createTranscriptPublicRouter() {
  const r = Router();
  r.get('/:token', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex');
    try { res.json(await publicTranscript(String(req.params.token))); }
    catch (e) {
      if (e instanceof LearnError) return res.status(404).json({ error: e.message, code: e.code });
      res.status(500).json({ error: 'The transcript could not be loaded.' });
    }
  });
  return r;
}
