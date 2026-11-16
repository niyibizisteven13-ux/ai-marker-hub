import ExcelJS from 'exceljs';

/**
 * The record of a MySEB test as an Excel file: a summary per student and a timeline of everything that happened.
 * It holds names, devices and what the app saw (left the screen, lost connection...). It never holds pictures or video.
 */
export interface MySebReport {
  exam: { title: string; status: string; leave_action: string; live_mode: string; created_at: string; ends_at: string | null };
  students: Array<{ id: string; student_name: string; status: string; client_type: string; platform: string | null; started_at: string; deadline_at: string; ended_at: string | null; end_reason: string | null; violation_count: number; reinstated_count?: number; id_status?: string }>;
  events: Array<{ session_id: string; type: string; detail: unknown; created_at: string }>;
  /** What disqualified browser students had typed when they left (the lecturer's data; no pictures). */
  partial?: Array<{ session_id: string; student_name: string; labels: Record<string, string> | null; answers: Record<string, unknown> | null; partial_at: string | null }>;
}

export const EVENT_TEXT: Record<string, string> = {
  leave: 'Left the test screen', background: 'Left the app', blur: 'Switched to another window', heartbeat_lost: 'Lost connection', screenshot: 'Tried a screenshot',
  copy: 'Tried to copy', paste: 'Tried to paste', cut: 'Tried to cut', devtools: 'Opened developer tools', shortcut: 'Pressed a blocked key', close_attempt: 'Tried to close the app',
  extra_display: 'A second screen was connected', forbidden_app: 'A remote-control or recording app was running', fullscreen_exit: 'Left full screen', split_screen: 'Split screen',
  screen_recording: 'Screen recording started', visibility_hidden: 'Hid the test tab', token_misuse: 'Tried to use the exam key from another place',
  face_missing: 'Face left the camera', camera_off: 'Turned the camera off', multiple_faces: 'More than one face in the camera', face_check_unavailable: 'The face check could not load (camera still required)',
  reinstated: 'The lecturer let the student back in after a disqualification',
};
/** Reasons that mean the student broke a browser rule and was disqualified (as opposed to finishing, time up, or the lecturer ending them). */
const DISQUALIFIED = new Set(['face_missing', 'camera_off', 'multiple_faces', 'background', 'visibility_hidden', 'blur', 'fullscreen_exit', 'leave', 'split_screen', 'screen_recording', 'extra_display', 'forbidden_app', 'screen_share_stopped', 'id_refused']);
const ID_TEXT: Record<string, string> = { none: '', pending: 'Waiting for the lecturer', approved: 'Approved', refused: 'Refused' };
const END_TEXT: Record<string, string> = { student_exit: 'Student ended it', time_up: 'Time was up', teacher: 'Ended by the lecturer', exam_ended: 'The test was ended', leave: 'Ended after leaving the screen', background: 'Ended after leaving the app', face_missing: 'Disqualified: face left the camera', camera_off: 'Disqualified: camera turned off', visibility_hidden: 'Disqualified: opened another app or tab', blur: 'Disqualified: left the test window', id_refused: 'Student card refused' };
const STATUS_TEXT: Record<string, string> = { IN_EXAM: 'Still in the test', PAUSED: 'Paused', LEFT: 'Left', ENDED: 'Finished' };

