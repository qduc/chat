// Base class coordinating adapter-driven request/response translation for providers.
export class BaseProvider {
  constructor(options = {}) {
    this.config = options.config;
    this.providerId = options.providerId;
    this.http = options.http;
    this.settings = options.settings || {};
    this.adapter = null;
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

  translateRequest(internalRequest = {}, context = {}) {
    const adapterContext = this.buildAdapterContext(context);
    return this.getAdapter().translateRequest(internalRequest, adapterContext);
  }

  translateResponse(providerResponse, context = {}) {
    const adapterContext = this.buildAdapterContext(context);
    return this.getAdapter().translateResponse(providerResponse, adapterContext);
  }

  translateStreamChunk(chunk, context = {}) {
    const adapterContext = this.buildAdapterContext(context);
    return this.getAdapter().translateStreamChunk(chunk, adapterContext);
  }

  async sendRequest(internalRequest = {}, context = {}) {
    const adapterContext = this.buildAdapterContext(context);
    const translatedRequest = this.getAdapter().translateRequest(internalRequest, adapterContext);
    const providerResponse = await this.makeHttpRequest(translatedRequest, adapterContext);
    return this.getAdapter().translateResponse(providerResponse, adapterContext);
  }

  async streamRequest(internalRequest = {}, context = {}) {
    const adapterContext = this.buildAdapterContext(context);
    const translatedRequest = this.getAdapter().translateRequest(internalRequest, adapterContext);
    const providerResponse = await this.makeStreamRequest(translatedRequest, adapterContext);
    return this.getAdapter().translateResponse(providerResponse, adapterContext);
  }

  // Subclasses must provide the HTTP invocation used by sendRequest/streamRequest.
  async makeHttpRequest(_translatedRequest, _context = {}) {
    throw new Error('makeHttpRequest must be implemented');
  }

  async makeStreamRequest(translatedRequest, context = {}) {
    return this.makeHttpRequest(translatedRequest, context);
  }

  // Backward-compatibility helpers for legacy callers.
  normalizeRequest(internalRequest = {}, context = {}) {
    return this.translateRequest(internalRequest, context);
  }

  normalizeResponse(providerResponse, context = {}) {
    return this.translateResponse(providerResponse, context);
  }

  normalizeStreamChunk(chunk, context = {}) {
    return this.translateStreamChunk(chunk, context);
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

  getDefaultModel() {
    // TODO: provide the default model identifier for this provider.
    return this.config?.defaultModel;
  }

  isConfigured() {
    // TODO: verify that the provider has the minimum configuration to run.
    return false;
  }
}
