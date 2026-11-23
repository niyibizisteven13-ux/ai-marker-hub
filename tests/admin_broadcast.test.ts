import assert from 'node:assert/strict';
import test from 'node:test';
import { broadcastDraftSchema, formatAdminBroadcast } from '../server/email/AdminBroadcast.js';

test('HTML-only broadcast preserves an imported email layout and creates a text alternative', () => {
  const draft = broadcastDraftSchema.parse({
    subject: 'Meet Bwenge4Profile',
    text: '',
    htmlSource: '<!doctype html><html><head><title>Subject</title><style>p{color:red}</style></head><body><table role="presentation"><tr><td bgcolor="#ffffff" style="padding:24px;color:#123456"><h1>Meet Bwenge4Profile</h1><p>Projects &amp; updates</p></td></tr></table></body></html>',
    videoUrl: 'https://www.bwenge.space/api/biz/email-video/example.mp4',
  });
  const message = formatAdminBroadcast(draft);
  assert.match(message.html, /<table role="presentation">/);
  assert.match(message.html, /style="padding:24px;color:#123456"/);
  assert.match(message.html, /<video autoplay muted loop playsinline controls/);
  assert.match(message.html, />Watch video<\/a>/);
  assert.doesNotMatch(message.html, /<style>|<title>|p\{color:red\}/);
  assert.match(message.text, /Meet Bwenge4Profile\nProjects & updates/);
  assert.match(message.text, /Watch video: https:/);
});

test('broadcast markup removes active content and preserves the supplied plain-text version', () => {
  const draft = broadcastDraftSchema.parse({
    subject: 'Announcement',
    text: 'Custom text',
    htmlSource: '<script>alert(1)</script><iframe src="https://example.com"></iframe><p onclick="alert(1)" style="background:url(https://example.com);color:#121212"><a href="javascript:alert(1)">Read</a></p>',
  });
  const message = formatAdminBroadcast(draft);
  assert.equal(message.text, 'Custom text');
  assert.match(message.html, /<p style="color:#121212"><a>Read<\/a><\/p>/);
  assert.doesNotMatch(message.html, /alert|iframe|url\(/);
  assert.equal(broadcastDraftSchema.safeParse({ subject: 'Empty', text: '' }).success, false);
});
