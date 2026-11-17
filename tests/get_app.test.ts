import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { DEFAULT_APK_URL, apkUrl, chooserPage, createGetAppRouter, deviceOf } from '../server/routes/getApp.js';

// The landing page's QR code and button open the Bwenge app (not MySEB).
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36';

test('devices are told apart', () => { assert.equal(deviceOf(ANDROID), 'android'); assert.equal(deviceOf(IPHONE), 'ios'); assert.equal(deviceOf(WINDOWS), 'other'); assert.equal(deviceOf(''), 'other'); });

test('the app address is the Bwenge APK unless a safe HTTPS address is set', () => {
  assert.match(DEFAULT_APK_URL, /\/releases\/download\/apk-latest\/Bwenge\.apk$/);
  assert.equal(apkUrl({} as any), DEFAULT_APK_URL);
  assert.equal(apkUrl({ BWENGE_APK_URL: 'https://cdn.example.rw/Bwenge.apk' } as any), 'https://cdn.example.rw/Bwenge.apk');
  for (const bad of ['http://x.rw/a.apk', 'javascript:alert(1)', 'ftp://x', '  ', 'https://a b']) assert.equal(apkUrl({ BWENGE_APK_URL: bad } as any), DEFAULT_APK_URL, bad);
});

test('the page for other devices names Bwenge, never MySEB as the app, and escapes the address', () => {
  const ios = chooserPage('ios', DEFAULT_APK_URL), pc = chooserPage('other', DEFAULT_APK_URL);
  assert.match(ios, /Add to Home Screen/); assert.match(pc, /Install/); assert.ok(ios.includes(DEFAULT_APK_URL));
  assert.ok(!/download MySEB/i.test(ios + pc));
  assert.ok(!chooserPage('other', 'https://x.rw/a"><script>alert(1)</script>').includes('<script>'));
});

test('an Android phone is sent straight to the APK; everyone else gets the page', async () => {
  const app = express(); app.use('/get-app', createGetAppRouter({} as any));
  const srv = app.listen(0); const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/get-app`;
  try {
    const a = await fetch(base, { headers: { 'user-agent': ANDROID }, redirect: 'manual' });
    assert.equal(a.status, 302); assert.equal(a.headers.get('location'), DEFAULT_APK_URL); assert.equal(a.headers.get('cache-control'), 'no-store');
    const i = await fetch(base, { headers: { 'user-agent': IPHONE } }); assert.equal(i.status, 200); assert.match(await i.text(), /Add to Home Screen/);
    const w = await fetch(base, { headers: { 'user-agent': WINDOWS } }); assert.equal(w.status, 200); assert.match(await w.text(), /Download for Android/);
  } finally { srv.close(); }
});
