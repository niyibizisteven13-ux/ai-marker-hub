import { authFetch } from '../utils/authFetch';

export interface AdminQualitySummary {
  generatedAt: string | null;
  reportFile: string | null;
  evaluationMode: string;
  split: string;
  status: string;
  notMeasured: string;
  metrics: {
    caseCount: number;
    passCount: number;
    successRate: number;
    confidenceInterval95: [number, number] | null;
    instabilityRate: number | null;
  };
  capabilityBreakdown: Array<{ capability: string; total: number; passed: number; successRate: number }>;
  traceMetrics?: {
    traceCount: number;
    sampleLimit: number;
    successRate: number | null;
    capabilityStats: Array<{ capability: string; traces: number; successes: number; successRate: number | null }>;
    retries: number;
    averageRetries: number | null;
    toolErrorRate: number | null;
    toolStats: Array<{ name: string; calls: number; errors: number }>;
    topFailureClasses: Array<{ failureClass: string; count: number }>;
    latencyP50Ms: number | null;
    latencyP95Ms: number | null;
    averageCostUsd: number | null;
    failingTraces: Array<{
      id: string;
      capability: string;
      model: string;
      provider: string;
      finalStatus: string;
      failureClass: string | null;
      latencyMs: number;
      createdAt: string;
      toolCalls: Array<{ name: string; argsValid: boolean; durationMs: number; ok: boolean; errorCode: string | null }>;
    }>;
  };
}

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await authFetch(url, init);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

