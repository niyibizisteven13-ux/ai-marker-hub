import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SITE, mysebDownloadUrl, studentInvite } from '../shared/mysebShare.js';

// The message a lecturer shares when a live test opens: the join link, the code, and where to get the MySEB app.
test('the download link points at the MySEB downloader of the site, with or without a trailing slash, and falls back to the main site', () => {
  assert.equal(mysebDownloadUrl('https://www.bwenge.space/'), 'https://www.bwenge.space/myseb/download');
  assert.equal(mysebDownloadUrl('https://x.example.rw'), 'https://x.example.rw/myseb/download');
  assert.equal(mysebDownloadUrl(''), `${DEFAULT_SITE}/myseb/download`);
});

test('the invite has the join link, the code, the app download link and the iPhone note', () => {
  const t = studentInvite({ title: ' S4 Biology midterm ', joinUrl: 'https://www.bwenge.space/myseb/join/482910', code: '482 910', site: 'https://www.bwenge.space' });
  assert.deepEqual(t.split('\n').slice(0, 3), ['Join S4 Biology midterm: https://www.bwenge.space/myseb/join/482910', 'Code: 482 910', 'Get the MySEB app (Windows, Android, Linux, Mac): https://www.bwenge.space/myseb/download']);
  assert.match(t, /iPhone it starts in the browser/);
});

test('without a title or code the invite still reads well', () => {
  const t = studentInvite({ joinUrl: 'https://x.rw/j/1' });
  assert.ok(t.startsWith('Join the test: https://x.rw/j/1\nGet the MySEB app')); assert.ok(!t.includes('Code:'));
  assert.ok(t.includes(`${DEFAULT_SITE}/myseb/download`));
});
