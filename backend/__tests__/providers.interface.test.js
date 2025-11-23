import { OpenAIProvider } from '../src/lib/providers/openaiProvider.js';
import { AnthropicProvider } from '../src/lib/providers/anthropicProvider.js';
import { GeminiProvider } from '../src/lib/providers/geminiProvider.js';
import { BaseProvider } from '../src/lib/providers/baseProvider.js';

describe('Provider Interface Compliance', () => {
  const providers = [
    { name: 'OpenAIProvider', Provider: OpenAIProvider, expectedTranslation: false },
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
});
