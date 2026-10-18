import test from 'node:test';
import assert from 'node:assert/strict';
import { buildToolkit } from '../server/services/ai/tools/index.js';

test('Python, web, URL-fetch and image-generation tools are not registered by default', () => {
  const flagNames = [
    'ENABLE_AGENT_PYTHON_TOOL',
    'ENABLE_AGENT_WEB_TOOLS',
    'ENABLE_AGENT_IMAGE_GENERATION',
  ];
  const previousValues = flagNames.map((name) => process.env[name]);
  for (const name of flagNames) delete process.env[name];

  try {
    const registry = buildToolkit({
      python: { execute: async () => ({ stdout: '', stderr: '' }) },
      webSearch: { search: async () => [], fetchUrl: async () => '' },
      image: { generate: async () => ({ data: Buffer.alloc(0), mime: 'image/png' }) },
    });
    assert.equal(registry.names().some((name) => ['run_python', 'web_search', 'fetch_url', 'generate_image'].includes(name)), false);
  } finally {
    flagNames.forEach((name, index) => {
      if (previousValues[index] === undefined) delete process.env[name];
      else process.env[name] = previousValues[index];
    });
  }
});
