import { authFetch, getAccessToken, getApiUrl, refreshAccessToken } from '../utils/authFetch';

/** Client for the knowledge repository (file explorer) API at /api/admin/knowledge. */

export type IndexStatus = 'uploaded' | 'queued' | 'extracting' | 'chunking' | 'embedding' | 'indexing' | 'indexed' | 'pending_embeddings'
  | 'partial_failure' | 'failed' | 'unsupported' | 'excluded' | 'duplicate';

export interface RepoStatistics {
  files: number; folders: number; totalBytes: number; quotaBytes: number; byStatus: Record<string, number>;
  awaitingIndexing: number; indexing: number; indexed: number; failed: number; embeddingsAvailable: boolean;
}
export interface Repository {
  id: string; name: string; description: string | null; knowledgeBaseId: string | null; createdAt: string; updatedAt: string;
  /** assistant: in the public library for every user (on by default for new datasets). */
  settings: { language: string; domain: string; ocr: boolean; autoIndex: boolean; assistant?: boolean }; statistics: RepoStatistics;
}
export interface RepoDirectory { id: string; name: string; path: string; parentId: string | null; aiEnabled: boolean; createdAt?: string; updatedAt?: string }
export interface TreeDirectory extends RepoDirectory { files: number; bytes: number }
export interface RepoTree { repository: { id: string; name: string }; root: { files: number; bytes: number }; directories: TreeDirectory[] }
export interface RepoFile {
  id: string; repositoryId: string; directoryId: string | null; name: string; path: string; extension: string; mimeType: string; sizeBytes: number;
  version: number; createdAt: string; updatedAt: string; aiEnabled: boolean;
  extraction: { status: string | null; method: string | null };
  indexing: { status: IndexStatus; error: string | null; indexedAt: string | null; chunks: number | null; duplicateOf: string | null; searchable: boolean };
}
export interface Breadcrumb { id: string | null; name: string; path: string }
export interface Contents { directory: RepoDirectory | null; breadcrumbs: Breadcrumb[]; folders: RepoDirectory[]; files: RepoFile[]; total: number; offset: number; limit: number; hasMore: boolean }
export interface UploadSummary { results: Array<{ path: string; status: string; fileId?: string; reason?: string }>; indexJobId: string | null; summary: Record<string, number> }

export type Preview = { file: RepoFile } & (
  | { kind: 'text' | 'markdown' | 'json'; text: string; offset: number; nextOffset: number | null; totalBytes: number }
  | { kind: 'table'; sheets: Array<{ name: string; rows?: number }>; sheet: string; columns: string[]; rows: string[][]; offset: number; totalRows: number; nextOffset: number | null }
  | { kind: 'pdf'; page: number; pages: number; text: string; pageImage: string; hasTextLayer: boolean }
  | { kind: 'document' | 'html'; html: string; text: string; note?: string }
  | { kind: 'slides'; slides: Array<{ slide: number; text: string; notes: string }> }
  | { kind: 'image'; image: string; ocrText: string | null }
  | { kind: 'archive'; entries: Array<{ path: string; directory: boolean; sizeBytes: number | null; problem: string | null }>; totalEntries: number }
  | { kind: 'unavailable'; reason: string }
);

export interface SearchResults {
  query: string; method?: string; folders?: RepoDirectory[]; files?: RepoFile[];
  content?: Array<{ fileId: string; path: string; name: string; page: number | null; slide: number | null; sheet: string | null; score: number; excerpt: string }>;
}

const ADMIN_BASE = '/api/admin/knowledge';
const VIEW_BASE = '/api/curation';
let BASE = ADMIN_BASE;
/** Read-only Datasets & Curations (any signed-in user) uses the GET-only /api/curation endpoints. */
export const setKnowledgeViewOnly = (on: boolean) => { BASE = on ? VIEW_BASE : ADMIN_BASE; };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await authFetch(`${BASE}${path}`, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) throw new Error(body.error || `Request failed (${res.status}).`);
  return body.data as T;
}
const json = (method: string, data?: unknown): RequestInit => ({ method, body: data === undefined ? undefined : JSON.stringify(data) });
const qs = (o: Record<string, string | number | undefined | null>) => {
  const p = Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  return p.length ? `?${p.join('&')}` : '';
};

