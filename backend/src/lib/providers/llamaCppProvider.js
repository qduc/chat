import { OpenAIProvider } from './openaiProvider.js';

export class LlamaCppProvider extends OpenAIProvider {
  static get defaultBaseUrl() {
    return 'http://localhost:8080/v1';
  }

  getReasoningFormat() {
    return 'llama-cpp';
  }

  isConfigured() {
    return Boolean(this.baseUrl);
  }
}
