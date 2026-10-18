import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';

test('email OTP endpoints keep codes out of responses and enforce verification rules', async () => {
  const originalCwd = process.cwd();
  const originalNodeEnv = process.env.NODE_ENV;
  const originalSecret = process.env.EMAIL_OTP_SECRET;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-marker-email-otp-'));
  process.chdir(tempDir);
  process.env.NODE_ENV = 'test';
  process.env.EMAIL_OTP_SECRET = crypto.randomBytes(32).toString('hex');
  delete process.env.DATABASE_URL;

  const logs: string[] = [];
  const originalConsoleLog = console.log;
  console.log = (...args: unknown[]) => logs.push(args.map(String).join(' '));

  try {
    const [{ default: authRoutes }, { prisma }, { generateCode, computeCodeHash }] = await Promise.all([
      import('../server/routes/authRoutes.js'),
      import('../server/db.js'),
      import('../server/auth/emailCode.js'),
    ]);
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const cookieHeader = req.headers.cookie || '';
      req.cookies = Object.fromEntries(
        cookieHeader.split(';').map((cookie) => {
          const separator = cookie.indexOf('=');
          return separator < 0
            ? ['', '']
            : [cookie.slice(0, separator).trim(), decodeURIComponent(cookie.slice(separator + 1).trim())];
        }).filter(([name]) => name)
      );
      next();
    });
    app.use('/api/auth', authRoutes);

    const assertNoCodeInResponse = (response: import('supertest').Response, code: string) => {
      const responseText = `${JSON.stringify(response.body)}${JSON.stringify(response.headers)}`;
      assert.equal(responseText.includes(code), false, 'OTP must not be present in response body or headers');
    };

    const requestCode = async (email: string) => {
      const logStart = logs.length;
      const response = await request(app).post('/api/auth/email/start').send({ email });
      assert.equal(response.status, 202);
      const loggedContent = logs.slice(logStart).join('\n');
      const code = loggedContent.match(/\b(\d{6}) is your Bwenge login verification code\b/)?.[1];
      assert.ok(code, 'development console sender should log the code to the server terminal');
      assertNoCodeInResponse(response, code);
      return code;
    };

    const verifyCode = async (email: string, code: string) => {
      const response = await request(app).post('/api/auth/email/verify').send({ email, code });
      assertNoCodeInResponse(response, code.replace(/\D/g, ''));
      return response;
    };

    const mixedCaseEmail = '  MixedCase@Example.com ';
    const code = await requestCode(mixedCaseEmail);
    let wrongCode = generateCode();
    while (wrongCode === code) wrongCode = generateCode();
    const wrongResponse = await verifyCode(mixedCaseEmail, wrongCode);
    assert.equal(wrongResponse.status, 400);
    assert.deepEqual(wrongResponse.body, {
      error: { code: 'code_invalid', message: 'That code is incorrect or expired.' },
    });

    const spacedCode = code.split('').join(' ');
    const otpRecord = await prisma.emailCode.findFirst({
      where: { email: 'mixedcase@example.com', consumedAt: null },
    });
    assert.ok(otpRecord);
    assert.deepEqual(otpRecord.codeHash, computeCodeHash('mixedcase@example.com', spacedCode));
    const persistedHash = JSON.parse(JSON.stringify(otpRecord.codeHash));
    await Reflect.apply(prisma.emailCode.update, prisma.emailCode, [{
      where: { id: otpRecord.id },
      data: { codeHash: persistedHash },
    }]);
    const successResponse = await verifyCode(' MIXEDCASE@example.com ', spacedCode);
    assert.equal(successResponse.status, 200, JSON.stringify(successResponse.body));
    assert.equal(successResponse.body.user.email, 'mixedcase@example.com');

    const refreshCookie = successResponse.headers['set-cookie']?.[0];
    assert.ok(refreshCookie, 'successful verification should set a refresh cookie');
    assert.match(refreshCookie, /;\s*HttpOnly/i);
    assert.match(refreshCookie, /;\s*SameSite=Lax/i);
    assert.match(refreshCookie, /;\s*Path=\//i);
    assert.match(refreshCookie, /;\s*Max-Age=2592000/i);

    const authenticatedResponse = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${successResponse.body.accessToken}`);
    assert.equal(authenticatedResponse.status, 200, JSON.stringify(authenticatedResponse.body));
    assert.equal(authenticatedResponse.body.user.email, 'mixedcase@example.com');

    const refreshResponse = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', refreshCookie.split(';', 1)[0]);
    assert.equal(refreshResponse.status, 200, JSON.stringify(refreshResponse.body));
    assert.equal(refreshResponse.body.expiresIn, 900);
    const restoredAuthResponse = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${refreshResponse.body.accessToken}`);
    assert.equal(restoredAuthResponse.status, 200, JSON.stringify(restoredAuthResponse.body));
    assert.equal(restoredAuthResponse.body.user.email, 'mixedcase@example.com');

    const originalFetch = globalThis.fetch;
    const { authFetch, setAccessToken } = await import('../src/utils/authFetch.ts');
    let meAuthorization: string | null = null;
    try {
      setAccessToken(successResponse.body.accessToken, successResponse.body.expiresIn);
      globalThis.fetch = async (_input, init) => {
        meAuthorization = new Headers(init?.headers).get('Authorization');
        return new Response(JSON.stringify({ user: successResponse.body.user }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };
      const frontendMeResponse = await authFetch('/api/auth/me');
      assert.equal(frontendMeResponse.status, 200);
      assert.equal(meAuthorization, `Bearer ${successResponse.body.accessToken}`);
    } finally {
      globalThis.fetch = originalFetch;
      setAccessToken(null);
    }

    const unknownRefreshResponse = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', 'session=unknown-refresh-token');
    assert.equal(unknownRefreshResponse.status, 401);
    assert.deepEqual(unknownRefreshResponse.body, { error: { code: 'TOKEN_EXPIRED' } });
    assert.match(unknownRefreshResponse.headers['set-cookie']?.[0] || '', /^session=;/);

    const orphanRefreshToken = crypto.randomBytes(32).toString('base64url');
    await prisma.refreshSession.create({
      data: {
        userId: 'missing-user',
        familyId: crypto.randomUUID(),
        tokenHash: crypto.createHash('sha256').update(orphanRefreshToken).digest('hex'),
        expiresAt: new Date(Date.now() + 60_000),
        absoluteExpiresAt: new Date(Date.now() + 120_000),
      },
    });
    const orphanRefreshResponse = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', `session=${orphanRefreshToken}`);
    assert.equal(orphanRefreshResponse.status, 401);
    assert.deepEqual(orphanRefreshResponse.body, { error: { code: 'TOKEN_EXPIRED' } });
    assert.match(orphanRefreshResponse.headers['set-cookie']?.[0] || '', /^session=;/);

    const reusedResponse = await verifyCode(mixedCaseEmail, code);
    assert.equal(reusedResponse.status, 400);
    assert.deepEqual(reusedResponse.body, wrongResponse.body);

    const unknownCode = generateCode();
    const unknownResponse = await verifyCode('unknown@example.com', unknownCode);
    assert.equal(unknownResponse.status, wrongResponse.status);
    assert.deepEqual(unknownResponse.body, wrongResponse.body);

    const resendEmail = 'resend@example.com';
    const firstResendCode = await requestCode(resendEmail);
    const latestResendCode = await requestCode(resendEmail);
    const invalidatedResponse = await verifyCode(resendEmail, firstResendCode);
    assert.equal(invalidatedResponse.status, 400);
    assert.deepEqual(invalidatedResponse.body, wrongResponse.body);
    const latestCodeResponse = await verifyCode(resendEmail, latestResendCode);
    assert.equal(latestCodeResponse.status, 200);

    const expiredEmail = 'expired@example.com';
    const expiredCode = await requestCode(expiredEmail);
    const expiredRecord = await prisma.emailCode.findFirst({
      where: { email: expiredEmail, consumedAt: null },
    });
    assert.ok(expiredRecord);
    await prisma.emailCode.update({
      where: { id: expiredRecord.id },
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    const expiredResponse = await verifyCode(expiredEmail, expiredCode);
    assert.equal(expiredResponse.status, 400);
    assert.deepEqual(expiredResponse.body, wrongResponse.body);

    const attemptsEmail = 'attempts@example.com';
    const attemptsCode = await requestCode(attemptsEmail);
    for (let attempt = 0; attempt < 5; attempt++) {
      let invalidCode = generateCode();
      while (invalidCode === attemptsCode) invalidCode = generateCode();
      const response = await verifyCode(attemptsEmail, invalidCode);
      assert.equal(response.status, 400);
    }
    const afterLimitResponse = await verifyCode(attemptsEmail, attemptsCode);
    assert.equal(afterLimitResponse.status, 400);
    assert.deepEqual(afterLimitResponse.body, wrongResponse.body);

    const limitedEmail = 'limited@example.com';
    await requestCode(limitedEmail);
    await requestCode(limitedEmail);
    await requestCode(limitedEmail);
    const requestLimitResponse = await request(app).post('/api/auth/email/start').send({ email: limitedEmail });
    assert.equal(requestLimitResponse.status, 429);
    assertNoCodeInResponse(requestLimitResponse, generateCode());

    const { ConsoleEmailSender, getEmailSender, validateEmailSenderConfiguration } =
      await import('../server/email/EmailSender.js');
    const originalSmtp = {
      host: process.env.SMTP_HOST,
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    };
    const originalConsoleError = console.error;
    const startupErrors: string[] = [];
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.SMTP_HOST;
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASS;
      console.error = (...args: unknown[]) => startupErrors.push(args.map(String).join(' '));
      validateEmailSenderConfiguration();
      assert.match(startupErrors.join('\n'), /SMTP_HOST, SMTP_USER, and SMTP_PASS/);
      assert.throws(() => getEmailSender(), /requires SMTP_HOST, SMTP_USER, and SMTP_PASS/);
      await assert.rejects(
        new ConsoleEmailSender().send({ to: 'test@example.com', subject: 'Test', text: '', html: '' }),
        /disabled in production/
      );
    } finally {
      console.error = originalConsoleError;
      process.env.NODE_ENV = 'test';
      if (originalSmtp.host === undefined) delete process.env.SMTP_HOST;
      else process.env.SMTP_HOST = originalSmtp.host;
      if (originalSmtp.user === undefined) delete process.env.SMTP_USER;
      else process.env.SMTP_USER = originalSmtp.user;
      if (originalSmtp.pass === undefined) delete process.env.SMTP_PASS;
      else process.env.SMTP_PASS = originalSmtp.pass;
    }
  } finally {
    console.log = originalConsoleLog;
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalSecret === undefined) delete process.env.EMAIL_OTP_SECRET;
    else process.env.EMAIL_OTP_SECRET = originalSecret;
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  }
});
