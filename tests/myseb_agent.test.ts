import { test as baseTest } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { AUTO_REASONS, DEFAULT_RULES, cleanRules, decide, type AgentRules, type StudentView } from '../server/services/mySebAgent.js';

// The room assistant: the lecturer's rules for routine moments. The decisions are plain functions (always tested); the loop against a stand-in
// MySEB server and PostgreSQL runs in CI.
const on = (over: Partial<AgentRules> = {}): AgentRules => ({ ...DEFAULT_RULES, on: true, ...over });
const stu = (over: Partial<StudentView> = {}): StudentView => ({ id: 's1', student_name: 'Amy', status: 'PAUSED', pause_reason: 'face_missing', seen_ago: 2, ...over });

baseTest('rules are clamped, and the assistant can only ever clear the small reasons', () => {
  const r = cleanRules({ on: true, afterSeconds: 9999, maxResumes: 0, reasons: ['teacher', 'screenshot', 'blur', 'nonsense'] as any });
  assert.equal(r.afterSeconds, 300); assert.equal(r.maxResumes, 1); assert.deepEqual(r.reasons, ['blur'], 'teacher and cheating reasons cannot be added');
  assert.deepEqual(cleanRules({ reasons: ['teacher'] as any }).reasons, [...AUTO_REASONS], 'a list with nothing valid keeps the default');
  assert.equal(cleanRules(undefined).on, false, 'off until the lecturer switches it on');
  for (const bad of ['teacher', 'screenshot', 'screen_recording', 'forbidden_app', 'multiple_faces', 'id_refused', 'devtools', 'token_misuse']) assert.ok(!(AUTO_REASONS as readonly string[]).includes(bad), `${bad} is never cleared by the assistant`);
});

baseTest('a student paused for a small reason is let back in after the wait, once connected', () => {
  assert.deepEqual(decide(stu(), on(), 10, 0), { action: 'wait' }, 'too soon');
  assert.deepEqual(decide(stu({ seen_ago: 40 }), on(), 60, 0), { action: 'wait' }, 'not connected: nothing to let back in');
  const d = decide(stu(), on(), 31, 0); assert.equal(d.action, 'resume'); assert.match((d as any).why, /face left the camera/);
  assert.equal(decide(stu({ status: 'LEFT', pause_reason: null }), on(), 31, 0).action, 'resume', 'lost connection counts as heartbeat_lost');
  assert.equal(decide(stu({ status: 'IN_EXAM', pause_reason: null }), on(), 99, 0).action, 'none');
  assert.equal(decide(stu(), { ...on(), on: false }, 99, 0).action, 'none', 'off means off');
  assert.equal(decide(stu(), on({ autoResume: false }), 99, 0).action, 'none');
});

baseTest('what the lecturer did, and anything that looks like cheating, is never touched', () => {
  for (const reason of ['teacher', 'screenshot', 'multiple_faces', 'id_refused', 'forbidden_app', 'screen_recording', 'devtools']) {
    const d = decide(stu({ pause_reason: reason }), on(), 999, 0);
    assert.equal(d.action, 'needs_you', reason);
  }
  assert.equal(decide(stu({ pause_reason: 'blur' }), on({ reasons: ['face_missing'] }), 999, 0).action, 'needs_you', 'a reason the lecturer did not allow');
  assert.equal(decide(stu({ pause_reason: null, status: 'PAUSED' }), on(), 999, 0).action, 'needs_you', 'no known reason');
});

baseTest('the limit: after it the lecturer is told, and a test is ended only if the lecturer switched that on beforehand', () => {
  const two = decide(stu(), on({ maxResumes: 2 }), 31, 2);
  assert.equal(two.action, 'needs_you'); assert.match((two as any).why, /already let back in 2 times/);
  assert.equal(decide(stu(), on({ maxResumes: 2 }), 31, 1).action, 'resume');
  const end = decide(stu(), on({ maxResumes: 2, endAfterMax: true }), 31, 2);
  assert.equal(end.action, 'end'); assert.match((end as any).why, /again/);
  assert.equal(decide(stu({ pause_reason: 'teacher' }), on({ endAfterMax: true }), 999, 9).action, 'needs_you', 'even then the lecturer\'s own pause is never ended');
});

