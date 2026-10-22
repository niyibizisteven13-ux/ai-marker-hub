import test from 'node:test';
import assert from 'node:assert/strict';
import { loadComplexProvider } from '../server/services/ai/router/complexProvider.js';
import { TaskRouter } from '../server/services/ai/router/taskRouter.js';
import { TaskClassifier } from '../server/services/ai/router/taskClassifier.js';
import { ModelPolicyManager } from '../server/services/ai/router/modelPolicy.js';
import { ModelDispatchAdapter } from '../server/services/ai/providers/modelDispatch.js';
import { ReliableProviderAdapter } from '../server/services/ai/providers/reliableAdapter.js';
import { ProviderMetrics } from '../server/services/ai/observability/providerMetrics.js';
import { ProviderError, type ProviderAdapter, type ProviderChunk, type ProviderRequest } from '../server/services/ai/providers/types.js';

test('big-task provider is off by default and when keys/models are missing', () => {
  assert.equal(loadComplexProvider({}).config, null);
  assert.equal(loadComplexProvider({ AI_COMPLEX_PROVIDER: 'gonka' }).config, null);
  assert.match(loadComplexProvider({ AI_COMPLEX_PROVIDER: 'deepseek' }).reason, /DEEPSEEK_API_KEY/);
  assert.match(loadComplexProvider({ AI_COMPLEX_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'k' }).reason, /OPENROUTER_COMPLEX_MODEL/);
  assert.match(loadComplexProvider({ AI_COMPLEX_PROVIDER: 'other' }).reason, /unknown/);
});

test('deepseek and openrouter configs', () => {
  const ds = loadComplexProvider({ AI_COMPLEX_PROVIDER: 'DeepSeek', DEEPSEEK_API_KEY: 'k' }).config!;
  assert.deepEqual([ds.name, ds.baseUrl, ds.model, ds.fallbackToGonka, ds.supportsVision], ['DeepSeek', 'https://api.deepseek.com/v1', 'deepseek-chat', true, false]);
  assert.equal(loadComplexProvider({ AI_COMPLEX_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'k', DEEPSEEK_COMPLEX_MODEL: 'deepseek-reasoner', AI_COMPLEX_FALLBACK_TO_GONKA: 'false' }).config!.fallbackToGonka, false);
  const or = loadComplexProvider({ AI_COMPLEX_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'k', OPENROUTER_COMPLEX_MODEL: 'vendor/model-x' }).config!;
  assert.deepEqual([or.name, or.model], ['OpenRouter', 'vendor/model-x']);
});

function router(env: Record<string, string>) {
  return new TaskRouter(new ModelPolicyManager(undefined, { GONKA_MODEL: 'gonka/std' }), new TaskClassifier(), true, false, loadComplexProvider(env).config);
}

test('normal chat stays on Gonka; big tasks go to the big-task provider', () => {
  const r = router({ AI_COMPLEX_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'k' });
  for (const prompt of ['Hello!', 'Explain the water cycle for my class', 'Calculate the average of 3, 4 and 5']) {
    const d = r.route({ prompt });
    assert.equal(d.provider, 'gonka', prompt);
    assert.equal(d.model, 'gonka/std');
  }
  for (const prompt of ['Compare these two policy documents and explain the differences', 'Make a bar chart of enrolment by province', 'x'.repeat(2000)]) {
    const d = r.route({ prompt });
    assert.equal(d.provider, 'DeepSeek', prompt.slice(0, 40));
    assert.equal(d.model, 'deepseek-chat');
    assert.equal(d.fallbackModel, undefined, 'adapter-level fallback to Gonka applies');
  }
});

test('big tasks with images stay on Gonka unless the provider supports vision', () => {
  const prompt = 'Compare these two scanned report pages';
  assert.equal(router({ AI_COMPLEX_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'k' }).route({ prompt, hasImages: true }).provider, 'gonka');
  assert.equal(router({ AI_COMPLEX_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'k', AI_COMPLEX_SUPPORTS_VISION: 'true' }).route({ prompt, hasImages: true }).provider, 'DeepSeek');
});

