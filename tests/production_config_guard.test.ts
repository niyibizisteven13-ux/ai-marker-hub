import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');

test('production config defaults are not SQLite and include required infrastructure settings', () => {
  const schema = fs.readFileSync(path.join(repoRoot, 'prisma/schema.prisma'), 'utf8');
  const server = fs.readFileSync(path.join(repoRoot, 'server.ts'), 'utf8');
  const db = fs.readFileSync(path.join(repoRoot, 'server/db.ts'), 'utf8');
  const envExample = fs.readFileSync(path.join(repoRoot, '.env.example'), 'utf8');

  assert.match(schema, /provider\s*=\s*"postgresql"/i, 'Prisma datasource should not use SQLite.');
  assert.match(server, /DATABASE_URL must use PostgreSQL in production/, 'Production startup must refuse a non-PostgreSQL database.');
  assert.match(db, /mockFallbackAllowed = process\.env\.NODE_ENV !== 'production'/, 'Production must never fall back to the local JSON store.');
  assert.match(envExample, /DATABASE_URL="?postgresql:/i, 'Env example should document Postgres, not SQLite.');
});
