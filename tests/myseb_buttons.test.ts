import test from 'node:test';
import assert from 'node:assert/strict';
import { TOKEN_TTL_MS, makeToken, takeToken, type RoomToken } from '../server/services/agenda/roomTokens.js';
import { memoryKV } from '../server/services/agenda/store.js';
import { runRoomToken, type ButtonDeps } from '../server/services/mySebButtons.js';

// Telegram room buttons: short single-use tokens that only their owner can use, and what each one does.
const base: RoomToken = { userId: 'u1', kind: 'form', ref: 'f1', action: 'pause' };

test('a button token is short, single use, private to its owner and expires', async () => {
  const kv = memoryKV(); const t0 = 1_000_000;
  const token = await makeToken(base, kv, t0);
  assert.ok(token.length <= 12 && `ra:${token}`.length <= 64, 'fits a Telegram button');
  assert.deepEqual(await takeToken(token, 'u2', kv, t0), { ok: false, why: 'not_yours' }, 'someone else cannot use it');
  const ok = await takeToken(token, 'u1', kv, t0 + 1000); assert.ok(ok.ok && ok.token.action === 'pause', 'and it was not used up by them');
  assert.deepEqual(await takeToken(token, 'u1', kv, t0 + 2000), { ok: false, why: 'unknown' }, 'single use');
  const old = await makeToken(base, kv, t0);
  assert.deepEqual(await takeToken(old, 'u1', kv, t0 + TOKEN_TTL_MS + 1), { ok: false, why: 'expired' });
  assert.deepEqual(await takeToken('../../etc', 'u1', kv), { ok: false, why: 'unknown' }); assert.deepEqual(await takeToken('abcdefgh', undefined, kv), { ok: false, why: 'unknown' });
  const mine = await makeToken(base, kv); assert.deepEqual(await takeToken(mine, undefined, kv), { ok: false, why: 'not_yours' });
});

function fakes() {
  const calls: string[] = [];
  const deps: ButtonDeps = {
    loader: () => (async () => ({}) as any),
    letBackIn: async (_l, sid) => { calls.push(`back_in ${sid}`); return 'Amy can continue.'; },
    roomAction: (async (_l: any, a: any, who: string, by: string) => { calls.push(`${a.action} ${a.minutes ?? ''} ${who} ${by}`.trim()); return { ok: true, text: `Done: ${a.action}` }; }) as any,
    decideReview: (async (_l: any, sid: string, input: any, by: string) => { calls.push(`review ${sid} ${input.decision} ${input.giveMinutes ?? ''} ${by}`.trim()); return { ok: true }; }) as any,
  };
  return { calls, deps };
}

test('each button does one thing, as the lecturer, and says what happened', async () => {
  const { calls, deps } = fakes();
  assert.equal((await runRoomToken({ ...base, action: 'back_in', sid: 's1' }, deps)).text, 'Amy can continue.');
  assert.equal((await runRoomToken({ ...base, action: 'pause' }, deps)).text, 'Done: pause_room');
  assert.equal((await runRoomToken({ ...base, action: 'resume_all' }, deps)).text, 'Done: resume_room');
  assert.equal((await runRoomToken({ ...base, action: 'add', minutes: 5 }, deps)).text, 'Done: add_time');
  assert.match((await runRoomToken({ ...base, action: 'dismiss_give', sid: 's1', name: 'Amy', minutes: 10 }, deps)).text, /Dismissed for Amy, with 10 minutes given back/);
  assert.match((await runRoomToken({ ...base, action: 'confirm', sid: 's1', name: 'Amy' }, deps)).text, /Confirmed for Amy/);
  assert.deepEqual(calls.map((c) => c.replace(/ +/g, ' ')), ['back_in s1', 'pause_room lecturer u1', 'resume_room lecturer u1', 'add_time 5 lecturer u1', 'review s1 dismissed 10 u1', 'review s1 confirmed u1']);
});

test('a failure comes back as words, never an exception', async () => {
  const { deps } = fakes();
  const bad: ButtonDeps = { ...deps, letBackIn: async () => { throw new Error('That student is not in this test.'); } };
  const r = await runRoomToken({ ...base, action: 'back_in', sid: 'x' }, bad);
  assert.equal(r.ok, false); assert.match(r.text, /not in this test/);
  assert.equal((await runRoomToken({ ...base, action: 'nope' as any }, deps)).ok, false);
});
