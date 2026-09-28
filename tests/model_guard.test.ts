import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const filesToCheck = ['server/services/AiService.ts', 'server.ts'];

test('production model configuration avoids deprecated EOL model names', () => {
  for (const relativePath of filesToCheck) {
    const filePath = path.join(repoRoot, relativePath);
    const content = fs.readFileSync(filePath, 'utf8');
    assert.doesNotMatch(
      content,
      /gemini-2\.0-flash|gemini-2\.5-flash|meta\/llama-3\.3|meta\/llama-3\.1|llama-3\.3-70b-instruct/i,
      `${relativePath} still references a deprecated EOL model.`
    );
  }

  const aiServicePath = path.join(repoRoot, 'server/services/AiService.ts');
  const aiServiceContent = fs.readFileSync(aiServicePath, 'utf8');
  assert.match(aiServiceContent, /gemini-3\.8-flash|gemini-3\.8-pro/i, 'Gemini defaults should use current maintained model names.');
  assert.match(aiServiceContent, /llama-4-maverick|llama-4-scout/i, 'NVIDIA default models should use Llama 4 families rather than EOL Llama 3.x.');
});
