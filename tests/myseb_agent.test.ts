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
const violationsOf: Record<string, string[]> = {};
let monitorDown = false; let reportEvents: any[] = []; let evidenceBy: Record<string, number> = {};
let students: any[] = []; let examStatus = 'active'; const actions: string[] = [];
const fake = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const json = (o: unknown) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(o));
    if (req.url?.startsWith(`/api/exams/${EXAM}/monitor`) && monitorDown) { res.writeHead(503).end('{"error":"down"}'); return; }
    if (req.url?.startsWith(`/api/exams/${EXAM}/monitor`)) return json({ exam: { title: 'Biology', status: examStatus }, counts: {}, students });
    if (req.url?.startsWith(`/api/exams/${EXAM}/report`)) return json({ exam: { title: 'Biology', status: examStatus }, students: students.map((x) => ({ ...x, id: x.id })), events: reportEvents });
    if (req.url?.startsWith(`/api/exams/${EXAM}/evidence`)) return req.url.includes('sessionId=') ? json({ items: [{ at: 'x', type: 'screenshot', frame: 'data:image/jpeg;base64,AA==', screen: null }] }) : json({ counts: evidenceBy });
    const rein = /\/api\/sessions\/([^/]+)\/reinstate$/.exec(req.url ?? '');
    if (rein && req.method === 'POST') { actions.push(`reinstate ${rein[1]} ${body}`); return json({ ok: true }); }
    const vio = /\/api\/sessions\/([^/]+)\/violations$/.exec(req.url ?? '');
    if (vio) return json((violationsOf[vio[1]] ?? []).map((type, i) => ({ type, created_at: new Date(1700000000000 + i * 1000).toISOString() })));
    if (/\/api\/exams\/[^/]+\/end$/.test(req.url ?? '') && req.method === 'POST') { actions.push('closeall'); examStatus = 'ended'; return json({ ok: true }); }
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

test('autopilot: needs a confirmation, warns, lets a warned student carry on, ends at the strike limit, closes the test and sends the report once', async () => {
  const load = formTarget(owner, formId);
  A.__resetAgentMemoryForTests(); actions.length = 0; examStatus = 'active';
  await assert.rejects(A.setAgent(load, { on: true, level: 'run', serious: 'end', seriousStrikes: 2, afterSeconds: 20, dryRun: false }, owner), /confirm/i);
  assert.equal((await A.getAgent(load)).rules.level, 'assist', 'nothing changed without the confirmation');
  const v = await A.setAgent(load, { on: true, level: 'run', serious: 'end', seriousStrikes: 2, afterSeconds: 20, dryRun: false, autoClose: true }, owner, { confirmedAutopilot: true });
  assert.equal(v.rules.level, 'run'); assert.match(v.log[0].text, /AUTOPILOT/);
  const amy = person({ student_name: 'Amy', status: 'IN_EXAM', pause_reason: null, violation_count: 1, last_violation: 'screenshot' });
  const ben = person({ student_name: 'Ben', status: 'PAUSED', pause_reason: 'screenshot', violation_count: 1, last_violation: 'screenshot' });
  violationsOf[amy.id] = ['screenshot']; violationsOf[ben.id] = ['screenshot'];
  students = [amy, ben];
  const t0 = Date.now();
  await A.runRoom(await rowOf(), t0);
  assert.ok(actions.some((a) => a.startsWith('notice') && a.includes(amy.id) && /Warning/.test(a)), 'Amy was warned');
  assert.ok(!actions.some((a) => a.startsWith('end')), 'nobody ended on a first strike');
  const n1 = actions.length;
  await A.runRoom(await rowOf(), t0 + 10_000); assert.equal(actions.length, n1, 'not warned again for the same signal');
  await A.runRoom(await rowOf(), t0 + 25_000);
  assert.ok(actions.includes(`resume ${ben.id}`), 'Ben, warned once, carries on after the wait');
  // a second serious signal: the policy the lecturer chose applies
  violationsOf[amy.id] = ['screenshot', 'devtools']; amy.violation_count = 2; amy.last_violation = 'devtools';
  await A.runRoom(await rowOf(), t0 + 30_000);
  assert.ok(actions.includes(`end ${amy.id}`), 'Amy\'s test ended at the second strike');
  const row = await rowOf(); assert.equal(row.serious[amy.id], 2);
  assert.ok(row.log.some((e: any) => e.kind === 'ended' && /autopilot policy/.test(e.text)) && row.log.some((e: any) => e.kind === 'warned'));
  // everyone finished: after two quiet minutes the test is closed, then the next look sends the report once
  let reports: string[] = []; A.__setReportOwnerForTests(async (_r, title, text) => { reports.push(`${title}|${text}`); });
  students = [{ ...amy, status: 'ENDED', end_reason: 'devtools' }, { ...ben, status: 'ENDED', end_reason: 'student' }];
  await A.runRoom(await rowOf(), t0 + 40_000); assert.ok(!actions.includes('closeall'), 'not at once');
  await A.runRoom(await rowOf(), t0 + 170_000); assert.ok(actions.includes('closeall'), 'closed after two quiet minutes');
  await A.runRoom(await rowOf(), t0 + 180_000);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(reports.length, 1); assert.match(reports[0], /^Biology\|Biology: final report/); assert.match(reports[0], /Amy/);
  const done = await rowOf(); assert.equal(done.reported, true); assert.match(done.report.text, /signals, not proof/); assert.equal(done.rules.on, false, 'it stops when the test is over');
  assert.equal((await A.getAgent(load)).report?.text, done.report.text);
  examStatus = 'active';
});