export const knowledgeApi = {
  listRepositories: () => call<Repository[]>('/repositories'),
  createRepository: (input: { name: string; description?: string }) => call<Repository>('/repositories', json('POST', input)),
  updateRepository: (id: string, patch: { name?: string; description?: string | null; settings?: { assistant?: boolean } }) => call<Repository>(`/repositories/${id}`, json('PATCH', patch)),
  deleteRepository: (id: string) => call<unknown>(`/repositories/${id}?confirm=true`, { method: 'DELETE' }),
  tree: (id: string) => call<RepoTree>(`/repositories/${id}/tree`),
  statistics: (id: string) => call<RepoStatistics>(`/repositories/${id}/statistics`),
  contents: (id: string, q: { directoryId?: string | null; sort?: string; order?: 'asc' | 'desc'; limit?: number; offset?: number } = {}) =>
    call<Contents>(`/repositories/${id}/contents${qs({ ...q, directoryId: q.directoryId ?? undefined })}`),
  createDirectory: (id: string, name: string, parentId: string | null) => call<RepoDirectory>(`/repositories/${id}/directories`, json('POST', { name, parentId })),
  updateDirectory: (id: string, patch: { name?: string; parentId?: string | null }) => call<RepoDirectory>(`/directories/${id}`, json('PATCH', patch)),
  deleteDirectory: (id: string, recursive = true) => call<unknown>(`/directories/${id}${qs({ recursive: String(recursive) })}`, { method: 'DELETE' }),
  updateFile: (id: string, patch: { name?: string; directoryId?: string | null }) => call<RepoFile>(`/files/${id}`, json('PATCH', patch)),
  deleteFile: (id: string) => call<unknown>(`/files/${id}`, { method: 'DELETE' }),
  reindexFile: (id: string) => call<unknown>(`/files/${id}/index`, json('POST', {})),
  reindexRepository: (id: string, onlyFailed = false) => call<unknown>(`/repositories/${id}/reindex`, json('POST', { onlyFailed })),
  extractArchive: (id: string, targetDirectoryId: string | null) => call<UploadSummary>(`/files/${id}/extract`, json('POST', { targetDirectoryId })),
  bulk: (repoId: string, action: 'move' | 'copy' | 'delete' | 'reindex', fileIds: string[], targetDirectoryId?: string | null) =>
    call<{ results: Array<{ fileId: string; ok: boolean; error?: string }> }>(`/repositories/${repoId}/files/bulk`, json('POST', { action, fileIds, targetDirectoryId })),
  preview: (id: string, q: { page?: number; sheet?: string; offset?: number } = {}) => call<Preview>(`/files/${id}/preview${qs(q)}`),
  search: (id: string, q: string, directoryId?: string | null) => call<SearchResults>(`/repositories/${id}/search${qs({ q, directoryId, limit: 30 })}`),

  /** Fetches a protected binary (preview image, download) with the bearer token. */
  async blob(path: string): Promise<Blob> {
    const res = await authFetch(path.startsWith('/api/') ? path : `${BASE}${path}`);
    if (!res.ok) throw new Error(`Could not load the file (${res.status}).`);
    return res.blob();
  },

  /** Saves a repository file through the authenticated download endpoint. */
  async download(file: Pick<RepoFile, 'id' | 'name'>) {
    const blob = await knowledgeApi.blob(`/files/${file.id}/download`);
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: file.name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  },

  /**
   * Uploads files (optionally a whole folder, keeping relative paths) with byte-level progress.
   * XHR is used instead of fetch because fetch cannot report upload progress.
   */
  async upload(repoId: string, input: { files: Array<{ file: File; relativePath?: string }>; directoryId: string | null; folder: boolean; emptyFolders?: string[]; onConflict?: 'rename' | 'replace' | 'skip' },
    onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<UploadSummary> {
    const fd = new FormData();
    for (const f of input.files) fd.append('files', f.file, f.file.name);
    if (input.folder) fd.append('relativePaths', JSON.stringify(input.files.map((f) => f.relativePath || f.file.name)));
    if (input.emptyFolders?.length) fd.append('emptyFolders', JSON.stringify(input.emptyFolders));
    if (input.directoryId) fd.append('directoryId', input.directoryId);
    if (input.onConflict) fd.append('onConflict', input.onConflict);
    const token = getAccessToken() ?? (await refreshAccessToken());
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', getApiUrl(`${BASE}/repositories/${repoId}/${input.folder ? 'folder-uploads' : 'uploads'}`));
      xhr.withCredentials = true;
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
      xhr.onload = () => {
        let body: any = {};
        try { body = JSON.parse(xhr.responseText); } catch { /* non-JSON error page */ }
        if (xhr.status >= 200 && xhr.status < 300 && body.success !== false) resolve(body.data);
        else if (xhr.status === 422 && body.data) resolve(body.data); // every file rejected: show the reasons
        else reject(new Error(body.error || `Upload failed (${xhr.status}).`));
      };
      xhr.onerror = () => reject(new Error('Network error during upload.'));
      xhr.onabort = () => reject(new Error('Upload cancelled.'));
      signal?.addEventListener('abort', () => xhr.abort(), { once: true });
      xhr.send(fd);
    });
  },
};

export const formatBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(2)} GB`);

/** Files from a drag-and-drop, walking dropped folders (keeps relative paths and empty folders). */
export async function filesFromDrop(dt: DataTransfer): Promise<{ files: Array<{ file: File; relativePath: string }>; emptyFolders: string[]; hasFolders: boolean }> {
  const files: Array<{ file: File; relativePath: string }> = [];
  const emptyFolders: string[] = [];
  let hasFolders = false;
  const entries = [...dt.items].map((i) => (i as any).webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return { files: [...dt.files].map((f) => ({ file: f, relativePath: f.name })), emptyFolders, hasFolders };
  const readAll = (reader: any): Promise<any[]> => new Promise((res, rej) => {
    const out: any[] = [];
    const next = () => reader.readEntries((batch: any[]) => { if (!batch.length) res(out); else { out.push(...batch); next(); } }, rej);
    next();
  });
  const walk = async (entry: any, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file: File = await new Promise((res, rej) => entry.file(res, rej));
      files.push({ file, relativePath: `${prefix}${file.name}` });
    } else if (entry.isDirectory) {
      hasFolders = true;
      const children = await readAll(entry.createReader());
      if (!children.length) emptyFolders.push(`${prefix}${entry.name}`);
      for (const c of children) await walk(c, `${prefix}${entry.name}/`);
    }
  };
  for (const e of entries) await walk(e, '');
  return { files, emptyFolders, hasFolders };
}
