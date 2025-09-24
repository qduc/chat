import assert from 'node:assert/strict';
import { jest } from '@jest/globals';

// Mock the dependencies
let mockProviderIsConfigured = () => Promise.resolve(true);
let mockCreateOpenAIRequest = () => Promise.resolve({
  ok: true,
  json: () => Promise.resolve({
    choices: [{
      message: {
        content: 'Generated Title',
      },
    }],
  }),
});

// Mock the modules
jest.unstable_mockModule('../../src/lib/streamUtils.js', () => ({
  createOpenAIRequest: (...args) => mockCreateOpenAIRequest(...args),
}));

jest.unstable_mockModule('../../src/lib/providers/index.js', () => ({
  providerIsConfigured: (...args) => mockProviderIsConfigured(...args),
}));


describe('ConversationTitleService', () => {
  let ConversationTitleService;
  let titleService;
  const mockConfig = {
    titleModel: 'gpt-3.5-turbo',
    defaultModel: 'gpt-4',
  };

  beforeAll(async () => {
    ({ ConversationTitleService } = await import('../../src/lib/persistence/ConversationTitleService.js'));
  });

  beforeEach(() => {
    titleService = new ConversationTitleService(mockConfig);
    // Reset mocks
    mockProviderIsConfigured = () => Promise.resolve(true);
    mockCreateOpenAIRequest = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        choices: [{
          message: {
            content: 'Generated Title',
          },
        }],
      }),
    });
  });

  describe('generateFallbackTitle', () => {
    test('should generate title from first 6 words', () => {
      const content = 'This is a long user message that should be truncated';
      const result = titleService.generateFallbackTitle(content);

      assert.equal(result, 'This is a long user message');
    });

    test('should handle short content', () => {
      const content = 'Short message';
      const result = titleService.generateFallbackTitle(content);

      assert.equal(result, 'Short message');
    });

    test('should handle empty content', () => {
      const result = titleService.generateFallbackTitle('');

      assert.equal(result, null);
    });

    test('should replace line breaks with spaces', () => {
      const content = 'Multi\nline\rmessage with breaks';
      const result = titleService.generateFallbackTitle(content);

      assert.equal(result, 'Multi line message with breaks');
    });

    test('should truncate long titles', () => {
      const content = 'A'.repeat(85);
      const result = titleService.generateFallbackTitle(content);

      assert.ok(result.length <= 80);
      assert.ok(result.endsWith('…'));
    });
  });

  describe('generateTitle', () => {
    test('should generate title via API when configured', async () => {
      mockProviderIsConfigured = () => Promise.resolve(true);
      mockCreateOpenAIRequest = () => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          choices: [{
            message: {
              content: '  "API Generated Title"  ',
            },
          }],
        }),
      });

      const result = await titleService.generateTitle('Test content', 'test-provider');

      assert.equal(result, 'API Generated Title');
    });

    test('should fallback when provider not configured', async () => {
      mockProviderIsConfigured = () => Promise.resolve(false);

      const result = await titleService.generateTitle('Test content for fallback', 'test-provider');

      assert.equal(result, 'Test content for fallback');
    });

    test('should fallback when API request fails', async () => {
      mockProviderIsConfigured = () => Promise.resolve(true);
      mockCreateOpenAIRequest = () => Promise.resolve({
        ok: false,
      });

      const result = await titleService.generateTitle('Test content for fallback', 'test-provider');

      assert.equal(result, 'Test content for fallback');
    });

    test('should handle API errors gracefully', async () => {
      mockProviderIsConfigured = () => Promise.resolve(true);
      mockCreateOpenAIRequest = () => Promise.reject(new Error('API Error'));

      const result = await titleService.generateTitle('Test content for fallback', 'test-provider');

      assert.equal(result, 'Test content for fallback');
    });

    test('should truncate long content for API request', async () => {
      const longContent = 'A'.repeat(600);
      mockProviderIsConfigured = () => Promise.resolve(true);

      let requestBody;
      mockCreateOpenAIRequest = (config, body) => {
        requestBody = body;
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            choices: [{
              message: {
                content: 'Title for Long Content',
              },
            }],
          }),
        });
      };

      await titleService.generateTitle(longContent, 'test-provider');

      const userMessage = requestBody.messages.find(m => m.role === 'user');
      assert.ok(userMessage.content.includes('…'));
      assert.ok(userMessage.content.length < longContent.length + 50); // Account for prompt text
    });

    test('should handle empty API response', async () => {
      mockProviderIsConfigured = () => Promise.resolve(true);
      mockCreateOpenAIRequest = () => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          choices: [{
            message: {
              content: '',
            },
          }],
        }),
      });

      const result = await titleService.generateTitle('Test content for fallback', 'test-provider');

      assert.equal(result, 'Test content for fallback');
    });

    test('should clean up generated title', async () => {
      mockProviderIsConfigured = () => Promise.resolve(true);
      mockCreateOpenAIRequest = () => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          choices: [{
            message: {
              content: '  "Title with\nLine Breaks"  \n',
            },
          }],
        }),
      });

      const result = await titleService.generateTitle('Test content', 'test-provider');

      assert.equal(result, 'Title with Line Breaks');
    });

    test('should truncate very long generated titles', async () => {
      mockProviderIsConfigured = () => Promise.resolve(true);
      mockCreateOpenAIRequest = () => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          choices: [{
            message: {
              content: 'A'.repeat(85),
            },
          }],
        }),
      });

      const result = await titleService.generateTitle('Test content', 'test-provider');

      assert.ok(result.length <= 80);
      assert.ok(result.endsWith('…'));
    });
  });

  describe('extractSystemPrompt', () => {
    test('should extract from systemPrompt field', () => {
      const bodyIn = { systemPrompt: '  System prompt  ' };
      const result = ConversationTitleService.extractSystemPrompt(bodyIn);

      assert.equal(result, 'System prompt');
    });

    test('should extract from system_prompt field', () => {
      const bodyIn = { system_prompt: '  Alternative field  ' };
      const result = ConversationTitleService.extractSystemPrompt(bodyIn);

      assert.equal(result, 'Alternative field');
    });

    test('should prefer systemPrompt over system_prompt', () => {
      const bodyIn = {
        systemPrompt: 'Primary',
        system_prompt: 'Secondary',
      };
      const result = ConversationTitleService.extractSystemPrompt(bodyIn);

      assert.equal(result, 'Primary');
    });

    test('should return empty string when missing', () => {
      const bodyIn = {};
      const result = ConversationTitleService.extractSystemPrompt(bodyIn);

      assert.equal(result, '');
    });
  });

  describe('findLastUserMessage', () => {
    test('should find last user message', () => {
      const messages = [
        { role: 'system', content: 'System' },
        { role: 'user', content: 'First user' },
        { role: 'assistant', content: 'Response' },
        { role: 'user', content: 'Second user' },
      ];

      const result = ConversationTitleService.findLastUserMessage(messages);

      assert.equal(result.content, 'Second user');
    });

    test('should skip system messages', () => {
      const messages = [
        { role: 'system', content: 'System' },
        { role: 'user', content: 'User message' },
        { role: 'system', content: 'Another system' },
      ];

      const result = ConversationTitleService.findLastUserMessage(messages);

      assert.equal(result.content, 'User message');
    });

    test('should return null when no user messages', () => {
      const messages = [
        { role: 'system', content: 'System' },
        { role: 'assistant', content: 'Assistant' },
      ];

      const result = ConversationTitleService.findLastUserMessage(messages);

      assert.equal(result, null);
    });

    test('should handle invalid messages', () => {
      const messages = [
        null,
        { role: 'user' }, // Missing content
        { content: 'No role' }, // Missing role
        { role: 'user', content: 'Valid' },
      ];

      const result = ConversationTitleService.findLastUserMessage(messages);

      assert.equal(result.content, 'Valid');
    });
  });
});
