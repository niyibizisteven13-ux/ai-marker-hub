import { Router } from 'express';
import { AiService } from '../services/AiService.js';
import logger from '../utils/logger.js';

const router = Router();
const aiService = AiService.getInstance();

router.get('/tags', async (req, res) => {
  try {
    const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    const response = await fetch(`${baseUrl}/api/tags`);
    const data = await response.json();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/chat', async (req, res) => {
  try {
    const { prompt, model, system, json } = req.body;
    const answer = await aiService.sendOllamaChat(prompt, { model, system, json });
    res.json({ success: true, answer });
  } catch (err: any) {
    logger.error('Ollama chat failed', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
