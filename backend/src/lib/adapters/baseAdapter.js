// BaseAdapter defines the interface for translating between the internal
// request/response shapes and the upstream provider API contracts.
export class BaseAdapter {
  constructor(options = {}) {
    this.config = options.config;
    this.settings = options.settings;
  }

  // Map the internal request format into the provider-specific payload.
  translateRequest(_internalRequest, _context = {}) {
    throw new Error('translateRequest must be implemented');
  }

  // Convert the provider response into the internal response structure.
  translateResponse(_providerResponse, _context = {}) {
    throw new Error('translateResponse must be implemented');
  }

  // Translate streaming chunks into the internal streaming event shape.
  translateStreamChunk(_chunk, _context = {}) {
    throw new Error('translateStreamChunk must be implemented');
  }
}
