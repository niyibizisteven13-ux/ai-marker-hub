import { authFetch, getAccessToken, getApiUrl } from '../utils/authFetch';
import type { CardLayoutChange, ProgramInfo, MemberInfo, ProgramSummary, RedeemResult, TodayInfo, CardInfo, MeInfo, TrackerInfo, TrackerRecordInfo, SectionInfo, Costs, Post, PublicPost, AgentSettings, SecretsStatus, Business, DayStats, Enquiry, Product, PublicBusiness, LedgerEntry, Dashboard } from './types';

/** Calls to /api/biz. Public calls need no sign-in; the others use the person's own session. */
export class BizApiError extends Error { constructor(message: string, public status: number, public code?: string) { super(message); } }
async function read<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new BizApiError(body?.error || 'Something went wrong. Please try again.', res.status, body?.code);
  return body as T;
}
const json = (method: string, body?: unknown): RequestInit => ({ method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });

export const publicApi = {
  badge: async (slug: string) => read<{ verified: boolean }>(await fetch(getApiUrl(`/api/biz/public/${encodeURIComponent(slug)}/badge`), { cache: 'no-store' })),
  page: async (slug: string) => read<{ business: PublicBusiness; openNow: boolean | null }>(await fetch(getApiUrl(`/api/biz/public/${encodeURIComponent(slug)}`))),
  mediaUrl: (slug: string, id: string) => getApiUrl(`/api/biz/public/${encodeURIComponent(slug)}/media/${encodeURIComponent(id)}`),
  track: (slug: string, kind: 'whatsapp' | 'call' | 'share') => { try { const body = JSON.stringify({ kind }); const url = getApiUrl(`/api/biz/public/${encodeURIComponent(slug)}/track`); if (!navigator.sendBeacon?.(url, new Blob([body], { type: 'application/json' }))) void fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }); } catch { /* counting never blocks a tap */ } },
  enquiry: async (slug: string, body: { name: string; contact: string; message: string; productId?: string; website?: string }) => read<{ ok: boolean }>(await fetch(getApiUrl(`/api/biz/public/${encodeURIComponent(slug)}/enquiry`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })),
  posts: async (slug: string, postId?: string) => (await read<{ posts: PublicPost[] }>(await fetch(getApiUrl(`/api/biz/public/${encodeURIComponent(slug)}/posts${postId ? `?post=${encodeURIComponent(postId)}` : ''}`)))).posts,
  like: async (slug: string, pid: string) => read<{ liked: boolean; likes: number }>(await fetch(getApiUrl(`/api/biz/public/${encodeURIComponent(slug)}/posts/${encodeURIComponent(pid)}/like`), { method: 'POST' })),
  comments: async (slug: string, pid: string) => (await read<{ comments: Array<{ id: string; name: string; text: string; at: string; owner?: boolean }> }>(await fetch(getApiUrl(`/api/biz/public/${encodeURIComponent(slug)}/posts/${encodeURIComponent(pid)}/comments`)))).comments,
  comment: async (slug: string, pid: string, body: { name: string; text: string; website?: string }) => (await read<{ comment: { id: string; name: string; text: string; at: string; owner?: boolean } }>(await fetch(getApiUrl(`/api/biz/public/${encodeURIComponent(slug)}/posts/${encodeURIComponent(pid)}/comments`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))).comment,
  submitForm: async (slug: string, sid: string, body: { values: Record<string, string>; website?: string }) => read<{ ok: boolean }>(await fetch(getApiUrl(`/api/biz/public/${encodeURIComponent(slug)}/forms/${encodeURIComponent(sid)}`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })),
  order: async (slug: string, body: { name: string; contact: string; note?: string; items: Array<{ productId: string; qty: number }>; website?: string }) => read<{ ok: boolean; total: number }>(await fetch(getApiUrl(`/api/biz/public/${encodeURIComponent(slug)}/order`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })),
  pay: async (slug: string, body: { name: string; phone: string; items?: Array<{ productId: string; qty: number }>; amount?: number; website?: string }) => read<{ ref: string; total: number }>(await fetch(getApiUrl(`/api/biz/public/${encodeURIComponent(slug)}/pay`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })),
  payStatus: async (slug: string, ref: string) => read<{ state: 'pending' | 'success' | 'failed' }>(await fetch(getApiUrl(`/api/biz/public/${encodeURIComponent(slug)}/pay/${encodeURIComponent(ref)}`))),
  join: async (slug: string, pid: string, body: { name: string; phone: string; username?: string; passcode: string; joinCode?: string; idNumber?: string; startDate?: string; remember?: boolean; website?: string }) => read<{ session: string; expiresAt: string; cardId: string; code: string; username: string }>(await fetch(getApiUrl(`/api/biz/public/${encodeURIComponent(slug)}/plans/${encodeURIComponent(pid)}/join`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })),
  login: async (slug: string, body: { username?: string; phone?: string; passcode: string; remember?: boolean }) => read<{ session: string; expiresAt: string; username: string }>(await fetch(getApiUrl(`/api/biz/public/${encodeURIComponent(slug)}/login`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })),
  usernames: async (slug: string, name: string) => (await read<{ suggestions: string[] }>(await fetch(getApiUrl(`/api/biz/public/${encodeURIComponent(slug)}/username?name=${encodeURIComponent(name)}`), { cache: 'no-store' }))).suggestions,
  tick: async (slug: string, session: string, code: string, passcode?: string) => read<{ ok: boolean; item: string; useId: string; cardId: string }>(await fetch(getApiUrl(`/api/biz/public/${encodeURIComponent(slug)}/me/tick`), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Pass-Session': session }, body: JSON.stringify({ code, passcode }) })),
  untick: async (slug: string, session: string, cardId: string, useId: string) => read<{ ok: boolean }>(await fetch(getApiUrl(`/api/biz/public/${encodeURIComponent(slug)}/me/untick`), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Pass-Session': session }, body: JSON.stringify({ cardId, useId }) })),
  logout: async (slug: string, session: string) => { try { await fetch(getApiUrl(`/api/biz/public/${encodeURIComponent(slug)}/logout`), { method: 'POST', headers: { 'X-Pass-Session': session } }); } catch { /* signing out locally is enough */ } },
  me: async (slug: string, session: string) => read<MeInfo>(await fetch(getApiUrl(`/api/biz/public/${encodeURIComponent(slug)}/me`), { cache: 'no-store', headers: { 'X-Pass-Session': session } })),
  card: async (slug: string, session: string, cardId?: string) => read<CardInfo>(await fetch(getApiUrl(`/api/biz/public/${encodeURIComponent(slug)}/me/card${cardId ? `?card=${encodeURIComponent(cardId)}` : ''}`), { cache: 'no-store', headers: { 'X-Pass-Session': session } })),
  payCard: async (slug: string, session: string, cardId: string, phone: string) => read<{ ok: boolean }>(await fetch(getApiUrl(`/api/biz/public/${encodeURIComponent(slug)}/me/pay`), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Pass-Session': session }, body: JSON.stringify({ cardId, phone }) })),
  claimCard: async (slug: string, session: string, cardId: string, ref: string) => read<{ ok: boolean }>(await fetch(getApiUrl(`/api/biz/public/${encodeURIComponent(slug)}/me/claim`), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Pass-Session': session }, body: JSON.stringify({ cardId, ref }) })),
  changePasscode: async (slug: string, session: string, current: string, next: string) => read<{ ok: boolean }>(await fetch(getApiUrl(`/api/biz/public/${encodeURIComponent(slug)}/me/passcode`), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Pass-Session': session }, body: JSON.stringify({ current, next }) })),
  report: async (slug: string, body: { reason: string; detail: string }) => read<{ ok: boolean }>(await fetch(getApiUrl(`/api/biz/public/${encodeURIComponent(slug)}/report`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })),
};

export interface Mine { prefs?: { studioLang?: 'en' | 'rw' }; locked?: boolean; paid?: boolean; verified?: boolean; badge?: { priceRwf: number; url: string }; upgradeUrl?: string; upgrade?: { plan: string; name: string; priceRwf: number | null; priceNote: string; url: string }; businesses: Business[]; limits: { businesses: number; products: number; images: number; videos: number; totalMediaMb: number }; plan: string }
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
  agentChat: async (id: string, body: { message: string; history: Array<{ role: 'user' | 'assistant'; text: string }>; image?: string }) => (await read<{ reply: string }>(await authFetch(`/api/biz/${id}/agent/chat`, json('POST', body)))).reply,
  posts: async (id: string) => (await read<{ posts: Array<Post & { likes: number; comments: number }> }>(await authFetch(`/api/biz/${id}/posts`))).posts,
  postComments: async (id: string, pid: string) => (await read<{ comments: Array<{ id: string; name: string; text: string; at: string; owner?: boolean }> }>(await authFetch(`/api/biz/${id}/posts/${pid}/comments`))).comments,
  replyComment: async (id: string, pid: string, text: string) => read(await authFetch(`/api/biz/${id}/posts/${pid}/comments`, json('POST', { text }))),
  removeComment: async (id: string, cid: string) => { const r = await authFetch(`/api/biz/${id}/comments/${cid}`, json('DELETE')); if (!r.ok) await read(r); },
  addPost: async (id: string, body: { text: string; mediaIds: string[]; productId?: string }) => (await read<{ post: Post }>(await authFetch(`/api/biz/${id}/posts`, json('POST', body)))).post,
  setPost: async (id: string, pid: string, body: { pinned?: boolean; text?: string; productId?: string }) => read(await authFetch(`/api/biz/${id}/posts/${pid}`, json('PATCH', body))),
  removePost: async (id: string, pid: string) => { const r = await authFetch(`/api/biz/${id}/posts/${pid}`, json('DELETE')); if (!r.ok) await read(r); },
  programs: async (id: string) => read<{ programs: ProgramInfo[]; summary: ProgramSummary }>(await authFetch(`/api/biz/${id}/programs`)),
  saveProgram: async (id: string, body: Partial<ProgramInfo> & { cardLayoutChange?: Partial<CardLayoutChange> }) => (await read<{ program: ProgramInfo }>(await authFetch(`/api/biz/${id}/programs`, json('POST', body)))).program,
  endProgram: async (id: string, pid: string) => read<import('./types').EndProgramResult>(await authFetch(`/api/biz/${id}/programs/${pid}/end`, json('POST', {}))),
  deleteProgram: async (id: string, pid: string) => { const r = await authFetch(`/api/biz/${id}/programs/${pid}`, json('DELETE')); if (!r.ok) await read(r); },
  programText: async (id: string, body: Record<string, unknown>) => (await read<{ text: Record<string, unknown> }>(await authFetch(`/api/biz/${id}/program-text`, json('PUT', body)))).text,
  members: async (id: string, q: { program?: string; state?: string; q?: string } = {}) => (await read<{ members: MemberInfo[] }>(await authFetch(`/api/biz/${id}/members?${new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][])}`))).members,
  resetPasscode: async (id: string, mid: string) => (await read<{ passcode: string }>(await authFetch(`/api/biz/${id}/members/${mid}/reset-passcode`, json('POST')))).passcode,
  confirmMember: async (id: string, mid: string, method: 'cash' | 'momo') => (await read<{ member: MemberInfo }>(await authFetch(`/api/biz/${id}/members/${mid}/confirm`, json('POST', { method })))).member,
  setMember: async (id: string, mid: string, body: { action: 'pause' | 'resume' | 'cancel' | 'extend' | 'note'; days?: number; note?: string }) => (await read<{ member: MemberInfo }>(await authFetch(`/api/biz/${id}/members/${mid}`, json('PATCH', body)))).member,
  redeem: async (id: string, body: { token?: string; code?: string; memberId?: string; item?: string; force?: boolean }) => read<RedeemResult>(await authFetch(`/api/biz/${id}/uses/redeem`, json('POST', body))),
  undoUse: async (id: string, useId: string) => read<{ ok: boolean }>(await authFetch(`/api/biz/${id}/uses/${useId}/undo`, json('POST'))),
  checkinCode: async (id: string, programId: string) => read<{ code: string; expiresInSec: number; program: string }>(await authFetch(`/api/biz/${id}/programs/${encodeURIComponent(programId)}/checkin-code`)),
  report: async (id: string, date: string | undefined, lang: string) => read<{ report: { date: string; money: { sales: number; expenses: number; profit: number; orders: number; pending: number; salesChangePct: number | null }; programs: { served: number; people: number; notYet: Array<{ name: string }> | null; waiting: Array<unknown>; expiring: Array<unknown> } | null; attention: string[] }; text: string }>(await authFetch(`/api/biz/${id}/report?lang=${lang}${date ? `&date=${date}` : ''}`)),
  today: async (id: string) => read<TodayInfo>(await authFetch(`/api/biz/${id}/uses/today`)),
  costs: async (id: string) => read<Costs>(await authFetch(`/api/biz/${id}/costs`)),
  setBudget: async (id: string, category: string, amount: number | null) => read<Costs>(await authFetch(`/api/biz/${id}/budgets`, json('PUT', { category, amount }))),
  addRecurring: async (id: string, body: { name: string; amount: number; every: 'month' | 'week'; on: number; category: string }) => read(await authFetch(`/api/biz/${id}/recurring`, json('POST', body))),
  setRecurring: async (id: string, rid: string, body: { paused?: boolean; remove?: boolean }) => read(await authFetch(`/api/biz/${id}/recurring/${rid}`, json('PATCH', body))),
  updateEntry: async (id: string, eid: string, body: Record<string, unknown>) => read<{ entry: LedgerEntry }>(await authFetch(`/api/biz/${id}/ledger/${eid}/edit`, json('PATCH', body))),
  trackers: async (id: string) => (await read<{ trackers: TrackerInfo[] }>(await authFetch(`/api/biz/${id}/trackers`))).trackers,
  addFeature: async (id: string, kind: string, lang: 'en' | 'rw') => read(await authFetch(`/api/biz/${id}/features/${kind}`, json('POST', { lang }))),
  createTracker: async (id: string, body: Record<string, unknown>) => read(await authFetch(`/api/biz/${id}/trackers`, json('POST', body))),
  deleteTracker: async (id: string, tid: string) => { const r = await authFetch(`/api/biz/${id}/trackers/${tid}`, json('DELETE')); if (!r.ok) await read(r); },
  records: async (id: string, tid: string) => read<{ tracker: TrackerInfo; records: TrackerRecordInfo[] }>(await authFetch(`/api/biz/${id}/trackers/${tid}/records`)),
  addRecord: async (id: string, tid: string, body: { values: Record<string, string>; status?: string }) => read(await authFetch(`/api/biz/${id}/trackers/${tid}/records`, json('POST', body))),
  updateRecord: async (id: string, rid: string, body: { status?: string; values?: Record<string, string> }) => read(await authFetch(`/api/biz/${id}/records/${rid}`, json('PATCH', body))),
  deleteRecord: async (id: string, rid: string) => { const r = await authFetch(`/api/biz/${id}/records/${rid}`, json('DELETE')); if (!r.ok) await read(r); },
  sections: async (id: string) => (await read<{ sections: SectionInfo[] }>(await authFetch(`/api/biz/${id}/sections`))).sections,
  saveSection: async (id: string, body: Record<string, unknown>) => read(await authFetch(`/api/biz/${id}/sections`, json('POST', body))),
  moveSection: async (id: string, sid: string, dir: number) => read(await authFetch(`/api/biz/${id}/sections/${sid}/move`, json('POST', { dir }))),
  removeSection: async (id: string, sid: string) => { const r = await authFetch(`/api/biz/${id}/sections/${sid}`, json('DELETE')); if (!r.ok) await read(r); },
  setLang: async (id: string, lang: 'en' | 'rw') => read(await authFetch(`/api/biz/${id}/lang`, json('PUT', { lang }))),
  setPrefs: async (body: { studioLang: 'en' | 'rw' }) => read(await authFetch('/api/biz/prefs', json('PUT', body))),
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
  upload: (id: string, file: File | Blob, name: string, onProgress: (fraction: number) => void, scope?: 'feed' | 'timeline') => new Promise<{ id: string }>((resolve, reject) => {
    const x = new XMLHttpRequest(); x.open('POST', getApiUrl(`/api/biz/${id}/media`));
    const t = getAccessToken(); if (t) x.setRequestHeader('Authorization', `Bearer ${t}`);
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    x.onload = () => { if (x.status >= 200 && x.status < 300) { try { return resolve(JSON.parse(x.responseText).media); } catch { return resolve({ id: '' }); } } let msg = 'The upload did not work. Please try again.'; try { msg = JSON.parse(x.responseText)?.error || msg; } catch { /* keep */ } reject(new BizApiError(msg, x.status)); };
    x.onerror = () => reject(new BizApiError('The connection dropped. Check your network and try again.', 0));
    const f = new FormData(); f.append('file', file, name); f.append('originalName', name); if (scope) f.append('scope', scope); x.send(f);
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
