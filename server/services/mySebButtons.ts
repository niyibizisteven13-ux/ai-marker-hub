import { MySebError, assignmentTarget, formTarget, monitor, reinstate, sessionAction, type TargetLoader } from './mySeb.js';
import { roomAction } from './mySebAgent.js';
import { decideReview } from './mySebReview.js';
import type { RoomToken } from './agenda/roomTokens.js';

/** What a Telegram room button does. Each one is a decision the lecturer just made by tapping it. */
export interface ButtonDeps {
  loader(t: RoomToken): TargetLoader;
  letBackIn(load: TargetLoader, sid: string): Promise<string>;
  roomAction: typeof roomAction;
  decideReview: typeof decideReview;
}
const loaderOf = (t: RoomToken): TargetLoader => (t.kind === 'form' ? formTarget(t.userId, t.ref) : assignmentTarget(t.userId, t.ref));

/** Paused or lost connection: let them continue. Ended by a rule: give them 10 minutes. Anything else: say so. */
export async function letBackIn(load: TargetLoader, sid: string): Promise<string> {
  const m: any = await monitor(load, { frames: false });
  const s = (m.students ?? []).find((x: any) => x.id === sid);
  if (!s) throw new MySebError('That student is not in this test.', 404, 'NOT_FOUND');
  if (s.status === 'PAUSED' || s.status === 'LEFT') { await sessionAction(load, sid, 'resume'); return `${s.student_name} can continue.`; }
  if (s.status === 'ENDED') { await reinstate(load, sid, 10); return `${s.student_name} is back in the test with 10 more minutes.`; }
  return `${s.student_name} is already in the test.`;
}
export const realButtonDeps: ButtonDeps = { loader: loaderOf, letBackIn, roomAction, decideReview };

export async function runRoomToken(t: RoomToken, deps: ButtonDeps = realButtonDeps): Promise<{ ok: boolean; text: string }> {
  const load = deps.loader(t);
  try {
    switch (t.action) {
      case 'back_in': return { ok: true, text: await deps.letBackIn(load, String(t.sid)) };
      case 'pause': { const r = await deps.roomAction(load, { action: 'pause_room', reason: 'paused from Telegram' }, 'lecturer', t.userId); return { ok: r.ok, text: r.text }; }
      case 'resume_all': { const r = await deps.roomAction(load, { action: 'resume_room' }, 'lecturer', t.userId); return { ok: r.ok, text: r.text }; }
      case 'add': { const r = await deps.roomAction(load, { action: 'add_time', minutes: t.minutes ?? 5 }, 'lecturer', t.userId); return { ok: r.ok, text: r.text }; }
      case 'dismiss_give': await deps.decideReview(load, String(t.sid), { decision: 'dismissed', giveMinutes: t.minutes ?? 10 }, t.userId); return { ok: true, text: `Dismissed${t.name ? ` for ${t.name}` : ''}, with ${t.minutes ?? 10} minutes given back.` };
      case 'confirm': await deps.decideReview(load, String(t.sid), { decision: 'confirmed' }, t.userId); return { ok: true, text: `Confirmed${t.name ? ` for ${t.name}` : ''}: it stays in the report.` };
      default: return { ok: false, text: 'Unknown action.' };
    }
  } catch (e) { return { ok: false, text: String((e as Error)?.message ?? e).slice(0, 200) }; }
}
