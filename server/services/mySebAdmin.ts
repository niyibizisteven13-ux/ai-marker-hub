import { flagOn, loadPlatformSettings, onPlatformSettings, type PlatformSettings } from './platform/settings.js';
import { embeddedStatus } from './mySebEmbedded.js';
import { downloadLinks, mySebConfigured } from './mySeb.js';
import logger from '../utils/logger.js';

/**
 * Admin → MySEB: what the exam server is doing, every exam on it, and the switches the administrator holds (new sign-ins, browser mode,
 * retention). The MySEB server keeps its own copy of the switches (it is a separate process); this file pushes them whenever they change
 * and once a minute, so a restarted MySEB catches up.
 */
const URL_ = () => (process.env.MYSEB_URL || '').replace(/\/$/, '');
const KEY = () => process.env.MYSEB_SERVICE_KEY || '';

async function call(path: string, init: { method?: string; body?: unknown; timeoutMs?: number } = {}) {
  if (!mySebConfigured()) throw new Error('MySEB is not set up on this server (MYSEB_URL and MYSEB_SERVICE_KEY).');
  const res = await fetch(`${URL_()}/api${path}`, { method: init.method ?? 'GET', signal: AbortSignal.timeout(init.timeoutMs ?? 8000), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY()}` }, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `MySEB answered ${res.status}`);
  return json;
}

export async function mySebOverview() {
  const configured = mySebConfigured();
  const [overview, links] = await Promise.all([configured ? call('/admin/overview').catch((e) => ({ error: (e as Error).message })) : Promise.resolve({ error: 'MySEB is not set up on this server.' }), Promise.resolve(downloadLinks())]);
  return { configured, embedded: embeddedStatus(), overview, downloads: links, wanted: { enabled: flagOn('myseb.enabled'), browserMode: flagOn('myseb.browserMode') } };
}
export const mySebEndExam = (examId: string) => call(`/exams/${encodeURIComponent(examId)}/end`, { method: 'POST' });
export const mySebPurgeNow = () => call('/admin/purge', { method: 'POST', timeoutMs: 30_000 });

export async function pushMySebSettings(s?: PlatformSettings) {
  if (!mySebConfigured()) return;
  const cur = s ?? await loadPlatformSettings();
  await call('/admin/controls', { method: 'PUT', body: { enabled: flagOn('myseb.enabled', cur), browserMode: flagOn('myseb.browserMode', cur), retentionDays: cur.retention.mysebDays } });
}

let timer: NodeJS.Timeout | null = null;
export function startMySebSync() {
  onPlatformSettings((s) => { void pushMySebSettings(s).catch(() => undefined); });
  timer ??= setInterval(() => { void pushMySebSettings().catch((e) => logger.debug?.('[myseb] settings not pushed', { error: (e as Error)?.message })); }, 60_000);
  timer.unref();
}