// ---- the loop, against a stand-in MySEB server and PostgreSQL
const NO_PG = !process.env.DATABASE_URL && 'needs PostgreSQL (DATABASE_URL); CI provides it';
const test = (name: string, fn: () => Promise<void>) => baseTest(name, { skip: NO_PG }, fn);
const EXAM = randomUUID();
let students: any[] = []; let examStatus = 'active'; const actions: string[] = [];
const fake = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const json = (o: unknown) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(o));
    if (req.url?.startsWith(`/api/exams/${EXAM}/monitor`)) return json({ exam: { title: 'Biology', status: examStatus }, counts: {}, students });
    const room = /\/api\/exams\/[^/]+\/(pause-all|resume-all|extend|notice)$/.exec(req.url ?? '');
    if (room && req.method === 'POST') { actions.push(`${room[1]} ${body}`); return json({ ok: true, changed: 4 }); }
    const m = /\/api\/sessions\/([^/]+)\/(resume|end)$/.exec(req.url ?? '');
    if (m && req.method === 'POST') { actions.push(`${m[2]} ${m[1]}`); return json({ ok: true }); }
    res.writeHead(404).end('{}');
  });
}).listen(0);
await new Promise((r) => fake.once('listening', r));
Object.assign(process.env, { MYSEB_URL: `http://127.0.0.1:${(fake.address() as AddressInfo).port}`, MYSEB_SERVICE_KEY: 'svc', APP_BASE_URL: 'https://www.bwenge.space' });
const { prisma } = await import('../server/db.js');
const db = prisma as any;
const A = await import('../server/services/mySebAgent.js');
const { formTarget } = await import('../server/services/mySeb.js');
const platformSettings = await import('../server/services/platform/settings.js');
platformSettings.__setPlatformSettingsForTests(platformSettings.DEFAULT_SETTINGS);
const owner = `ag-${randomUUID().slice(0, 8)}`; const stranger = `ag-${randomUUID().slice(0, 8)}`; const formId = randomUUID();
if (!NO_PG) {
  for (const id of [owner, stranger]) await db.user.create({ data: { id, email: `${id}@test.local`, name: id, passwordHash: 'x', role: 'INSTRUCTOR' } });
  await db.applicationForm.create({ data: { id: formId, userId: owner, title: 'Biology', schema: JSON.stringify({ title: 'Biology', exam: { requireMyseb: true, mysebExamId: EXAM } }) } });
}
baseTest.after(async () => { fake.close(); if (!NO_PG) { await db.appSetting.deleteMany({ where: { key: { startsWith: 'myseb-agent:form:' + formId } } }); await db.applicationForm.deleteMany({ where: { id: formId } }); await db.user.deleteMany({ where: { id: { in: [owner, stranger] } } }); } });
const person = (over: any) => ({ id: randomUUID(), student_name: 'Amy', status: 'PAUSED', client_type: 'web', violation_count: 1, pause_reason: 'face_missing', seen_ago: 2, ...over });
const rowOf = async () => { const v = (await db.appSetting.findUnique({ where: { key: `myseb-agent:form:${formId}` } })).value; return { ...v, rules: A.cleanRules(v.rules) }; };

test('the lecturer switches it on; only the owner can, and the rules are saved clean', async () => {
  assert.equal((await A.getAgent(formTarget(owner, formId))).rules.on, false);
  const v = await A.setAgent(formTarget(owner, formId), { on: true, afterSeconds: 20, maxResumes: 2 }, owner);
  assert.equal(v.rules.on, true); assert.equal(v.rules.afterSeconds, 20); assert.match(v.log[0].text, /Room assistant is on: it lets students back in after 20 s/);
  await assert.rejects(A.setAgent(formTarget(stranger, formId), { on: false }, stranger), /not found/i);
  assert.equal((await A.getAgent(formTarget(owner, formId))).rules.on, true, 'a stranger changed nothing');
});

