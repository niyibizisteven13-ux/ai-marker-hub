import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const serverPath = path.join(repoRoot, 'server.ts');

test('production startup refuses SQLite database URLs', () => {
  const content = fs.readFileSync(serverPath, 'utf8');
  assert.match(content, /NODE_ENV === 'production'/i, 'Production boot guard should be present.');
  assert.match(content, /file:/i, 'Production guard should explicitly reject file: SQLite URLs.');
});
