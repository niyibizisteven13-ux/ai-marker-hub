import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { app } from '../src/server.js';
import { migrate, pool } from '../src/db.js';
import navigation from '../../desktop/src/roomPolicy.js';

test('one dashboard controls 500 distinct laptop sessions and keeps legacy entry points', async (t) => {
  await migrate();
  const server = app.listen(0);
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  async function call(path, method = 'GET', body, token = '') {
    const r = await fetch(base + '/room/api/' + path, {
      method,
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    return { status: r.status, data: await r.json().catch(() => null) };
  }
  const initial = {
    title: 'Workshop',
    minutes: 60,
    mode: 'single',
    url: 'https://assessment.example.org/task'
  };
  const { code, host } = (await call('', 'POST', initial)).data;
  assert.match(code, /^RM-/);
  const keys = Array.from({ length: 500 }, () =>
    randomBytes(32).toString('hex')
  );
  async function wave(fn) {
    for (let i = 0; i < keys.length; i += 50)
      await Promise.all(keys.slice(i, i + 50).map((k, j) => fn(k, i + j)));
  }
  await wave(async (token, i) => {
    assert.equal(
      (await call(code + '/join', 'POST', { token, name: 'Laptop ' + i }))
        .status,
      200
    );
  });
  assert.equal(
    (await call(code + '/join', 'POST', { token: keys[0], name: 'Laptop 0' }))
      .status,
    200
  );
  const activity = {
    ...initial,
    name: 'Follow-up activity',
    url: 'https://training.example.org/lesson'
  };
  assert.equal(
    (await call(code + '/activities', 'POST', activity, keys[0])).status,
    403
  );
  assert.equal(
    (await call(code + '/activities', 'POST', activity, host)).status,
    200
  );
  assert.equal((await call(code + '/qr', 'GET', undefined, host)).status, 200);
  const get = async () => (await call(code, 'GET', undefined, host)).data;
  assert.equal((await get()).members.length, 500);
  assert.equal((await get()).activities[0].url, activity.url);
  assert.equal((await call(code, 'GET', undefined, keys[1])).status, 403);
  const update = {
    ...initial,
    url: 'https://training.example.org/lesson',
    revision: 1
  };
  assert.equal(
    (await call(code + '/policy', 'PUT', update, keys[0])).status,
    403
  );
  assert.equal((await call(code + '/policy', 'PUT', update, host)).status, 200);
  assert.equal((await call(code + '/policy', 'PUT', update, host)).status, 409);
  await wave(async (token, i) => {
    const received = (await call(code + '/sync', 'POST', { applied: 1 }, token))
      .data;
    assert.equal(received.revision, 2);
    assert.equal(received.policy.url, update.url);
    assert.equal(
      navigation.permitted(
        'https://training.example.org/next',
        received.policy
      ),
      true
    );
    for (const outside of [
      initial.url,
      'https://training.example.org.other.test',
      'https://training.example.org:444',
      'file:///tmp/x',
      'https://user@training.example.org'
    ])
      assert.equal(navigation.permitted(outside, received.policy), false);
    assert.equal(
      (
        await call(
          code + '/sync',
          'POST',
          { applied: 2, request: i === 0 ? 'exit' : undefined },
          token
        )
      ).status,
      200
    );
  });
  await Promise.all(
    keys.map(async (token) => {
      const received = await call(
        code + '/sync',
        'POST',
        { applied: 2 },
        token
      );
      assert.equal(received.status, 200);
    })
  );
  const state = await get();
  assert.equal(
    state.members.filter((m) => m.connected && m.applied === 2).length,
    500
  );
  const person = state.members.find((m) => m.request === 'exit');
  assert.equal(
    (
      await call(
        code + '/review',
        'POST',
        { id: person.id, request: 'exit', action: 'release' },
        host
      )
    ).status,
    200
  );
  assert.equal((await get()).members.filter((m) => m.released).length, 1);
  assert.equal(
    (await call(code + '/sync', 'POST', { applied: 2 }, keys[0])).data.released,
    true
  );
  assert.equal((await call(code + '/end', 'POST', {}, host)).status, 200);
  assert.equal(
    (await call(code + '/sync', 'POST', { applied: 2 }, keys[1])).data.closed,
    true
  );
  for (const path of ['/room/', '/liveroom/', '/join/123456'])
    assert.equal((await fetch(base + path)).status, 200);
});
