import type { Tool, ToolServices } from '../types.js';
import { err, untrusted } from './helpers.js';

/**
 * The rest of the platform, in the chat: live rooms (MySEB: codes, who is online, who broke a rule, letting a student back in),
 * classes (roster, marks, who is missing work) and marked exams. The user asks in plain words and gets the answer or the action,
 * with a link only as a bonus. Everything is scoped to the signed-in user by the services behind it.
 */
const app = () => (process.env.APP_BASE_URL || '').replace(/\/$/, '');
const roomLink = (kind: 'form' | 'task', id: string) => `${app()}/live/${kind}/${encodeURIComponent(id)}`;
const problem = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 240);
const KIND = { type: 'string', enum: ['form', 'task'], description: 'form: a quiz or test made in Forms. task: a task (assignment) people hand in.' } as const;
const ID = { type: 'string', description: 'The id of the form or task (from list_forms, list_assignments or list_live_rooms).' } as const;

const REASON: Record<string, string> = {
  face_missing: 'face left the camera', camera_off: 'turned the camera off', multiple_faces: 'more than one person in the camera', visibility_hidden: 'opened another app or tab',
  background: 'left the page', blur: 'left the test window', fullscreen_exit: 'left full screen', id_refused: 'student card refused', leave: 'left the test screen',
  teacher: 'ended by the lecturer', time_up: 'time was up', exam_ended: 'the test was ended', student: 'finished', student_exit: 'ended it themselves',
};
const why = (r: string | null) => (r ? REASON[r] ?? r : '');
const NOT_RULES = new Set(['teacher', 'time_up', 'exam_ended', 'student', 'student_exit']);

