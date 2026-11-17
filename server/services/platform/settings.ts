import { z } from 'zod';
import { prisma } from '../../db.js';
import logger from '../../utils/logger.js';

/**
 * The administrator's platform controls, kept in the database (appSetting "platform") and read by every part of the server:
 *  - feature switches (turn a chat ability or MySEB on or off without a redeploy),
 *  - maintenance mode and the announcement banner,
 *  - blocked network addresses,
 *  - retention and per-user storage limits.
 * A switch can only turn things OFF that the server's own settings already allow: it never turns on something the deployment disabled.
 * Settings are cached for a few seconds, so a change reaches every request quickly and no request waits on the database.
 */
export interface FlagInfo { id: string; label: string; hint: string; group: 'Chat abilities' | 'MySEB (exams)' | 'Other'; tools?: string[] }

export const FLAGS: FlagInfo[] = [
  { id: 'chat.platformTools', label: 'Chat: live rooms, classes, marked exams', hint: 'The chat can read and change live rooms, classes and marked exams.', group: 'Chat abilities',
    tools: ['list_live_rooms', 'live_room_status', 'live_room_code', 'live_room_settings', 'live_room_student', 'live_room_saved_answers', 'list_courses', 'course_overview', 'list_marked_exams'] },
  { id: 'chat.workTools', label: 'Chat: mark tasks, release results, build classes', hint: 'The chat can mark a task, release results, manage classes and change exam marks.', group: 'Chat abilities',
    tools: ['task_results', 'task_settings', 'mark_task', 'release_task_results', 'export_task_results', 'create_class', 'add_class_students', 'link_class_work', 'export_class_gradebook', 'list_practice_classes', 'create_practice_class', 'practice_class_overview', 'exam_results', 'exam_candidate', 'change_exam_mark', 'release_exam_results'] },
  { id: 'chat.agendaTools', label: 'Chat: scheduled tasks and plans', hint: 'The chat can schedule tasks (morning brief), propose plans and run them after a yes, and send alerts to Telegram.', group: 'Chat abilities',
    tools: ['schedule_task', 'list_agenda', 'cancel_task', 'propose_actions', 'run_proposal', 'undo_proposal', 'list_proposals', 'notify_settings'] },
  { id: 'chat.adminTools', label: 'Chat: administrator tools', hint: 'The administrator can see and decide MySEB payment requests and get the platform overview in the chat.', group: 'Chat abilities',
    tools: ['admin_overview', 'admin_pending_payments', 'admin_decide_payment'] },
  { id: 'chat.formTools', label: 'Chat: forms and quizzes', hint: 'The chat can create, edit, publish and analyse forms and set test rules.', group: 'Chat abilities',
    tools: ['create_form', 'edit_form', 'review_form', 'publish_form', 'set_test_rules', 'list_forms', 'analyze_form', 'form_report'] },
  { id: 'chat.assignmentTools', label: 'Chat: tasks (assignments)', hint: 'The chat can set tasks and read hand-ins.', group: 'Chat abilities', tools: ['create_assignment', 'list_assignments', 'assignment_hand_ins', 'mark_assignment'] },
  { id: 'chat.webTools', label: 'Chat: web search and fetch', hint: 'The chat can search the web and read pages.', group: 'Chat abilities', tools: ['web_search', 'fetch_url'] },
  { id: 'chat.python', label: 'Chat: run Python', hint: 'The chat can run code to analyse data.', group: 'Chat abilities', tools: ['run_python'] },
  { id: 'chat.images', label: 'Chat: make pictures', hint: 'The chat can generate pictures.', group: 'Chat abilities', tools: ['generate_image'] },
  { id: 'chat.3d', label: 'Chat: 3D models', hint: 'The chat can build interactive 3D models.', group: 'Chat abilities', tools: ['create_3d_model', 'analyze_3d_model'] },
  { id: 'myseb.enabled', label: 'MySEB: new exam sign-ins', hint: 'Off: nobody can start MySEB tests (students already in a test carry on). Use it in an emergency or while the exam server is being fixed.', group: 'MySEB (exams)' },
  { id: 'myseb.requirePayment', label: 'MySEB: charge for codes', hint: 'On: a lecturer needs a monthly plan or a test credit (Admin → MySEB sales) to get a code for students. Off: MySEB is free for everyone. Administrators are never charged.', group: 'MySEB (exams)' },
  { id: 'myseb.browserMode', label: 'MySEB: browser mode', hint: 'Off: students cannot use the browser (iPhones) to join a test; they must use the app.', group: 'MySEB (exams)' },
];
export const FLAG_IDS = FLAGS.map((f) => f.id);

export interface PlatformSettings {
  flags: Record<string, boolean>;
  maintenance: { on: boolean; message: string };
  announcement: { text: string; level: 'info' | 'warning' | 'critical'; until: string | null } | null;
  blockedIps: string[];
  retention: { mysebDays: number | null };
  /** Extra storage (in MB) for named people, on top of their plan. */
  storageOverridesMb: Record<string, number>;
}
export const DEFAULT_SETTINGS: PlatformSettings = { flags: {}, maintenance: { on: false, message: '' }, announcement: null, blockedIps: [], retention: { mysebDays: null }, storageOverridesMb: {} };

