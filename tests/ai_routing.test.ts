import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskClassifier } from '../server/services/ai/router/taskClassifier.js';
import { loadModelPolicies, ModelPolicyManager } from '../server/services/ai/router/modelPolicy.js';
import { TaskRouter } from '../server/services/ai/router/taskRouter.js';

const classifier = new TaskClassifier();
const cls = (prompt: string, extra = {}) => classifier.classifyWithReason({ prompt, ...extra });

test('classifier: greetings and short questions are SIMPLE', () => {
  for (const p of ['Hello!', 'hi there', 'Muraho', 'What is photosynthesis?', 'Define osmosis']) {
    assert.equal(cls(p).taskClass, 'SIMPLE', p);
  }
});

test('classifier: word boundaries avoid false matches', () => {
  assert.notEqual(cls('Give me a summary of this lesson').taskClass, 'DETERMINISTIC', '"summary" is not "sum"');
  assert.notEqual(cls('I need information about schools').taskClass, 'ARTIFACT_SPEC', '"information" is not "form"');
});

test('classifier: calculations, artifacts and complex work', () => {
  assert.deepEqual(cls('Calculate the average score'), { taskClass: 'DETERMINISTIC', reasonCode: 'DETERMINISTIC_CALCULATION' });
  assert.deepEqual(cls('Make a bar chart of enrolment'), { taskClass: 'ARTIFACT_SPEC', reasonCode: 'ARTIFACT_SPECIFICATION' });
  assert.equal(cls('Compare these two policy documents and explain the differences').taskClass, 'COMPLEX');
  assert.equal(cls('x'.repeat(1600)).taskClass, 'COMPLEX');
  assert.equal(cls('Explain this', { hasFiles: true }).reasonCode, 'ATTACHED_FILES');
  assert.equal(cls('Explain the water cycle in detail for my class').taskClass, 'STANDARD');
});

test('classifier: internal override wins', () => {
  assert.deepEqual(cls('hello', { overrideClass: 'COMPLEX' }), { taskClass: 'COMPLEX', reasonCode: 'OVERRIDE' });
});

test('policies default every class to GONKA_MODEL when no class models are configured', () => {
  const p = loadModelPolicies({ GONKA_MODEL: 'gw/standard' });
  for (const c of Object.values(p)) assert.equal(c.model, 'gw/standard');
  assert.equal(p.STANDARD.fallbackModel, undefined);
});

test('policies use configured economical/premium/fallback models and token caps', () => {
  const env = { GONKA_MODEL: 'gw/std', GONKA_ECONOMICAL_MODEL: 'gw/cheap', GONKA_PREMIUM_MODEL: 'gw/big', GONKA_FALLBACK_MODEL: 'gw/backup', AI_MAX_OUTPUT_TOKENS_SIMPLE: '300' };
  const p = loadModelPolicies(env);
  assert.equal(p.SIMPLE.model, 'gw/cheap');
  assert.equal(p.SIMPLE.maxOutputTokens, 300);
  assert.equal(p.STANDARD.model, 'gw/std');
  assert.equal(p.COMPLEX.model, 'gw/big');
  assert.equal(p.ARTIFACT_SPEC.model, 'gw/big');
  const m = new ModelPolicyManager(undefined, env);
  assert.equal(m.getFallbackModel('STANDARD'), 'gw/backup');
  assert.equal(m.getFallbackModel('COMPLEX'), undefined, 'no silent downgrade for complex work');
  assert.equal(m.getFallbackModel('ARTIFACT_SPEC'), undefined);
});

test('SIMPLE falls back to the standard model by default (an upgrade); COMPLEX never falls back to it', () => {
  const m = new ModelPolicyManager(undefined, { GONKA_MODEL: 'gw/std', GONKA_ECONOMICAL_MODEL: 'gw/cheap', GONKA_PREMIUM_MODEL: 'gw/big' });
  assert.equal(m.getFallbackModel('SIMPLE'), 'gw/std');
  assert.equal(m.getFallbackModel('STANDARD'), undefined);
  assert.equal(m.getFallbackModel('COMPLEX'), undefined);
  assert.equal(new ModelPolicyManager(undefined, { GONKA_MODEL: 'gw/std' }).getFallbackModel('SIMPLE'), undefined, 'no self-fallback');
});

test('invalid model ids from env are ignored rather than sent upstream', () => {
  const p = loadModelPolicies({ GONKA_MODEL: 'gw/std', GONKA_ECONOMICAL_MODEL: 'bad model; rm -rf', AI_MAX_OUTPUT_TOKENS_SIMPLE: '-5' });
  assert.equal(p.SIMPLE.model, 'gw/std');
  assert.equal(p.SIMPLE.maxOutputTokens, 1024);
  assert.throws(() => new ModelPolicyManager({ STANDARD: { model: '', maxOutputTokens: 10 } }, {}), /no valid model id/);
});

test('router: decision carries model, token cap and fallback; images block non-vision fallback', () => {
  const env = { GONKA_MODEL: 'gw/std', GONKA_ECONOMICAL_MODEL: 'gw/cheap', GONKA_FALLBACK_MODEL: 'gw/backup' };
  const router = new TaskRouter(new ModelPolicyManager(undefined, env), new TaskClassifier(), true, false);
  const simple = router.route({ prompt: 'hello' });
  assert.equal(simple.model, 'gw/cheap');
  assert.equal(simple.fallbackModel, 'gw/backup');
  assert.equal(router.route({ prompt: 'describe this picture please', hasFiles: true, hasImages: true }).fallbackModel, null);
});

test('router: AI_MODEL_ROUTING=off sends everything to the standard policy', () => {
  const env = { GONKA_MODEL: 'gw/std', GONKA_ECONOMICAL_MODEL: 'gw/cheap', GONKA_PREMIUM_MODEL: 'gw/big' };
  const router = new TaskRouter(new ModelPolicyManager(undefined, env), new TaskClassifier(), false);
  for (const prompt of ['hello', 'Compare these documents', 'Make a chart']) {
    const d = router.route({ prompt });
    assert.equal(d.taskClass, 'STANDARD');
    assert.equal(d.model, 'gw/std');
  }
});
