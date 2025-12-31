import { ChatCompletionsAdapter } from '../src/lib/adapters/chatCompletionsAdapter.js';

/**
 * Tests for image generation capability in adapters
 */

describe('Image Generation Request Parameters', () => {
  describe('ChatCompletionsAdapter', () => {
    function createAdapter(overrides = {}) {
      return new ChatCompletionsAdapter({
        getDefaultModel: () => 'test-model',
        supportsReasoningControls: () => false,
        ...overrides,
      });
    }

    it('should pass through image_config in request', async () => {
      const adapter = createAdapter();
      
      const request = {
        model: 'test-model',
        messages: [{ role: 'user', content: 'Generate an image' }],
        modalities: ['image', 'text'],
        image_config: { aspect_ratio: '16:9', size: '2K' }
      };
      
      const translated = await adapter.translateRequest(request);
      
      // image_config should be passed through
      expect(translated.image_config).toBeDefined();
      expect(translated.image_config.aspect_ratio).toBe('16:9');
      expect(translated.image_config.size).toBe('2K');
    });

    it('should pass through modalities in request', async () => {
      const adapter = createAdapter();
      
      const request = {
        model: 'test-model',
        messages: [{ role: 'user', content: 'Generate an image' }],
        modalities: ['image', 'text']
      };
      
      const translated = await adapter.translateRequest(request);
      
      // modalities should be passed through
      expect(translated.modalities).toBeDefined();
      expect(translated.modalities).toContain('image');
      expect(translated.modalities).toContain('text');
    });

    it('should not include image_config when not provided', async () => {
      const adapter = createAdapter();
      
      const request = {
        model: 'test-model',
        messages: [{ role: 'user', content: 'Just text' }]
      };
      
      const translated = await adapter.translateRequest(request);
      
      // image_config should not be present
      expect(translated.image_config).toBeUndefined();
    });
  });
});

describe('Image Generation Streaming Response Format', () => {
  describe('Delta image format', () => {
    it('should have correct structure for streaming images', () => {
      // This test documents the expected format from OpenRouter/providers
      const expectedDeltaWithImages = {
        id: 'chatcmpl-123',
        choices: [{
          index: 0,
          delta: {
            content: 'Here is your image:',
            images: [
              {
                image_url: {
                  url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
                }
              }
            ]
          },
          finish_reason: null
        }]
      };

      // Verify structure
      expect(expectedDeltaWithImages.choices[0].delta.images).toBeDefined();
      expect(Array.isArray(expectedDeltaWithImages.choices[0].delta.images)).toBe(true);
      expect(expectedDeltaWithImages.choices[0].delta.images[0].image_url.url).toContain('data:image');
    });
  });

  describe('Message image format', () => {
    it('should have correct structure for non-streaming images', () => {
      // This test documents the expected format from providers for non-streaming
      const expectedMessageWithImages = {
        id: 'chatcmpl-123',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: 'Here is your image:',
            images: [
              {
                image_url: {
                  url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
                }
              }
            ]
          },
          finish_reason: 'stop'
        }]
      };

      // Verify structure
      expect(expectedMessageWithImages.choices[0].message.images).toBeDefined();
      expect(Array.isArray(expectedMessageWithImages.choices[0].message.images)).toBe(true);
      expect(expectedMessageWithImages.choices[0].message.images[0].image_url.url).toContain('data:image');
    });
  });
});
