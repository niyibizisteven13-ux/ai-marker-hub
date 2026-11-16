import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraErrorMessage } from '../src/utils/cameraErrors.js';

const as = (ua: string, secure = true) => {
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: ua }, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'window', { value: { isSecureContext: secure }, configurable: true, writable: true });
};
const WIN_APP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MySEB/1.0 (desktop; win32)';

test('a student is told what is actually wrong with the camera', () => {
  as(WIN_APP);
  assert.match(cameraErrorMessage({ name: 'NotReadableError' }), /Another program is using your camera/);
  as('Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120 Mobile MySEB/1.0 (mobile)');
  assert.match(cameraErrorMessage({ name: 'NotReadableError' }), /Another app is using your camera.*recent apps/, 'on a phone it says app and how to close it');
  as(WIN_APP);
  assert.match(cameraErrorMessage({ name: 'NotFoundError' }), /No camera was found/);
  assert.match(cameraErrorMessage({ name: 'NotAllowedError' }), /not letting MySEB use the camera/);
  assert.match(cameraErrorMessage({ name: 'NotAllowedError' }), /Let desktop apps access your camera/, 'the Windows setting is named');
  assert.match(cameraErrorMessage(new Error('x')), /could not be started/);
  as('Mozilla/5.0 (Windows NT 10.0) Chrome/120');
  assert.match(cameraErrorMessage({ name: 'NotAllowedError' }), /lock icon/, 'in a browser: the lock icon');
  as('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Chrome/120');
  assert.match(cameraErrorMessage({ name: 'NotAllowedError' }), /System Settings/);
  as('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile MySEB/1.0 (mobile)');
  assert.match(cameraErrorMessage({ name: 'NotAllowedError' }), /Your phone is not letting MySEB use the camera/);
  assert.match(cameraErrorMessage({ name: 'NotAllowedError' }), /Settings → Apps → MySEB → Permissions → Camera/);
  as(WIN_APP, false);
  assert.match(cameraErrorMessage({ name: 'NotAllowedError' }), /https/);
});
