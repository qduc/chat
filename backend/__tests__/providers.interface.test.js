import { OpenAIProvider } from '../src/lib/providers/openaiProvider.js';
import { AnthropicProvider } from '../src/lib/providers/anthropicProvider.js';
import { GeminiProvider } from '../src/lib/providers/geminiProvider.js';
import { BaseProvider } from '../src/lib/providers/baseProvider.js';
import { selectProviderConstructor, createProviderWithSettings } from '../src/lib/providers/index.js';

describe('Provider Interface Compliance', () => {
  const providers = [
    { name: 'OpenAIProvider', Provider: OpenAIProvider, expectedTranslation: true },
    { name: 'AnthropicProvider', Provider: AnthropicProvider, expectedTranslation: true },
    { name: 'GeminiProvider', Provider: GeminiProvider, expectedTranslation: true },
  ];

  describe('needsStreamingTranslation()', () => {
    providers.forEach(({ name, Provider, expectedTranslation }) => {
      it(`${name} should implement needsStreamingTranslation()`, () => {
        const instance = new Provider({ config: {}, providerId: 'test' });

        // Verify method exists and returns a boolean
        expect(typeof instance.needsStreamingTranslation).toBe('function');
        const result = instance.needsStreamingTranslation();
        expect(typeof result).toBe('boolean');

        // Verify it returns the expected value
        expect(result).toBe(expectedTranslation);
      });
    });

    it('should throw error if provider does not implement needsStreamingTranslation()', () => {
      // Create a mock class that inherits from BaseProvider but doesn't override needsStreamingTranslation
      class BrokenProvider extends BaseProvider {
        createAdapter() {
          return null;
        }
        async makeHttpRequest() {
          return null;
        }
        // Missing needsStreamingTranslation() should throw
      }

      const instance = new BrokenProvider({ config: {}, providerId: 'test' });

      // Should throw error when calling the method
      expect(() => instance.needsStreamingTranslation()).toThrow(
        /must implement needsStreamingTranslation/
      );
    });
  });

  describe('Required methods', () => {
    const requiredMethods = [
      'createAdapter',
      'makeHttpRequest',
      'needsStreamingTranslation',
      'isConfigured',
    ];

    providers.forEach(({ name, Provider }) => {
      describe(name, () => {
        requiredMethods.forEach(method => {
          it(`should have ${method}() method`, () => {
            const instance = new Provider({ config: {}, providerId: 'test' });
            expect(typeof instance[method]).toBe('function');
          });
        });
      });
    });
  });

  describe('defaultBaseUrl', () => {
    it('OpenAIProvider should have correct default base URL', () => {
      expect(OpenAIProvider.defaultBaseUrl).toBe('https://api.openai.com/v1');
    });

    it('AnthropicProvider should have correct default base URL', () => {
      expect(AnthropicProvider.defaultBaseUrl).toBe('https://api.anthropic.com');
    });

    it('GeminiProvider should have correct default base URL', () => {
      expect(GeminiProvider.defaultBaseUrl).toBe('https://generativelanguage.googleapis.com/v1beta');
    });

    it('selectProviderConstructor should return correct provider class', () => {
      expect(selectProviderConstructor('openai')).toBe(OpenAIProvider);
      expect(selectProviderConstructor('anthropic')).toBe(AnthropicProvider);
      expect(selectProviderConstructor('gemini')).toBe(GeminiProvider);
      // Default to OpenAI for unknown types
      expect(selectProviderConstructor('unknown')).toBe(OpenAIProvider);
    });
  });

  describe('baseUrl resolves from settings or defaults', () => {
    // After cleanup: providers simply use settings.baseUrl || ProviderClass.defaultBaseUrl
    it('GeminiProvider should use default base URL when settings.baseUrl is empty', () => {
      const provider = new GeminiProvider({
        config: {},
        settings: {
          baseUrl: '',  // Empty string - should fall through to default
          apiKey: 'test-key'
        }
      });

      expect(provider.baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta');
    });

    it('GeminiProvider should use provided base URL when settings.baseUrl is non-empty', () => {
      const customUrl = 'https://custom.gemini.endpoint/v1beta';
      const provider = new GeminiProvider({
        config: {},
        settings: {
          baseUrl: customUrl,
          apiKey: 'test-key'
        }
      });

      expect(provider.baseUrl).toBe(customUrl);
    });

    it('createProviderWithSettings should create Gemini provider with correct base URL', () => {
      const config = {};
      const ProviderClass = selectProviderConstructor('gemini');
      const defaultBaseUrl = ProviderClass.defaultBaseUrl;

      const provider = createProviderWithSettings(config, 'gemini', {
        apiKey: 'test-key',
        baseUrl: defaultBaseUrl,
        headers: {}
      });

      expect(provider.baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta');
    });

    it('AnthropicProvider should use default base URL when settings.baseUrl is empty', () => {
      const provider = new AnthropicProvider({
        config: {},
        settings: {
          baseUrl: '',  // Empty string - should fall through to default
          apiKey: 'test-key'
        }
      });

      expect(provider.baseUrl).toBe('https://api.anthropic.com');
    });

    it('AnthropicProvider should use provided base URL', () => {
      const customUrl = 'https://custom.anthropic.proxy/v1';
      const provider = new AnthropicProvider({
        config: {},
        settings: {
          baseUrl: customUrl,
          apiKey: 'test-key'
        }
      });

      expect(provider.baseUrl).toBe('https://custom.anthropic.proxy');
    });

    it('createProviderWithSettings should create Anthropic provider with correct base URL', () => {
      const config = {};
      const ProviderClass = selectProviderConstructor('anthropic');
      const defaultBaseUrl = ProviderClass.defaultBaseUrl;

      const provider = createProviderWithSettings(config, 'anthropic', {
        apiKey: 'test-key',
        baseUrl: defaultBaseUrl,
        headers: {}
      });

      expect(provider.baseUrl).toBe('https://api.anthropic.com');
    });

    it('OpenAIProvider should use default base URL when settings.baseUrl is empty', () => {
      const provider = new OpenAIProvider({
        config: {},
        settings: {
          baseUrl: '',  // Empty string
          apiKey: 'test-key'
        }
      });

      expect(provider.baseUrl).toBe('https://api.openai.com');
    });

    it('OpenAIProvider should use custom OpenAI-compatible URL', () => {
      const customUrl = 'https://custom.openai.proxy/v1';
      const provider = new OpenAIProvider({
        config: {},
        settings: {
          baseUrl: customUrl,
          apiKey: 'test-key'
        }
      });

      // Custom URL should be used (trailing /v1 stripped)
      expect(provider.baseUrl).toBe('https://custom.openai.proxy');
    });

    it('createProviderWithSettings should create OpenAI provider with correct base URL', () => {
      const config = {};
      const ProviderClass = selectProviderConstructor('openai');
      const defaultBaseUrl = ProviderClass.defaultBaseUrl;

      const provider = createProviderWithSettings(config, 'openai', {
        apiKey: 'test-key',
        baseUrl: defaultBaseUrl,
        headers: {}
      });

      expect(provider.baseUrl).toBe('https://api.openai.com');
    });
  });
});
