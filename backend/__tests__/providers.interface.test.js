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

  describe('baseUrl fallback behavior', () => {
    // Regression test: when settings.baseUrl is empty string (falsy),
    // the provider should use its default base URL, not fall through to config.providerConfig.baseUrl
    it('GeminiProvider should use default base URL when settings.baseUrl is empty', () => {
      // This simulates the background refresh scenario where row.base_url is null
      // and was being converted to empty string, causing the provider to use OpenAI URL
      const provider = new GeminiProvider({
        config: {
          providerConfig: { baseUrl: 'https://api.openai.com/v1' }  // Should NOT use this for Gemini
        },
        settings: {
          baseUrl: '',  // Empty string - should fall through to default
          apiKey: 'test-key'
        }
      });

      // The baseUrl getter should return Gemini's default, not OpenAI's
      expect(provider.baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta');
    });

    it('GeminiProvider should use provided base URL when settings.baseUrl is non-empty', () => {
      const customUrl = 'https://custom.gemini.endpoint/v1beta';
      const provider = new GeminiProvider({
        config: { providerConfig: { baseUrl: 'https://api.openai.com/v1' } },
        settings: {
          baseUrl: customUrl,
          apiKey: 'test-key'
        }
      });

      expect(provider.baseUrl).toBe(customUrl);
    });

    it('createProviderWithSettings should create Gemini provider with correct base URL', () => {
      // This tests the fix for the background refresh issue
      const config = { providerConfig: { baseUrl: 'https://api.openai.com/v1' } };
      const ProviderClass = selectProviderConstructor('gemini');
      const defaultBaseUrl = ProviderClass.defaultBaseUrl;

      // When baseUrl is null (as it would be from database for Gemini),
      // we should use the provider's default
      const provider = createProviderWithSettings(config, 'gemini', {
        apiKey: 'test-key',
        baseUrl: defaultBaseUrl,  // This is what the fixed code does
        headers: {}
      });

      expect(provider.baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta');
    });

    // Anthropic provider regression tests
    it('AnthropicProvider should use default base URL when settings.baseUrl is empty', () => {
      const provider = new AnthropicProvider({
        config: {
          providerConfig: { baseUrl: 'https://api.openai.com/v1' }  // Should NOT use this for Anthropic
        },
        settings: {
          baseUrl: '',  // Empty string - should fall through to default
          apiKey: 'test-key'
        }
      });

      // The baseUrl getter should return Anthropic's default, not OpenAI's
      expect(provider.baseUrl).toBe('https://api.anthropic.com');
    });

    it('AnthropicProvider should reject OpenAI URL in settings.baseUrl', () => {
      // If somehow OpenAI URL ends up in settings.baseUrl, it should be ignored
      const provider = new AnthropicProvider({
        config: {},
        settings: {
          baseUrl: 'https://api.openai.com/v1',  // Wrong URL - should be ignored
          apiKey: 'test-key'
        }
      });

      // Should fall back to Anthropic's default, not use OpenAI URL
      expect(provider.baseUrl).toBe('https://api.anthropic.com');
    });

    it('AnthropicProvider should use custom Anthropic-compatible URL', () => {
      const customUrl = 'https://custom.anthropic.proxy/v1';
      const provider = new AnthropicProvider({
        config: { providerConfig: { baseUrl: 'https://api.openai.com/v1' } },
        settings: {
          baseUrl: customUrl,
          apiKey: 'test-key'
        }
      });

      expect(provider.baseUrl).toBe('https://custom.anthropic.proxy');
    });

    it('createProviderWithSettings should create Anthropic provider with correct base URL', () => {
      const config = { providerConfig: { baseUrl: 'https://api.openai.com/v1' } };
      const ProviderClass = selectProviderConstructor('anthropic');
      const defaultBaseUrl = ProviderClass.defaultBaseUrl;

      const provider = createProviderWithSettings(config, 'anthropic', {
        apiKey: 'test-key',
        baseUrl: defaultBaseUrl,
        headers: {}
      });

      expect(provider.baseUrl).toBe('https://api.anthropic.com');
    });

    // OpenAI provider tests (should correctly use OpenAI URL from config)
    it('OpenAIProvider should use default base URL when settings.baseUrl is empty', () => {
      const provider = new OpenAIProvider({
        config: {
          providerConfig: { baseUrl: 'https://api.openai.com/v1' }
        },
        settings: {
          baseUrl: '',  // Empty string
          apiKey: 'test-key'
        }
      });

      // OpenAI should correctly use the OpenAI URL from config (this is expected behavior)
      expect(provider.baseUrl).toBe('https://api.openai.com');
    });

    it('OpenAIProvider should use custom OpenAI-compatible URL', () => {
      const customUrl = 'https://custom.openai.proxy/v1';
      const provider = new OpenAIProvider({
        config: { providerConfig: { baseUrl: 'https://api.openai.com/v1' } },
        settings: {
          baseUrl: customUrl,
          apiKey: 'test-key'
        }
      });

      // Custom URL should be used (trailing /v1 stripped)
      expect(provider.baseUrl).toBe('https://custom.openai.proxy');
    });

    it('createProviderWithSettings should create OpenAI provider with correct base URL', () => {
      const config = { providerConfig: { baseUrl: 'https://api.openai.com/v1' } };
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
