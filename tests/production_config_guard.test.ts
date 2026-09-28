import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');

test('production config defaults are not SQLite and include required infrastructure settings', () => {
  const schema = fs.readFileSync(path.join(repoRoot, 'prisma/schema.prisma'), 'utf8');
  const compose = fs.readFileSync(path.join(repoRoot, 'docker-compose.yml'), 'utf8');
  const envExample = fs.readFileSync(path.join(repoRoot, '.env.example'), 'utf8');

  assert.match(schema, /provider\s*=\s*"postgresql"/i, 'Prisma datasource should not use SQLite.');
  assert.match(compose, /postgres:/i, 'Docker compose should include a Postgres service.');
  assert.match(compose, /DATABASE_URL=postgresql:/i, 'Compose should define a PostgreSQL database URL.');
  assert.match(envExample, /DATABASE_URL="postgresql:/i, 'Env example should document Postgres, not SQLite.');
});
