// Base class defining the provider interface responsible for adapting requests and responses.
export class BaseProvider {
  constructor(options = {}) {
    this.config = options.config;
    this.providerId = options.providerId;
    this.http = options.http;
    this.settings = options.settings;
  }

  isConfigured() {
    // TODO: verify that the provider has the minimum configuration to run.
    return false;
  }

  normalizeRequest(_internalRequest) {
    // TODO: map the internal request format to the provider's API payload.
    return _internalRequest;
  }

  sendRequest(_normalizedRequest) {
    // TODO: perform the upstream call for the provider.
    throw new Error('sendRequest not implemented for provider');
  }

  normalizeResponse(_upstreamResponse) {
    // TODO: translate the provider response back into the internal format.
    return _upstreamResponse;
  }

  normalizeStreamChunk(_chunk) {
    // TODO: translate streaming chunks into the internal event format.
    return _chunk;
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
}
