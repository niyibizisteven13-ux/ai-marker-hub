import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

// The web chat end to end, the way a lecturer uses it: real chat code (generalAssist) over HTTP against a scripted stand-in for Claude
// (the real stream format), the REAL task, class and form services, and a stand-in MySEB server for the live room. What is checked:
// platform requests reach the tools, the tools run, their answers go back to the model, and the actions really happened.
const claudeRequests: any[] = [];
type Turn = { text?: string; tools?: Array<{ id: string; name: string; input: unknown }> };
const script: Turn[] = [];
function sse(res: http.ServerResponse, turn: Turn) {
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  send('message_start', { type: 'message_start', message: { id: `msg_${claudeRequests.length}`, type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 12, output_tokens: 1 } } });
  let i = 0;
  if (turn.text) { send('content_block_start', { type: 'content_block_start', index: i, content_block: { type: 'text', text: '' } }); send('content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'text_delta', text: turn.text } }); send('content_block_stop', { type: 'content_block_stop', index: i++ }); }
  for (const t of turn.tools ?? []) {
    send('content_block_start', { type: 'content_block_start', index: i, content_block: { type: 'tool_use', id: t.id, name: t.name, input: {} } });
    const json = JSON.stringify(t.input);
    for (let k = 0; k < json.length; k += 50) send('content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: json.slice(k, k + 50) } });
    send('content_block_stop', { type: 'content_block_stop', index: i++ });
  }
  send('message_delta', { type: 'message_delta', delta: { stop_reason: turn.tools?.length ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 20 } });
  send('message_stop', { type: 'message_stop' });
  res.end();
}
const claude = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => { if (req.url !== '/v1/messages') { res.writeHead(404).end(); return; } claudeRequests.push(JSON.parse(body)); sse(res, script.shift() ?? { text: 'Done.' }); });
}).listen(0);
await new Promise((r) => claude.once('listening', r));

// The MySEB server's live-room answers (the real one needs its own database).
const examId = randomUUID();
const benSession = randomUUID(); const amySession = randomUUID();
const mysebCalls: string[] = [];
let benEnded = true;
const myseb = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (req.headers.authorization !== 'Bearer svc-key') { res.writeHead(401).end('{}'); return; }
    mysebCalls.push(`${req.method} ${req.url}${body ? ` ${body}` : ''}`);
    const json = (o: unknown) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(o));
    if (req.url === `/api/exams/${examId}/monitor?frames=0` || req.url === `/api/exams/${examId}/monitor`) {
      return json({ exam: { title: 'Biology midterm', status: 'active', live_mode: 'pictures', live_sound: false, live_source: 'camera', allow_web: true, web_strict: true, web_devices: 'ios', multi_face: 'warn', id_check: false, leave_action: 'record' }, counts: { IN_EXAM: 1, PAUSED: 0, LEFT: 0, ENDED: benEnded ? 1 : 0 },
        students: [{ id: amySession, student_name: 'Amy Uwase', status: 'IN_EXAM', client_type: 'web', violation_count: 0, last_violation: null, pause_reason: null, end_reason: null, aside_seconds: 40, has_partial: true },
          { id: benSession, student_name: 'Ben Habimana', status: benEnded ? 'ENDED' : 'IN_EXAM', client_type: 'web', violation_count: 1, last_violation: 'visibility_hidden', pause_reason: null, end_reason: benEnded ? 'visibility_hidden' : null, has_partial: true }] });
    }
    if (req.url === `/api/sessions/${benSession}/reinstate` && req.method === 'POST') { benEnded = false; return json({ ok: true }); }
    if (req.url === `/api/exams/${examId}/generate-code` && req.method === 'POST') return json({ code: '482910', display: '482 910', qrSvg: '<svg/>', joinUrl: 'https://www.bwenge.space/myseb/join/482910', expiresAt: '2026-11-17T12:00:00Z' });
    if (req.url === `/api/exams/${examId}` && req.method === 'PATCH') return json({ ok: true });
    if (req.url === `/api/sessions/${benSession}/partial`) return json({ student: 'Ben Habimana', saved_at: '2026-11-16T09:05:00Z', labels: { q1: 'What makes energy in a cell?' }, answers: { q1: 'Mitochondria' } });
    res.writeHead(404).end('{"error":"not found"}');
  });
}).listen(0);
await new Promise((r) => myseb.once('listening', r));

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'chatagent-'));
Object.assign(process.env, {
  AI_PROVIDER: 'gonkarouter', AI_AGENT_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'test-key-not-real', ANTHROPIC_BASE_URL: `http://127.0.0.1:${(claude.address() as AddressInfo).port}`,
  CLAUDE_AGENT_MODEL: 'claude-haiku-5-5', CLAUDE_FALLBACK_TO_GONKA: 'false', GONKA_API_KEY: 'test-gonka-key', GONKA_BASE_URL: 'http://127.0.0.1:9/gonka/v1', LIBRARY_AUTO_ROUTE: 'false',
  MYSEB_URL: `http://127.0.0.1:${(myseb.address() as AddressInfo).port}`, MYSEB_SERVICE_KEY: 'svc-key', APP_BASE_URL: 'https://www.bwenge.space',
});
// MySEB is a paid service (see tests/myseb_access.test.ts); these scenarios are about the chat, so charging is switched off here.
const platformSettings = await import('../server/services/platform/settings.js');
platformSettings.__setPlatformSettingsForTests({ ...platformSettings.DEFAULT_SETTINGS, flags: { 'myseb.requirePayment': false } });
const { prisma } = await import('../server/db.js');
const db = prisma as any;
const { AiService, fileJobQueue } = await import('../server/services/AiService.js');
const { OwnedRecordStore } = await import('../server/services/storage/ownedRecordStore.js');
const { AssignmentError, createAssignmentService } = await import('../server/services/assignments/service.js');
const { setAssignmentService } = await import('../server/services/assignments/runtime.js');
const { createCourseService } = await import('../server/services/courses/service.js');
const { setCourseService } = await import('../server/services/courses/runtime.js');
const ai = AiService.getInstance();
test.after(async () => { await fileJobQueue.stop(); claude.close(); myseb.close(); await fs.rm(dir, { recursive: true, force: true }); });

