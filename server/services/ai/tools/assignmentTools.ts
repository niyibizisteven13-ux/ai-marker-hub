import type { Tool, ToolServices } from '../types.js';
import { err, untrusted } from './helpers.js';

/**
 * Assignments in the chat: the teacher asks for a task to be set ("give my S4 class homework on linear
 * equations, due Friday"), gets the share link, asks who has handed in, and starts marking the class. Marking
 * itself opens the Mark page with every hand-in loaded, where the teacher adds the scheme and watches it live.
 */

const app = () => (process.env.APP_BASE_URL || '').replace(/\/$/, '');
const dashboard = (id: string) => `${app()}/assignments/${id}`;
const when = (iso: string | null) => (iso ? new Date(iso).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : 'no due date');
const problem = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 240);

export function assignmentTools(services: ToolServices): Tool[] {
  const as = services.assignments;
  if (!as) return [];

  const create: Tool = {
    definition: {
      name: 'create_assignment',
      description: 'Set a task for a class and get the link students use to hand in (no account needed; photos, PDF, Word or typed). Write the complete task the students will read: the questions or what they must do, how to hand in, and the marks if known. Call it when the teacher asks to give, set, assign or share homework, an exercise, a test or any task.',
      parameters: {
        type: 'object', required: ['title', 'instructions'],
        properties: {
          title: { type: 'string', description: 'Short title with class and subject, e.g. "S4 Mathematics: Linear equations homework".' },
          instructions: { type: 'string', description: 'The full task students see, in the language the teacher used.' },
          dueAt: { type: 'string', description: 'Due date and time as ISO 8601 (e.g. 2026-11-03T17:00:00+02:00), only when the teacher gave one.' },
        },
      },
    },
    async execute(input, ctx) {
      const i = input as { title: string; instructions: string; dueAt?: string };
      try {
        const a = await as.create(ctx.userId, i);
        return { text: `Assignment created: "${a.title}" (assignmentId ${a.id}), due ${when(a.dueAt)}.\nStudent link (share it in the class group): ${a.link}\nClass dashboard: ${dashboard(a.id)}\nGive the teacher both links as Markdown links, say students need no account, and that they can say "mark the class" when hand-ins are in.` };
      } catch (e) { return err(`Could not create the assignment: ${problem(e)}`); }
    },
  };

  const list: Tool = {
    definition: {
      name: 'list_assignments',
      description: "List the teacher's assignments with how many students have handed in, the due date, whether hand-ins are open, and their links. Call it when the teacher asks about their assignments or refers to one by name.",
      parameters: { type: 'object', properties: {} },
    },
    async execute(_input, ctx) {
      try {
        const rows = await as.list(ctx.userId);
        if (!rows.length) return { text: 'The teacher has no assignments yet.' };
        return { text: untrusted('ASSIGNMENTS', rows.map((r) => `- ${r.title} (assignmentId ${r.id}): ${r.submitted} handed in, ${r.open ? 'open' : 'closed'}, due ${when(r.dueAt)}; student link ${r.link}; dashboard ${dashboard(r.id)}`).join('\n')) };
      } catch (e) { return err(`Could not list assignments: ${problem(e)}`); }
    },
  };

  const handIns: Tool = {
    definition: {
      name: 'assignment_hand_ins',
      description: 'Who has handed in for one assignment: each student, their number, when, whether late, the files they sent, and the start of any typed answer. Use it to answer "who has handed in", "who is late", or to summarise the hand-ins.',
      parameters: { type: 'object', required: ['assignmentId'], properties: { assignmentId: { type: 'string' } } },
    },
    async execute(input, ctx) {
      try {
        const a = await as.get(ctx.userId, String((input as { assignmentId: string }).assignmentId));
        const lines = a.submissions.map((s) => `- ${s.studentName}${s.studentId ? ` (${s.studentId})` : ''}: ${new Date(s.submittedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC${s.late ? ', LATE' : ''}; ${s.files.length} file(s)${s.files.length ? ` [${s.files.map((f) => f.name).join(', ').slice(0, 200)}]` : ''}${s.text ? `; typed: "${s.text.slice(0, 300).replace(/\s+/g, ' ')}"` : ''}`);
        return { text: `"${a.title}": ${a.submissions.length} handed in, ${a.open ? 'open' : 'closed'}, due ${when(a.dueAt)}. Dashboard: ${dashboard(a.id)}\n${untrusted('HAND_INS', lines.join('\n') || 'Nobody has handed in yet.')}` };
      } catch (e) { return err(`Could not read the hand-ins: ${problem(e)}`); }
    },
  };

  const mark: Tool = {
    definition: {
      name: 'mark_assignment',
      description: 'Start marking every hand-in of an assignment with AI. Returns a link that opens the Mark page with the whole class loaded (one PDF per student, names kept); the teacher adds the marking scheme or the question paper there and presses Mark, and marking runs live in the chat. Call it when the teacher asks to mark or correct an assignment.',
      parameters: { type: 'object', required: ['assignmentId'], properties: { assignmentId: { type: 'string' } } },
    },
    async execute(input, ctx) {
      try {
        const a = await as.get(ctx.userId, String((input as { assignmentId: string }).assignmentId));
        if (!a.submissions.length) return { text: `Nobody has handed in "${a.title}" yet. Share the student link again: ${a.link}` };
        return { text: `${a.submissions.length} hand-ins of "${a.title}" are ready to mark. Give the teacher this link as a Markdown link named "Mark all ${a.submissions.length} hand-ins": ${dashboard(a.id)}?mark=1\nIt opens the Mark page with every student loaded. Tell them to add the marking scheme (or the question paper, and Bwenge writes the scheme first), then press Mark; each student appears in the chat as they are marked.` };
      } catch (e) { return err(`Could not open the assignment: ${problem(e)}`); }
    },
  };

  return [create, list, handIns, mark];
}
