import { authFetch } from '../utils/authFetch';

/** Client for the output engine's artifact library (/api/outputs). */

export interface Artifact {
  id: string; kind: string; format: string; title: string; status: 'queued' | 'generating' | 'ready' | 'failed';
  revision: number; rootId: string; parentId: string | null; createdAt: string; updatedAt: string;
  sources: Array<{ type: string; label: string }>; sizeBytes: number | null; warnings: string[] | null; error: string | null;
  share: { mode: 'private' | 'organization' | 'link'; expiresAt: string | null }; download: string | null;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await authFetch(`/api/outputs${path}`, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status}).`);
  return body as T;
}

const MIME: Record<string, string> = {
  svg: 'image/svg+xml', png: 'image/png', html: 'text/html', json: 'application/json', pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
const EXT: Record<string, string> = { svg: 'svg', png: 'png', html: 'html', json: 'json', xlsx: 'xlsx', docx: 'docx', pptx: 'pptx', pdf: 'pdf' };

export const outputsApi = {
  list: (limit = 100) => call<{ artifacts: Artifact[] }>(`?limit=${limit}`).then((r) => r.artifacts),
  retry: (id: string) => call<{ artifact: Artifact }>(`/${id}/retry`, { method: 'POST', body: '{}' }).then((r) => r.artifact),
  remove: (id: string) => call<unknown>(`/${id}`, { method: 'DELETE' }),
  share: (id: string, mode: 'private' | 'link', expiresInHours = 168) =>
    call<{ artifact: Artifact; shareToken: string | null; sharePath: string | null }>(`/${id}/share`, { method: 'POST', body: JSON.stringify(mode === 'link' ? { mode, expiresInHours } : { mode }) }),

  /** The artifact file through the authenticated download route, typed by its format. */
  async blob(a: Pick<Artifact, 'id' | 'format'>, view = false): Promise<Blob> {
    const res = await authFetch(`/api/outputs/${a.id}/download${view ? '?view=1' : ''}`);
    if (!res.ok) throw new Error(`Could not load the file (${res.status}).`);
    return new Blob([await res.arrayBuffer()], { type: MIME[a.format] ?? 'application/octet-stream' });
  },

  async download(a: Pick<Artifact, 'id' | 'title' | 'format'>) {
    const url = URL.createObjectURL(await outputsApi.blob(a));
    const link = Object.assign(document.createElement('a'), { href: url, download: `${a.title.replace(/[^\w.\- ]+/g, '_').trim() || 'output'}.${EXT[a.format] ?? a.format}` });
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  },
};
