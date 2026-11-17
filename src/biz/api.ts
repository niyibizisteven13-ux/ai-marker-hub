import { authFetch, getAccessToken, getApiUrl } from '../utils/authFetch';
import type { AgentSettings, SecretsStatus, Business, DayStats, Enquiry, Product, PublicBusiness, LedgerEntry, Dashboard } from './types';

/** Calls to /api/biz. Public calls need no sign-in; the others use the person's own session. */
export class BizApiError extends Error { constructor(message: string, public status: number, public code?: string) { super(message); } }
async function read<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new BizApiError(body?.error || 'Something went wrong. Please try again.', res.status, body?.code);
  return body as T;
}
const json = (method: string, body?: unknown): RequestInit => ({ method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });

export const publicApi = {
  page: async (slug: string) => read<{ business: PublicBusiness; openNow: boolean | null }>(await fetch(getApiUrl(`/api/biz/public/${encodeURIComponent(slug)}`))),
  mediaUrl: (slug: string, id: string) => getApiUrl(`/api/biz/public/${encodeURIComponent(slug)}/media/${encodeURIComponent(id)}`),
  track: (slug: string, kind: 'whatsapp' | 'call' | 'share') => { try { const body = JSON.stringify({ kind }); const url = getApiUrl(`/api/biz/public/${encodeURIComponent(slug)}/track`); if (!navigator.sendBeacon?.(url, new Blob([body], { type: 'application/json' }))) void fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }); } catch { /* counting never blocks a tap */ } },
  enquiry: async (slug: string, body: { name: string; contact: string; message: string; productId?: string; website?: string }) => read<{ ok: boolean }>(await fetch(getApiUrl(`/api/biz/public/${encodeURIComponent(slug)}/enquiry`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })),
  order: async (slug: string, body: { name: string; contact: string; note?: string; items: Array<{ productId: string; qty: number }>; website?: string }) => read<{ ok: boolean; total: number }>(await fetch(getApiUrl(`/api/biz/public/${encodeURIComponent(slug)}/order`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })),
  pay: async (slug: string, body: { name: string; phone: string; items?: Array<{ productId: string; qty: number }>; amount?: number; website?: string }) => read<{ ref: string; total: number }>(await fetch(getApiUrl(`/api/biz/public/${encodeURIComponent(slug)}/pay`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })),
  payStatus: async (slug: string, ref: string) => read<{ state: 'pending' | 'success' | 'failed' }>(await fetch(getApiUrl(`/api/biz/public/${encodeURIComponent(slug)}/pay/${encodeURIComponent(ref)}`))),
  report: async (slug: string, body: { reason: string; detail: string }) => read<{ ok: boolean }>(await fetch(getApiUrl(`/api/biz/public/${encodeURIComponent(slug)}/report`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })),
};

