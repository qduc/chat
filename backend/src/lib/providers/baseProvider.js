// Base class coordinating adapter-driven request/response translation for providers.
export class BaseProvider {
  constructor(options = {}) {
    this.config = options.config;
    this.providerId = options.providerId;
    this.http = options.http;
    this.settings = options.settings || {};
    this.adapter = null;
  }

  static get defaultBaseUrl() {
    return null;
  }

  get httpClient() {
    if (this.http) return this.http;
    if (typeof globalThis.fetch === 'function') {
      return globalThis.fetch.bind(globalThis);
    }
    return null;
  }

  createAdapter() {
    throw new Error('createAdapter must be implemented');
  }

  refreshAdapter() {
    this.adapter = null;
    return this.getAdapter();
  }

  getAdapter() {
    if (!this.adapter) {
      this.adapter = this.createAdapter();
    }
    return this.adapter;
  }

  // Allow subclasses to extend the adapter context with provider-specific data.
  buildAdapterContext(context = {}) {
    return context;
  }

  async translateRequest(internalRequest = {}, context = {}) {
    const adapterContext = this.buildAdapterContext(context);
    return await this.getAdapter().translateRequest(internalRequest, adapterContext);
  }

  async translateResponse(providerResponse, context = {}) {
    const adapterContext = this.buildAdapterContext(context);
    return await this.getAdapter().translateResponse(providerResponse, adapterContext);
  }

  translateStreamChunk(chunk, context = {}) {
    const adapterContext = this.buildAdapterContext(context);
    return this.getAdapter().translateStreamChunk(chunk, adapterContext);
  }

  async sendRequest(internalRequest = {}, context = {}) {
    const adapterContext = this.buildAdapterContext(context);
    const translatedRequest = await this.translateRequest(internalRequest, adapterContext);
    const providerResponse = await this.makeHttpRequest(translatedRequest, adapterContext);
    return await this.getAdapter().translateResponse(providerResponse, adapterContext);
  }

  /**
   * Execute a request but return the raw upstream response for callers that
   * need full Response semantics (status, headers, body stream).
   */
  async sendRawRequest(internalRequest = {}, context = {}) {
    const adapterContext = this.buildAdapterContext(context);
    const translatedRequest = await this.translateRequest(internalRequest, adapterContext);
    return await this.makeHttpRequest(translatedRequest, adapterContext);
  }

  async streamRequest(internalRequest = {}, context = {}) {
    const adapterContext = this.buildAdapterContext(context);
    const translatedRequest = await this.translateRequest(internalRequest, adapterContext);
    const providerResponse = await this.makeStreamRequest(translatedRequest, adapterContext);
    return await this.getAdapter().translateResponse(providerResponse, adapterContext);
  }

  // Subclasses must provide the HTTP invocation used by sendRequest/streamRequest.
  async makeHttpRequest(_translatedRequest, _context = {}) {
    throw new Error('makeHttpRequest must be implemented');
  }

  async makeStreamRequest(translatedRequest, context = {}) {
    return this.makeHttpRequest(translatedRequest, context);
  }

  // Backward-compatibility helpers for legacy callers.
  async normalizeRequest(internalRequest = {}, context = {}) {
    return await this.translateRequest(internalRequest, context);
  }

  async normalizeResponse(providerResponse, context = {}) {
    return await this.translateResponse(providerResponse, context);
  }

  normalizeStreamChunk(chunk, context = {}) {
    return this.translateStreamChunk(chunk, context);
  }

  normalizeModelEntry(model) {
    if (!model) return null;
    if (typeof model === 'string') {
      return { id: model };
    }
    if (typeof model.name === 'string' && !model.id && model.name.startsWith('models/')) {
      return {
        ...model,
        id: model.name.replace('models/', ''),
      };
    }
    if (model.id) {
      return model;
    }
    return null;
  }

  normalizeModelListPayload(payload) {
    let models = [];
    if (Array.isArray(payload?.data)) models = payload.data;
    else if (Array.isArray(payload?.models)) models = payload.models;
    else if (Array.isArray(payload)) models = payload;

    return models.map((model) => this.normalizeModelEntry(model)).filter(Boolean);
  }

  async listModels(_options = {}) {
    throw new Error(`${this.constructor.name} does not implement listModels`);
  }

  getToolsetSpec(_toolRegistry) {
    // TODO: expose the tool schema that this provider understands.
    return [];
  }

  supportsTools() {
    // TODO: indicate whether the provider supports tool invocation.
    return false;
  }

  supportsReasoningControls(_model) {
    // TODO: report whether reasoning controls are available for the model.
    return false;
  }

  supportsPromptCaching() {
    // TODO: report whether the provider supports prompt caching.
    return false;
  }

  needsStreamingTranslation() {
    throw new Error(
      `${this.constructor.name} must implement needsStreamingTranslation(). ` +
      `Return true if this provider's API format differs from OpenAI format; ` +
      `return false only if the provider uses OpenAI-compatible format.`
    );
  }

  getDefaultModel() {
    // TODO: provide the default model identifier for this provider.
    return this.config?.defaultModel;
  }

  isConfigured() {
    // TODO: verify that the provider has the minimum configuration to run.
    return false;
  }
}

export class ProviderModelsError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'ProviderModelsError';
    this.status = status;
    this.body = body;
  }
}