const user = `lect-${randomUUID().slice(0, 8)}`;
await db.user.create({ data: { id: user, email: `${user}@test.local`, name: 'Lecturer', passwordHash: 'x', role: 'INSTRUCTOR' } });
const formId = randomUUID();
await db.applicationForm.create({ data: { id: formId, userId: user, title: 'Biology midterm', schema: JSON.stringify({ title: 'Biology midterm', fields: [], exam: { enabled: true, minutes: 45, requireMyseb: true, mysebExamId: examId } }), rubric: null, selectionSettings: null, createdAt: new Date(), updatedAt: new Date() } });

// real task + class services; only the AI marker and the file store are stand-ins
const mem = new Map<string, { owner: string; name: string; mime: string; data: Buffer }>();
const files = {
  async save(u: string, name: string, mime: string, data: Buffer) { const id = randomUUID(); mem.set(id, { owner: u, name, mime, data }); return { id, name, mime, size: data.length }; },
  async read(u: string, id: string) { const f = mem.get(id); if (!f || f.owner !== u) throw new AssignmentError('NOT_FOUND', 'File not found.', 404); return f; },
};
const taskStore = new OwnedRecordStore<any>(path.join(dir, 'a'));
const marked = new Map<string, { total: number; released: boolean }>();
const markCalls: string[] = [];
const marker: any = {
  async mark() {},
  async statuses(_o: string, a: any) { return Object.fromEntries(a.submissions.filter((s: any) => marked.has(s.id)).map((s: any) => [s.id, { state: 'marked', total: marked.get(s.id)!.total, maxTotal: 20, percent: marked.get(s.id)!.total * 5, released: marked.get(s.id)!.released }])); },
  async release(_o: string, a: any, ids: any) { markCalls.push(`release ${ids === 'all' ? 'all' : ids.length}`); for (const s of a.submissions) if (marked.has(s.id) && (ids === 'all' || ids.includes(s.id))) marked.get(s.id)!.released = true; return { released: [...marked.values()].filter((m) => m.released).length, skipped: [] }; },
  async result() { return { state: 'not_marked', title: '', studentName: '' }; },
  async markNow(_o: string, a: any, opts: { confirm: boolean }) {
    markCalls.push(`markNow confirm=${opts.confirm}`);
    if (!opts.confirm) return { kind: 'needs_confirmation', scheme: { state: 'needs_confirmation', summary: '2 questions, 20 marks', warnings: [], errors: [] } };
    a.submissions.forEach((s: any, i: number) => marked.set(s.id, { total: 18 - i * 6, released: false }));
    await taskStore.update(a.id, a.ownerId, (r: any) => { r.examId = 'exam1'; });
    return { kind: 'started' };
  },
};
const tasks = createAssignmentService({ store: taskStore, files: files as any, tokenDir: path.join(dir, 'links'), baseUrl: () => 'https://www.bwenge.space', marker });
setAssignmentService(tasks);
setCourseService(createCourseService({ store: new OwnedRecordStore<any>(path.join(dir, 'c')), sources: { available: async () => ({ tasks: [], quizzes: [] }), task: async (o: string, id: string) => { const a: any = await tasks.get(o, id); return { title: a.title, dueAt: a.dueAt, submissions: a.submissions.map((s: any) => ({ studentId: s.studentId, late: s.late, marking: s.marking })) } as any; }, quiz: async () => null } as any }));

