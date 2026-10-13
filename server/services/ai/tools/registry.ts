import * as AjvNs from 'ajv';
import type { ValidateFunction } from 'ajv';
import type { Tool, ToolDefinition } from '../types.js';

type AjvCtor = typeof import('ajv').default;
// Ajv is CommonJS with a default export; unwrap it for NodeNext ESM.
const Ajv: AjvCtor = ((AjvNs as any).default?.default ?? (AjvNs as any).default ?? AjvNs) as AjvCtor;

/** Holds tools, exposes their definitions to the model, and validates model-supplied arguments. */
export class ToolRegistry {
  private tools = new Map<string, Tool>();
  private validators = new Map<string, ValidateFunction>();
  private ajv = new Ajv({ allErrors: true, strict: false, useDefaults: true });

  constructor(tools: Tool[] = []) {
    tools.forEach((t) => this.add(t));
  }

  add(tool: Tool): this {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(tool.definition.name)) throw new Error(`Invalid tool name: ${tool.definition.name}`);
    this.tools.set(tool.definition.name, tool);
    this.validators.set(tool.definition.name, this.ajv.compile(tool.definition.parameters));
    return this;
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  names(): string[] {
    return [...this.tools.keys()];
  }

  definitions(only?: string[]): ToolDefinition[] {
    return [...this.tools.values()].filter((t) => !only || only.includes(t.definition.name)).map((t) => t.definition);
  }

  /** Returns null when valid, otherwise a short message the model can use to fix its call. */
  validate(name: string, input: unknown): string | null {
    const v = this.validators.get(name);
    if (!v) return `Unknown tool: ${name}`;
    if (v(input)) return null;
    return (v.errors ?? []).slice(0, 5).map((e) => `${e.instancePath || '(root)'} ${e.message}`).join('; ');
  }

  /** Anthropic tool format, for the existing Claude loop. */
  toAnthropicTools(only?: string[]) {
    return this.definitions(only).map((d) => ({ name: d.name, description: d.description, input_schema: d.parameters }));
  }
}
