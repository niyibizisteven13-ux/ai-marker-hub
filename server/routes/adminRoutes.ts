import { Router } from 'express';
import { getRealizedMargin } from '../services/CostTrackingService.js';
import { CostCircuitBreakerService } from '../services/CostCircuitBreakerService.js';
import { prisma } from '../db.js';
import { writeAuditLog } from '../../production/auth.js';

const router = Router();

// In-memory store for enterprise admin controls (Colab tunnel, compute matrix, safety patches, routing weights)
let colabConfig = {
  tunnelUrl: process.env.COLAB_TUNNEL_URL || '',
  status: 'disconnected' as 'connected' | 'disconnected' | 'syncing',
  lastSyncAt: null as string | null,
  syncedChunksCount: 0,
  activeModel: 'GPT-4o / Claude 3.5 Sonnet + Local RAG',
};

let computeMatrixState = {
  clusterCapacityPercent: 78.4,
  gpuAllocation: 'H100 Cluster Alpha (8x 80GB)',
  networkRoutingLoad: 'Normal (1.2 Gbps)',
  tokenGenerationQueueLength: 14,
  forcedOptimization: false,
};

let safetyState = {
  flaggedRatio: 0.0012,
  toxicityClusterCount: 0,
  guardrailBypassesDetected: 0,
  temperatureConstraint: 0.2,
  safetyAlignmentPatch: 'v2.4-strict-academic',
};

let modelRoutingState = {
  primaryModel: 'claude-3-5-sonnet',
  fallbackModel: 'gemini-2.5-flash',
  localOllamaModel: 'llama3:8b',
  routingSplitPercent: 85, // % primary
};

