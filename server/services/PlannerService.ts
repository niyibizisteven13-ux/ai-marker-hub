import crypto from 'crypto';
import logger from '../utils/logger.js';

const DEFAULT_FETCH_TIMEOUT_MS = 60_000;

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...init, signal: controller.signal }); }
  catch (err: any) {
    if (err?.name === 'AbortError') throw new Error(`Request to ${url} timed out after ${timeoutMs}ms`);
    throw err;
  } finally { clearTimeout(timer); }
}

export type TaskStatus = 'pending' | 'running' | 'done' | 'failed';

export interface PlanTask {
  id: string;
  title: string;
  description: string;
  tool?: string; // optional tool to use for this task
  toolInput?: any;
  dependencies: string[]; // ids of tasks that must complete first
  status: TaskStatus;
  result?: string;
  error?: string;
}

export interface Plan {
  id: string;
  goal: string;
  tasks: PlanTask[];
  createdAt: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  finalSummary?: string;
}

export class PlannerService {
  private static instance: PlannerService;
  private plans = new Map<string, Plan>();
  private gonkaBaseUrl: string;
  private gonkaApiKey: string;
  private gonkaModel: string;

  private constructor() {
    this.gonkaApiKey = process.env.GONKA_API_KEY || '';
    this.gonkaBaseUrl = (process.env.GONKA_BASE_URL || 'https://api.gonkarouter.io/v1').replace(/\/$/, '') + '/chat/completions';
    this.gonkaModel = process.env.GONKA_MODEL || 'zai-org/GLM-5.3-Flash';
  }

  public static getInstance(): PlannerService {
    if (!PlannerService.instance) PlannerService.instance = new PlannerService();
    return PlannerService.instance;
  }

