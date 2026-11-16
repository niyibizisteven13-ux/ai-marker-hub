import { q } from './db.js';
import { config } from './config.js';
import { liveStats } from './live.js';

/**
 * Controls the platform administrator sets (through bwenge, with the service key): stop new sign-ins, turn browser mode off, and change how
 * long finished exams are kept. They live in memory for speed and in the database (myseb_meta) so a restart keeps them.
 * Students already inside a test are never cut off by these switches: they only decide who can START one.
 */
let controls = { enabled: true, browserMode: true, retentionDays: null };
export const getControls = () => controls;
export const retentionDays = () => controls.retentionDays ?? config.retentionDays;

export async function loadControls() {
  try {
    const v = (await q("SELECT v FROM myseb_meta WHERE k = 'controls'")).rows[0]?.v;
    if (v) controls = normalise(JSON.parse(v));
  } catch { /* keep the defaults */ }
  return controls;
}
const normalise = (o = {}) => ({
  enabled: o.enabled !== false,
  browserMode: o.browserMode !== false,
  retentionDays: Number.isInteger(o.retentionDays) && o.retentionDays >= 7 && o.retentionDays <= 3650 ? o.retentionDays : null,
});
export async function saveControls(patch = {}) {
  controls = normalise({ ...controls, ...patch, ...(patch.retentionDays === null ? { retentionDays: null } : {}) });
  await q("INSERT INTO myseb_meta (k, v) VALUES ('controls', $1) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v", [JSON.stringify(controls)]);
  return controls;
}

/** One look at everything: how loaded the server is, and every exam with how many students are where. */
export async function overview() {
  const totals = (await q(`SELECT count(*)::int AS exams, count(*) FILTER (WHERE status = 'active')::int AS active FROM exams`)).rows[0];
  const sessions = (await q(`SELECT status, count(*)::int AS n FROM exam_sessions GROUP BY status`)).rows;
  const by = Object.fromEntries(sessions.map((r) => [r.status, r.n]));
  const exams = (await q(
    `SELECT e.id, e.title, e.status, e.created_at, e.allow_web, e.require_myseb, e.live_mode,
            count(s.id)::int AS students,
            count(s.id) FILTER (WHERE s.status = 'IN_EXAM')::int AS in_exam,
            count(s.id) FILTER (WHERE s.status = 'PAUSED')::int AS paused,
            count(s.id) FILTER (WHERE s.status = 'LEFT')::int AS left,
            count(s.id) FILTER (WHERE s.status = 'ENDED')::int AS ended,
            max(s.last_heartbeat) AS last_seen
       FROM exams e LEFT JOIN exam_sessions s ON s.exam_id = e.id
      GROUP BY e.id ORDER BY (count(s.id) FILTER (WHERE s.status = 'IN_EXAM') > 0) DESC, max(s.last_heartbeat) DESC NULLS LAST, e.created_at DESC LIMIT 60`)).rows;
  const mem = process.memoryUsage();
  return {
    controls, retentionDays: retentionDays(), live: liveStats(),
    server: { uptimeSeconds: Math.round(process.uptime()), memoryMb: Math.round(mem.rss / 1048576), node: process.version },
    totals: { exams: totals.exams, activeExams: totals.active, inExam: by.IN_EXAM ?? 0, paused: by.PAUSED ?? 0, left: by.LEFT ?? 0, ended: by.ENDED ?? 0 },
    exams,
  };
}