test('the loop: waits, lets a connected student back in, counts it, leaves the lecturer\'s pause alone, and writes it all in the log', async () => {
  A.__resetAgentMemoryForTests(); actions.length = 0;
  const amy = person({ student_name: 'Amy' }); const ben = person({ student_name: 'Ben', pause_reason: 'teacher' }); const cy = person({ student_name: 'Cy', pause_reason: 'multiple_faces' }); const dee = person({ student_name: 'Dee', seen_ago: 90 });
  const card = person({ student_name: 'Eli', status: 'IN_EXAM', pause_reason: null, id_status: 'pending' });
  students = [amy, ben, cy, dee, card];
  const t0 = Date.now();
  await A.runRoom(await rowOf(), t0);                                   // first look: they have just been seen paused
  assert.deepEqual(actions, [], 'nobody is let back in at once');
  const made = await A.runRoom(await rowOf(), t0 + 25_000);             // 25 s later (the wait is 20 s)
  assert.deepEqual(actions, [`resume ${amy.id}`], 'only Amy: connected, small reason, waited long enough');
  assert.ok(made.some((e) => e.kind === 'resumed' && e.student === 'Amy'));
  const row = await rowOf();
  assert.equal(row.counts[amy.id], 1);
  const log = row.log.map((e: any) => `${e.kind}:${e.student ?? ''}`);
  assert.ok(log.includes('needs_you:Ben') && log.includes('needs_you:Cy'), 'the lecturer is told about the pause they made and the multi-face pause');
  assert.ok(log.includes('card:Eli'), 'the student card waiting is surfaced');
  assert.ok(!log.includes('needs_you:Dee') && !log.includes('resumed:Dee'), 'Dee is not connected: nothing to do yet');
  // told once, not every ten seconds
  await A.runRoom(await rowOf(), t0 + 35_000);
  assert.equal((await rowOf()).log.filter((e: any) => e.kind === 'needs_you' && e.student === 'Ben').length, 1);
  assert.equal(actions.filter((a) => a.startsWith('end')).length, 0, 'nobody is ever ended unless the lecturer asked');
});

test('the limit and the optional end: after the limit the lecturer is told; with "end after the limit" on, the test is ended', async () => {
  A.__resetAgentMemoryForTests(); actions.length = 0;
  const amy = person({ student_name: 'Amy' });
  students = [amy];
  const key = `myseb-agent:form:${formId}`;
  const cur = (await db.appSetting.findUnique({ where: { key } })).value;
  await db.appSetting.update({ where: { key }, data: { value: { ...cur, counts: { [amy.id]: 2 } } } });
  const t0 = Date.now();
  await A.runRoom(await rowOf(), t0); await A.runRoom(await rowOf(), t0 + 25_000);
  assert.deepEqual(actions, [], 'limit reached: not let back in');
  assert.ok((await rowOf()).log.some((e: any) => e.kind === 'needs_you' && /already let back in 2 times/.test(e.text)));
  await A.setAgent(formTarget(owner, formId), { endAfterMax: true }, owner);
  A.__resetAgentMemoryForTests();
  await A.runRoom(await rowOf(), t0); await A.runRoom(await rowOf(), t0 + 25_000);
  assert.deepEqual(actions, [`end ${amy.id}`]);
  assert.ok((await rowOf()).log.some((e: any) => e.kind === 'ended' && e.student === 'Amy'));
});

test('when the test has ended the assistant stops by itself', async () => {
  examStatus = 'ended'; students = [];
  await A.runRoom(await rowOf(), Date.now());
  const row = await rowOf();
  assert.equal(row.rules.on, false); assert.ok(row.log.some((e: any) => e.kind === 'finished'));
  examStatus = 'active';
});

test('tickAgents only looks at rooms that are switched on', async () => {
  actions.length = 0; A.__resetAgentMemoryForTests();
  students = [person({ student_name: 'Amy' })];
  await A.tickAgents(Date.now() + 99_000);               // the assistant was switched off by the test above
  assert.deepEqual(actions, []);
});