export interface Mine { businesses: Business[]; limits: { businesses: number; products: number; images: number; videos: number; totalMediaMb: number }; plan: string }
export const ownerApi = {
  mine: async () => read<Mine>(await authFetch('/api/biz/mine')),
  create: async (body: { name: string; category?: string; slug?: string }) => read<{ business: Business }>(await authFetch('/api/biz', json('POST', body))),
  update: async (id: string, patch: Record<string, unknown>) => read<{ business: Business }>(await authFetch(`/api/biz/${id}`, json('PATCH', patch))),
  remove: async (id: string) => { const r = await authFetch(`/api/biz/${id}`, json('DELETE')); if (!r.ok) await read(r); },
  publish: async (id: string, on: boolean) => read<{ business: Business }>(await authFetch(`/api/biz/${id}/publish`, json('POST', { on }))),
  preview: async (id: string) => read<{ business: PublicBusiness; openNow: boolean | null }>(await authFetch(`/api/biz/${id}/preview`)),
  mediaUrls: async (id: string) => (await read<{ urls: Record<string, string> }>(await authFetch(`/api/biz/${id}/media-urls`))).urls,
  addProduct: async (id: string, body: Partial<Product>) => read<{ product: Product }>(await authFetch(`/api/biz/${id}/products`, json('POST', body))),
  updateProduct: async (id: string, pid: string, body: Partial<Product>) => read<{ product: Product }>(await authFetch(`/api/biz/${id}/products/${pid}`, json('PATCH', body))),
  removeProduct: async (id: string, pid: string) => { const r = await authFetch(`/api/biz/${id}/products/${pid}`, json('DELETE')); if (!r.ok) await read(r); },
  updateMedia: async (id: string, mid: string, body: { caption?: string; visible?: boolean }) => read(await authFetch(`/api/biz/${id}/media/${mid}`, json('PATCH', body))),
  removeMedia: async (id: string, mid: string) => { const r = await authFetch(`/api/biz/${id}/media/${mid}`, json('DELETE')); if (!r.ok) await read(r); },
  enquiries: async (id: string) => (await read<{ enquiries: Enquiry[] }>(await authFetch(`/api/biz/${id}/enquiries`))).enquiries,
  setEnquiry: async (id: string, eid: string, status: Enquiry['status']) => read(await authFetch(`/api/biz/${id}/enquiries/${eid}`, json('PATCH', { status }))),
  dashboard: async (id: string, days = 7) => read<Dashboard>(await authFetch(`/api/biz/${id}/dashboard?days=${days}`)),
  ledger: async (id: string, q: { type?: 'sale' | 'expense'; days?: number } = {}) => (await read<{ entries: LedgerEntry[] }>(await authFetch(`/api/biz/${id}/ledger?${new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]))}`))).entries,
  addEntry: async (id: string, body: Record<string, unknown>) => read<{ entry: LedgerEntry }>(await authFetch(`/api/biz/${id}/ledger`, json('POST', body))),
  setEntry: async (id: string, eid: string, status: LedgerEntry['status']) => read(await authFetch(`/api/biz/${id}/ledger/${eid}`, json('PATCH', { status }))),
  removeEntry: async (id: string, eid: string) => { const r = await authFetch(`/api/biz/${id}/ledger/${eid}`, json('DELETE')); if (!r.ok) await read(r); },
  agent: async (id: string) => (await read<{ agent: AgentSettings }>(await authFetch(`/api/biz/${id}/agent`))).agent,
  setAgent: async (id: string, body: Partial<AgentSettings>) => (await read<{ agent: AgentSettings }>(await authFetch(`/api/biz/${id}/agent`, json('PUT', body)))).agent,
  secrets: async (id: string) => read<SecretsStatus>(await authFetch(`/api/biz/${id}/secrets`)),
  saveSecrets: async (id: string, provider: 'mtn' | 'airtel', body: Record<string, string>) => read<SecretsStatus>(await authFetch(`/api/biz/${id}/secrets/${provider}`, json('PUT', body))),
  clearSecrets: async (id: string, provider: 'mtn' | 'airtel') => read<SecretsStatus>(await authFetch(`/api/biz/${id}/secrets/${provider}`, json('DELETE'))),
  testSecrets: async (id: string, provider: 'mtn' | 'airtel') => read<{ ok: true }>(await authFetch(`/api/biz/${id}/secrets/${provider}/test`, json('POST', {}))),
  requestPayment: async (id: string, body: { phone: string; amount: number; item?: string; customer?: string }) => (await read<{ entry: LedgerEntry }>(await authFetch(`/api/biz/${id}/pay`, json('POST', body)))).entry,
  refreshPayment: async (id: string, eid: string) => (await read<{ entry: LedgerEntry }>(await authFetch(`/api/biz/${id}/pay/${eid}/refresh`, json('POST', {})))).entry,
  stats: async (id: string) => read<{ last30: DayStats; days: Array<{ day: string } & DayStats>; newMessages: number }>(await authFetch(`/api/biz/${id}/stats`)),
  /** Uploads a photo or video with a progress report (a video on a slow phone connection can take a while). */
  upload: (id: string, file: File | Blob, name: string, onProgress: (fraction: number) => void) => new Promise<void>((resolve, reject) => {
    const x = new XMLHttpRequest(); x.open('POST', getApiUrl(`/api/biz/${id}/media`));
    const t = getAccessToken(); if (t) x.setRequestHeader('Authorization', `Bearer ${t}`);
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    x.onload = () => { if (x.status >= 200 && x.status < 300) return resolve(); let msg = 'The upload did not work. Please try again.'; try { msg = JSON.parse(x.responseText)?.error || msg; } catch { /* keep */ } reject(new BizApiError(msg, x.status)); };
    x.onerror = () => reject(new BizApiError('The connection dropped. Check your network and try again.', 0));
    const f = new FormData(); f.append('file', file, name); x.send(f);
  }),
};

/** Shrinks a big photo before it is sent (phones take 4000 px pictures): longest side 1600 px, JPEG. Videos and small files go as they are. */
export async function prepareImage(file: File): Promise<{ blob: Blob; name: string }> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 400 * 1024) return { blob: file, name: file.name };
  try {
    const bmp = await createImageBitmap(file); const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 1.5 * 1024 * 1024) return { blob: file, name: file.name };
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.84));
    return blob && blob.size < file.size ? { blob, name: file.name.replace(/\.[a-z0-9]+$/i, '') + '.jpg' } : { blob: file, name: file.name };
  } catch { return { blob: file, name: file.name }; }
}