  /**
   * Decompose a high-level goal into a list of micro-tasks using Gonka.
   */
  public async decompose(goal: string): Promise<Plan> {
    const planId = crypto.randomUUID();
    const systemPrompt = `You are an autonomous planning engine. Given a user goal, decompose it into 3-7 concrete, actionable micro-tasks.
Return ONLY valid JSON in this exact shape:
{
  "tasks": [
    {
      "id": "task_1",
      "title": "<short title>",
      "description": "<what to do>",
      "tool": <optional: "web_search"|"analyze_data_with_python"|"read_document"|null>,
      "dependencies": []
    }
  ]
}
Rules:
- Each task must be specific and actionable.
- Use "dependencies" to define which task IDs must complete before this one starts.
- If a task can use a tool, specify it.
- Do NOT include any text outside the JSON object.`;
    const userPrompt = `GOAL: ${goal}`;

    if (!this.gonkaApiKey) {
      const plan: Plan = {
        id: planId,
        goal,
        tasks: [{ id: 'task_1', title: 'Complete goal manually', description: goal, dependencies: [], status: 'pending' }],
        createdAt: new Date().toISOString(),
        status: 'pending',
      };
      this.plans.set(planId, plan);
      return plan;
    }

    try {
      const response = await fetchWithTimeout(this.gonkaBaseUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.gonkaApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.gonkaModel,
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
          temperature: 0.3, max_tokens: 2048, stream: false,
        }),
      }, 60_000);
      const data: any = await response.json();
      if (!response.ok) throw new Error(`Gonka PlannerService error: ${data?.error?.message}`);
      const raw = (data?.choices?.[0]?.message?.content || '').replace(/```json?/g, '').replace(/```/g, '').trim();
      const json = JSON.parse(raw);
      const tasks: PlanTask[] = (json.tasks || []).map((t: any) => ({
        id: t.id || crypto.randomUUID(),
        title: t.title || 'Untitled task',
        description: t.description || '',
        tool: t.tool || undefined,
        dependencies: Array.isArray(t.dependencies) ? t.dependencies : [],
        status: 'pending' as TaskStatus,
      }));
      const plan: Plan = { id: planId, goal, tasks, createdAt: new Date().toISOString(), status: 'pending' };
      this.plans.set(planId, plan);
      logger.info(`PlannerService: created plan ${planId} with ${tasks.length} tasks for goal: ${goal.slice(0, 80)}`);
      return plan;
    } catch (e) {
      logger.error('PlannerService.decompose error', e);
      const fallback: Plan = {
        id: planId,
        goal,
        tasks: [{ id: 'task_1', title: 'Research goal', description: `Search for information about: ${goal}`, tool: 'web_search', dependencies: [], status: 'pending' }],
        createdAt: new Date().toISOString(),
        status: 'pending',
      };
      this.plans.set(planId, fallback);
      return fallback;
    }
  }

  public getPlan(id: string): Plan | undefined { return this.plans.get(id); }

  public updateTaskStatus(planId: string, taskId: string, status: TaskStatus, result?: string, error?: string) {
    const plan = this.plans.get(planId);
    if (!plan) return;
    const task = plan.tasks.find(t => t.id === taskId);
    if (!task) return;
    task.status = status;
    if (result !== undefined) task.result = result;
    if (error !== undefined) task.error = error;
    const allDone = plan.tasks.every(t => t.status === 'done');
    const anyFailed = plan.tasks.some(t => t.status === 'failed');
    plan.status = allDone ? 'done' : anyFailed ? 'failed' : 'running';
  }

  /**
   * Execute a plan step by step using the provided tool executor.
   * Streams progress events.
   */
  public async execute(
    planId: string,
    executeTool: (name: string, input: any) => Promise<string>,
    onProgress: (event: { type: 'task_start' | 'task_done' | 'task_failed' | 'plan_done' | 'summary'; taskId?: string; title?: string; result?: string; error?: string; summary?: string }) => void
  ): Promise<Plan> {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error(`Plan ${planId} not found`);
    plan.status = 'running';

    // Execute tasks respecting dependencies (simple topological order)
    const completed = new Set<string>();
    const maxRounds = plan.tasks.length * 2;
    let rounds = 0;

    while (completed.size < plan.tasks.length && rounds < maxRounds) {
      rounds++;
      for (const task of plan.tasks) {
        if (completed.has(task.id)) continue;
        if (task.status === 'failed') continue;
        if (task.dependencies.some(d => !completed.has(d))) continue; // wait for deps

        this.updateTaskStatus(planId, task.id, 'running');
        onProgress({ type: 'task_start', taskId: task.id, title: task.title });

        try {
          let result: string;
          if (task.tool) {
            result = await executeTool(task.tool, task.toolInput || { query: task.description });
          } else {
            // Use Gonka to "think through" tasks without a tool
            result = await this.thinkThroughTask(task.description, plan.goal);
          }
          this.updateTaskStatus(planId, task.id, 'done', result);
          completed.add(task.id);
          onProgress({ type: 'task_done', taskId: task.id, title: task.title, result });
        } catch (e: any) {
          const err = e?.message || String(e);
          this.updateTaskStatus(planId, task.id, 'failed', undefined, err);
          completed.add(task.id);
          onProgress({ type: 'task_failed', taskId: task.id, title: task.title, error: err });
        }
      }
    }

    // Synthesize final summary
    const summary = await this.synthesizeSummary(plan);
    plan.finalSummary = summary;
    plan.status = plan.tasks.every(t => t.status === 'done') ? 'done' : 'failed';
    onProgress({ type: 'plan_done', summary });
    return plan;
  }

  private async thinkThroughTask(taskDescription: string, overallGoal: string): Promise<string> {
    if (!this.gonkaApiKey) return `Task: ${taskDescription}`;
    const systemPrompt = `You are an autonomous task executor. Think through the task below and provide a concrete result or analysis. Be specific and actionable.`;
    const userPrompt = `OVERALL GOAL: ${overallGoal}\n\nTASK: ${taskDescription}\n\nProvide a specific, concrete result for this task.`;
    try {
      const response = await fetchWithTimeout(this.gonkaBaseUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.gonkaApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.gonkaModel,
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
          temperature: 0.3, max_tokens: 1024, stream: false,
        }),
      }, 30_000);
      const data: any = await response.json();
      return (data?.choices?.[0]?.message?.content || '').trim();
    } catch (e: any) {
      return `Could not process task: ${e.message}`;
    }
  }

  private async synthesizeSummary(plan: Plan): Promise<string> {
    if (!this.gonkaApiKey) return `Plan completed: ${plan.goal}`;
    const taskResults = plan.tasks.map(t => `[${t.status.toUpperCase()}] ${t.title}: ${t.result || t.error || 'No result'}`).join('\n');
    const systemPrompt = `You are a plan synthesizer. Given a goal and task results, write a clear, concise final summary for the user. Use markdown formatting. Be specific about what was achieved.`;
    const userPrompt = `GOAL: ${plan.goal}\n\nTASK RESULTS:\n${taskResults}`;
    try {
      const response = await fetchWithTimeout(this.gonkaBaseUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.gonkaApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.gonkaModel,
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
          temperature: 0.3, max_tokens: 1024, stream: false,
        }),
      }, 30_000);
      const data: any = await response.json();
      return (data?.choices?.[0]?.message?.content || '').trim();
    } catch { return `Plan completed: ${plan.goal}`; }
  }
}