test('autopilot gives time when many connections drop, and announces the time left', async () => {
  const load = formTarget(owner, formId);
  A.__resetAgentMemoryForTests(); actions.length = 0; examStatus = 'active';
  await A.setAgent(load, { on: true, level: 'run', dryRun: false, maxAddMinutes: 60 }, owner, { confirmedAutopilot: true });
  const t0 = Date.now();
  const mk = (i: number, gone: boolean) => person({ student_name: `S${i}`, status: gone ? 'LEFT' : 'IN_EXAM', pause_reason: null, violation_count: 0, seen_ago: gone ? 90 : 2, deadline_at: new Date(t0 + 30_000).toISOString() });
  students = Array.from({ length: 8 }, (_, i) => mk(i, i < 4));
  await A.runRoom(await rowOf(), t0);
  assert.ok(actions.some((a) => a.startsWith('extend') && a.includes('"minutes":10')), 'ten minutes added');
  assert.ok(actions.some((a) => a.startsWith('notice') && /Many connections were lost/.test(a)));
  assert.ok(actions.some((a) => a.startsWith('notice') && /1 minute left/.test(a)), 'the last minute is announced');
  const n = actions.length; await A.runRoom(await rowOf(), t0 + 10_000);
  assert.equal(actions.length, n, 'neither is repeated');
  assert.ok((await A.getAgent(load)).usage.addedMinutes <= 60, 'within the limit the lecturer set');
});

test('the review queue: the lecturer decides, time can be given back, someone else\'s test cannot be touched, and decisions are remembered', async () => {
  const R = await import('../server/services/mySebReview.js');
  const load = formTarget(owner, formId); actions.length = 0; examStatus = 'active';
  const ben = person({ student_name: 'Ben', status: 'ENDED', end_reason: 'screenshot', violation_count: 2, pause_reason: null });
  students = [ben]; reportEvents = [{ session_id: ben.id, type: 'screenshot', created_at: '2026-11-17T09:01:00Z' }, { session_id: ben.id, type: 'devtools', created_at: '2026-11-17T09:02:00Z' }]; evidenceBy = { [ben.id]: 2 };
  const q1 = await R.getReview(load);
  assert.equal(q1.open, 1); assert.equal(q1.items[0].name, 'Ben'); assert.equal(q1.items[0].evidence, 2); assert.ok(q1.items[0].canRestore);
  await assert.rejects(R.decideReview(load, ben.id, { decision: 'confirmed' as any, giveMinutes: 10 }, owner), /only be given back when you dismiss/);
  await assert.rejects(R.decideReview(load, ben.id, { decision: 'dismissed', giveMinutes: 90 }, owner), /1 to 60/);
  await assert.rejects(R.decideReview(load, 'not-a-student', { decision: 'dismissed' }, owner), /not in this test/);
  await assert.rejects(R.decideReview(formTarget(stranger, formId), ben.id, { decision: 'dismissed' }, stranger), /not found/i);
  assert.deepEqual(actions.filter((a) => a.startsWith('reinstate')), [], 'nothing was done by the refused calls');
  const ok = await R.decideReview(load, ben.id, { decision: 'dismissed', giveMinutes: 10, note: 'The head set a task' }, owner);
  assert.equal(ok.gaveMinutes, 10); assert.ok(actions.some((a) => a === `reinstate ${ben.id} {"minutes":10}`));
  const q2 = await R.getReview(load);
  assert.equal(q2.open, 0); assert.equal(q2.items[0].decision, 'dismissed'); assert.equal(q2.items[0].note, 'The head set a task'); assert.equal(q2.items[0].gaveMinutes, 10);
  const row = (await db.appSetting.findUnique({ where: { key: `myseb-review:form:${formId}` } })).value; assert.equal(row.items[ben.id].by, owner);
  assert.equal((await R.getEvidence(load, ben.id)).length, 1);
  await db.appSetting.deleteMany({ where: { key: `myseb-review:form:${formId}` } });
});

