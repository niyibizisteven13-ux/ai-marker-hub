import { authFetch } from '../utils/authFetch';

/** Public library: datasets admins published for every user (/api/knowledge/library). */

export interface LibraryDataset {
  id: string; name: string; description: string; files: number; totalBytes: number;
  types: Record<string, number>; indexed: number; folders: string[];
}
export interface LibraryFile { id: string; path: string; name: string; type: string; sizeBytes: number; status: string; updatedAt: string }
export interface LibraryListing {
  repository: { id: string; name: string }; path: string; search?: string;
  folders: Array<{ name: string; path: string; files: number }>; files: LibraryFile[]; totalFiles: number;
}

async function call<T>(path: string): Promise<T> {
  const res = await authFetch(`/api/knowledge${path}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) throw new Error(body.error || `Request failed (${res.status}).`);
  return body.data as T;
}

export const libraryApi = {
  datasets: () => call<LibraryDataset[]>('/library'),
  browse: (repoId: string, q: { path?: string; search?: string } = {}) => {
    const p = new URLSearchParams();
    if (q.path) p.set('path', q.path);
    if (q.search) p.set('search', q.search);
    return call<LibraryListing>(`/library/${encodeURIComponent(repoId)}${p.size ? `?${p}` : ''}`);
  },
  /** The file itself (inline when the browser can show it safely). */
  async blob(fileId: string, inline: boolean): Promise<Blob> {
    const res = await authFetch(`/api/knowledge/sources/${encodeURIComponent(fileId)}${inline ? '?inline=1' : ''}`);
    if (!res.ok) throw new Error(res.status === 404 ? 'This file is not available.' : `Could not open the file (${res.status}).`);
    return res.blob();
  },
};

/** The chat message for a question about a library folder or file; the ids let the assistant open it directly. */
export function libraryQuestion(question: string, target: { dataset: { id: string; name: string }; folder?: string; file?: LibraryFile }): string {
  const where = target.file
    ? `file "${target.file.path}" in "${target.dataset.name}" (fileId ${target.file.id})`
    : target.folder
      ? `folder "${target.folder}" in "${target.dataset.name}" (datasetId ${target.dataset.id})`
      : `dataset "${target.dataset.name}" (datasetId ${target.dataset.id})`;
  return `${question.trim()}\n\n[Public library: ${where}]`;
}
