import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const guardedFiles = ['production/authRoutes.js', 'server/controllers/authController.ts'];

test('JWT auth entrypoints do not include a hardcoded fallback secret', () => {
  for (const relativePath of guardedFiles) {
    const filePath = path.join(repoRoot, relativePath);
    const content = fs.readFileSync(filePath, 'utf8');
    assert.doesNotMatch(
      content,
      /process\.env\.JWT_SECRET\s*\|\|\s*['"]/,
      `${relativePath} still contains a hardcoded JWT fallback secret.`
    );
  }
});
