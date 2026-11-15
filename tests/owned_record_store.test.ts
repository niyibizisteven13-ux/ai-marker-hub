import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { OwnedRecordStore, type OwnedRecord } from '../server/services/storage/ownedRecordStore.js';

interface Rec extends OwnedRecord { items: string[]; count: number }
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ors-'));
test.after(() => fs.rm(dir, { recursive: true, force: true }));

test('many changes at the same moment are all kept (a class handing in together)', async () => {
  const store = new OwnedRecordStore<Rec>(dir);
  const rec = await store.create('o1', { items: [], count: 0 });
  await Promise.all(Array.from({ length: 80 }, (_, i) => store.update(rec.id, 'o1', (r) => { r.items.push(`s${i}`); r.count += 1; })));
  const after = (await store.get(rec.id, 'o1'))!;
  assert.equal(after.items.length, 80, 'no hand-in was overwritten');
  assert.equal(after.count, 80);
  assert.equal(new Set(after.items).size, 80);
  const left = (await fs.readdir(dir)).filter((n) => n.endsWith('.lock'));
  assert.deepEqual(left, [], 'no lock file is left behind');
});

test('two stores on one folder (two servers) also keep every change', async () => {
  const a = new OwnedRecordStore<Rec>(dir), b = new OwnedRecordStore<Rec>(dir);
  const rec = await a.create('o2', { items: [], count: 0 });
  await Promise.all(Array.from({ length: 60 }, (_, i) => (i % 2 ? a : b).update(rec.id, 'o2', (r) => { r.items.push(`x${i}`); })));
  assert.equal((await a.get(rec.id, 'o2'))!.items.length, 60);
});

test('a lock left by a crashed server is cleared; another owner still cannot change the record; a failing change releases the lock', async () => {
  const store = new OwnedRecordStore<Rec>(dir);
  const rec = await store.create('o3', { items: [], count: 0 });
  const lock = path.join(dir, `${rec.id}.json.lock`);
  await fs.writeFile(lock, '');
  const old = new Date(Date.now() - 60_000);
  await fs.utimes(lock, old, old);
  assert.ok(await store.update(rec.id, 'o3', (r) => { r.count = 1; }));
  assert.equal(await store.update(rec.id, 'someone-else', (r) => { r.count = 99; }), null);
  await assert.rejects(store.update(rec.id, 'o3', () => { throw new Error('boom'); }), /boom/);
  assert.ok(await store.update(rec.id, 'o3', (r) => { r.count = 2; }), 'the next change still works');
  assert.equal((await store.get(rec.id, 'o3'))!.count, 2);
  assert.equal(await store.delete(rec.id, 'someone-else'), false);
  assert.equal(await store.delete(rec.id, 'o3'), true);
});