// Margin Check & Overview
router.get('/margin-check', async (req, res) => {
  try {
    const grading = await getRealizedMargin('grading', 24);
    const scoring = await getRealizedMargin('scoring', 24);
    const hourlySpend = await CostCircuitBreakerService.getHourlySpend();
    const threshold = CostCircuitBreakerService.getThreshold();
    const isCircuitOpen = await CostCircuitBreakerService.isCircuitOpen();

    const failedJobsCount = await prisma.failedJob.count({
      where: { status: 'needs_review' }
    });

    res.json({
      success: true,
      data: {
        grading,
        scoring,
        failedJobsCount,
        hourlySpend,
        threshold,
        isCircuitOpen,
        isForcedOpen: CostCircuitBreakerService.getForcedOpenState(),
        targetMargin: 1.2,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/circuit-breaker/toggle', async (req, res) => {
  const open = req.body?.open;
  if (typeof open !== 'boolean') {
    return res.status(400).json({ success: false, error: 'The open field must be a boolean.' });
  }
  CostCircuitBreakerService.forceOpen(open);
  await writeAuditLog((req as any).user?.userId, 'CIRCUIT_BREAKER_TOGGLED', 'cost_circuit_breaker', null, { open });
  res.json({ success: true, isForcedOpen: open });
});

router.get('/failed-jobs', async (req, res) => {
  try {
    const jobs = await prisma.failedJob.findMany({
      where: { status: 'needs_review' },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, jobId: true, jobType: true, errorMessage: true, attempts: true, createdAt: true },
    });
    res.json({ success: true, data: jobs });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/audit-logs', async (req, res) => {
  try {
    const { actorId, action, resourceType, limit = '50' } = req.query;
    const take = Number(limit);
    if (!Number.isInteger(take) || take < 1 || take > 100) {
      return res.status(400).json({ success: false, error: 'Limit must be an integer between 1 and 100.' });
    }

    const where: any = {};
    if (actorId) where.actorId = actorId as string;
    if (action) where.action = action as string;
    if (resourceType) where.resourceType = resourceType as string;

    const logs = await prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
    });

    res.json({ success: true, data: logs });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- Google Colab & Local AI Knowledge Console APIs ---

router.get('/colab/status', (req, res) => {
  res.json({ success: true, data: colabConfig });
});

router.post('/colab/configure', async (req, res) => {
  const { tunnelUrl } = req.body;
  if (typeof tunnelUrl !== 'string') {
    return res.status(400).json({ success: false, error: 'Tunnel URL must be a string.' });
  }
  colabConfig.tunnelUrl = tunnelUrl.trim();
  colabConfig.status = colabConfig.tunnelUrl ? 'connected' : 'disconnected';
  await writeAuditLog((req as any).user?.userId, 'COLAB_CONFIG_UPDATED', 'colab_console', null, { tunnelUrl: colabConfig.tunnelUrl });
  res.json({ success: true, data: colabConfig });
});

router.post('/colab/sync', async (req, res) => {
  try {
    colabConfig.status = 'syncing';
    // Simulate sync with Google Colab local knowledge vector store
    setTimeout(() => {
      colabConfig.status = 'connected';
      colabConfig.lastSyncAt = new Date().toISOString();
      colabConfig.syncedChunksCount += 1420;
    }, 1500);

    await writeAuditLog((req as any).user?.userId, 'COLAB_KNOWLEDGE_SYNC', 'colab_console', null, {});
    res.json({ success: true, message: 'Google Colab local knowledge sync initiated.', data: colabConfig });
  } catch (error: any) {
    colabConfig.status = 'connected';
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- Compute & GPU Matrix APIs ---

router.get('/compute/matrix', (req, res) => {
  res.json({ success: true, data: computeMatrixState });
});

router.post('/compute/override', async (req, res) => {
  const { forcedOptimization } = req.body;
  if (typeof forcedOptimization === 'boolean') {
    computeMatrixState.forcedOptimization = forcedOptimization;
    computeMatrixState.clusterCapacityPercent = forcedOptimization ? 45.2 : 78.4;
  }
  await writeAuditLog((req as any).user?.userId, 'COMPUTE_OVERRIDE', 'compute_matrix', null, computeMatrixState);
  res.json({ success: true, data: computeMatrixState });
});

// --- Safety & Moderation Hub APIs ---

router.get('/safety/metrics', (req, res) => {
  res.json({ success: true, data: safetyState });
});

router.post('/safety/patch', async (req, res) => {
  const { temperatureConstraint, safetyAlignmentPatch } = req.body;
  if (typeof temperatureConstraint === 'number') {
    safetyState.temperatureConstraint = temperatureConstraint;
  }
  if (typeof safetyAlignmentPatch === 'string') {
    safetyState.safetyAlignmentPatch = safetyAlignmentPatch;
  }
  await writeAuditLog((req as any).user?.userId, 'SAFETY_PATCH_APPLIED', 'safety_hub', null, safetyState);
  res.json({ success: true, data: safetyState });
});

// --- Model Weights & Routing APIs ---

router.get('/models/routing', (req, res) => {
  res.json({ success: true, data: modelRoutingState });
});

router.post('/models/routing', async (req, res) => {
  const { primaryModel, fallbackModel, routingSplitPercent } = req.body;
  if (primaryModel) modelRoutingState.primaryModel = primaryModel;
  if (fallbackModel) modelRoutingState.fallbackModel = fallbackModel;
  if (typeof routingSplitPercent === 'number') modelRoutingState.routingSplitPercent = routingSplitPercent;

  await writeAuditLog((req as any).user?.userId, 'MODEL_ROUTING_UPDATED', 'model_routing', null, modelRoutingState);
  res.json({ success: true, data: modelRoutingState });
});

// --- User Management APIs ---

router.get('/users', async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });
    res.json({ success: true, data: users });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/users/role', async (req, res) => {
  try {
    const { userId, role } = req.body;
    if (!userId || !['ADMIN', 'INSTRUCTOR', 'STUDENT'].includes(role)) {
      return res.status(400).json({ success: false, error: 'Valid userId and role are required.' });
    }
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { role },
      select: { id: true, email: true, role: true },
    });
    await writeAuditLog((req as any).user?.userId, 'USER_ROLE_UPDATED', 'User', userId, { role });
    res.json({ success: true, data: updated });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
