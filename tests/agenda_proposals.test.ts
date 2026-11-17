import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_STEPS, PROPOSABLE, cancelProposal, planText, proposalStore, runProposal, undoProposal, validateSteps, type Exec } from '../server/services/agenda/proposals.js';
import { memoryKV } from '../server/services/agenda/store.js';

// A plan shows what it will do, runs only after a yes, stops at the first failure, and can be undone where a step has its own reverse.
const good = [
  { tool: 'publish_form', input: { id: 'f1' }, label: 'Open the quiz for students', undo: { tool: 'publish_form', input: { id: 'f1', open: false }, label: 'Close the quiz again' } },
  { tool: 'launch_test', input: { kind: 'form', id: 'f1' }, label: 'Make the code and the link' },
];

test('only known action tools, a few steps, and every step explained in words', () => {
  assert.ok(validateSteps(good).ok);
  const bad = (raw: unknown) => { const r = validateSteps(raw); assert.ok(!r.ok); return (r as { error: string }).error; };
  assert.match(bad([]), /at least one/); assert.match(bad('x'), /at least one/);
  assert.match(bad(Array.from({ length: MAX_STEPS + 1 }, () => good[0])), /at most/);
  assert.match(bad([{ tool: 'run_python', input: {}, label: 'x' }]), /cannot be part of a plan/);
  assert.match(bad([{ tool: 'delete_everything', input: {}, label: 'x' }]), /cannot be part of a plan/);
  assert.match(bad([{ tool: 'publish_form', input: {} }]), /label/);
  assert.match(bad([{ tool: 'publish_form', input: {}, label: 'x', undo: { tool: 'run_python', input: {} } }]), /undo/);
  assert.match((validateSteps(good, (t) => t !== 'launch_test') as { error: string }).error, /not available/);
  for (const t of ['release_task_results', 'release_exam_results', 'mark_task', 'live_room_student']) assert.ok(PROPOSABLE.has(t), `${t} may be in a plan (with the user's yes)`);
  for (const t of ['run_python', 'fetch_url', 'web_search', 'create_document']) assert.ok(!PROPOSABLE.has(t), `${t} is not an action`);
  assert.match(planText({ title: 'Open the quiz', steps: good }), /Open the quiz\n1\. Open the quiz for students\n2\. Make the code and the link/);
});

test('a plan runs after the yes, one step after the other, and it is done only once', async () => {
  const store = proposalStore(memoryKV()); const calls: string[] = [];
  const exec: Exec = async (tool, input) => { calls.push(`${tool} ${JSON.stringify(input)}`); return { ok: true, text: 'ok' }; };
  const v = validateSteps(good); assert.ok(v.ok);
  const p = await store.create('u1', 'Open the quiz', (v as any).steps);
  assert.equal((await store.pending('u1')).length, 1);
  const r = await runProposal(store, 'u1', p.id, exec);
  assert.ok(r.ok); assert.match(r.text, /Done\.\n✓ Open the quiz for students\n✓ Make the code and the link\nYou can undo this\./);
  assert.deepEqual(calls, ['publish_form {"id":"f1"}', 'launch_test {"kind":"form","id":"f1"}']);
  assert.equal((await store.pending('u1')).length, 0);
  assert.match((await runProposal(store, 'u1', p.id, exec)).text, /already been done/, 'a second tap does nothing');
  assert.equal(calls.length, 2);
});

test('someone else\'s plan cannot be run, and an old plan has expired', async () => {
  const store = proposalStore(memoryKV()); const exec: Exec = async () => ({ ok: true, text: 'ok' });
  const p = await store.create('u1', 'Mine', (validateSteps(good) as any).steps, new Date('2026-11-01T00:00:00Z'));
  assert.match((await runProposal(store, 'u2', p.id, exec)).text, /not found/);
  assert.match((await runProposal(store, 'u1', p.id, exec, { now: new Date('2026-11-04T00:00:00Z') })).text, /expired/);
  assert.equal((await store.pending('u1', undefined, new Date('2026-11-04T00:00:00Z'))).length, 0);
});

test('the first step that fails stops the rest, and the report says what was and was not done', async () => {
  const store = proposalStore(memoryKV());
  const exec: Exec = async (tool) => (tool === 'publish_form' ? { ok: false, text: 'The form has no questions.' } : { ok: true, text: 'ok' });
  const p = await store.create('u1', 'Open', (validateSteps(good) as any).steps);
  const r = await runProposal(store, 'u1', p.id, exec);
  assert.ok(!r.ok); assert.match(r.text, /Stopped/); assert.match(r.text, /✗ Open the quiz for students: The form has no questions\./); assert.match(r.text, /– Make the code and the link/);
  assert.equal((await store.get('u1', p.id))!.status, 'failed');
  const thrown = await store.create('u1', 'Throws', (validateSteps(good) as any).steps);
  assert.match((await runProposal(store, 'u1', thrown.id, async () => { throw new Error('boom'); })).text, /boom/);
});

test('undo puts back what has a reverse (last step first) and says what cannot be reversed', async () => {
  const store = proposalStore(memoryKV()); const calls: string[] = [];
  const exec: Exec = async (tool, input) => { calls.push(`${tool} ${JSON.stringify(input)}`); return { ok: true, text: 'ok' }; };
  const p = await store.create('u1', 'Open', (validateSteps(good) as any).steps);
  assert.match((await undoProposal(store, 'u1', p.id, exec)).text, /Only a plan that was done/);
  await runProposal(store, 'u1', p.id, exec); calls.length = 0;
  const u = await undoProposal(store, 'u1', p.id, exec);
  assert.ok(u.ok); assert.deepEqual(calls, ['publish_form {"id":"f1","open":false}']); assert.match(u.text, /Undone\.\n✓ Close the quiz again\n1 step cannot be reversed/);
  assert.equal((await store.get('u1', p.id))!.status, 'undone');
  assert.match((await undoProposal(store, 'u1', p.id, exec)).text, /already undone/);
  const none = await store.create('u1', 'Release', (validateSteps([{ tool: 'release_task_results', input: { assignmentId: 'a' }, label: 'Show the marks to students' }]) as any).steps);
  await runProposal(store, 'u1', none.id, exec);
  assert.match((await undoProposal(store, 'u1', none.id, exec)).text, /cannot be reversed/);
});

test('cancelling changes nothing, and only a waiting plan can be cancelled', async () => {
  const store = proposalStore(memoryKV()); let ran = 0;
  const p = await store.create('u1', 'Open', (validateSteps(good) as any).steps);
  assert.match((await cancelProposal(store, 'u2', p.id)).text, /not found/);
  assert.ok((await cancelProposal(store, 'u1', p.id)).ok);
  assert.match((await runProposal(store, 'u1', p.id, async () => { ran++; return { ok: true, text: '' }; })).text, /cancelled/); assert.equal(ran, 0);
  assert.match((await cancelProposal(store, 'u1', p.id)).text, /already cancelled/);
});

test('every run and undo is written to the audit log', async () => {
  const store = proposalStore(memoryKV()); const seen: string[] = [];
  const p = await store.create('u1', 'Open', (validateSteps(good) as any).steps);
  const audit = async (a: string) => { seen.push(a); };
  await runProposal(store, 'u1', p.id, async () => ({ ok: true, text: '' }), { audit }); await undoProposal(store, 'u1', p.id, async () => ({ ok: true, text: '' }), { audit });
  assert.deepEqual(seen, ['PROPOSAL_RUN', 'PROPOSAL_UNDO']);
});