const toolResults = (req: any) => (req.messages.at(-1).content as any[]).filter((b) => b.type === 'tool_result').map((b) => (typeof b.content === 'string' ? b.content : JSON.stringify(b.content)));
const ask = (text: string, history: any[] = []) => ai.generalAssist({ userId: user, messages: [...history, { role: 'user', content: text }], onEvent: () => undefined }) as Promise<any>;

test('"how is my exam going" reaches the tools, and the live room is read, changed and explained from the chat', async () => {
  claudeRequests.length = 0; mysebCalls.length = 0;
  script.push(
    { text: 'Let me look.', tools: [{ id: 't1', name: 'list_live_rooms', input: {} }] },
    { tools: [{ id: 't2', name: 'live_room_status', input: { kind: 'form', id: formId } }] },
    { tools: [{ id: 't3', name: 'live_room_student', input: { kind: 'form', id: formId, student: 'Ben', action: 'let_back_in' } }, { id: 't4', name: 'live_room_saved_answers', input: { kind: 'form', id: formId, student: 'Ben Habimana' } }] },
    { text: 'Ben is back in and his answer so far was "Mitochondria".' },
  );
  const out = await ask('How is my biology exam going? Ben said it was a mistake, let him back in and show me what he had written.');
  assert.equal(claudeRequests.length, 4, 'the message was routed to the tool model');
  const first = claudeRequests[0];
  const toolNames: string[] = first.tools.map((t: any) => t.name);
  for (const n of ['list_live_rooms', 'live_room_status', 'live_room_code', 'live_room_settings', 'live_room_student', 'live_room_saved_answers', 'mark_task', 'task_results', 'release_task_results', 'create_class', 'course_overview', 'exam_results', 'set_test_rules', 'create_assignment', 'create_form']) assert.ok(toolNames.includes(n), `the model is offered ${n}`);
  const system = JSON.stringify(first.system);
  assert.match(system, /The whole platform, from here/); assert.match(system, /Doing the work in the chat/); assert.match(system, /Tests and live rooms \(MySEB\)/);
  // the tools ran against the (stand-in) live room and the answers went back to the model
  const r1 = toolResults(claudeRequests[1])[0]; assert.match(r1, /Biology midterm \(form /); assert.match(r1, /MySEB is on/);
  const r2 = toolResults(claudeRequests[2])[0];
  assert.match(r2, /browsers allowed on iPhones and iPads only, strict rules on/); assert.match(r2, /Disqualified: Ben Habimana \(opened another app or tab\)/); assert.match(r2, /Amy Uwase 40s/);
  const r3 = toolResults(claudeRequests[3]);
  assert.match(r3[0], /Done: let back in for Ben Habimana/); assert.match(r3[1], /What makes energy in a cell\?: Mitochondria/);
  assert.ok(mysebCalls.includes(`POST /api/sessions/${benSession}/reinstate`), 'Ben was really let back in on the MySEB server');
  assert.match(JSON.stringify(out.content), /Mitochondria/);
});

test('a code and a rule change from the chat, without opening any page', async () => {
  claudeRequests.length = 0; mysebCalls.length = 0;
  script.push(
    { tools: [{ id: 't1', name: 'live_room_code', input: { kind: 'form', id: formId } }, { id: 't2', name: 'live_room_settings', input: { kind: 'form', id: formId, faces: 'end', studentCard: true, browserDevices: 'any' } }] },
    { text: 'The code is 482 910 and the rules are changed.' },
  );
  await ask('Give me a code for students and make more-than-one-face disqualify, and ask for the student card.');
  const [code, settings] = toolResults(claudeRequests[1]);
  assert.match(code, /Code: 482 910/); assert.match(code, /myseb\/join\/482910/);
  assert.match(settings, /faces: end/); assert.match(settings, /studentCard: true/); assert.match(settings, /browserDevices: any/);
  const patch = mysebCalls.find((c) => c.startsWith(`PATCH /api/exams/${examId}`))!;
  assert.match(patch, /"multiFace":"end"/); assert.match(patch, /"idCheck":true/); assert.match(patch, /"webDevices":"any"/);
  assert.match(patch, /"liveMode":"pictures"/, 'the live mode the lecturer had is kept');
});

test('marking a task from the chat: the scheme is read back for a yes, marks are reported, releasing waits for a yes, Excel arrives attached', async () => {
  const a = await tasks.create(user, { title: 'Cells homework', instructions: 'Draw and label a cell.' });
  const token = a.link.split('/a/')[1];
  for (const [n, id] of [['Aline Uwase', '2201'], ['Eric Mugisha', '2202']]) await tasks.submit(token, { studentName: n, studentId: id, text: `${n}'s answer` });
  claudeRequests.length = 0; markCalls.length = 0;
  // turn 1: the scheme goes in, the chat shows it back and waits
  script.push(
    { tools: [{ id: 'm1', name: 'mark_task', input: { assignmentId: a.id, scheme: 'Q1 (10 marks): organelles named\nQ2 (10 marks): functions' } }] },
    { text: 'I read your scheme: 2 questions, 20 marks. Shall I mark now?' },
  );
  const first: any = await ask('Mark my Cells homework with this scheme: Q1 (10 marks) organelles named, Q2 (10 marks) functions.');
  assert.match(toolResults(claudeRequests[1])[0], /2 questions, 20 marks/); assert.match(toolResults(claudeRequests[1])[0], /confirm true/);
  assert.deepEqual(markCalls, ['markNow confirm=false'], 'nothing was marked before the yes');
  // turn 2: the user says yes; marking runs, the marks are read back, releasing is refused until the user agrees
  claudeRequests.length = 0;
  const history: any[] = [{ role: 'user', content: 'Mark my Cells homework with this scheme: Q1 (10 marks) organelles named, Q2 (10 marks) functions.' }, { role: 'assistant', content: first.content?.[0]?.text ?? 'I read your scheme: 2 questions, 20 marks. Shall I mark now?' }];
  script.push(
    { tools: [{ id: 'm2', name: 'mark_task', input: { assignmentId: a.id, confirm: true } }] },
    { tools: [{ id: 'm3', name: 'task_results', input: { assignmentId: a.id } }, { id: 'm4', name: 'release_task_results', input: { assignmentId: a.id } }, { id: 'm5', name: 'export_task_results', input: { assignmentId: a.id } }] },
    { text: 'Marked: Aline 18/20, Eric 12/20. The Excel sheet is attached. Release to students?' },
  );
  const events: any[] = [];
  const out: any = await ai.generalAssist({ userId: user, messages: [...history, { role: 'user', content: 'Yes, mark them, show me the marks and send me the Excel sheet.' }], onEvent: (e) => events.push(e) });
  assert.match(toolResults(claudeRequests[1])[0], /Marking started for 2 hand-in/);
  const [results, release, exported] = toolResults(claudeRequests[2]);
  assert.match(results, /2 handed in, 2 marked, average 75%/); assert.match(results, /Aline Uwase \(2201\): marked, 18\/20 \(90%\), not released yet/);
  assert.match(release, /Ask the user to confirm/, 'releasing to students was refused without a yes');
  assert.ok(!markCalls.some((c) => c.startsWith('release')), 'nothing was released');
  assert.match(exported, /attached/);
  assert.equal(out.attachments.length, 1); assert.match(out.attachments[0].name, /Cells homework marks\.xlsx$/);
  assert.ok(events.some((e) => e.type === 'attachment'), 'the Excel file reached the chat stream');
});

test('a class from a pasted list, linked to the task, read back as numbers', async () => {
  const list: any[] = await tasks.list(user);
  claudeRequests.length = 0;
  script.push(
    { tools: [{ id: 'c1', name: 'create_class', input: { name: 'S4 Biology', code: 'BIO4', students: '2201, Aline Uwase\n2202, Eric Mugisha\n2203, Chantal Mutesi' } }] },
    { tools: [{ id: 'c2', name: 'list_courses', input: {} }] },
    { text: 'Class made.' },
  );
  await ask('Create my class S4 Biology with these students: 2201 Aline Uwase, 2202 Eric Mugisha, 2203 Chantal Mutesi.');
  const made = toolResults(claudeRequests[1])[0]; const courseId = /courseId ([0-9a-f-]{36})/.exec(made)?.[1] as string;
  assert.ok(courseId, made); assert.match(made, /made with 3 student/);
  claudeRequests.length = 0;
  script.push(
    { tools: [{ id: 'c3', name: 'link_class_work', input: { courseId, items: [{ kind: 'task', id: list[0].id }] } }] },
    { tools: [{ id: 'c4', name: 'course_overview', input: { courseId } }] },
    { text: 'Chantal has not handed in.' },
  );
  await ask('Link the Cells homework to my S4 Biology class and tell me who is missing work.');
  const overview = toolResults(claudeRequests[2])[0];
  assert.match(overview, /S4 Biology \(BIO4\): 3 students, class average 75%/); assert.match(overview, /2\/3 handed in/);
});

test('general questions stay on the everyday chat model', async () => {
  claudeRequests.length = 0;
  await assert.rejects(ask('What is photosynthesis?'));
  assert.equal(claudeRequests.length, 0, 'no tool model for a general question');
});