test('without a big-task provider everything stays on Gonka', () => {
  const d = router({}).route({ prompt: 'Compare these two policy documents' });
  assert.equal(d.provider, 'gonka');
  assert.equal(d.fallbackModel, null);
});

function fake(name: string, steps: Array<ProviderChunk[] | Error>) {
  const calls: ProviderRequest[] = [];
  const adapter: ProviderAdapter = {
    name,
    async *stream(req) {
      calls.push(req);
      const step = steps.shift();
      if (!step) throw new Error('no step');
      if (step instanceof Error) throw step;
      yield* step;
    },
  };
  return { adapter, calls };
}

async function text(gen: AsyncGenerator<ProviderChunk>) {
  let out = '';
  for await (const c of gen) if (c.type === 'text') out += c.text;
  return out;
}

const fast = { sleep: async () => {}, random: () => 1, metrics: new ProviderMetrics() };

test('dispatch: big-task model goes to DeepSeek, everything else to Gonka', async () => {
  const gonka = fake('Gonka', [[{ type: 'text', text: 'from gonka' }]]);
  const ds = fake('DeepSeek', [[{ type: 'text', text: 'from deepseek' }]]);
  const dispatch = new ModelDispatchAdapter(gonka.adapter, new Map([['deepseek-chat', ds.adapter]]));
  assert.equal(await text(dispatch.stream({ model: 'deepseek-chat', messages: [] })), 'from deepseek');
  assert.equal(await text(dispatch.stream({ model: 'gonka/std', messages: [] })), 'from gonka');
});

test('DeepSeek outage falls back to Gonka with bounded attempts; disabled fallback fails cleanly', async () => {
  const gonkaInner = fake('Gonka', [[{ type: 'text', text: 'gonka answer' }]]);
  const gonka = new ReliableProviderAdapter({ primary: gonkaInner.adapter, ...fast });
  const dsInner = fake('DeepSeek', [new ProviderError('x', 503), new ProviderError('x', 503), new ProviderError('x', 503)]);
  const big = new ReliableProviderAdapter({ primary: dsInner.adapter, fallbackAdapter: gonka, fallbackModel: 'gonka/complex', ...fast });
  const dispatch = new ModelDispatchAdapter(gonka, new Map([['deepseek-chat', big]]));

  assert.equal(await text(dispatch.stream({ model: 'deepseek-chat', messages: [] })), 'gonka answer');
  assert.equal(dsInner.calls.length, 3);
  assert.deepEqual(gonkaInner.calls.map((c) => c.model), ['gonka/complex']);

  const dsDown = fake('DeepSeek', [new ProviderError('x', 401)]);
  const noFallback = new ReliableProviderAdapter({ primary: dsDown.adapter, ...fast });
  await assert.rejects(text(noFallback.stream({ model: 'deepseek-chat', messages: [] })), (e: any) => e.category === 'AUTH_FAILURE');
});

test('an exhausted Gonka fallback is not retried again by the big-task adapter', async () => {
  const gonkaInner = fake('Gonka', [new ProviderError('x', 503), new ProviderError('x', 503), new ProviderError('x', 503), [{ type: 'text', text: 'unused' }]]);
  const gonka = new ReliableProviderAdapter({ primary: gonkaInner.adapter, ...fast });
  const dsInner = fake('DeepSeek', [new ProviderError('x', 503), new ProviderError('x', 503), new ProviderError('x', 503)]);
  const big = new ReliableProviderAdapter({ primary: dsInner.adapter, fallbackAdapter: gonka, fallbackModel: 'gonka/complex', ...fast });
  await assert.rejects(text(big.stream({ model: 'deepseek-chat', messages: [] })));
  assert.equal(gonkaInner.calls.length, 3, 'Gonka tried 3 times once, not 3×3');
});
