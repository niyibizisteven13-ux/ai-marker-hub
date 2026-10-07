import { Router } from 'express';
import { AiService } from '../services/AiService.js';
import { agentTools, AGENT_SYSTEM_PROMPT } from '../services/agentTools.js';
import { ensureProject, getMessages, saveMessages } from '../services/projectStore.js';
import { executeAgentTool } from '../services/executeAgentTool.js';
import { initSandboxProject, killSandbox } from '../services/sandboxManager.js';
import { writeAuditLog } from '../../production/auth.js';

const router = Router();
const aiService = AiService.getInstance();
function ownedProject(req: any, res: any, next: any) {
  const userId = req.user?.userId;
  const projectId = req.params.id;
  if (!userId) return res.status(401).json({ error: 'Authentication required.' });
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(projectId)) return res.status(400).json({ error: 'Invalid project id.' });
  // Project ids in the filesystem sandbox are namespaced by account.
  req.accountProjectId = `${userId}:${projectId}`;
  next();
}

router.post('/projects/:id/init', ownedProject, async (req, res) => {
  try {
    const projectId = req.accountProjectId;
    await ensureProject(projectId);
    await initSandboxProject(projectId);
    res.json({ success: true, message: 'Sandbox initialized with React+Vite template' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/projects/:id/message', ownedProject, async (req, res) => {
  const projectId = req.accountProjectId;
  if (typeof req.body?.message !== 'string' || !req.body.message.trim() || req.body.message.length > 20000) {
    return res.status(400).json({ error: 'Message must be between 1 and 20,000 characters.' });
  }
  await ensureProject(projectId);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (event: string, data: any) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const messages = getMessages(projectId);
  messages.push({ role: 'user', content: req.body.message });

  try {
    const finalMessages = await aiService.runAgentLoop({
      messages,
      tools: agentTools,
      systemPrompt: AGENT_SYSTEM_PROMPT,
      executeTool: (name, input) => executeAgentTool(projectId, name, input),
      onEvent: (event) => send(event.type, event.data),
    });

    saveMessages(projectId, finalMessages);

    await writeAuditLog((req as any).user?.userId || 'local-dev', 'AGENT_BUILD_TURN', 'Project', projectId, {
      turns: finalMessages.length,
    });
  } catch (err: any) {
    send('text', { text: `Error: ${process.env.NODE_ENV === 'production' ? 'Agent request failed.' : err.message}` });
    send('done', {});
  }

  res.end();
});

router.delete('/projects/:id', ownedProject, async (req, res) => {
  try {
    const projectId = req.accountProjectId;
    await killSandbox(projectId);
    res.json({ success: true, message: 'Sandbox terminated' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