export const adminApi = {
  getOverview: () => readJson<{ success: true; data: any }>('/api/admin/overview'),
  getHealth: () => readJson<{ success: true; data: any[] }>('/api/admin/health'),

  // Knowledge Bases
  getKnowledgeBases: () => readJson<{ success: true; data: any[] }>('/api/admin/knowledge-bases'),
  createKnowledgeBase: (payload: { name: string; description?: string; state?: string; globalApproved?: boolean }) =>
    readJson('/api/admin/knowledge-bases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
  updateKnowledgeBase: (id: string, payload: any) =>
    readJson(`/api/admin/knowledge-bases/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
  deleteKnowledgeBase: (id: string) =>
    readJson(`/api/admin/knowledge-bases/${id}`, { method: 'DELETE' }),

  // Documents
  getDocuments: () => readJson<{ success: true; data: any[] }>('/api/admin/documents'),
  getDocument: (id: string) => readJson<{ success: true; data: any }>(`/api/admin/documents/${id}`),
  getDocumentChunks: (id: string) => readJson<{ success: true; data: any[] }>(`/api/admin/documents/${id}/chunks`),
  updateDocumentChunk: (chunkId: string, payload: any) => readJson(`/api/admin/document-chunks/${chunkId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
  approveDocument: (id: string) => readJson(`/api/admin/documents/${id}/approve`, { method: 'POST' }),
  retractDocument: (id: string) => readJson(`/api/admin/documents/${id}/retract`, { method: 'POST' }),
  uploadDocument: (formData: FormData) =>
    authFetch('/api/admin/documents/upload', { method: 'POST', body: formData }).then(async r => {
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Upload failed');
      return d;
    }),
  deleteDocument: (id: string) => readJson(`/api/admin/documents/${id}`, { method: 'DELETE' }),

  // Search & Playground
  search: (q: string, kbId?: string) => readJson<{ success: true; data: any[] }>(`/api/admin/search?q=${encodeURIComponent(q)}${kbId ? `&knowledgeBaseId=${kbId}` : ''}`),
  runPlayground: (payload: any) => readJson('/api/admin/playground', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),

  // Corrections & Verified Answers (Phases 2, 3, 4)
  getCorrections: () => readJson<{ success: true; data: any[] }>('/api/admin/corrections'),
  submitCorrection: (payload: any) => readJson('/api/admin/corrections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
  approveCorrection: (id: string) => readJson(`/api/admin/corrections/${id}/approve`, { method: 'POST' }),
  rejectCorrection: (id: string, reason: string) => readJson(`/api/admin/corrections/${id}/reject`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) }),
  retractCorrection: (id: string) => readJson(`/api/admin/corrections/${id}/retract`, { method: 'POST' }),
  getVerifiedAnswers: () => readJson<{ success: true; data: any[] }>('/api/admin/verified-answers'),

  // Datasets & Prompt Adapter Examples
  getDatasets: () => readJson<{ success: true; data: any[] }>('/api/admin/datasets'),
  createDataset: (payload: any) => readJson('/api/admin/datasets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
  deleteDataset: (datasetId: string) => readJson(`/api/admin/datasets/${datasetId}`, { method: 'DELETE' }),
  getDatasetExamples: (datasetId: string) => readJson<{ success: true; data: any[] }>(`/api/admin/datasets/${datasetId}/examples`),
  uploadDatasetFile: (datasetId: string, formData: FormData) =>
    authFetch(`/api/admin/datasets/${datasetId}/files`, { method: 'POST', body: formData }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'File extraction failed.');
      return data;
    }),
  createDatasetExample: (datasetId: string, payload: any) => readJson(`/api/admin/datasets/${datasetId}/examples`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
  generateDatasetExamples: (datasetId: string, source = 'all') =>
    readJson<{ success: true; data: any[]; message?: string }>(`/api/admin/datasets/${datasetId}/generate-from-knowledge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source }),
    }),
  approveAllDatasetExamples: (datasetId: string) =>
    readJson(`/api/admin/datasets/${datasetId}/approve-all`, { method: 'POST' }),
  exportDataset: (datasetId: string) => readJson<{ success: true; manifest: any; jsonl: string }>(`/api/admin/datasets/${datasetId}/export`),
  updateDatasetExample: (exampleId: string, payload: any) => readJson(`/api/admin/dataset-examples/${exampleId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
  deleteDatasetExample: (exampleId: string) => readJson(`/api/admin/dataset-examples/${exampleId}`, { method: 'DELETE' }),

  // Dataset-grounded prompt adapters; these do not train model weights.
  getDatasetAdapters: () => readJson<{ success: true; data: any[] }>('/api/admin/dataset-adapters/jobs'),
  createDatasetAdapter: (
    payload:
      | string
      | {
          datasetId: string;
          baseModel?: string;
          suffix?: string;
          targetEnvironment?: string;
          autoApprove?: boolean;
        }
  ) =>
    readJson('/api/admin/dataset-adapters/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(typeof payload === 'string' ? { datasetId: payload } : payload),
    }),
  cancelDatasetAdapter: (id: string) => readJson(`/api/admin/dataset-adapters/jobs/${id}/cancel`, { method: 'POST' }),
  testDatasetAdapter: (id: string, prompt: string) =>
    readJson<{ success: true; data: { baseModel: string; adapterName: string; output: string; latencyMs: number; examplesUsed: number; adapterApplied: boolean; trainedWeights: false } }>(
      `/api/admin/dataset-adapters/jobs/${id}/test`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      }
    ),
  // Models
  getModels: () => readJson<{ success: true; data: any[] }>('/api/admin/models'),
  createModel: (payload: any) => readJson('/api/admin/models', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
  updateModel: (id: string, payload: any) => readJson(`/api/admin/models/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
  activateModel: (id: string, environment = 'production') =>
    readJson(`/api/admin/models/${id}/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ environment }),
    }),
  deleteModel: (id: string) => readJson(`/api/admin/models/${id}`, { method: 'DELETE' }),

  // Prompts
  getPrompts: () => readJson<{ success: true; data: any[] }>('/api/admin/prompts'),
  createPrompt: (payload: any) => readJson('/api/admin/prompts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
  promotePrompt: (promptId: string, versionId: string, targetEnvironment: string, confirm: boolean) =>
    readJson(`/api/admin/prompts/${promptId}/promote`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ versionId, targetEnvironment, confirm }) }),

  // Retrieval Settings
  getRetrievalSettings: (env: string) => readJson<{ success: true; data: any }>(`/api/admin/retrieval-settings?environment=${env}`),
  updateRetrievalSettings: (payload: any) => readJson('/api/admin/retrieval-settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),

  // Providers
  getProviders: () => readJson<{ success: true; data: any[] }>('/api/admin/providers'),
  updateProvider: (payload: any) => readJson('/api/admin/providers', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),

  // Analytics
  getAnalytics: (range = '7d') => readJson<{ success: true; data: any }>(`/api/admin/analytics?range=${range}`),
  getQuality: () => readJson<{ success: true; data: AdminQualitySummary }>(`/api/admin/quality`),

  // Users & Organizations
  getUsers: () => readJson<{ success: true; data: any[] }>('/api/admin/users'),
  createUser: (payload: { email: string; name: string }) =>
    readJson('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  updateUserRole: (userId: string, role: string) => readJson('/api/admin/users/role', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, role }) }),
  getOrganizations: () => readJson<{ success: true; data: any[] }>('/api/admin/organizations'),
  createOrganization: (name: string) => readJson('/api/admin/organizations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }),

  // Audit Logs
  getAuditLogs: (limit = 50) => readJson<{ success: true; data: any[] }>(`/api/admin/audit-logs?limit=${limit}`),
};
