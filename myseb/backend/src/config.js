import crypto from 'node:crypto';

const isProd = process.env.NODE_ENV === 'production';
function need(name, fallback) {
  const v = process.env[name];
  if (v) return v;
  if (isProd) throw new Error(`${name} must be set in production`);
  return fallback;
}

export const config = {
  port: Number(process.env.PORT || 4000),
  databaseUrl: process.env.DATABASE_URL || 'postgres://myseb:myseb@localhost:5432/myseb',
  publicUrl: (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 4000}`).replace(/\/$/, ''),
  // Where this server is reachable on its public address, when it sits behind a prefix such as /myseb.
  get basePath() { try { return new URL(this.publicUrl).pathname.replace(/\/$/, ''); } catch { return ''; } },
  teacherKey: need('TEACHER_KEY', 'dev-teacher-key'),
  pepper: need('PEPPER', 'dev-pepper-not-for-production'),
  heartbeatTimeoutSeconds: Number(process.env.HEARTBEAT_TIMEOUT_SECONDS || 20),
  codeTtlHours: Number(process.env.CODE_TTL_HOURS || 12),
  retentionDays: Number(process.env.RETENTION_DAYS || 90),
  dashboardEnabled: process.env.DISABLE_DASHBOARD !== '1',
  isProd,
};

export const sha = (s) => crypto.createHmac('sha256', config.pepper).update(String(s)).digest('hex');
export const safeEqual = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};