test('practice mode writes what it would do and does nothing; watch mode only tells the lecturer', async () => {
  A.__resetAgentMemoryForTests(); actions.length = 0;
  await A.setAgent(formTarget(owner, formId), { on: true, endAfterMax: false, dryRun: true, level: 'assist' }, owner);
  const amy = person({ student_name: 'Amy' }); students = [amy];
  const t0 = Date.now();
  await A.runRoom(await rowOf(), t0); await A.runRoom(await rowOf(), t0 + 40_000); await A.runRoom(await rowOf(), t0 + 50_000);
  assert.deepEqual(actions, [], 'nothing was done');
  const row = await rowOf();
  assert.equal(row.log.filter((e: any) => e.kind === 'would' && e.student === 'Amy').length, 1, 'said once');
  assert.match(row.log.find((e: any) => e.kind === 'would').text, /Would have let back in/);
  assert.ok(!row.counts[amy.id], 'it did not count a let-back-in that did not happen');
  A.__resetAgentMemoryForTests();
  await A.setAgent(formTarget(owner, formId), { dryRun: false, level: 'watch' }, owner);
  await A.runRoom(await rowOf(), t0); await A.runRoom(await rowOf(), t0 + 40_000);
  assert.deepEqual(actions, [], 'watch mode lets nobody back in');
  assert.ok((await rowOf()).log.some((e: any) => e.kind === 'needs_you' && /watch mode/.test(e.text)));
});

test('room actions: the lecturer may always; the assistant only within its limits; practice mode does nothing; everything is logged and counted', async () => {
  actions.length = 0;
  const load = formTarget(owner, formId);
  await A.setAgent(load, { on: true, level: 'assist', dryRun: false, maxAddMinutes: 15, maxRoomPauses: 1 }, owner);
  const lec = await A.roomAction(load, { action: 'add_time', minutes: 30 }, 'lecturer', owner);
  assert.ok(lec.ok); assert.match(lec.text, /4 students got 30 more minutes/); assert.ok(actions.some((a) => a.startsWith('extend') && a.includes('"minutes":30')));
  assert.equal((await A.getAgent(load)).usage.addedMinutes, 0, 'the lecturer\'s own actions do not use up the assistant\'s limit');
  assert.ok((await A.roomAction(load, { action: 'add_time', minutes: 10 }, 'agent', owner)).ok);
  const more = await A.roomAction(load, { action: 'add_time', minutes: 10 }, 'agent', owner);
  assert.ok(!more.ok); assert.match(more.text, /limit of 15 minutes/);
  assert.ok((await A.roomAction(load, { action: 'pause_room', reason: 'power cut' }, 'agent', owner)).ok);
  assert.ok(!(await A.roomAction(load, { action: 'pause_room' }, 'agent', owner)).ok, 'one pause is the limit');
  assert.ok((await A.roomAction(load, { action: 'notice', text: 'Ten more minutes were added.' }, 'agent', owner)).ok);
  assert.equal(actions.filter((a) => a.startsWith('pause-all')).length, 1);
  assert.deepEqual((await A.getAgent(load)).usage, { roomPauses: 1, addedMinutes: 10, notices: 1 });
  const kinds = (await A.getAgent(load)).log.map((e) => e.kind);
  assert.ok(kinds.includes('room') && kinds.includes('refused'));
  // practice mode: chosen, written down, not done
  await A.setAgent(load, { dryRun: true }, owner); actions.length = 0;
  const dry = await A.roomAction(load, { action: 'resume_room' }, 'agent', owner);
  assert.ok(dry.ok && dry.dry); assert.deepEqual(actions, []);
  assert.ok((await A.getAgent(load)).log.some((e) => e.kind === 'would' && /let everyone back in/.test(e.text)));
  // the lecturer is not stopped by practice mode
  assert.ok((await A.roomAction(load, { action: 'resume_room' }, 'lecturer', owner)).ok); assert.ok(actions.some((a) => a.startsWith('resume-all')));
  // someone else's test cannot be touched
  await assert.rejects(A.roomAction(formTarget(stranger, formId), { action: 'pause_room' }, 'lecturer', stranger), /not found/i);
});
