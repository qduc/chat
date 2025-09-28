import { BaseProvider } from './baseProvider.js';

export class AnthropicProvider extends BaseProvider {
  isConfigured() {
    // TODO: check for required Anthropic credentials.
  }

  normalizeRequest(_internalRequest) {
    // TODO: adapt internal request into Anthropic Messages payload.
  }

  async sendRequest(_normalizedRequest) {
    // TODO: issue HTTP request to Anthropic endpoint.
  }

  normalizeResponse(_upstreamResponse) {
    // TODO: translate Anthropic response back into internal response format.
  }

  normalizeStreamChunk(_chunk) {
    // TODO: translate Anthropic streaming chunk to internal chunk structure.
  }

  getToolsetSpec(_toolRegistry) {
    // TODO: emit Anthropic tool schema when the provider supports it.
  }

  supportsTools() {
    // TODO: report Anthropic tool support by model.
  }

  supportsReasoningControls(_model) {
    // TODO: report reasoning control availability for Anthropic.
  }

  getDefaultModel() {
    // TODO: determine Anthropic default model from configuration.
  }
}
