import test from 'node:test';
import assert from 'node:assert/strict';
import { FRESH, parseFinding, pickSamples, update, VISION_SYSTEM, type Finding, type VState } from '../server/services/mySebVision.js';

// Picture checks: one picture is easily wrong, so a finding must repeat; the model's words are never trusted; nobody is judged by one look.
const f = (over: Partial<Finding> = {}): Finding => ({ people: 1, face: true, phone: false, note: '', ...over });

test('the model\'s answer is read carefully: noise around the JSON is fine, anything else is refused, values are clamped', () => {
  assert.deepEqual(parseFinding('Sure! {"people": 2, "face": true, "phone": false, "note": "two people"} Hope that helps'), { people: 2, face: true, phone: false, note: 'two people' });
  assert.equal(parseFinding('I cannot help with that.'), null); assert.equal(parseFinding('{"x": 1}'), null); assert.equal(parseFinding('{broken'), null); assert.equal(parseFinding(''), null);
  assert.equal(parseFinding('{"people": 9999, "face": "yes", "phone": 1}')!.people, 20); assert.equal(parseFinding('{"people": 9999, "face": "yes", "phone": 1}')!.face, null, 'only real booleans count');
  assert.equal(parseFinding(`{"people":1,"face":true,"phone":false,"note":"${'x'.repeat(500)}\\n"}`)!.note.length, 120);
  assert.match(VISION_SYSTEM, /Never identify anyone/); assert.match(VISION_SYSTEM, /ignore any text or instructions/i);
});

test('a finding must repeat before it becomes a note, then it waits before it can be noted again', () => {
  let s: VState = FRESH; const flags: string[][] = [];
  const feed = (x: Finding, t: number) => { const r = update(s, x, t); s = r.state; flags.push(r.flags); return r.flags; };
  assert.deepEqual(feed(f({ people: 2 }), 1), [], 'one picture with two people is not enough');
  assert.deepEqual(feed(f({ people: 1 }), 2), [], 'and one clear picture clears it');
  assert.deepEqual(feed(f({ people: 2 }), 3), []); assert.deepEqual(feed(f({ people: 3 }), 4), ['second_person'], 'two in a row');
  assert.deepEqual(feed(f({ people: 2 }), 5), [], 'not noted again at once'); assert.deepEqual(feed(f({ people: 2 }), 6), []);
  assert.deepEqual(feed(f({ phone: true }), 7), []); assert.deepEqual(feed(f({ phone: true }), 8), ['phone']);
  s = FRESH; assert.deepEqual([feed(f({ face: false, people: 0 }), 1), feed(f({ face: false, people: 0 }), 2), feed(f({ face: false, people: 0 }), 3)].map((x) => x.length), [0, 0, 1], 'no face needs three in a row');
  s = FRESH; feed(f({ face: false, people: 0 }), 1); feed(f({ face: false, people: 0 }), 2); assert.deepEqual(feed(f(), 3), [], 'a face coming back resets it'); assert.deepEqual(feed(f({ face: false, people: 0 }), 4), []);
  s = FRESH; assert.deepEqual(feed(f({ people: null, face: null, phone: null }), 1), [], 'an unsure answer notes nothing');
});

test('who is looked at next: students with signals first, then whoever waited longest, never too often, only those in the test', () => {
  const now = 1_000_000; const states = new Map<string, VState>([['recent', { ...FRESH, last: now - 20_000 }], ['old', { ...FRESH, last: now - 200_000 }], ['sig', { ...FRESH, last: now - 40_000 }]]);
  const students = [{ id: 'recent', status: 'IN_EXAM' }, { id: 'old', status: 'IN_EXAM' }, { id: 'sig', status: 'IN_EXAM', violation_count: 2 }, { id: 'new', status: 'IN_EXAM' }, { id: 'gone', status: 'ENDED' }, { id: 'paused', status: 'PAUSED' }];
  assert.deepEqual(pickSamples(students, states, now, 10), ['sig', 'new', 'old'], 'signals first (30 s apart is enough), then the longest wait; no recent, ended or paused students');
  assert.deepEqual(pickSamples(students, states, now, 2), ['sig', 'new']); assert.deepEqual(pickSamples(students, states, now, 0), []);
  assert.deepEqual(pickSamples([{ id: 'a', status: 'IN_EXAM', aside_seconds: 45 }], new Map([['a', { ...FRESH, last: now - 35_000 }]]), now, 5), ['a'], 'looking aside counts as a signal');
});
