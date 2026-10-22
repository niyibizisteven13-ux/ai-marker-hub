import * as AjvNs from 'ajv';
import { extractJsonFragment } from '../../../utils/textSanitizers.js';
import type { ProviderAdapter } from '../providers/types.js';

type AjvCtor = typeof import('ajv').default;
const Ajv: AjvCtor = ((AjvNs as any).default?.default ?? (AjvNs as any).default ?? AjvNs) as AjvCtor;
const ajv = new Ajv({ allErrors: true, strict: false });

export class StructuredOutputError extends Error {
  constructor(message: string, public problems: string[]) {
    super(message);
  }
}

export interface StructuredRequest {
  model: string;
  system: string;
  prompt: string;
  /** JSON schema the output must match. Keep it simple (types, enums, required, additionalProperties: false). */
  schema: Record<string, unknown>;
  /** Images (data URLs) sent with the prompt, e.g. a scanned page. */
  images?: string[];
  /** Extra deterministic checks; return problems (empty = valid). */
  validate?: (data: unknown) => string[];
  maxTokens?: number;
  signal?: AbortSignal;
  requestId?: string;
  fallbackModel?: string | null;
}

export interface StructuredResult<T> {
  data: T;
  usage: { input: number; output: number };
  attempts: number;
}

/**
 * Asks a model for JSON and validates it. With Claude the schema is enforced by structured outputs;
 * with other gateways it is sent as an instruction. Either way the result is schema-checked here,
 * plus caller checks, with one repair attempt that quotes the problems back to the model.
 */
export async function generateStructured<T>(adapter: ProviderAdapter, req: StructuredRequest): Promise<StructuredResult<T>> {
  const validateSchema = ajv.compile(req.schema);
  const usage = { input: 0, output: 0 };
  let prompt = req.prompt;
  let lastProblems: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    let text = '';
    for await (const c of adapter.stream({
      model: req.model,
      messages: [
        { role: 'system', content: `${req.system}\n\nRespond with a single JSON object that matches this JSON schema, and nothing else:\n${JSON.stringify(req.schema)}` },
        { role: 'user', content: req.images?.length ? [...req.images.map((url) => ({ type: 'image_url' as const, image_url: { url } })), { type: 'text' as const, text: prompt }] : prompt },
      ],
      maxTokens: req.maxTokens ?? 16_000,
      responseSchema: req.schema,
      signal: req.signal,
      requestId: req.requestId,
      fallbackModel: req.fallbackModel,
    })) {
      if (c.type === 'text') text += c.text;
      else if (c.type === 'usage') { usage.input += c.input; usage.output += c.output; }
    }
    const fragment = extractJsonFragment(text) ?? text.trim();
    let data: unknown;
    try {
      data = JSON.parse(fragment);
    } catch {
      lastProblems = ['The response was not valid JSON.'];
    }
    if (data !== undefined) {
      lastProblems = validateSchema(data) ? [] : (validateSchema.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}`);
      if (!lastProblems.length && req.validate) lastProblems = req.validate(data);
      if (!lastProblems.length) return { data: data as T, usage, attempts: attempt };
    }
    prompt = `${req.prompt}\n\nYour previous answer had these problems:\n- ${lastProblems.slice(0, 20).join('\n- ')}\nReturn corrected JSON only.`;
  }
  throw new StructuredOutputError('The model did not return valid structured output.', lastProblems);
}