test('a restart does not repeat announcements or the connection-loss time', async () => {
  const load = formTarget(owner, formId);
  { const key = `myseb-agent:form:${formId}`; const cur = (await db.appSetting.findUnique({ where: { key } })).value; await db.appSetting.update({ where: { key }, data: { value: { ...cur, mem: undefined } } }); }   // a fresh test
  A.__resetAgentMemoryForTests(); actions.length = 0; examStatus = 'active';
  await A.setAgent(load, { on: true, level: 'run', dryRun: false, maxAddMinutes: 60 }, owner, { confirmedAutopilot: true });
  const t0 = Date.now();
  const mk = (i: number, gone: boolean) => person({ student_name: `R${i}`, status: gone ? 'LEFT' : 'IN_EXAM', pause_reason: null, violation_count: 0, seen_ago: gone ? 90 : 2, deadline_at: new Date(t0 + 30_000).toISOString() });
  students = Array.from({ length: 8 }, (_, i) => mk(i, i < 4));
  await A.runRoom(await rowOf(), t0);
  const first = actions.length; assert.ok(first >= 2, 'the announcement and the extra time happened');
  assert.ok((await rowOf()).mem.told.some((k: string) => /:ann1$/.test(k)), 'remembered in the database');
  A.__resetAgentMemoryForTests();                       // the server restarted: memory is empty
  await A.runRoom(await rowOf(), t0 + 10_000);
  assert.equal(actions.length, first, 'nothing was said or added a second time');
});

test('the assistant never fails silently: repeated errors drop autopilot to watch mode and tell the lecturer; an unreachable test server is reported once', async () => {
  const load = formTarget(owner, formId);
  const told: string[] = []; A.__setAlertOwnerForTests(async (_r, entries) => { told.push(...entries.map((e) => e.text)); });
  A.__resetAgentMemoryForTests(); actions.length = 0; examStatus = 'active'; students = [];
  await A.setAgent(load, { on: true, level: 'run', dryRun: false }, owner, { confirmedAutopilot: true });
  A.__injectFaultForTests(() => { throw new Error('boom'); });
  for (let i = 0; i < 2; i++) { await A.runRoom(await rowOf(), Date.now()); assert.equal((await rowOf()).rules.level, 'run', 'two failures are tolerated'); }
  await A.runRoom(await rowOf(), Date.now());
  const row = await rowOf(); assert.equal(row.rules.level, 'watch'); assert.equal(row.rules.on, true, 'still watching');
  assert.ok(row.log.some((e: any) => e.kind === 'stopped' && /switched to watch mode/.test(e.text))); assert.ok(told.some((t) => /watch mode/.test(t)));
  A.__injectFaultForTests(null);
  // MySEB cannot be reached
  A.__resetAgentMemoryForTests(); told.length = 0; monitorDown = true;
  for (let i = 0; i < 8; i++) await A.runRoom(await rowOf(), Date.now());
  monitorDown = false;
  assert.equal(told.filter((t) => /cannot reach the test server/.test(t)).length, 1, 'told once, not every ten seconds');
  A.__setAlertOwnerForTests(async () => undefined);
});
