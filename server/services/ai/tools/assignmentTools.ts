import type { Tool, ToolServices } from '../types.js';
import { err, untrusted } from './helpers.js';

/**
 * Tasks in the chat (stored as assignments): the user asks for a task to be set ("give my S4 group homework on
 * linear equations, due Friday"), gets the share link, asks who has submitted, and starts marking them all. Marking
 * itself opens the Mark page with every submission loaded, where the user adds the scheme and watches it live.
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
      description: 'Set a task and get the link people use to submit (no account needed; photos, PDF, Word or typed). Write the complete task they will read: the questions or what they must do, how to submit, and the marks if known. Call it when the user asks to give, set, assign or share homework, an exercise, a test, a survey-style exercise or any task.',
      parameters: {
        type: 'object', required: ['title', 'instructions'],
        properties: {
          title: { type: 'string', description: 'Short title with the group and subject, e.g. "S4 Mathematics: Linear equations homework".' },
          instructions: { type: 'string', description: 'The full task people see, in the language the user wrote in.' },
          dueAt: { type: 'string', description: 'Due date and time as ISO 8601 (e.g. 2026-11-03T17:00:00+02:00), only when the user gave one.' },
        },
      },
    },
    async execute(input, ctx) {
      const i = input as { title: string; instructions: string; dueAt?: string };
      try {
        const a = await as.create(ctx.userId, i);
        return { text: `Task created: "${a.title}" (assignmentId ${a.id}), due ${when(a.dueAt)}.\nLink to share (for example in the group chat): ${a.link}\nDashboard: ${dashboard(a.id)}\nGive the user both links as Markdown links, say people need no account to submit, and that they can say "mark them all" when submissions are in. Call it a task, not an assignment.` };
      } catch (e) { return err(`Could not create the task: ${problem(e)}`); }
    },
  };

  const list: Tool = {
    definition: {
      name: 'list_assignments',
      description: "List the user's tasks with how many people have submitted, the due date, whether submissions are open, and their links. Call it when the user asks about their tasks (or assignments, homework) or refers to one by name.",
      parameters: { type: 'object', properties: {} },
    },
    async execute(_input, ctx) {
      try {
        const rows = await as.list(ctx.userId);
        if (!rows.length) return { text: 'The user has no tasks yet.' };
        return { text: untrusted('ASSIGNMENTS', rows.map((r) => `- ${r.title} (assignmentId ${r.id}): ${r.submitted} submitted, ${r.open ? 'open' : 'closed'}, due ${when(r.dueAt)}; share link ${r.link}; dashboard ${dashboard(r.id)}`).join('\n')) };
      } catch (e) { return err(`Could not list tasks: ${problem(e)}`); }
    },
  };

  const handIns: Tool = {
    definition: {
      name: 'assignment_hand_ins',
      description: 'Who has submitted for one task: each person, their ID, when, whether late, the files they sent, and the start of any typed answer. Use it to answer "who has submitted", "who is late", or to summarise the submissions.',
      parameters: { type: 'object', required: ['assignmentId'], properties: { assignmentId: { type: 'string' } } },
    },
    async execute(input, ctx) {
      try {
        const a = await as.get(ctx.userId, String((input as { assignmentId: string }).assignmentId));
        const lines = a.submissions.map((s) => `- ${s.studentName}${s.studentId ? ` (${s.studentId})` : ''}: ${new Date(s.submittedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC${s.late ? ', LATE' : ''}; ${s.files.length} file(s)${s.files.length ? ` [${s.files.map((f) => f.name).join(', ').slice(0, 200)}]` : ''}${s.text ? `; typed: "${s.text.slice(0, 300).replace(/\s+/g, ' ')}"` : ''}`);
        return { text: `"${a.title}": ${a.submissions.length} submitted, ${a.open ? 'open' : 'closed'}, due ${when(a.dueAt)}. Dashboard: ${dashboard(a.id)}\n${untrusted('HAND_INS', lines.join('\n') || 'Nobody has submitted yet.')}` };
      } catch (e) { return err(`Could not read the submissions: ${problem(e)}`); }
    },
  };

  const mark: Tool = {
    definition: {
      name: 'mark_assignment',
      description: 'Start marking every submission of a task with AI. Returns a link that opens the Mark page with everyone loaded (one PDF per person, names kept); the user adds the marking scheme or the question paper there and presses Mark, and marking runs live in the chat. Call it when the user asks to mark or correct a task.',
      parameters: { type: 'object', required: ['assignmentId'], properties: { assignmentId: { type: 'string' } } },
    },
    async execute(input, ctx) {
      try {
        const a = await as.get(ctx.userId, String((input as { assignmentId: string }).assignmentId));
        if (!a.submissions.length) return { text: `Nobody has submitted "${a.title}" yet. Share the link again: ${a.link}` };
        return { text: `${a.submissions.length} submissions of "${a.title}" are ready to mark. Give the user this link as a Markdown link named "Mark all ${a.submissions.length} submissions": ${dashboard(a.id)}?mark=1\nIt opens the Mark page with everyone loaded. Tell them to add the marking scheme (or the question paper, and Bwenge writes the scheme first), then press Mark; each person appears in the chat as they are marked.` };
      } catch (e) { return err(`Could not open the task: ${problem(e)}`); }
    },
  };

  return [create, list, handIns, mark];
}
