import type { Tool, ToolServices } from '../types.js';
import { MIME } from '../files/mime.js';
import { err, saveFile, untrusted } from './helpers.js';

/**
 * Doing the work in the chat, with no page to open: mark a task's hand-ins and see the marks, change a task, release results to
 * students, make and fill a class, read marked exams, and download Excel files that arrive as attachments. Marking and releasing
 * spend credits or show things to students, so they say what they will do and wait for a yes when it matters.
 */
const problem = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 240);
const pct = (n: number | null | undefined) => (n === null || n === undefined ? 'n/a' : `${Math.round(n * 10) / 10}%`);
const STATE: Record<string, string> = { queued: 'waiting to be marked', marking: 'being marked now', marked: 'marked', needs_review: 'marked, a few answers need a look', failed: 'could not be marked', waiting_scheme: 'waiting for the marking scheme' };

export function workTools(services: ToolServices): Tool[] {
  const w = services.work;
  if (!w) return [];
  const note = (userId: string, action: string, type: string, id: string, details: unknown) => services.audit?.(userId, `CHAT_${action}`, type, id, details).catch(() => undefined);
  const TASK = { type: 'string', description: 'The task id (from list_assignments).' } as const;

  const results: Tool = {
    definition: {
      name: 'task_results',
      description: "How one task stands: who handed in, who is late, and for each hand-in whether it is marked, its mark and percent, and whether the result was released to the student. Use it for 'who passed', 'what did Aline get', 'how is the marking going', 'who is still not marked', and to check progress after mark_task.",
      parameters: { type: 'object', required: ['assignmentId'], properties: { assignmentId: TASK } },
    },
    async execute(input, ctx) {
      try {
        const a = await w.taskResults(ctx.userId, String((input as { assignmentId: string }).assignmentId));
        const subs = a.submissions;
        const marked = subs.filter((s) => s.marking && (s.marking.state === 'marked' || s.marking.state === 'needs_review'));
        const avg = marked.length ? marked.reduce((n, s) => n + (s.marking!.percent ?? 0), 0) / marked.length : null;
        const rows = subs.map((s) => `- ${s.studentName}${s.studentId ? ` (${s.studentId})` : ''}${s.late ? ' [late]' : ''}: ${s.marking ? `${STATE[s.marking.state] ?? s.marking.state}${s.marking.total !== null ? `, ${s.marking.total}/${s.marking.maxTotal} (${pct(s.marking.percent)})` : ''}${s.marking.released ? ', released to the student' : marked.includes(s) ? ', not released yet' : ''}${s.marking.error ? ` (${s.marking.error})` : ''}` : 'not marked'}`);
        return { text: `"${a.title}": ${subs.length} handed in, ${marked.length} marked${avg !== null ? `, average ${pct(avg)}` : ''}; ${a.open ? 'open' : 'closed'}; automatic marking ${a.autoMark ? 'on' : 'off'}.\n${untrusted('TASK_RESULTS', rows.join('\n') || 'Nobody has handed in yet.')}` };
      } catch (e) { return err(`Could not read the task: ${problem(e)}`); }
    },
  };

  const settings: Tool = {
    definition: {
      name: 'task_settings',
      description: "Change a task: open or close it for hand-ins, move the due date (ISO 8601, or null for none), rename it, or rewrite its instructions. Only change what the user asked for.",
      parameters: { type: 'object', required: ['assignmentId'], properties: { assignmentId: TASK, open: { type: 'boolean' }, dueAt: { type: ['string', 'null'] }, title: { type: 'string' }, instructions: { type: 'string' } } },
    },
    async execute(input, ctx) {
      const i = input as { assignmentId: string; open?: boolean; dueAt?: string | null; title?: string; instructions?: string };
      const patch = { open: i.open, dueAt: i.dueAt, title: i.title, instructions: i.instructions };
      if (!Object.values(patch).some((v) => v !== undefined)) return err('Say what to change: open, dueAt, title or instructions.');
      try {
        const a = await w.taskSettings(ctx.userId, String(i.assignmentId), patch);
        await note(ctx.userId, 'TASK_SETTINGS', 'task', String(i.assignmentId), { open: patch.open, dueAt: patch.dueAt, title: patch.title, instructions: patch.instructions !== undefined ? '(rewritten)' : undefined });
        return { text: `Task "${a.title}" is now ${a.open ? 'open' : 'closed'} for hand-ins${a.dueAt ? `, due ${a.dueAt.slice(0, 16).replace('T', ' ')} UTC` : ', with no due date'}.` };
      } catch (e) { return err(`Could not change the task: ${problem(e)}`); }
    },
  };

  const mark: Tool = {
    definition: {
      name: 'mark_task',
      description: "Mark every hand-in of a task with AI, right here in the chat, using the marking scheme. Pass the marking scheme as text in `scheme` when the user gives or pastes one (or asks you to write it from the questions: write the full scheme with the marks per question); leave it out when the task already has a scheme. Marking costs credits (about 12 per script): tell the user how many scripts there are and ask before you start when there are more than 10. If the scheme needs the lecturer's OK, this returns it: show it to the user, and only after they say yes call again with confirm true. Then use task_results to report progress and the marks.",
      parameters: {
        type: 'object', required: ['assignmentId'],
        properties: { assignmentId: TASK, scheme: { type: 'string', description: 'The marking scheme as plain text: each question with its marks and the answer or points that earn them.' }, confirm: { type: 'boolean', description: 'true only after the user read the scheme and said yes.' } },
      },
    },
    async execute(input, ctx) {
      const i = input as { assignmentId: string; scheme?: string; confirm?: boolean };
      try {
        const r = await w.markTask(ctx.userId, String(i.assignmentId), { scheme: i.scheme?.trim() || undefined, confirm: i.confirm === true });
        switch (r.kind) {
          case 'started': await note(ctx.userId, 'MARK_TASK', 'task', String(i.assignmentId), { handIns: r.count ?? null, newScheme: !!i.scheme }); return { text: `Marking started for ${r.count ?? 'all'} hand-in(s). It runs in the background and each paper is marked in about a minute. Tell the user, then call task_results in a little while to report the marks.` };
          case 'already_running': return { text: 'Marking is already running for this task. Call task_results to see how far it is.' };
          case 'nothing_to_mark': return { text: 'Everything handed in so far is already marked. Call task_results to show the marks.' };
          case 'no_papers': return { text: 'Nobody has handed in yet, so there is nothing to mark.' };
          case 'reading': return { text: 'The marking scheme is still being read. Wait a moment and call mark_task again.' };
          case 'needs_confirmation': return { text: `The marking scheme was read. Show it to the user in plain words and ask if it is right; if they say yes, call mark_task again with confirm true.\n${untrusted('SCHEME', `${r.summary ?? ''}${r.warnings?.length ? `\nWarnings: ${r.warnings.join('; ')}` : ''}`)}` };
          case 'invalid': return err(`The marking scheme cannot be used: ${(r.errors ?? []).join('; ') || 'it could not be read'}. Ask the user for a clearer scheme (each question with its marks) or write one with them.`);
          default: return { text: `Marking answered: ${r.kind}.` };
        }
      } catch (e) { return err(`Could not start marking: ${problem(e)}`); }
    },
  };

  const release: Tool = {
    definition: {
      name: 'release_task_results',
      description: "Show marked results to students (each student sees only their own, through their private result link). This is visible to students, so ask the user first and call it with confirmed true only after they said yes. Release everyone, or only the named students (by registration number).",
      parameters: { type: 'object', required: ['assignmentId'], properties: { assignmentId: TASK, confirmed: { type: 'boolean', description: 'true only after the user said yes.' }, studentIds: { type: 'array', items: { type: 'string' }, description: 'Registration numbers; leave out to release everyone marked.' } } },
    },
    async execute(input, ctx) {
      const i = input as { assignmentId: string; confirmed?: boolean; studentIds?: string[] };
      if (i.confirmed !== true) return err('Releasing shows the results to students. Ask the user to confirm, then call again with confirmed true.');
      try {
        let ids: string[] | undefined;
        if (i.studentIds?.length) {
          const a = await w.taskResults(ctx.userId, String(i.assignmentId));
          const want = new Set(i.studentIds.map((x) => x.toLowerCase()));
          ids = a.submissions.filter((s) => s.studentId && want.has(s.studentId.toLowerCase())).map((s) => s.id);
          if (!ids.length) return err('None of those registration numbers handed in to this task.');
        }
        const r = await w.releaseTask(ctx.userId, String(i.assignmentId), ids);
        await note(ctx.userId, 'RELEASE_TASK_RESULTS', 'task', String(i.assignmentId), { released: r.released, some: ids ? ids.length : 'all' });
        return { text: `Released ${r.released} result(s) to students.${r.skipped.length ? ` Not released: ${r.skipped.slice(0, 10).map((s) => `${s.studentName} (${s.reason})`).join('; ')}.` : ''}` };
      } catch (e) { return err(`Could not release the results: ${problem(e)}`); }
    },
  };

  const exportTask: Tool = {
    definition: {
      name: 'export_task_results',
      description: "The task's marks as an Excel file, attached to the chat: every student on the class list or who handed in, when, whether late, and the marks. Call it when the user wants the marks, a mark sheet or a spreadsheet of a task.",
      parameters: { type: 'object', required: ['assignmentId'], properties: { assignmentId: TASK } },
    },
    async execute(input, ctx) {
      try {
        const f = await w.exportTask(ctx.userId, String((input as { assignmentId: string }).assignmentId));
        const ref = await saveFile(ctx, { name: f.name.replace(/\.xlsx$/i, ''), ext: 'xlsx', mime: MIME.xlsx, kind: 'spreadsheet', data: f.data });
        return { text: `Created ${ref.name}. The file is attached for the user to download; summarise the marks briefly instead of pasting them.`, attachments: [ref] };
      } catch (e) { return err(`Could not make the file: ${problem(e)}`); }
    },
  };

  const createClass: Tool = {
    definition: {
      name: 'create_class',
      description: "Make a class (course) with its students: a name, optionally a code and term, and the students pasted as one line each (registration number, then name; an email may follow). Call it when the user wants to set up a class or roster.",
      parameters: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, code: { type: 'string' }, term: { type: 'string' }, students: { type: 'string', description: 'One student per line: registration number, name[, email].' } } },
    },
    async execute(input, ctx) {
      const i = input as { name: string; code?: string; term?: string; students?: string };
      try {
        const c = await w.createCourse(ctx.userId, { name: i.name, code: i.code, term: i.term, students: i.students });
        await note(ctx.userId, 'CREATE_CLASS', 'class', c.id, { name: c.name, students: c.students });
        return { text: `Class "${c.name}" made with ${c.students} student(s) (courseId ${c.id}). Next the user can link tasks and quizzes to it (link_class_work) to see marks by student.` };
      } catch (e) { return err(`Could not make the class: ${problem(e)}`); }
    },
  };

  const addStudents: Tool = {
    definition: {
      name: 'add_class_students',
      description: "Add students to a class from pasted text, one per line (registration number, name[, email]). A student already listed by that number gets the new name or email; nothing else changes.",
      parameters: { type: 'object', required: ['courseId', 'students'], properties: { courseId: { type: 'string' }, students: { type: 'string' } } },
    },
    async execute(input, ctx) {
      const i = input as { courseId: string; students: string };
      try {
        const r = await w.addCourseStudents(ctx.userId, String(i.courseId), String(i.students));
        await note(ctx.userId, 'ADD_CLASS_STUDENTS', 'class', String(i.courseId), r);
        return { text: `Added ${r.added} student(s), updated ${r.updated}.` };
      } catch (e) { return err(`Could not add the students: ${problem(e)}`); }
    },
  };

  const link: Tool = {
    definition: {
      name: 'link_class_work',
      description: "Choose which tasks and quizzes count in a class (this REPLACES the list): each item is a task (assignment id) or a quiz (form id). Students are matched by registration number, so the class overview and the gradebook then show their marks.",
      parameters: { type: 'object', required: ['courseId', 'items'], properties: { courseId: { type: 'string' }, items: { type: 'array', items: { type: 'object', required: ['kind', 'id'], properties: { kind: { type: 'string', enum: ['task', 'quiz'] }, id: { type: 'string' } } } } } },
    },
    async execute(input, ctx) {
      const i = input as { courseId: string; items: Array<{ kind: 'task' | 'quiz'; id: string }> };
      try {
        await w.linkCourseWork(ctx.userId, String(i.courseId), i.items ?? []);
        await note(ctx.userId, 'LINK_CLASS_WORK', 'class', String(i.courseId), { items: (i.items ?? []).length });
        return { text: `The class now counts ${(i.items ?? []).length} task(s) and quiz(zes). Use course_overview to see the marks.` };
      } catch (e) { return err(`Could not link the work: ${problem(e)}`); }
    },
  };

  const exportClass: Tool = {
    definition: {
      name: 'export_class_gradebook',
      description: "A class's gradebook as an Excel file attached to the chat: every student, the percent for each task or quiz, the average, what is missing and who needs attention.",
      parameters: { type: 'object', required: ['courseId'], properties: { courseId: { type: 'string' } } },
    },
    async execute(input, ctx) {
      try {
        const f = await w.exportCourse(ctx.userId, String((input as { courseId: string }).courseId));
        const ref = await saveFile(ctx, { name: f.name.replace(/\.xlsx$/i, ''), ext: 'xlsx', mime: MIME.xlsx, kind: 'spreadsheet', data: f.data });
        return { text: `Created ${ref.name}. The file is attached for the user to download; summarise the class briefly instead of pasting the table.`, attachments: [ref] };
      } catch (e) { return err(`Could not make the gradebook: ${problem(e)}`); }
    },
  };

  const examRes: Tool = {
    definition: {
      name: 'exam_results',
      description: "The marks of one marked exam set (from list_marked_exams): each candidate with total, percent, whether the result was released, and how many answers still need the teacher's look. Use it for 'show me the results of the mock exam', 'who needs review'.",
      parameters: { type: 'object', required: ['examId'], properties: { examId: { type: 'string' } } },
    },
    async execute(input, ctx) {
      try {
        const r = await w.examResults(ctx.userId, String((input as { examId: string }).examId));
        const avg = r.rows.length ? r.rows.reduce((n, x) => n + x.percent, 0) / r.rows.length : null;
        const lines = r.rows.map((x) => `- ${x.candidateName ?? x.candidateId} (${x.candidateId}): ${x.total}/${x.maxTotal} (${pct(x.percent)})${x.released ? ', released' : ''}${x.openFlags || x.lowConfidence ? `, needs a look (${x.openFlags} flagged, ${x.lowConfidence} low confidence)` : ''}`);
        return { text: `${r.title}: ${r.rows.length} candidate(s), average ${pct(avg)}.\n${untrusted('EXAM_RESULTS', lines.join('\n') || 'Nothing is marked yet.')}` };
      } catch (e) { return err(`Could not read the exam: ${problem(e)}`); }
    },
  };

  const practiceList: Tool = {
    definition: {
      name: 'list_practice_classes',
      description: "The user's practice classes (Learn): classes where students join with a code and practise topics; the lecturer sees an anonymous overview. Call it for 'my practice classes', 'what is the class code for students to join'.",
      parameters: { type: 'object', properties: {} },
    },
    async execute(_i, ctx) {
      try {
        const rows = await w.practiceClasses(ctx.userId);
        if (!rows.length) return { text: 'The user has no practice classes yet. create_practice_class makes one and gives the code students join with.' };
        return { text: untrusted('PRACTICE_CLASSES', rows.map((r) => `- ${r.name}: join code ${r.code}, ${r.students} student(s) (classId ${r.id})`).join('\n')) };
      } catch (e) { return err(`Could not list the practice classes: ${problem(e)}`); }
    },
  };

  const practiceCreate: Tool = {
    definition: {
      name: 'create_practice_class',
      description: 'Make a practice class and get the code students use to join it (Learn → classes). Call it when the user wants students to practise topics with adaptive questions and see how they are doing.',
      parameters: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
    },
    async execute(input, ctx) {
      try {
        const c = await w.createPracticeClass(ctx.userId, String((input as { name: string }).name));
        await note(ctx.userId, 'CREATE_PRACTICE_CLASS', 'practice_class', c.id, { name: c.name });
        return { text: `Practice class "${c.name}" made. Students join with the code ${c.code} (Learn → Join a class). Give the user the code. classId ${c.id}.` };
      } catch (e) { return err(`Could not make the class: ${problem(e)}`); }
    },
  };

  const practiceOverview: Tool = {
    definition: {
      name: 'practice_class_overview',
      description: "How a practice class is doing: how many students were active this week and, for each topic with enough students, accuracy, mastery bands (struggling, developing, secure) and shared misconceptions. Results are anonymous by design (small groups are hidden): never try to identify students from it.",
      parameters: { type: 'object', required: ['classId'], properties: { classId: { type: 'string' } } },
    },
    async execute(input, ctx) {
      try {
        const d = await w.practiceClassOverview(ctx.userId, String((input as { classId: string }).classId));
        const lines = d.topics.map((t) => `- ${t.topic}: ${t.learners} students, accuracy ${t.accuracy === null ? 'n/a' : `${Math.round(t.accuracy * 100)}%`}, mastery ${Math.round(t.meanMastery * 100)}% (struggling ${t.bands.struggling}, developing ${t.bands.developing}, secure ${t.bands.secure})${t.misconceptions.length ? `; common mistakes: ${t.misconceptions.map((m) => `${m.tag} (${m.learners})`).join(', ')}` : ''}`);
        return { text: `${d.class.name} (code ${d.class.code}): ${d.students} student(s)${d.active7d !== null ? `, ${d.active7d} active in the last 7 days` : ''}.\n${untrusted('PRACTICE_OVERVIEW', lines.join('\n') || 'No topic has enough students yet.')}${d.note ? `\n${d.note}` : ''}` };
      } catch (e) { return err(`Could not read the class: ${problem(e)}`); }
    },
  };

  const examCand: Tool = {
    definition: {
      name: 'exam_candidate',
      description: "One candidate of a marked exam, question by question: marks out of the maximum, whether it is full, partial or zero, and how many questions are flagged for a look. Use it for 'why did Ann get 40', 'show me Ann's marks per question'. The candidate is the registration number or the name as in exam_results.",
      parameters: { type: 'object', required: ['examId', 'candidate'], properties: { examId: { type: 'string' }, candidate: { type: 'string' } } },
    },
    async execute(input, ctx) {
      const i = input as { examId: string; candidate: string };
      try {
        const c = await w.examCandidate(ctx.userId, String(i.examId), String(i.candidate));
        if (!c) return { text: 'That candidate has no marked script yet.' };
        const rows = c.questions.map((q) => `- Question ${q.number}: ${q.marks === null ? 'not marked' : `${q.marks}/${q.maxMarks}`} (${q.outcome})${q.flags ? `, ${q.flags} flagged for a look` : ''}`);
        return { text: `${c.candidateName ?? c.candidateId} (${c.candidateId}): ${c.total}/${c.maxTotal} (${pct(c.percent)})${c.passed === null ? '' : c.passed ? ', passed' : ', not passed'}.\n${untrusted('CANDIDATE', rows.join('\n'))}` };
      } catch (e) { return err(`Could not read the candidate: ${problem(e)}`); }
    },
  };

  const changeMark: Tool = {
    definition: {
      name: 'change_exam_mark',
      description: "Change one mark on a marked exam, with a reason (kept in the record). Use it when the lecturer says a mark should be different ('give Ann 4 for question 3, the working was right'). It cannot be undone by the chat, so say what you will change and call it only after the user asked for exactly that.",
      parameters: { type: 'object', required: ['examId', 'candidate', 'question', 'marks', 'reason'], properties: { examId: { type: 'string' }, candidate: { type: 'string' }, question: { type: 'string', description: 'The question number, as in exam_candidate.' }, marks: { type: 'number' }, reason: { type: 'string', description: "Why, in the lecturer's words." } } },
    },
    async execute(input, ctx) {
      const i = input as { examId: string; candidate: string; question: string; marks: number; reason: string };
      if (!String(i.reason ?? '').trim()) return err('A reason is needed: ask the user why the mark changes.');
      try {
        await w.changeExamMark(ctx.userId, String(i.examId), String(i.candidate), String(i.question), Number(i.marks), String(i.reason).trim());
        await note(ctx.userId, 'CHANGE_EXAM_MARK', 'exam', String(i.examId), { candidate: i.candidate, question: i.question, marks: i.marks, reason: String(i.reason).trim().slice(0, 300) });
        return { text: `Question ${i.question} for ${i.candidate} is now ${i.marks} mark(s). The reason is in the record. Use exam_candidate to show the new total.` };
      } catch (e) { return err(`Could not change the mark: ${problem(e)}`); }
    },
  };

  const releaseExam: Tool = {
    definition: {
      name: 'release_exam_results',
      description: "Release a marked exam set's results so students can see them. Visible to students: ask first and call it with confirmed true only after the user said yes. Candidates with an unmarked question are skipped and listed.",
      parameters: { type: 'object', required: ['examId'], properties: { examId: { type: 'string' }, confirmed: { type: 'boolean', description: 'true only after the user said yes.' } } },
    },
    async execute(input, ctx) {
      const i = input as { examId: string; confirmed?: boolean };
      if (i.confirmed !== true) return err('Releasing shows the results to students. Ask the user to confirm, then call again with confirmed true.');
      try {
        const r = await w.releaseExam(ctx.userId, String(i.examId));
        await note(ctx.userId, 'RELEASE_EXAM_RESULTS', 'exam', String(i.examId), { released: r.released, skipped: r.skipped.length });
        return { text: `Released ${r.released} result(s).${r.skipped.length ? ` Skipped: ${r.skipped.slice(0, 10).map((s) => `${s.candidateId} (${s.reason})`).join('; ')}.` : ''}` };
      } catch (e) { return err(`Could not release the results: ${problem(e)}`); }
    },
  };

  return [results, settings, mark, release, exportTask, createClass, addStudents, link, exportClass, practiceList, practiceCreate, practiceOverview, examRes, examCand, changeMark, releaseExam];
}
