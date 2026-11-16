import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';

// The pure parts of the platform controls (no database needed): the switches, the announcement, the gate and the public status.
const S = await import('../server/services/platform/settings.js');
const { platformGate, platformStatus } = await import('../server/services/platform/gate.js');
const { isBlockedIp } = await import('../server/services/platform/security.js');
const { buildToolkit } = await import('../server/services/ai/tools/index.js');
test.after(() => S.__setPlatformSettingsForTests(S.DEFAULT_SETTINGS));

test('the switch list covers every chat ability, and every tool name in it is a real tool', () => {
  const real = new Set(buildToolkit({ platform: {} as any, work: {} as any, assignments: {} as any, memory: {} as any, outputs: {} as any, datasets: {} as any, webSearch: {} as any, python: {} as any, image: {} as any, formAi: (() => ({})) as any } as any).names());
  process.env.ENABLE_AGENT_WEB_TOOLS = 'true'; process.env.ENABLE_AGENT_PYTHON_TOOL = 'true';
  const all = new Set(buildToolkit({ platform: {} as any, work: {} as any, assignments: {} as any, memory: {} as any, webSearch: { search: async () => [], fetchUrl: async () => '' } as any, python: { execute: async () => ({ stdout: '' }) } as any, formAi: (() => ({ adapter: {}, model: 'm' })) as any } as any).names());
  for (const f of S.FLAGS) for (const t of f.tools ?? []) assert.ok(real.has(t) || all.has(t) || t === 'generate_image', `switch ${f.id} lists ${t}, which is not a tool`);
  assert.ok(new Set(S.FLAG_IDS).size === S.FLAG_IDS.length, 'no switch twice');
  assert.ok(S.FLAGS.some((f) => f.id === 'myseb.enabled') && S.FLAGS.some((f) => f.id === 'chat.workTools'));
});

test('everything is on until the administrator turns it off; a switch only turns off', () => {
  S.__setPlatformSettingsForTests(S.DEFAULT_SETTINGS);
  assert.equal(S.disabledTools().size, 0); assert.ok(S.flagOn('chat.python'));
  S.__setPlatformSettingsForTests({ ...S.DEFAULT_SETTINGS, flags: { 'chat.webTools': false, 'chat.python': false, 'myseb.enabled': false, 'made.up': false } as any });
  assert.deepEqual([...S.disabledTools()].sort(), ['fetch_url', 'run_python', 'web_search']);
  assert.equal(S.flagOn('myseb.enabled'), false); assert.equal(S.flagOn('chat.images'), true);
  assert.equal('made.up' in S.platformSettings().flags, false, 'unknown switches are dropped');
});

test('what the administrator may send is validated', () => {
  const ok = (v: unknown) => S.settingsPatchSchema.safeParse(v).success;
  assert.ok(ok({ flags: { 'chat.python': false } })); assert.ok(ok({ announcement: null })); assert.ok(ok({ maintenance: { on: true, message: 'x' } }));
  assert.ok(!ok({ surprise: 1 })); assert.ok(!ok({ flags: { a: 'yes' } })); assert.ok(!ok({ announcement: { text: '' } })); assert.ok(!ok({ announcement: { text: 'x'.repeat(301) } }));
  assert.ok(!ok({ announcement: { text: 'x', until: 'tomorrow' } })); assert.ok(!ok({ blockedIps: new Array(201).fill('1.2.3.4') })); assert.ok(!ok({ retention: { mysebDays: 6 } })); assert.ok(ok({ retention: { mysebDays: null } }));
  assert.ok(!ok({ storageOverridesMb: { u: -1 } }));
});

test('the announcement ends by itself', () => {
  const s = { ...S.DEFAULT_SETTINGS, announcement: { text: 'Hi', level: 'info' as const, until: '2026-01-01T00:00:00Z' } };
  assert.equal(S.activeAnnouncement(s, Date.parse('2025-12-31T23:59:00Z'))?.text, 'Hi'); assert.equal(S.activeAnnouncement(s, Date.parse('2026-01-01T00:00:01Z')), null);
  assert.equal(S.activeAnnouncement({ ...s, announcement: { ...s.announcement, until: null } }, Date.now() + 1e12)?.text, 'Hi', 'no end time: stays until removed');
});

const run = (path: string, ip = '192.0.2.1') => {
  const out: { status?: number; body?: any; next?: boolean; headers: Record<string, string> } = { headers: {} };
  const res = { status(c: number) { out.status = c; return res; }, json(b: unknown) { out.body = b; return res; }, setHeader(k: string, v: string) { out.headers[k] = v; } } as unknown as Response;
  platformGate({ path, ip, headers: {} } as unknown as Request, res, () => { out.next = true; });
  return out;
};
test('maintenance: held for everyone except sign-in, the admin pages, health, status and MySEB', () => {
  S.__setPlatformSettingsForTests({ ...S.DEFAULT_SETTINGS, maintenance: { on: true, message: 'Back at 15:00' } });
  const held = run('/forms/abc'); assert.equal(held.status, 503); assert.equal(held.body.maintenance, true); assert.equal(held.body.error, 'Back at 15:00');
  for (const p of ['/health', '/platform/status', '/auth/email/start', '/admin/platform/settings', '/admin', '/myseb/api/heartbeat', '/csp-report']) assert.equal(run(p).next, true, `${p} stays open`);
  assert.equal(run('/chat/send').status, 503); assert.equal(run('/adminx/steal').status, 503, 'only the exact prefixes are open');
  S.__setPlatformSettingsForTests({ ...S.DEFAULT_SETTINGS, maintenance: { on: true, message: '' } });
  assert.match(run('/forms/x').body.error, /being updated/, 'a default message when none is written');
  S.__setPlatformSettingsForTests(S.DEFAULT_SETTINGS); assert.equal(run('/forms/x').next, true);
});
test('blocked addresses: exact or by prefix, never the health check or status', () => {
  S.__setPlatformSettingsForTests({ ...S.DEFAULT_SETTINGS, blockedIps: ['203.0.113.9', '198.51.100.', '2001:db8:'] });
  assert.equal(run('/forms/x', '203.0.113.9').status, 403); assert.equal(run('/forms/x', '198.51.100.250').status, 403); assert.equal(run('/forms/x', '2001:db8::1').status, 403);
  assert.equal(run('/forms/x', '203.0.113.10').next, true, 'not a prefix match');
  assert.equal(run('/health', '203.0.113.9').next, true); assert.equal(run('/platform/status', '203.0.113.9').next, true);
  assert.ok(!isBlockedIp('1.1.1.1', []) && !isBlockedIp('', ['1.1.1.1']));
});
test('the public status shows only what a page needs', () => {
  S.__setPlatformSettingsForTests({ ...S.DEFAULT_SETTINGS, maintenance: { on: true, message: 'soon' }, announcement: { text: 'Exams at 14:00', level: 'warning', until: null }, flags: { 'myseb.browserMode': false } });
  let body: any; const res = { setHeader() {}, json(b: unknown) { body = b; } } as unknown as Response;
  platformStatus({} as Request, res);
  assert.deepEqual(body, { maintenance: { on: true, message: 'soon' }, announcement: { text: 'Exams at 14:00', level: 'warning', until: null }, features: { myseb: true, mysebBrowser: false } });
  assert.ok(!JSON.stringify(body).includes('203.0') && !('blockedIps' in body), 'no block list, no secrets');
});
