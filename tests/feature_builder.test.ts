import assert from 'node:assert/strict';
import test from 'node:test';
import { compileFeaturePreview, featureBuilderTools, starterFiles, starterNames } from '../server/services/featureBuilder.js';
import type { ToolContext } from '../server/services/ai/types.js';
import { contentSecurityPolicy } from '../server/utils/csp.js';

test('feature templates generate standalone previews, and project edits change the compiled result', async () => {
  for (const kind of starterNames) {
    const files = starterFiles(kind);
    const first = await compileFeaturePreview(files);
    assert.match(first, /<div id="root"><\/div><script>/);
    const tools = featureBuilderTools(files);
    assert.equal(tools.validate('write_project_file', { path: 'other.jsx', content: 'hello' }) === null, false);
    await tools.get('write_project_file')!.execute({
      path: 'App.jsx', content: 'export default function App() { return <button>Book a table</button>; }',
    }, {} as ToolContext);
    const next = await compileFeaturePreview(files);
    assert.match(next, /Book a table/);
    assert.doesNotMatch(next, /Your project is ready to edit/);
  }
});

test('builder compilation rejects unsupported imports and invalid JSX', async () => {
  const files = starterFiles('custom');
  files['App.jsx'] = "import other from './other'; export default other;";
  await assert.rejects(compileFeaturePreview(files), /Project imports are limited to React/);
  files['App.jsx'] = 'export default function App() { return <p>; }';
  await assert.rejects(compileFeaturePreview(files));
});

test('builder preview has a dedicated sandbox policy even when site CSP is disabled', () => {
  const policy = contentSecurityPolicy('/builder-preview.html', { CSP_MODE: 'off' });
  assert.equal(policy?.header, 'Content-Security-Policy');
  assert.match(policy!.value, /sandbox allow-scripts/);
  assert.match(policy!.value, /connect-src 'none'/);
  assert.match(policy!.value, /form-action 'none'/);
});
