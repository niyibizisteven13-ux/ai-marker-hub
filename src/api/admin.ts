import { authFetch } from '../utils/authFetch';

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
  createKnowledgeBase: (payload: { name: string; description?: string; state?: string }) =>
    readJson('/api/admin/knowledge-bases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
  updateKnowledgeBase: (id: string, payload: any) =>
    readJson(`/api/admin/knowledge-bases/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
  deleteKnowledgeBase: (id: string) =>
    readJson(`/api/admin/knowledge-bases/${id}`, { method: 'DELETE' }),

  // Documents
  getDocuments: () => readJson<{ success: true; data: any[] }>('/api/admin/documents'),
  getDocument: (id: string) => readJson<{ success: true; data: any }>(`/api/admin/documents/${id}`),
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

  // Datasets
  getDatasets: () => readJson<{ success: true; data: any[] }>('/api/admin/datasets'),
  createDataset: (payload: any) => readJson('/api/admin/datasets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
  getDatasetExamples: (datasetId: string) => readJson<{ success: true; data: any[] }>(`/api/admin/datasets/${datasetId}/examples`),
  createDatasetExample: (datasetId: string, payload: any) => readJson(`/api/admin/datasets/${datasetId}/examples`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
  generateDatasetExamples: (datasetId: string) => readJson(`/api/admin/datasets/${datasetId}/generate-from-knowledge`, { method: 'POST' }),
  updateDatasetExample: (exampleId: string, payload: any) => readJson(`/api/admin/dataset-examples/${exampleId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),

  // Fine-tuning
  getFineTuneJobs: () => readJson<{ success: true; data: any[] }>('/api/admin/fine-tune/jobs'),
  createFineTuneJob: (datasetId: string) => readJson('/api/admin/fine-tune/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ datasetId }) }),
  cancelFineTuneJob: (id: string) => readJson(`/api/admin/fine-tune/jobs/${id}/cancel`, { method: 'POST' }),

  // Models
  getModels: () => readJson<{ success: true; data: any[] }>('/api/admin/models'),
  createModel: (payload: any) => readJson('/api/admin/models', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
  updateModel: (id: string, payload: any) => readJson(`/api/admin/models/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
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

  // Users & Organizations
  getUsers: () => readJson<{ success: true; data: any[] }>('/api/admin/users'),
  updateUserRole: (userId: string, role: string) => readJson('/api/admin/users/role', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, role }) }),
  getOrganizations: () => readJson<{ success: true; data: any[] }>('/api/admin/organizations'),
  createOrganization: (name: string) => readJson('/api/admin/organizations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }),

  // Audit Logs
  getAuditLogs: (limit = 50) => readJson<{ success: true; data: any[] }>(`/api/admin/audit-logs?limit=${limit}`),
};
