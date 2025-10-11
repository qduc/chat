import { BaseProvider } from './baseProvider.js';

export class GeminiProvider extends BaseProvider {
  isConfigured() {
    // TODO: check for required Gemini credentials.
  }

  normalizeRequest(_internalRequest) {
    // TODO: adapt internal request into Gemini payload.
  }

  async sendRequest(_normalizedRequest) {
    // TODO: issue HTTP request to Gemini endpoint.
  }

  normalizeResponse(_upstreamResponse) {
    // TODO: translate Gemini response back into internal response format.
  }

  normalizeStreamChunk(_chunk) {
    // TODO: translate Gemini streaming chunk to internal chunk structure.
  }

  getToolsetSpec(_toolRegistry) {
    // TODO: emit Gemini tool schema when the provider supports it.
  }

  supportsTools() {
    // TODO: report Gemini tool support by model.
  }

  supportsReasoningControls(_model) {
    // TODO: report reasoning control availability for Gemini.
  }

  supportsPromptCaching() {
    // Gemini does not currently support explicit prompt caching via message annotations
    return false;
  }

  getDefaultModel() {
    // TODO: determine Gemini default model from configuration.
  }
}
