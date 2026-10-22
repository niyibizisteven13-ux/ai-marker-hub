import type { ProviderAdapter, ProviderChunk, ProviderRequest } from './types.js';

/**
 * Sends each request to the adapter that serves its model id, or to the default adapter.
 * Lets one agent use Gonka for everyday chat and a second provider for the models the router assigns to big tasks.
 */
export class ModelDispatchAdapter implements ProviderAdapter {
  readonly name: string;

  constructor(private defaultAdapter: ProviderAdapter, private byModel: Map<string, ProviderAdapter> = new Map()) {
    this.name = defaultAdapter.name;
  }

  adapterFor(model: string): ProviderAdapter {
    return this.byModel.get(model) ?? this.defaultAdapter;
  }

  stream(req: ProviderRequest): AsyncGenerator<ProviderChunk> {
    return this.adapterFor(req.model).stream(req);
  }
}
