/**
 * What is wrong with one student in the live room, in plain words, and what the lecturer can really do about it.
 * Only problems the lecturer can fix get a button; the rest say who has to act (the student) and what to tell them.
 * Pure (no screen, no network), so every case can be tested.
 */
export type HelpAction = 'resume' | 'reinstate' | 'card';
export interface HelpStudent {
  student_name: string; status: string; pause_reason: string | null; end_reason: string | null; last_violation?: string | null;
  seen_ago: number; client_type: string; id_status?: string; reinstated_count?: number;
  live: { camera: string; screen_state?: string } | null;
}
export interface Help {
  /** fix: the lecturer can fix it now. info: only the student can fix it. ok: nothing to do. */
  level: 'fix' | 'info' | 'ok';
  title: string;
  why: string;
  /** What the lecturer can do, best first. */
  can: HelpAction[];
  /** What to tell the student (for a problem only they can fix, or to go with a fix). */
  tell?: string;
  /** Look before you press: the reason looks like it could be cheating, not a slip. */
  careful?: boolean;
}

/** Reasons that are ordinary slips: a person leaving the screen for a moment, a weak connection, a camera problem. */
const SLIP = new Set(['leave', 'blur', 'background', 'heartbeat_lost', 'fullscreen_exit', 'face_missing', 'camera_off', 'screen_share_stopped', 'face_check_unavailable', 'visibility_hidden', 'teacher']);
/** Ended by a rule (not by the lecturer, the clock or the student): these can be reversed with "let back in". */
export const NOT_RULES = new Set(['teacher', 'time_up', 'exam_ended', 'student', 'student_exit']);

const WHY: Record<string, string> = {
  leave: 'left the test screen', background: 'left the app', blur: 'switched window', heartbeat_lost: 'lost connection', screenshot: 'tried a screenshot',
  copy: 'tried to copy', paste: 'tried to paste', cut: 'tried to cut', devtools: 'opened developer tools', shortcut: 'pressed a blocked key', close_attempt: 'tried to close the app',
  extra_display: 'connected a second screen', forbidden_app: 'opened a remote or recording app', fullscreen_exit: 'left full screen', split_screen: 'opened split screen',
  screen_recording: 'started a screen recording', id_refused: 'had their student card refused', visibility_hidden: 'opened another app or tab',
  screen_share_stopped: 'stopped sharing the screen', token_misuse: 'used the key from another place', teacher: 'was paused by you',
  face_missing: 'face left the camera', camera_off: 'turned the camera off', multiple_faces: 'had more than one person in the camera',
  face_check_unavailable: 'the face check could not load',
};
export const reasonWords = (r: string | null | undefined) => (r ? WHY[r] ?? r : '');

export function helpFor(s: HelpStudent): Help {
  const name = s.student_name.split(' ')[0] || 'The student';
  // 1. A student card waiting for the lecturer: only the lecturer can decide it.
  if (s.id_status === 'pending' && s.status !== 'ENDED') {
    return { level: 'fix', title: 'Showing their student card', why: `${name} is waiting for you to look at their student card.`, can: ['card'] };
  }
  // 2. Ended by a rule: the lecturer can put them back (it is written in their log, and their typed answers come back).
  if (s.status === 'ENDED' && s.end_reason && !NOT_RULES.has(s.end_reason)) {
    const slip = SLIP.has(s.end_reason);
    return {
      level: 'fix', title: 'Their test was ended by a rule', why: `${name} ${reasonWords(s.end_reason)}, so the test ended automatically.${s.reinstated_count ? ` You already let them back in ${s.reinstated_count === 1 ? 'once' : `${s.reinstated_count} times`}.` : ''}`,
      can: ['reinstate'], careful: !slip,
      tell: `${name}, your teacher has let you back in. Your page continues by itself with the answers you had typed. Please stay on the test screen.`,
    };
  }
  // 3. Paused, or connection lost: the lecturer can let them continue.
  if (s.status === 'PAUSED' || s.status === 'LEFT') {
    const reason = s.pause_reason ?? s.last_violation ?? (s.status === 'LEFT' ? 'heartbeat_lost' : '');
    const offline = s.status === 'LEFT' || s.seen_ago > 15;
    const byYou = reason === 'teacher';
    return {
      level: 'fix', title: byYou ? 'Paused by you' : offline ? 'Connection lost' : 'Paused', careful: !!reason && !SLIP.has(reason),
      why: byYou ? `You paused ${name}.` : `${name} ${reasonWords(reason) || 'left the test screen'}.${offline ? ` Last seen ${s.seen_ago > 90 ? `${Math.round(s.seen_ago / 60)} min` : `${s.seen_ago} s`} ago.` : ''}`,
      can: ['resume'],
      tell: offline ? `${name}, please check your internet and keep MySEB open on the test screen. When you are connected, your teacher will let you continue.` : `${name}, your teacher is letting you continue. Please stay on the test screen.`,
    };
  }
  // 4. Still in the test, but something on their side is not working: only the student can fix it.
  if (s.status === 'IN_EXAM' && s.live) {
    if (s.live.camera === 'busy') {
      return { level: 'info', title: 'Another app is using their camera', why: `${name}'s camera is being used by another app (a video call, the camera app or a screen recorder). A phone camera can only be used by one app. MySEB keeps trying by itself.`,
        can: [], tell: `${name}, another app is using your camera. Please close it (swipe it away from your recent apps). MySEB will turn your camera on by itself.` };
    }
    if (s.live.camera === 'denied') {
      return { level: 'info', title: 'Their camera is blocked', why: `${name}'s phone or browser is not letting the test use the camera.`,
        can: [], tell: `${name}, please allow the camera for MySEB: Settings → Apps → MySEB → Permissions → Camera → Allow, then open MySEB again.` };
    }
    if (s.live.screen_state === 'partial') {
      return { level: 'info', title: 'Shared a window, not the whole screen', why: `${name} shared one window or tab. You need to see the whole screen.`, can: [],
        tell: `${name}, please stop sharing and share your entire screen.` };
    }
    if (s.live.screen_state === 'denied') {
      return { level: 'info', title: 'Screen sharing is off', why: `${name} is not sharing their screen, which counts as leaving the test.`, can: [], tell: `${name}, please share your entire screen again.` };
    }
  }
  if (s.status === 'ENDED') return { level: 'ok', title: 'Finished', why: s.end_reason === 'time_up' ? 'Time was up.' : s.end_reason === 'teacher' ? 'You ended their test.' : 'The test is over for this student.', can: [] };
  return { level: 'ok', title: 'All good', why: `${name} is in the test with nothing to fix.`, can: [] };
}