const detailText = (d: unknown) => {
  if (!d || typeof d !== 'object') return '';
  const o = d as Record<string, unknown>;
  return Object.entries(o).filter(([k]) => k !== 'via').map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`).join('; ').slice(0, 200);
};
const asDate = (v: string | null) => (v ? new Date(v) : null);

export async function reportWorkbook(r: MySebReport): Promise<{ name: string; data: Buffer }> {
  const wb = new ExcelJS.Workbook(); wb.creator = 'Bwenge'; wb.created = new Date();
  const byId = new Map(r.students.map((s) => [s.id, s]));

  const ws = wb.addWorksheet('Students', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [{ header: 'Name', width: 28 }, { header: 'Status', width: 18 }, { header: 'Device', width: 18 }, { header: 'Started', width: 19 }, { header: 'Finished', width: 19 },
    { header: 'How it ended', width: 28 }, { header: 'Problems', width: 10 }, { header: 'Leave events', width: 13 }, { header: 'Lost connection', width: 15 }, { header: 'Disqualified', width: 14 }, { header: 'Let back in', width: 12 }, { header: 'Student card', width: 22 }, { header: 'Look at this', width: 14 }];
  const counts = new Map<string, Record<string, number>>();
  for (const e of r.events) { const c = counts.get(e.session_id) ?? {}; c[e.type] = (c[e.type] ?? 0) + 1; counts.set(e.session_id, c); }
  for (const s of r.students) {
    const c = counts.get(s.id) ?? {};
    const row = ws.addRow([s.student_name, STATUS_TEXT[s.status] ?? s.status, `${s.client_type}${s.platform ? ` · ${s.platform}` : ''}`, asDate(s.started_at), asDate(s.ended_at), s.end_reason ? (END_TEXT[s.end_reason] ?? s.end_reason) : '',
      s.violation_count, (c.leave ?? 0) + (c.background ?? 0) + (c.blur ?? 0), c.heartbeat_lost ?? 0,
      s.status === 'ENDED' && s.end_reason && DISQUALIFIED.has(s.end_reason) ? 'Yes' : '', s.reinstated_count ?? 0, ID_TEXT[s.id_status ?? 'none'] ?? '',
      (s.status === 'ENDED' && s.end_reason && DISQUALIFIED.has(s.end_reason)) || (s.reinstated_count ?? 0) > 0 || s.violation_count >= 3 ? 'Yes' : '']);
    row.getCell(4).numFmt = 'yyyy-mm-dd hh:mm:ss'; row.getCell(5).numFmt = 'yyyy-mm-dd hh:mm:ss';
    if (s.violation_count > 0) row.getCell(7).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: s.violation_count >= 3 ? 'FFFEE2E2' : 'FFFEF3C7' } };
  }
  ws.getRow(1).font = { bold: true };
  if (ws.rowCount > 1) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 13 } };

  const wt = wb.addWorksheet('Timeline', { views: [{ state: 'frozen', ySplit: 1 }] });
  wt.columns = [{ header: 'Time', width: 21 }, { header: 'Student', width: 28 }, { header: 'What happened', width: 46 }, { header: 'Detail', width: 40 }];
  for (const e of r.events) { const row = wt.addRow([new Date(e.created_at), byId.get(e.session_id)?.student_name ?? 'Unknown', EVENT_TEXT[e.type] ?? e.type, detailText(e.detail)]); row.getCell(1).numFmt = 'yyyy-mm-dd hh:mm:ss'; }
  wt.getRow(1).font = { bold: true };
  if (wt.rowCount > 1) wt.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 4 } };

  if (r.partial?.length) {
    const wp = wb.addWorksheet('Saved answers', { views: [{ state: 'frozen', ySplit: 1 }] });
    wp.columns = [{ header: 'Student', width: 28 }, { header: 'Question', width: 50 }, { header: 'What they had typed', width: 70 }, { header: 'Last saved', width: 19 }];
    const show = (v: unknown) => (Array.isArray(v) ? v.join(', ') : v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v ?? '')).slice(0, 5000);
    for (const p of r.partial) for (const [id, v] of Object.entries(p.answers ?? {})) { const row = wp.addRow([p.student_name, (p.labels ?? {})[id] || id, show(v), asDate(p.partial_at)]); row.getCell(3).alignment = { wrapText: true, vertical: 'top' }; row.getCell(4).numFmt = 'yyyy-mm-dd hh:mm:ss'; }
    wp.getRow(1).font = { bold: true };
  }

  const sum = wb.addWorksheet('About'); sum.columns = [{ width: 30 }, { width: 70 }];
  sum.addRow([r.exam.title]).font = { bold: true, size: 14 };
  sum.addRow(['Test status', r.exam.status === 'ended' ? 'Ended' : 'Running']); sum.addRow(['When a student left the screen', { record: 'Only recorded', pause: 'Paused until the lecturer resumed', end: 'Their test ended' }[r.exam.leave_action] ?? r.exam.leave_action]);
  sum.addRow(['Students', r.students.length]); sum.addRow(['Events recorded', r.events.length]);
  sum.addRow([]);
  sum.addRow(['This is a record of what the MySEB app and server saw. It is evidence to consider, not proof: a lost connection can be a real network fault. It contains no pictures, video or sound.']).alignment = { wrapText: true };
  sum.mergeCells(`A${sum.rowCount}:B${sum.rowCount}`); sum.getRow(sum.rowCount).height = 48;
  sum.addRow([`Made by Bwenge on ${new Date().toISOString().slice(0, 10)}`]);
  sum.addRow([]);
  sum.addRow(['Disqualified', r.students.filter((x) => x.status === 'ENDED' && x.end_reason && DISQUALIFIED.has(x.end_reason)).length]);
  sum.addRow(['Let back in by the lecturer', r.students.filter((x) => (x.reinstated_count ?? 0) > 0).length]);
  const name = `${String(r.exam.title).replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim().slice(0, 80) || 'Test'} MySEB report.xlsx`;
  return { name, data: Buffer.from(await wb.xlsx.writeBuffer()) };
}
