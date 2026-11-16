import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { parseJoin } = createRequire(import.meta.url)('../myseb/desktop/src/joinlink.js');

// A link from outside is untrusted input to the laptop app: only a 6-digit code and a name are ever taken from it.
test('the laptop app takes only a code and a name from a lecturer link', () => {
  assert.deepEqual(parseJoin('myseb://join?code=482910&name=Ann%20Uwase'), { code: '482910', name: 'Ann Uwase' });
  assert.deepEqual(parseJoin('myseb://join?code=482910'), { code: '482910', name: '' });
  assert.equal(parseJoin('myseb://join?code=12345'), null, 'five digits');
  assert.equal(parseJoin('myseb://join?code=4829100'), null, 'seven digits');
  assert.equal(parseJoin('myseb://join?code=48291a'), null, 'letters');
  assert.equal(parseJoin('myseb://evil?code=482910'), null, 'another host');
  assert.equal(parseJoin('https://bwenge.space/join?code=482910'), null, 'another scheme');
  assert.equal(parseJoin('not a link'), null); assert.equal(parseJoin(undefined), null);
  // a server address in the link is ignored: it can never move the app to another server
  assert.deepEqual(parseJoin('myseb://join?code=482910&name=A&api=https%3A%2F%2Fevil.example'), { code: '482910', name: 'A' });
  // control characters are dropped and a long name is cut
  assert.equal(parseJoin('myseb://join?code=482910&name=A%00B%0AC').name, 'ABC');
  assert.equal(parseJoin(`myseb://join?code=482910&name=${'x'.repeat(500)}`).name.length, 80);
});
