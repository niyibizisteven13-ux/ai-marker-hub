/**
 * Integrity score: turns a student's recorded violations into one number the lecturer can sort by.
 *
 * It is a TRIAGE aid, never a verdict: it tells the lecturer whom to look at first. Each reason is spelled out
 * so the lecturer can see why, and a connection drop alone never makes anyone "high".
 */
const WEIGHT = {
  token_misuse: 60,        // someone replayed the exam key from the wrong place
  screen_recording: 40, forbidden_app: 35, remote_session: 40, virtual_machine: 30,
  multiple_faces: 30, screen_share_stopped: 25, extra_display: 25, camera_off: 25, face_missing: 15,
  split_screen: 20, screenshot: 15, devtools: 20, blocked_navigation: 12,
  leave: 10, blur: 6, background: 6, visibility_hidden: 6, fullscreen_exit: 8,
  copy: 5, paste: 8, cut: 4, shortcut: 4, close_attempt: 5, heartbeat_lost: 2, face_check_unavailable: 1,
};
const LABEL = {
  token_misuse: 'exam key used from the wrong place', screen_recording: 'screen recording', forbidden_app: 'a blocked app was running',
  remote_session: 'remote desktop session', virtual_machine: 'running in a virtual machine', multiple_faces: 'more than one face', screen_share_stopped: 'stopped sharing the screen',
  extra_display: 'a second screen', camera_off: 'camera turned off', face_missing: 'face not visible', split_screen: 'split screen', screenshot: 'screenshot', devtools: 'developer tools',
  blocked_navigation: 'tried to open a blocked site', leave: 'left the exam', blur: 'switched window', background: 'sent the app to the background', visibility_hidden: 'hid the exam',
  fullscreen_exit: 'left full screen', copy: 'copied', paste: 'pasted', cut: 'cut', shortcut: 'blocked shortcut', close_attempt: 'tried to close the app',
};
// Each repeat of the same kind counts less, so ten window switches do not outweigh one screen recording.
const REPEAT = [1, 0.5, 0.3, 0.2];

/**
 * @param {Record<string, number>} counts   violations by type for one session
 * @param {{sharedDevice?: boolean}} flags
 * @returns {{score:number, level:'low'|'medium'|'high', reasons:string[]}}
 */
export function assess(counts = {}, flags = {}) {
  let score = 0;
  const parts = [];
  for (const [type, n] of Object.entries(counts)) {
    const w = WEIGHT[type];
    if (!w || !n) continue;
    let pts = 0;
    for (let i = 0; i < n; i++) pts += w * (REPEAT[Math.min(i, REPEAT.length - 1)]);
    score += pts;
    parts.push([pts, `${LABEL[type] || type}${n > 1 ? ` ×${n}` : ''}`]);
  }
  const kinds = Object.keys(counts).filter((t) => WEIGHT[t] && counts[t] && !['heartbeat_lost', 'face_check_unavailable'].includes(t)).length;
  if (kinds >= 4) { score += 10; parts.push([10, `${kinds} different kinds of warning`]); }
  if (flags.sharedDevice) { score += 60; parts.push([60, 'same device as another student in this exam, at the same time']); }
  score = Math.min(100, Math.round(score));
  const level = score >= 60 ? 'high' : score >= 25 ? 'medium' : 'low';
  return { score, level, reasons: parts.sort((a, b) => b[0] - a[0]).slice(0, 4).map((p) => p[1]) };
}