export function platformTools(services: ToolServices): Tool[] {
  const pf = services.platform;
  if (!pf) return [];

  const rooms: Tool = {
    definition: {
      name: 'list_live_rooms',
      description: "List the user's quizzes and tasks that are protected by MySEB (the exam browser) and so have a live room, plus the other forms and tasks that could get one. Call it when the user talks about a live room, an exam in progress, a code for students, or says which test without giving an id.",
      parameters: { type: 'object', properties: {} },
    },
    async execute(_i, ctx) {
      try {
        const rows = await pf.liveRooms(ctx.userId);
        if (!rows.length) return { text: 'The user has no quizzes or tasks yet.' };
        const lines = rows.map((r) => `- ${r.title} (${r.kind} ${r.id}): ${r.hasRoom ? `MySEB is on; live room ${roomLink(r.kind, r.id)}` : 'MySEB is not turned on'}`);
        return { text: untrusted('LIVE_ROOMS', lines.join('\n')) };
      } catch (e) { return err(`Could not list the live rooms: ${problem(e)}`); }
    },
  };

  const status: Tool = {
    definition: {
      name: 'live_room_status',
      description: "What is happening in one live room right now: how many students are in, paused, left or ended; who needs attention; who was disqualified and why; student cards waiting for a decision; and the room's settings. Use it for 'how is my exam going', 'who left', 'who is cheating', 'who was disqualified'.",
      parameters: { type: 'object', required: ['kind', 'id'], properties: { kind: KIND, id: ID } },
    },
    async execute(input, ctx) {
      const i = input as { kind: 'form' | 'task'; id: string };
      try {
        const m = await pf.roomStatus(ctx.userId, i.kind, String(i.id));
        const c = m.counts ?? {};
        const disq = m.students.filter((s) => s.status === 'ENDED' && s.end_reason && !NOT_RULES.has(s.end_reason));
        const away = m.students.filter((s) => s.status === 'PAUSED' || s.status === 'LEFT');
        const cards = m.students.filter((s) => s.id_status === 'pending' && s.status !== 'ENDED');
        const aside = m.students.filter((s) => (s.aside_seconds ?? 0) >= 30 && s.status !== 'ENDED').sort((a, b) => (b.aside_seconds ?? 0) - (a.aside_seconds ?? 0)).slice(0, 8);
        const e = m.exam;
        const lines = [
          `Test: ${e.title} (${e.status === 'ended' ? 'ended' : 'running'}). Students: ${m.students.length} (in the test ${c.IN_EXAM ?? 0}, paused ${c.PAUSED ?? 0}, connection lost ${c.LEFT ?? 0}, finished or ended ${c.ENDED ?? 0}).`,
          `Settings: browsers ${e.allow_web ? 'allowed' : 'not allowed'}${e.allow_web ? `, strict rules ${e.web_strict === false ? 'off' : 'on'}, more than one face: ${e.multi_face ?? 'warn'}, student card check ${e.id_check ? 'on' : 'off'}` : ''}; if a student leaves: ${e.leave_action ?? 'record'}.`,
          away.length ? `Paused or away: ${away.map((s) => `${s.student_name} (${why(s.pause_reason ?? s.last_violation) || s.status})`).join('; ')}.` : 'Nobody is paused or away.',
          disq.length ? `Disqualified: ${disq.map((s) => `${s.student_name} (${why(s.end_reason)}${s.reinstated_count ? `, let back in ${s.reinstated_count}x before` : ''})`).join('; ')}.` : 'Nobody is disqualified.',
          cards.length ? `Student cards waiting for the lecturer: ${cards.map((s) => s.student_name).join(', ')} (decide in the live room).` : '',
          aside.length ? `Looked aside the most (a number to judge, never proof): ${aside.map((s) => `${s.student_name} ${s.aside_seconds}s`).join(', ')}.` : '',
          `Live room: ${roomLink(i.kind, i.id)}`,
        ].filter(Boolean);
        return { text: untrusted('LIVE_ROOM', lines.join('\n')) };
      } catch (e) { return err(`Could not read the live room: ${problem(e)}`); }
    },
  };

  const code: Tool = {
    definition: {
      name: 'live_room_code',
      description: 'Make a new code for students to join a test, and the one link to share with them (opens MySEB, downloads it if missing, or starts in the browser on an iPhone). Call it when the user asks for a code or a link for students. It also turns MySEB on for that test.',
      parameters: { type: 'object', required: ['kind', 'id'], properties: { kind: KIND, id: ID } },
    },
    async execute(input, ctx) {
      const i = input as { kind: 'form' | 'task'; id: string };
      try {
        const c = await pf.roomCode(ctx.userId, i.kind, String(i.id));
        return { text: `Code: ${c.display} (valid until ${String(c.expiresAt).slice(0, 16).replace('T', ' ')} UTC).\nLink for students: ${c.joinUrl}\nLive room: ${roomLink(i.kind, i.id)}\nGive the user the code and the link. The same link works on every device. iPhones and iPads start in the browser only if browsers are allowed for this test (live_room_settings, allowBrowsers). A new code does not stop the old one working.` };
      } catch (e) { return err(`Could not make a code: ${problem(e)}`); }
    },
  };

  const settings: Tool = {
    definition: {
      name: 'live_room_settings',
      description: "Change a live room's rules. allowBrowsers: lets students without the app (iPhones) take the test in a browser. strictBrowsers: a browser student is disqualified at once for leaving the page, closing the tab, turning the camera off or taking their face away. faces: what happens when more than one person is in the camera (off, warn, end). studentCard: each browser student shows a student card to the camera and the lecturer lets them in. ifStudentLeaves: record, pause, end or pause_then_end. Only change what the user asked for.",
      parameters: {
        type: 'object', required: ['kind', 'id'],
        properties: {
          kind: KIND, id: ID,
          allowBrowsers: { type: 'boolean' }, strictBrowsers: { type: 'boolean' },
          faces: { type: 'string', enum: ['off', 'warn', 'end'] }, studentCard: { type: 'boolean' },
          ifStudentLeaves: { type: 'string', enum: ['record', 'pause', 'end', 'pause_then_end'] },
        },
      },
    },
    async execute(input, ctx) {
      const i = input as { kind: 'form' | 'task'; id: string; allowBrowsers?: boolean; strictBrowsers?: boolean; faces?: 'off' | 'warn' | 'end'; studentCard?: boolean; ifStudentLeaves?: 'record' | 'pause' | 'end' | 'pause_then_end' };
      const patch = { allowBrowsers: i.allowBrowsers, strictBrowsers: i.strictBrowsers, faces: i.faces, studentCard: i.studentCard, ifStudentLeaves: i.ifStudentLeaves };
      if (!Object.values(patch).some((v) => v !== undefined)) return err('Say what to change (allowBrowsers, strictBrowsers, faces, studentCard or ifStudentLeaves).');
      try {
        await pf.roomSettings(ctx.userId, i.kind, String(i.id), patch);
        const done = Object.entries(patch).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${v}`).join(', ');
        return { text: `Changed: ${done}. Tell the user what changed in plain words. Browser rules only apply when browsers are allowed.` };
      } catch (e) { return err(`Could not change the settings: ${problem(e)}`); }
    },
  };

  const student: Tool = {
    definition: {
      name: 'live_room_student',
      description: "Act on one student in a live room, by name. let_back_in: put a student who was disqualified for a rule back in the test (use it when the lecturer says it was a mistake; it is logged). resume: let a paused student continue. end: end this student's test: ALWAYS ask the user first and only call it with confirmed true after they said yes.",
      parameters: {
        type: 'object', required: ['kind', 'id', 'student', 'action'],
        properties: {
          kind: KIND, id: ID, student: { type: 'string', description: "The student's name (or part of it) as shown in the live room." },
          action: { type: 'string', enum: ['let_back_in', 'resume', 'end'] },
          confirmed: { type: 'boolean', description: 'Only for end: true after the user said yes.' },
        },
      },
    },
    async execute(input, ctx) {
      const i = input as { kind: 'form' | 'task'; id: string; student: string; action: 'let_back_in' | 'resume' | 'end'; confirmed?: boolean };
      try {
        const m = await pf.roomStatus(ctx.userId, i.kind, String(i.id));
        const q = String(i.student).trim().toLowerCase();
        const hits = m.students.filter((s) => s.student_name.toLowerCase() === q);
        const found = hits.length ? hits : m.students.filter((s) => s.student_name.toLowerCase().includes(q));
        if (!found.length) return err(`No student called "${i.student}" in this live room.`);
        if (found.length > 1) return err(`More than one student matches "${i.student}": ${found.slice(0, 8).map((s) => s.student_name).join(', ')}. Ask the user which one.`);
        const s = found[0];
        if (i.action === 'end' && i.confirmed !== true) return err(`Ending ${s.student_name}'s test cannot be undone. Ask the user to confirm, then call again with confirmed true.`);
        if (i.action === 'let_back_in' && !(s.status === 'ENDED' && s.end_reason && !NOT_RULES.has(s.end_reason))) return err(`${s.student_name} was not disqualified for a rule (status ${s.status}${s.end_reason ? `, ${why(s.end_reason)}` : ''}), so there is nothing to undo.`);
        await pf.roomStudent(ctx.userId, i.kind, String(i.id), s.id, i.action);
        return { text: `Done: ${i.action.replace(/_/g, ' ')} for ${s.student_name}.${i.action === 'let_back_in' ? ' It is written in their log, and their page restarts by itself.' : ''}` };
      } catch (e) { return err(`Could not do that: ${problem(e)}`); }
    },
  };

  const courses: Tool = {
    definition: {
      name: 'list_courses',
      description: "List the user's classes (courses) with how many students and how much work each has. Call it when the user talks about their class, students or roster without an id.",
      parameters: { type: 'object', properties: {} },
    },
    async execute(_i, ctx) {
      try {
        const rows = await pf.courses(ctx.userId);
        if (!rows.length) return { text: 'The user has no classes yet. They can make one in Practice & classes (/learn).' };
        return { text: untrusted('COURSES', rows.map((r) => `- ${r.name}${r.code ? ` (${r.code})` : ''}${r.term ? `, ${r.term}` : ''}: ${r.students} students, ${r.items} tasks or quizzes (courseId ${r.id})`).join('\n')) };
      } catch (e) { return err(`Could not list the classes: ${problem(e)}`); }
    },
  };

  const overview: Tool = {
    definition: {
      name: 'course_overview',
      description: "One class in detail: its average, each task or quiz with its average and how many handed in, and which students need attention (low marks or much missing work), who is late, whose responses were flagged, and who has accommodations. Use it for 'how is my class doing', 'who is failing', 'who has not handed in'.",
      parameters: { type: 'object', required: ['courseId'], properties: { courseId: { type: 'string' } } },
    },
    async execute(input, ctx) {
      try {
        const d = await pf.courseOverview(ctx.userId, String((input as { courseId: string }).courseId));
        const active = d.students.filter((s) => s.status === 'active');
        const attention = active.filter((s) => s.risk === 'attention');
        const watch = active.filter((s) => s.risk === 'watch');
        const f = (n: number | null) => (n === null ? 'n/a' : `${n}%`);
        const lines = [
          `${d.course.name}${d.course.code ? ` (${d.course.code})` : ''}: ${d.totals.students} students, class average ${f(d.totals.average)}, ${d.totals.needAttention} need attention, ${d.totals.withAccommodations} with accommodations, ${d.totals.flaggedResponses} flagged responses.`,
          d.columns.length ? `Work: ${d.columns.map((c) => `${c.title} (${c.kind}, average ${f(c.average)}, ${c.submitted}/${d.totals.students} handed in${c.flagged ? `, ${c.flagged} flagged` : ''})`).join('; ')}.` : 'No tasks or quizzes are linked to this class yet.',
          attention.length ? `Need attention: ${attention.map((s) => `${s.name} (average ${f(s.average)}, ${s.missing} missing)`).join('; ')}.` : 'Nobody needs attention.',
          watch.length ? `Worth watching: ${watch.slice(0, 15).map((s) => `${s.name} (${s.missing} missing${s.late ? `, ${s.late} late` : ''}${s.flagged ? `, ${s.flagged} flagged` : ''})`).join('; ')}.` : '',
          'Full table and Excel export: Practice & classes (/learn).',
        ].filter(Boolean);
        return { text: untrusted('COURSE', lines.join('\n')) };
      } catch (e) { return err(`Could not read the class: ${problem(e)}`); }
    },
  };

  const marked: Tool = {
    definition: {
      name: 'list_marked_exams',
      description: "List the user's marked exam sets: how many scripts, how many are marked, released to students, and how many need the teacher's review. Call it for 'what have I marked', 'what is waiting for review', 'results of my exam'.",
      parameters: { type: 'object', properties: {} },
    },
    async execute(_i, ctx) {
      try {
        const rows = await pf.markedExams(ctx.userId);
        if (!rows.length) return { text: 'No marked exams yet. Marking happens in the chat: attach the scripts and say "mark these".' };
        return { text: untrusted('EXAMS', rows.map((r) => `- ${r.title}: ${r.candidates} scripts, ${r.marked} marked, ${r.released} released, ${r.needsReview} need review (updated ${String(r.updatedAt).slice(0, 10)}); results page ${app()}/exams`).join('\n')) };
      } catch (e) { return err(`Could not list the exams: ${problem(e)}`); }
    },
  };

  return [rooms, status, code, settings, student, courses, overview, marked];
}