export const settingsPatchSchema = z.object({
  flags: z.record(z.string(), z.boolean()).optional(),
  maintenance: z.object({ on: z.boolean(), message: z.string().max(300).default('') }).optional(),
  announcement: z.object({ text: z.string().trim().min(1).max(300), level: z.enum(['info', 'warning', 'critical']).default('info'), until: z.string().datetime().nullable().default(null) }).nullable().optional(),
  blockedIps: z.array(z.string().trim().min(3).max(64)).max(200).optional(),
  retention: z.object({ mysebDays: z.number().int().min(7).max(3650).nullable() }).optional(),
  storageOverridesMb: z.record(z.string().max(64), z.number().int().min(0).max(1_000_000)).optional(),
}).strict();

let cached: PlatformSettings = DEFAULT_SETTINGS;
let loadedAt = 0;
let listeners: Array<(s: PlatformSettings) => void> = [];
const db = prisma as any;

const normalise = (v: unknown): PlatformSettings => {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<PlatformSettings>;
  const flags: Record<string, boolean> = {};
  for (const [k, val] of Object.entries(o.flags ?? {})) if (FLAG_IDS.includes(k) && typeof val === 'boolean') flags[k] = val;
  return {
    flags,
    maintenance: { on: o.maintenance?.on === true, message: String(o.maintenance?.message ?? '').slice(0, 300) },
    announcement: o.announcement && typeof o.announcement.text === 'string' && o.announcement.text ? { text: o.announcement.text.slice(0, 300), level: (['info', 'warning', 'critical'] as const).includes(o.announcement.level as any) ? o.announcement.level : 'info', until: typeof o.announcement.until === 'string' ? o.announcement.until : null } : null,
    blockedIps: (Array.isArray(o.blockedIps) ? o.blockedIps : []).filter((x) => typeof x === 'string').slice(0, 200),
    retention: { mysebDays: typeof o.retention?.mysebDays === 'number' ? o.retention.mysebDays : null },
    storageOverridesMb: Object.fromEntries(Object.entries(o.storageOverridesMb ?? {}).filter(([, n]) => typeof n === 'number' && n >= 0)),
  };
};

/** Reads the stored settings (cached for 10 seconds). Never throws: on a database problem the last known settings stay in force. */
export async function loadPlatformSettings(force = false): Promise<PlatformSettings> {
  if (!force && Date.now() - loadedAt < 10_000) return cached;
  loadedAt = Date.now();
  try {
    const row = await db.appSetting.findUnique({ where: { key: 'platform' } });
    cached = normalise(row?.value);
    for (const l of listeners) { try { l(cached); } catch { /* a listener must not break loading */ } }
  } catch (e) { logger.warn('[platform] settings unavailable, keeping the last known', { error: (e as Error)?.message }); }
  return cached;
}
/** Tests set the settings directly (the stored copy is read from the database, which the quick test run does not have). */
export const __setPlatformSettingsForTests = (s: PlatformSettings) => { cached = normalise(s); loadedAt = Date.now() + 3600_000; };
/** The settings as last read: for code that cannot wait (every request, every chat turn). */
export const platformSettings = (): PlatformSettings => cached;
export const onPlatformSettings = (fn: (s: PlatformSettings) => void) => { listeners.push(fn); return () => { listeners = listeners.filter((l) => l !== fn); }; };
export const flagOn = (id: string, s: PlatformSettings = cached) => s.flags[id] !== false;
/** Chat tool names the administrator has switched off. */
export function disabledTools(s: PlatformSettings = cached): Set<string> {
  const off = new Set<string>();
  for (const f of FLAGS) if (f.tools && !flagOn(f.id, s)) for (const t of f.tools) off.add(t);
  return off;
}
/** The announcement, unless its end time has passed. */
export const activeAnnouncement = (s: PlatformSettings = cached, now = Date.now()) => (s.announcement && (!s.announcement.until || Date.parse(s.announcement.until) > now) ? s.announcement : null);

/** Merges a validated change into the stored settings. `flags` and the two maps are merged key by key; everything else is replaced. */
export async function savePlatformSettings(patch: z.infer<typeof settingsPatchSchema>, adminId: string): Promise<PlatformSettings> {
  for (const k of Object.keys(patch.flags ?? {})) if (!FLAG_IDS.includes(k)) throw new Error(`Unknown switch: ${k}`);
  const current = normalise((await db.appSetting.findUnique({ where: { key: 'platform' } }).catch(() => null))?.value);
  const next: PlatformSettings = {
    ...current,
    ...(patch.flags ? { flags: { ...current.flags, ...patch.flags } } : {}),
    ...(patch.maintenance ? { maintenance: patch.maintenance } : {}),
    ...(patch.announcement !== undefined ? { announcement: patch.announcement } : {}),
    ...(patch.blockedIps ? { blockedIps: [...new Set(patch.blockedIps)] } : {}),
    ...(patch.retention ? { retention: { mysebDays: patch.retention.mysebDays ?? null } } : {}),
    ...(patch.storageOverridesMb ? { storageOverridesMb: Object.fromEntries(Object.entries({ ...current.storageOverridesMb, ...patch.storageOverridesMb }).filter(([, n]) => n > 0)) } : {}),
  };
  const value = normalise(next);
  const existing = await db.appSetting.findUnique({ where: { key: 'platform' } });
  if (existing) await db.appSetting.update({ where: { key: 'platform' }, data: { value, updatedBy: adminId, updatedAt: new Date() } });
  else await db.appSetting.create({ data: { key: 'platform', value, updatedBy: adminId, updatedAt: new Date() } });
  await loadPlatformSettings(true);
  return cached;
}

let timer: NodeJS.Timeout | null = null;
/** Keeps the settings fresh on every server of a group (they all read the same row). */
export function startPlatformSettings() {
  void loadPlatformSettings(true);
  timer ??= setInterval(() => { void loadPlatformSettings(true); }, 15_000);
  timer.unref();
}
