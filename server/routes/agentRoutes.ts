import { Router } from 'express';
import { AiService } from '../services/AiService.js';
import { agentTools, AGENT_SYSTEM_PROMPT } from '../services/agentTools.js';
import { ensureProject, getMessages, saveMessages } from '../services/projectStore.js';
import { executeAgentTool } from '../services/executeAgentTool.js';
import { initSandboxProject, killSandbox } from '../services/sandboxManager.js';
import { writeAuditLog } from '../../production/auth.js';

const router = Router();
const aiService = AiService.getInstance();

router.post('/projects/:id/init', async (req, res) => {
  try {
    const projectId = req.params.id;
    await ensureProject(projectId);
    await initSandboxProject(projectId);
    res.json({ success: true, message: 'Sandbox initialized with React+Vite template' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/projects/:id/message', async (req, res) => {
  const projectId = req.params.id;
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
    send('text', { text: `Error: ${err.message}` });
    send('done', {});
  }

  res.end();
});

router.delete('/projects/:id', async (req, res) => {
  try {
    const projectId = req.params.id;
    await killSandbox(projectId);
    res.json({ success: true, message: 'Sandbox terminated' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
